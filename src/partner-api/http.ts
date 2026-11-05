import { createHash, timingSafeEqual } from 'node:crypto'
import { addDataAndFileToRequest, type Endpoint, type PayloadHandler, type PayloadRequest } from 'payload'
import { z, type ZodType } from 'zod'
import type { Partner } from '@/payload-types'
import { derivedPassword } from '../lib/otp'
import { domainErrorOf, isUniqueViolation } from '../lib/partner/sys'

export const API_PREFIX = '/partner/v1'

export interface ApiError {
  ok: false
  error: string
  field?: string
  params?: Record<string, string | number>
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public field?: string,
    public params?: Record<string, string | number>,
  ) {
    super(code)
  }
}

export const fail = (status: number, code: string, field?: string, params?: Record<string, string | number>) =>
  new HttpError(status, code, field, params)

const NO_STORE = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' }

/**
 * The dwaar Partner app is a separate web/native client on another origin. Auth is header-only
 * (app key + Bearer token, never cookies), so any origin may call and credentials stay off.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Accept, Authorization, X-Dwaar-Partner-Key, X-Dwaar-User-Id, X-Dwaar-User-Email, X-Dwaar-User-Name, Idempotency-Key',
  'Access-Control-Expose-Headers': 'Idempotent-Replay, Content-Disposition',
  'Access-Control-Max-Age': '86400',
}

function withCors(res: Response) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v)
  return res
}

/** Browser preflight (OPTIONS) for every partner route path. */
export function preflightFor(endpoints: Endpoint[]): Endpoint[] {
  const paths = [...new Set(endpoints.map((e) => e.path))]
  return paths.map((path) => ({ path, method: 'options' as const, handler: async () => withCors(new Response(null, { status: 204 })) }))
}

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...NO_STORE, ...extraHeaders } })
}

function errorResponse(err: HttpError) {
  const body: ApiError = { ok: false, error: err.code }
  if (err.field) body.field = err.field
  if (err.params) body.params = err.params
  return json(body, err.status)
}

/** Constant-time check of X-Dwaar-Partner-Key against PARTNER_API_KEY (server-only env). */
function checkApiKey(req: PayloadRequest) {
  const expected = process.env.PARTNER_API_KEY
  if (!expected) throw fail(503, 'partner_api_not_configured')
  const given = req.headers.get('x-dwaar-partner-key')
  if (!given) throw fail(401, 'missing_api_key')
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw fail(401, 'invalid_api_key')
}

function decodeExp(token: string): number | null {
  try {
    const body = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number }
    return typeof body.exp === 'number' ? body.exp : null
  } catch {
    return null
  }
}

/** Our own partner token (from /auth/otp/verify), or null when the token is missing or not ours. */
async function partnerFromToken(req: PayloadRequest, token: string | null): Promise<Partner | null> {
  if (!token) return null
  const exp = decodeExp(token)
  if (exp && exp * 1000 <= Date.now()) return null
  try {
    const { user } = await req.payload.auth({ headers: new Headers({ Authorization: `JWT ${token}` }) })
    const partner = user as (Partner & { collection?: string }) | null
    return partner && partner.collection === 'partners' ? partner : null
  } catch {
    return null
  }
}

export interface ExternalIdentity {
  userId: string
  email: string | null
  name: string | null
}

const EXTERNAL_ID = /^[A-Za-z0-9._:@|+=-]{1,128}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/

/**
 * The Partner app's own login, passed as headers: X-Dwaar-User-Id (required), X-Dwaar-User-Email
 * and X-Dwaar-User-Name (URL-encoded). Returns null when no user id header was sent.
 */
export function readExternalIdentity(headers: Headers): ExternalIdentity | null {
  const userId = headers.get('x-dwaar-user-id')?.trim()
  if (!userId) return null
  if (!EXTERNAL_ID.test(userId)) throw fail(400, 'invalid_identity', 'X-Dwaar-User-Id')
  const email = headers.get('x-dwaar-user-email')?.trim().toLowerCase() || null
  if (email && (email.length > 254 || !EMAIL.test(email))) throw fail(400, 'invalid_identity', 'X-Dwaar-User-Email')
  let name: string | null = null
  const rawName = headers.get('x-dwaar-user-name')
  if (rawName) {
    try {
      // Form-style encoders send spaces as "+"; encodeURIComponent never leaves a literal "+".
      name = decodeURIComponent(rawName.replace(/\+/g, ' '))
    } catch {
      throw fail(400, 'invalid_identity', 'X-Dwaar-User-Name')
    }
    name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) || null
  }
  return { userId, email, name }
}

/** Stable, phone-free username and server-only password for a Partner app login. */
export function externalCredentials(secret: string, userId: string) {
  return {
    username: `ext-${createHash('sha256').update(userId).digest('hex').slice(0, 24)}`,
    password: derivedPassword(secret, `partner-ext:${userId}`),
  }
}

/**
 * Finds the partner linked to a Partner app user id, creating one in `pending_verification` the
 * first time. Server-owned fields are written only here; the email follows the latest header.
 */
export async function partnerFromExternalIdentity(req: PayloadRequest, identity: ExternalIdentity): Promise<Partner> {
  const payload = req.payload
  const lookup = async () =>
    (await payload.find({ collection: 'partners', overrideAccess: true, depth: 0, limit: 1, where: { externalUserId: { equals: identity.userId } } }))
      .docs[0] as Partner | undefined
  let partner = await lookup()
  if (!partner) {
    const { username, password } = externalCredentials(payload.secret, identity.userId)
    try {
      partner = (await payload.create({
        collection: 'partners',
        overrideAccess: true,
        depth: 0,
        data: {
          username,
          password,
          externalUserId: identity.userId,
          externalEmail: identity.email,
          name: identity.name,
          verificationStatus: 'pending_verification',
          accountStatus: 'active',
        },
      })) as Partner
    } catch (err) {
      // Two first requests raced: the other one created the partner.
      if (!isUniqueViolation(err)) throw err
      partner = await lookup()
      if (!partner) throw err
    }
  } else if (identity.email && partner.externalEmail !== identity.email) {
    partner = (await payload.update({ collection: 'partners', id: partner.id, overrideAccess: true, depth: 0, data: { externalEmail: identity.email } })) as Partner
  }
  return partner
}

/**
 * Resolves the partner. Our own `Authorization: Bearer <token>` wins (validated by payload.auth on
 * an isolated Headers object, no cookies, and it must belong to `partners`). If the token is
 * missing or not ours, the X-Dwaar-User-* headers identify the partner instead. The partner key
 * has already been checked by the caller.
 */
async function authenticate(req: PayloadRequest): Promise<{ partner: Partner; token: string }> {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? null
  let partner = await partnerFromToken(req, token)
  let ownToken = partner ? (token as string) : ''
  if (!partner) {
    const identity = readExternalIdentity(req.headers)
    if (!identity) {
      if (!token) throw fail(401, 'missing_token')
      const exp = decodeExp(token)
      throw fail(401, exp && exp * 1000 <= Date.now() ? 'token_expired' : 'invalid_token')
    }
    partner = await partnerFromExternalIdentity(req, identity)
    ownToken = ''
  }
  if (partner.accountStatus === 'deleted') throw fail(401, 'account_deleted')
  return { partner, token: ownToken }
}

export interface Ctx<B> {
  req: PayloadRequest
  partner: Partner
  /** Our own session token, or '' when the partner came in through the X-Dwaar-User-* headers. */
  token: string
  body: B
  params: Record<string, string>
  query: URLSearchParams
}

type Method = 'get' | 'post' | 'patch'

interface RouteOptions<S extends ZodType | undefined> {
  /** Requires a partner token (default true). */
  auth?: boolean
  body?: S
  /** Multipart upload: `file` plus plain form fields (or Payload's `_payload` JSON field). */
  multipart?: boolean
}

function isInvalidFile(err: unknown) {
  const e = err as { name?: string; data?: { errors?: { path?: string }[] } } | null
  return e?.name === 'ValidationError' && (e.data?.errors ?? []).some((x) => x.path === 'file')
}

/** Largest request body a partner upload may send (the biggest file allowed is a 50 MB video). */
export const MAX_UPLOAD_BYTES = 55 * 1024 * 1024

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

/** The file's declared type, or (when a client sends none / octet-stream) the type its extension implies. */
export function mimeOf(file: { type?: string; name?: string }) {
  const declared = (file.type ?? '').split(';')[0].trim().toLowerCase()
  if (declared && declared !== 'application/octet-stream') return declared
  const ext = (file.name ?? '').split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? declared
}

/**
 * Reads a multipart body with request.formData(). Plain string fields (type, kind, expiresAt,
 * idempotencyKey…) become the body; a `_payload` JSON field is merged in too (it wins on
 * conflicts). Empty fields count as not sent. The `file` part becomes `req.file` for handlers.
 */
async function readMultipart(req: PayloadRequest): Promise<Record<string, unknown>> {
  const size = Number(req.headers.get('content-length') ?? 0)
  if (size > MAX_UPLOAD_BYTES) throw fail(413, 'file_too_large', 'file')
  let form: FormData
  try {
    form = await (req as unknown as Request).formData()
  } catch {
    throw fail(400, 'invalid_body')
  }
  const fields: Record<string, unknown> = {}
  for (const [key, value] of form.entries()) {
    if (key === 'file' || key === '_payload' || typeof value !== 'string') continue
    const v = value.trim()
    if (v !== '') fields[key] = v
  }
  const extra = form.get('_payload')
  if (typeof extra === 'string' && extra.trim()) {
    try {
      Object.assign(fields, JSON.parse(extra))
    } catch {
      throw fail(400, 'invalid_body', '_payload')
    }
  }
  const file = form.get('file')
  if (file && typeof file !== 'string' && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) throw fail(413, 'file_too_large', 'file')
    req.file = { data: Buffer.from(await file.arrayBuffer()), mimetype: mimeOf(file), name: file.name || 'upload', size: file.size }
  } else {
    req.file = undefined
  }
  req.data = fields
  return fields
}

const idempotencyKey = z.string().trim().min(8).max(100)

/** Idempotency scope: the caller, the route and the key. */
async function claimIdempotency(req: PayloadRequest, scopeKey: string): Promise<Response | null> {
  try {
    await req.payload.create({ collection: 'idempotency-keys', overrideAccess: true, data: { scopeKey, state: 'pending' } })
    return null
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
  }
  const { docs } = await req.payload.find({
    collection: 'idempotency-keys',
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: { scopeKey: { equals: scopeKey } },
  })
  const prior = docs[0]
  if (prior?.state === 'done') return json(prior.response, prior.statusCode ?? 200, { 'Idempotent-Replay': 'true' })
  throw fail(409, 'request_in_progress')
}

async function settleIdempotency(req: PayloadRequest, scopeKey: string, status: number, body: unknown) {
  if (status >= 200 && status < 300) {
    await req.payload.update({
      collection: 'idempotency-keys',
      overrideAccess: true,
      where: { scopeKey: { equals: scopeKey } },
      data: { state: 'done', statusCode: status, response: body as Record<string, unknown> },
    })
  } else {
    // Failed writes left nothing behind, so the same key may be retried.
    await req.payload.delete({ collection: 'idempotency-keys', overrideAccess: true, where: { scopeKey: { equals: scopeKey } } })
  }
}

/**
 * Declares one partner API route. Every request needs the app key; authenticated routes need a
 * partner token; bodies are validated with zod; writes need an idempotencyKey (body field or
 * `Idempotency-Key` header) and replay their first successful response.
 */
export function route<S extends ZodType | undefined = undefined>(
  method: Method,
  path: string,
  opts: RouteOptions<S>,
  handler: (ctx: Ctx<S extends ZodType ? z.infer<S> : Record<string, never>>) => Promise<{ status?: number; body: Record<string, unknown> } | Response>,
): Endpoint {
  const requireAuth = opts.auth !== false
  const isWrite = method !== 'get'
  const handle = async (req: PayloadRequest): Promise<Response> => {
    let scopeKey: string | null = null
    try {
      checkApiKey(req)
      const who = requireAuth ? await authenticate(req) : null
      let raw: Record<string, unknown> = {}
      if (isWrite) {
        const contentType = (req.headers.get('content-type') ?? '').toLowerCase()
        if (contentType.startsWith('multipart/form-data')) raw = await readMultipart(req)
        else {
          await addDataAndFileToRequest(req)
          raw = (req.data ?? {}) as Record<string, unknown>
        }
      }
      // The idempotency key may come as a body field or as the Idempotency-Key header.
      const headerKey = req.headers.get('idempotency-key')?.trim()
      if (isWrite && raw.idempotencyKey === undefined && headerKey) raw = { ...raw, idempotencyKey: headerKey }
      const query = new URL(req.url ?? 'http://localhost').searchParams
      let body: unknown = {}
      if (opts.body) {
        const parsed = opts.body.safeParse(raw)
        if (!parsed.success) {
          const issue = parsed.error.issues[0]
          throw fail(400, 'invalid_body', issue?.path.join('.') || undefined)
        }
        body = parsed.data
      }
      if (isWrite) {
        const key = idempotencyKey.safeParse(raw.idempotencyKey ?? req.headers.get('idempotency-key'))
        if (!key.success) throw fail(400, 'idempotency_key_required', 'idempotencyKey')
        const caller = who ? `p:${who.partner.id}` : `phone:${String(raw.phone ?? '').replace(/\D/g, '').slice(-10)}`
        const params = Object.values(req.routeParams ?? {}).join(':')
        scopeKey = `${caller}:${method}:${path}:${params}:${key.data}`
        const replay = await claimIdempotency(req, scopeKey)
        if (replay) {
          scopeKey = null
          return replay
        }
      }
      const result = await handler({
        req,
        partner: (who?.partner ?? null) as Partner,
        token: who?.token ?? '',
        body: body as never,
        params: (req.routeParams ?? {}) as Record<string, string>,
        query,
      })
      if (result instanceof Response) {
        if (scopeKey) await settleIdempotency(req, scopeKey, 500, null)
        return result
      }
      const status = result.status ?? 200
      const payloadBody = { ok: true, ...result.body }
      if (scopeKey) await settleIdempotency(req, scopeKey, status, payloadBody)
      return json(payloadBody, status)
    } catch (err) {
      const httpErr =
        err instanceof HttpError
          ? err
          : (() => {
              const d = domainErrorOf(err)
              if (d) return fail(d.status, d.code, d.field, d.params)
              // Payload rejected the uploaded file itself (corrupt or not what its type claims).
              if (isInvalidFile(err)) return fail(400, 'file_invalid', 'file')
              req.payload.logger.error({ err, msg: `partner api ${method.toUpperCase()} ${path} failed` })
              return fail(500, 'server_error')
            })()
      if (scopeKey) {
        try {
          await settleIdempotency(req, scopeKey, httpErr.status, null)
        } catch {
          // best effort
        }
      }
      return errorResponse(httpErr)
    }
  }
  const run: PayloadHandler = async (req) => withCors(await handle(req))
  return { path: `${API_PREFIX}/${path}`.replace(/\/+$/, ''), method, handler: run }
}

/** Partner-scoped Local API options: access rules apply as this partner, via the partner API only. */
export function asPartner(partner: Partner, extra: Record<string, unknown> = {}) {
  return {
    overrideAccess: false as const,
    user: { ...partner, collection: 'partners' } as Partner & { collection: 'partners' },
    context: { partnerApi: true, ...extra },
  }
}
