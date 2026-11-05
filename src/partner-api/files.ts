import type { PayloadRequest } from 'payload'
import type { Partner } from '@/payload-types'
import { fail, route } from './http'

type PrivateFileCollection = 'job-media' | 'partner-documents' | 'problem-videos'
const PRIVATE_FILE_COLLECTIONS: PrivateFileCollection[] = ['job-media', 'partner-documents', 'problem-videos']

/**
 * Streams a private file through Payload's own access-checked file handler, as the partner:
 * Payload's read access decides, exactly as for a token request. Works the same whether the
 * partner signed in with our OTP token or through the Partner app's headers.
 */
export async function streamPrivateFile(req: PayloadRequest, partner: Partner, collection: PrivateFileCollection, filename: string) {
  const endpoint = (req.payload.collections[collection].config.endpoints || []).find((e) => e.method === 'get' && e.path === '/file/:filename')
  if (!endpoint) throw fail(404, 'not_found')
  // A view of the real request with the partner as user. A Proxy (not a copy) keeps the private
  // fields of Next's Request working; caller query params (prefix / version) are ignored so only
  // the checked document's file is served.
  const overrides: Record<PropertyKey, unknown> = {
    user: { ...partner, collection: 'partners' },
    routeParams: { collection, filename },
    searchParams: new URLSearchParams(),
  }
  const asPartner = new Proxy(req, {
    get(target, prop) {
      if (prop in overrides) return overrides[prop]
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    set(_target, prop, value) {
      overrides[prop] = value
      return true
    },
  }) as PayloadRequest
  const res = await endpoint.handler(asPartner)
  const headers = new Headers()
  for (const h of ['content-type', 'content-length', 'content-disposition']) {
    const v = res.headers.get(h)
    if (v) headers.set(h, v)
  }
  headers.set('Cache-Control', 'private, no-store')
  return new Response(res.body, { status: res.status, headers })
}

export const fileEndpoints = [
  route('get', 'files/:collection/:id', {}, async ({ req, partner, params }) => {
    const collection = params.collection as PrivateFileCollection
    if (!PRIVATE_FILE_COLLECTIONS.includes(collection)) throw fail(404, 'not_found')
    let doc: { filename?: string | null }
    try {
      // Partner read access decides (own documents; media of bookings they work).
      doc = await req.payload.findByID({ collection, id: params.id, depth: 0, overrideAccess: false, user: { ...partner, collection: 'partners' } })
    } catch {
      throw fail(404, 'not_found')
    }
    if (!doc.filename) throw fail(404, 'not_found')
    return streamPrivateFile(req, partner, collection, doc.filename)
  }),
]
