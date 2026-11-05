import { createClient } from 'jsr:@supabase/supabase-js@2.49.8'

/**
 * Supabase Storage. Private files (partner KYC documents, job media, problem videos) live in a
 * private bucket and are only ever streamed through access-checked routes; catalog images and
 * partner photos live in a public bucket.
 */
export const PRIVATE_BUCKET = 'make-4d6fa028-private'
export const PUBLIC_BUCKET = 'make-4d6fa028-public'

const client = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

let ready: Promise<void> | null = null
export function ensureBuckets() {
  ready ??= (async () => {
    const supabase = client()
    const { data } = await supabase.storage.listBuckets()
    const have = new Set((data ?? []).map((b) => b.name))
    if (!have.has(PRIVATE_BUCKET)) await supabase.storage.createBucket(PRIVATE_BUCKET, { public: false })
    if (!have.has(PUBLIC_BUCKET)) await supabase.storage.createBucket(PUBLIC_BUCKET, { public: true })
  })().catch((err) => {
    ready = null
    throw err
  })
  return ready
}

export async function putFile(bucket: string, path: string, body: Blob | Uint8Array, contentType: string) {
  await ensureBuckets()
  const { error } = await client().storage.from(bucket).upload(path, body, { contentType, upsert: true, cacheControl: bucket === PUBLIC_BUCKET ? '3600' : '0' })
  if (error) throw new Error(`storage upload failed: ${error.message}`)
  return { bucket, path }
}

export function publicUrl(path: string) {
  return client().storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl
}

/** Streams a private file back with no-store caching. */
export async function streamPrivate(path: string, filename?: string | null) {
  const { data, error } = await client().storage.from(PRIVATE_BUCKET).createSignedUrl(path, 60)
  if (error || !data?.signedUrl) return new Response(JSON.stringify({ ok: false, error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  const res = await fetch(data.signedUrl)
  const headers = new Headers({ 'Cache-Control': 'private, no-store' })
  for (const h of ['content-type', 'content-length']) {
    const v = res.headers.get(h)
    if (v) headers.set(h, v)
  }
  if (filename) headers.set('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`)
  return new Response(res.body, { status: res.ok ? 200 : 404, headers })
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}
export const extFor = (mime: string) => EXT[mime] ?? 'bin'
