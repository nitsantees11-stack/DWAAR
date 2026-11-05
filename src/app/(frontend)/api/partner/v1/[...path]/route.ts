import config from '@payload-config'
import { REST_GET, REST_OPTIONS, REST_PATCH, REST_POST } from '@payloadcms/next/routes'
import { SUPABASE_GATEWAY_HEADERS, functionUrl, isSupabase } from '@/lib/backend'

/**
 * dwaar Partner API entry point (/api/partner/v1/*). The Partner app always calls this URL.
 * With the Payload backend it hands the request to Payload's REST handler unchanged; with the
 * Supabase backend it forwards to the edge function, moving the partner's own Bearer token into
 * X-Dwaar-Partner-Token because the Supabase gateway needs Authorization for its anon key.
 */
type Ctx = { params: Promise<{ path: string[] }> }
type Method = 'GET' | 'POST' | 'PATCH' | 'OPTIONS'

const payloadHandlers = { GET: REST_GET(config), POST: REST_POST(config), PATCH: REST_PATCH(config), OPTIONS: REST_OPTIONS(config) }

const FORWARD_HEADERS = ['content-type', 'accept', 'x-dwaar-partner-key', 'x-dwaar-user-id', 'x-dwaar-user-email', 'x-dwaar-user-name', 'idempotency-key']
const RETURN_HEADERS = ['content-type', 'content-length', 'content-disposition', 'cache-control', 'idempotent-replay']
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Accept, Authorization, X-Dwaar-Partner-Key, X-Dwaar-User-Id, X-Dwaar-User-Email, X-Dwaar-User-Name, Idempotency-Key',
  'Access-Control-Expose-Headers': 'Idempotent-Replay, Content-Disposition',
  'Access-Control-Max-Age': '86400',
}

async function toSupabase(method: Method, req: Request, path: string[]) {
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const search = new URL(req.url).search
  const target = `${functionUrl()}/partner/v1/${path.map(encodeURIComponent).join('/')}${search}`
  const headers = new Headers(SUPABASE_GATEWAY_HEADERS)
  for (const h of FORWARD_HEADERS) {
    const v = req.headers.get(h)
    if (v) headers.set(h, v)
  }
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]
  if (token) headers.set('x-dwaar-partner-token', token)
  let res: Response
  try {
    res = await fetch(target, {
      method,
      headers,
      body: method === 'GET' ? undefined : req.body,
      // Streams multipart uploads through without buffering.
      ...(method === 'GET' ? {} : { duplex: 'half' as const }),
      cache: 'no-store',
    } as RequestInit)
  } catch {
    return Response.json({ ok: false, error: 'backend_unreachable' }, { status: 502, headers: CORS })
  }
  const out = new Headers(CORS)
  for (const h of RETURN_HEADERS) {
    const v = res.headers.get(h)
    if (v) out.set(h, v)
  }
  return new Response(res.body, { status: res.status, headers: out })
}

function handler(method: Method) {
  return async (req: Request, ctx: Ctx) => {
    const { path } = await ctx.params
    if (isSupabase()) return toSupabase(method, req, path)
    return payloadHandlers[method](req, { params: Promise.resolve({ slug: ['partner', 'v1', ...path] }) })
  }
}

export const GET = handler('GET')
export const POST = handler('POST')
export const PATCH = handler('PATCH')
export const OPTIONS = handler('OPTIONS')
