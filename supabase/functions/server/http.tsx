import type { Context } from 'npm:hono@4'
import { DomainError, UniqueViolation } from './db.tsx'

/** `{ ok:false, error, field?, params? }` with an HTTP status, from any thrown error. */
export function errorOf(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof DomainError) {
    const body: Record<string, unknown> = { ok: false, error: err.code }
    if (err.extra.field) body.field = err.extra.field
    if (err.extra.params) body.params = err.extra.params
    return { status: err.status, body }
  }
  if (err instanceof UniqueViolation) return { status: 409, body: { ok: false, error: 'conflict', field: err.field } }
  console.error('dwaar server error', err)
  return { status: 500, body: { ok: false, error: 'server_error' } }
}

export const NO_STORE = { 'Cache-Control': 'private, no-store' }

export function send(c: Context, body: Record<string, unknown>, status = 200, headers: Record<string, string> = NO_STORE) {
  for (const [k, v] of Object.entries(headers)) c.header(k, v)
  return c.json(body, status as 200)
}

export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  } catch {
    return {}
  }
}

/** Zod-style parse that throws `invalid_body` with the first failing field. */
export function parse<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[] }[] } } }, value: unknown, code = 'invalid_body'): T {
  const r = schema.safeParse(value)
  if (r.success) return r.data
  const field = r.error.issues[0]?.path.map(String).join('.') || undefined
  throw new DomainError(code, 400, field ? { field } : {})
}
