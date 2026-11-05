// Minimal Supabase Auth admin + Storage double.
export const authUsers = new Map<string, Record<string, unknown>>()
export const files = new Map<string, { type: string; bytes: Uint8Array }>()
export const buckets = new Set<string>()
export function createClient() {
  return {
    auth: {
      admin: {
        async createUser(o: Record<string, unknown>) {
          const id = String(o.id ?? crypto.randomUUID())
          if (authUsers.has(id) || [...authUsers.values()].some((u) => u.email === o.email)) return { data: { user: null }, error: { message: 'User already registered' } }
          authUsers.set(id, o)
          return { data: { user: { id } }, error: null }
        },
      },
    },
    storage: {
      async listBuckets() {
        return { data: [...buckets].map((name) => ({ name })), error: null }
      },
      async createBucket(name: string) {
        buckets.add(name)
        return { data: { name }, error: null }
      },
      from(bucket: string) {
        return {
          async upload(path: string, body: Blob | Uint8Array, o: { contentType: string }) {
            const bytes = body instanceof Uint8Array ? body : new Uint8Array(await body.arrayBuffer())
            files.set(`${bucket}/${path}`, { type: o.contentType, bytes })
            return { data: { path }, error: null }
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://storage.test/${bucket}/${path}` } }
          },
          async createSignedUrl(path: string) {
            const f = files.get(`${bucket}/${path}`)
            if (!f) return { data: null, error: { message: 'not found' } }
            let bin = ''
            for (const b of f.bytes) bin += String.fromCharCode(b)
            return { data: { signedUrl: `data:${f.type};base64,${btoa(bin)}` }, error: null }
          },
        }
      },
    },
  }
}
