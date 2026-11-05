import { APIError, type PayloadRequest } from 'payload'

/**
 * A shallow clone of `req` with its own context (and query). Payload's Local API merges a
 * passed `context`/`user` into the request object in place, so nested writes from a hook would
 * otherwise leak their actor into the outer operation. The clone keeps the transaction id.
 */
export function subReq(req: PayloadRequest | undefined, context: Record<string, unknown> = {}): PayloadRequest | undefined {
  if (!req) return undefined
  const clone = Object.assign(Object.create(Object.getPrototypeOf(req)), req) as PayloadRequest
  clone.context = { ...context }
  clone.query = { ...(req.query ?? {}) }
  return clone
}

export function idOf(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object' && 'id' in value) return String((value as { id: unknown }).id)
  return null
}

/**
 * Business-rule failure with a stable machine code. The partner API turns it into
 * `{ ok: false, error: code, field?, params? }`; the Payload Admin shows the code as the message.
 */
export class DomainError extends APIError {
  code: string
  field?: string
  params?: Record<string, string | number>
  constructor(code: string, status = 400, extra: { field?: string; params?: Record<string, string | number> } = {}) {
    super(code, status, { code, ...extra }, true)
    this.code = code
    this.field = extra.field
    this.params = extra.params
  }
}

export function domainErrorOf(err: unknown): { code: string; status: number; field?: string; params?: Record<string, string | number> } | null {
  if (!err || typeof err !== 'object') return null
  const e = err as { code?: unknown; status?: unknown; data?: { code?: unknown; field?: string; params?: Record<string, string | number> }; message?: string }
  const code = typeof e.code === 'string' && /^[a-z_]+$/.test(e.code) ? e.code : typeof e.data?.code === 'string' ? e.data.code : null
  if (!code) return null
  return { code, status: typeof e.status === 'number' ? e.status : 400, field: e.data?.field, params: e.data?.params }
}

/** True when a write failed because a unique index already holds the value. */
export function isUniqueViolation(err: unknown) {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; message?: string; data?: { errors?: { message?: string }[] }; code?: unknown }
  const text = [e.message, ...(e.data?.errors ?? []).map((x) => x.message)].join(' ').toLowerCase()
  return (
    e.name === 'ValidationError' && /unique|already|exists|duplicate/.test(text)
  ) || /unique|duplicate key|already exists|constraint/.test(text) || e.code === '23505' || e.code === 11000
}

export const nowISO = () => new Date().toISOString()
