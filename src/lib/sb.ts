import { cookies } from 'next/headers'
import { SUPABASE_GATEWAY_HEADERS, functionUrl } from './backend'

/**
 * Server-side client for the dwaar Supabase function. The customer session (an opaque token from
 * /c/auth/otp/verify) lives in an httpOnly cookie and is sent as X-Dwaar-Session; the browser
 * never talks to Supabase directly.
 */
export const SB_SESSION_COOKIE = 'dwaar-session'

export type SbResult = { ok: boolean; error?: string; params?: Record<string, string | number>; field?: string; [k: string]: unknown }

/** Backend failures that have no customer-facing meaning of their own. */
const GENERIC = new Set(['server_error', 'busy', 'conflict', 'backend_unreachable', 'invalid_body'])

export async function sessionToken() {
  return (await cookies()).get(SB_SESSION_COOKIE)?.value ?? null
}

export async function sb<T extends object = Record<string, unknown>>(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; form?: FormData; session?: string | null; auth?: boolean } = {},
): Promise<(SbResult & T) | (SbResult & { ok: false; error: string })> {
  const headers = new Headers(SUPABASE_GATEWAY_HEADERS)
  const session = opts.session !== undefined ? opts.session : opts.auth === false ? null : await sessionToken()
  if (session) headers.set('x-dwaar-session', session)
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(opts.body)
  }
  try {
    const res = await fetch(`${functionUrl()}${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, cache: 'no-store' })
    const json = (await res.json().catch(() => null)) as SbResult | null
    if (!json || typeof json.ok !== 'boolean') return { ok: false, error: 'generic' }
    if (!json.ok && (!json.error || GENERIC.has(json.error))) return { ...json, ok: false, error: 'generic' }
    return json as SbResult & T
  } catch {
    return { ok: false, error: 'generic' }
  }
}

/** Strips transport fields so an action returns the same ActionResult shape as before. */
export function asAction<T extends object>(r: SbResult, pick: (r: SbResult) => T) {
  if (!r.ok) {
    return { ok: false as const, error: r.error ?? 'generic', ...(r.params ? { params: r.params } : {}), ...(r.field ? { field: r.field } : {}) }
  }
  return { ok: true as const, ...pick(r) }
}
