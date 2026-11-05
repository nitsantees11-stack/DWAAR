import type { Context } from 'npm:hono@4'
import { DomainError, createDoc, findOne, getDoc, nowISO, raw, UniqueViolation } from './db.tsx'
import { readSession, sha256Hex } from './auth.tsx'
import { errorOf } from './http.tsx'
import type { Partner } from './engine.tsx'

/**
 * Partner API plumbing: partner key, partner identity, body validation, idempotent writes and
 * CORS. Same contract as the Payload version at /api/partner/v1/*.
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Accept, Authorization, X-Dwaar-Partner-Key, X-Dwaar-Partner-Token, X-Dwaar-User-Id, X-Dwaar-User-Email, X-Dwaar-User-Name, Idempotency-Key, apikey, x-client-info',
  'Access-Control-Expose-Headers': 'Idempotent-Replay, Content-Disposition',
  'Access-Control-Max-Age': '86400',
}

export const pfail = (status: number, code: string, field?: string, params?: Record<string, string | number>) =>
  new DomainError(code, status, { ...(field ? { field } : {}), ...(params ? { params } : {}) })

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...CORS_HEADERS, ...extra } })
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Constant-time check of X-Dwaar-Partner-Key against the PARTNER_API_KEY Supabase secret. */
function checkApiKey(c: Context) {
  const expected = Deno.env.get('PARTNER_API_KEY')
  if (!expected) throw pfail(503, 'partner_api_not_configured')
  const given = c.req.header('x-dwaar-partner-key')
  if (!given) throw pfail(401, 'missing_api_key')
  if (!timingSafeEqual(given, expected)) throw pfail(401, 'invalid_api_key')
}

/**
 * The partner's own token. Through the dwaar app proxy it arrives in X-Dwaar-Partner-Token (the
 * Supabase gateway needs Authorization for itself); a direct caller may send it as Bearer.
 */
function tokenOf(c: Context) {
  const header = c.req.header('x-dwaar-partner-token')?.trim()
  if (header) return header.replace(/^Bearer\s+/i, '')
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1] ?? null
  if (!bearer || bearer === Deno.env.get('SUPABASE_ANON_KEY')) return null
  return bearer
}

export interface ExternalIdentity {
  userId: string
  email: string | null
  name: string | null
}

const EXTERNAL_ID = /^[A-Za-z0-9._:@|+=-]{1,128}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/

/** X-Dwaar-User-Id (required), X-Dwaar-User-Email, X-Dwaar-User-Name (URL-encoded). */
export function readExternalIdentity(headers: Headers): ExternalIdentity | null {
  const userId = headers.get('x-dwaar-user-id')?.trim()
  if (!userId) return null
  if (!EXTERNAL_ID.test(userId)) throw pfail(400, 'invalid_identity', 'X-Dwaar-User-Id')
  const email = headers.get('x-dwaar-user-email')?.trim().toLowerCase() || null
  if (email && (email.length > 254 || !EMAIL.test(email))) throw pfail(400, 'invalid_identity', 'X-Dwaar-User-Email')
  let name: string | null = null
  const rawName = headers.get('x-dwaar-user-name')
  if (rawName) {
    try {
      // Form-style encoders send spaces as "+"; encodeURIComponent never leaves a literal "+".
      name = decodeURIComponent(rawName.replace(/\+/g, ' '))
    } catch {
      throw pfail(400, 'invalid_identity', 'X-Dwaar-User-Name')
    }
    name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) || null
  }
  return { userId, email, name }
}

export async function externalUsername(userId: string) {
  return `ext-${(await sha256Hex(userId)).slice(0, 24)}`
}

/** Partner linked to a Partner app user id, created in `pending_verification` the first time. */
export async function partnerFromExternalIdentity(identity: ExternalIdentity): Promise<Partner> {
  let partner = await findOne<Partner>('partners', 'externalUserId', identity.userId)
  if (!partner) {
    try {
      partner = await createDoc('partners', {
        username: await externalUsername(identity.userId),
        externalUserId: identity.userId,
        externalEmail: identity.email,
        name: identity.name,
        verificationStatus: 'pending_verification',
        accountStatus: 'active',
      })
    } catch (err) {
      // Two first requests raced: the other one created the partner.
      if (!(err instanceof UniqueViolation)) throw err
      partner = await findOne<Partner>('partners', 'externalUserId', identity.userId)
      if (!partner) throw err
    }
  } else if (identity.email && partner.externalEmail !== identity.email) {
    const { updatePartner } = await import('./engine.tsx')
    partner = (await updatePartner(partner.id, () => ({ externalEmail: identity.email }))) ?? partner
  }
  return partner
}

async function authenticate(c: Context): Promise<{ partner: Partner; token: string }> {
  const token = tokenOf(c)
  const session = token ? await readSession(token, 'partner') : null
  let partner = session ? await getDoc<Partner>('partners', session.id) : null
  let own = partner ? (token as string) : ''
  if (!partner) {
    const identity = readExternalIdentity(new Headers(c.req.raw.headers))
    if (!identity) throw pfail(401, token ? 'invalid_token' : 'missing_token')
    partner = await partnerFromExternalIdentity(identity)
    own = ''
  }
  if (partner.accountStatus === 'deleted') throw pfail(401, 'account_deleted')
  return { partner, token: own }
}

export interface Ctx<B> {
  c: Context
  partner: Partner
  /** Our own session token, or '' when the partner came in through the X-Dwaar-User-* headers. */
  token: string
  body: B
  file: File | null
  params: Record<string, string>
  query: URLSearchParams
}

type Schema<T> = { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[] }[] } } }

/** Largest request body a partner upload may send (the biggest file allowed is a 50 MB video). */
const MAX_UPLOAD_BYTES = 55 * 1024 * 1024
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
 * Write bodies: JSON, or multipart with `file` plus plain form fields (type, kind, expiresAt,
 * idempotencyKey…). A `_payload` JSON field is merged in too and wins on conflicts. Empty fields
 * count as not sent.
 */
async function readWriteBody(c: Context, multipart: boolean): Promise<{ raw: Record<string, unknown>; file: File | null }> {
  if (multipart || (c.req.header('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
    if (Number(c.req.header('content-length') ?? 0) > MAX_UPLOAD_BYTES) throw pfail(413, 'file_too_large', 'file')
    let form: FormData
    try {
      form = await c.req.raw.formData()
    } catch {
      throw pfail(400, 'invalid_body')
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
        throw pfail(400, 'invalid_body', '_payload')
      }
    }
    const part = form.get('file')
    let file: File | null = null
    if (part && typeof part !== 'string' && part.size > 0) {
      if (part.size > MAX_UPLOAD_BYTES) throw pfail(413, 'file_too_large', 'file')
      const name = (part as File).name || 'upload'
      const type = mimeOf({ type: part.type, name })
      file = type === part.type ? (part as File) : new File([part], name, { type })
    }
    return { raw: fields, file }
  }
  try {
    const body = await c.req.json()
    return { raw: body && typeof body === 'object' && !Array.isArray(body) ? body : {}, file: null }
  } catch {
    return { raw: {}, file: null }
  }
}

type Idem = { state: 'pending' | 'done'; status?: number; response?: unknown; at: number }
const IDEM_TTL_MS = 24 * 60 * 60 * 1000

/**
 * One partner API route. Every request needs the partner key; authenticated routes resolve the
 * partner; bodies are validated; writes need an idempotency key and replay their first success.
 */
export function route<T = Record<string, never>>(
  method: 'get' | 'post' | 'patch',
  path: string,
  opts: { auth?: boolean; body?: Schema<T>; multipart?: boolean },
  handler: (ctx: Ctx<T>) => Promise<{ status?: number; body: Record<string, unknown> } | Response>,
) {
  const requireAuth = opts.auth !== false
  const isWrite = method !== 'get'
  const run = async (c: Context) => {
    let scopeKey: string | null = null
    try {
      checkApiKey(c)
      const who = requireAuth ? await authenticate(c) : null
      const read = isWrite ? await readWriteBody(c, Boolean(opts.multipart)) : { raw: {}, file: null }
      const file = read.file
      // The idempotency key may come as a body field or as the Idempotency-Key header.
      const headerKey = c.req.header('idempotency-key')?.trim()
      const rawBody: Record<string, unknown> = isWrite && read.raw.idempotencyKey === undefined && headerKey ? { ...read.raw, idempotencyKey: headerKey } : read.raw
      let body: unknown = {}
      if (opts.body) {
        const parsed = opts.body.safeParse(rawBody)
        if (!parsed.success) throw pfail(400, 'invalid_body', parsed.error.issues[0]?.path.map(String).join('.') || undefined)
        body = parsed.data
      }
      const params = c.req.param() as Record<string, string>
      if (isWrite) {
        const key = String(rawBody.idempotencyKey ?? c.req.header('idempotency-key') ?? '').trim()
        if (key.length < 8 || key.length > 100) throw pfail(400, 'idempotency_key_required', 'idempotencyKey')
        const caller = who ? `p:${who.partner.id}` : `phone:${String(rawBody.phone ?? '').replace(/\D/g, '').slice(-10)}`
        scopeKey = `idem:${await sha256Hex(`${caller}:${method}:${path}:${Object.values(params).join(':')}:${key}`)}`
        if (!(await raw.insert(scopeKey, { state: 'pending', at: Date.now() } satisfies Idem))) {
          const prior = (await raw.get(scopeKey)) as Idem | undefined
          if (prior?.state === 'done' && Date.now() - prior.at < IDEM_TTL_MS) {
            scopeKey = null
            return json(prior.response, prior.status ?? 200, { 'Idempotent-Replay': 'true' })
          }
          if (prior && Date.now() - prior.at < 60_000) {
            scopeKey = null
            throw pfail(409, 'request_in_progress')
          }
          await raw.set(scopeKey, { state: 'pending', at: Date.now() } satisfies Idem)
        }
      }
      const query = new URL(c.req.url).searchParams
      const result = await handler({ c, partner: (who?.partner ?? null) as Partner, token: who?.token ?? '', body: body as T, file, params, query })
      if (result instanceof Response) {
        if (scopeKey) await raw.del(scopeKey)
        for (const [k, v] of Object.entries(CORS_HEADERS)) result.headers.set(k, v)
        return result
      }
      const status = result.status ?? 200
      const out = { ok: true, ...result.body }
      if (scopeKey) await raw.set(scopeKey, { state: 'done', status, response: out, at: Date.now() } satisfies Idem)
      return json(out, status)
    } catch (err) {
      // Failed writes left nothing behind, so the same key may be retried.
      if (scopeKey) await raw.del(scopeKey).catch(() => undefined)
      const e = errorOf(err)
      return json(e.body, e.status)
    }
  }
  return { method, path, run }
}

export const nowIso = nowISO
