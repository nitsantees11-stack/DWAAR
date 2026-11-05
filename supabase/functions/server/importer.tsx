import { Hono, type Context } from 'npm:hono@4'
import { COLLECTIONS, idOf, setGlobal } from './db.tsx'
import * as tables from './table-adapter.tsx'
import { SCHEMA, coerceNull, columnOf } from './schema.tsx'
import { mirrorAuthUser, sha256Hex } from './auth.tsx'
import { PRIVATE_BUCKET, PUBLIC_BUCKET, publicUrl, putFile } from './storage.tsx'

/**
 * One-time copy of the Payload data into Supabase. Protected by an import token that only exists
 * on the dwaar build machine; this file holds just its SHA-256. Re-running is safe (upserts by id).
 * Remove IMPORT_TOKEN_SHA256 (set it to '') once the move is finished to close the endpoint.
 */
const IMPORT_TOKEN_SHA256 = 'd5542a3d4b27b3269e74aa6ec81a05660b11cd265b4f87abc9b389b3f231c673'

export const importerApp = new Hono()

async function guard(c: Context) {
  const token = c.req.header('x-dwaar-import-token') ?? ''
  if (!IMPORT_TOKEN_SHA256 || token.length < 20 || (await sha256Hex(token)) !== IMPORT_TOKEN_SHA256) {
    return c.json({ ok: false, error: 'forbidden' }, 403)
  }
  return null
}

const UPLOADS: Record<string, string> = { media: PUBLIC_BUCKET, 'partner-documents': PRIVATE_BUCKET, 'problem-videos': PRIVATE_BUCKET, 'job-media': PRIVATE_BUCKET }

/** Payload doc (depth 0) -> row, keeping the original id and timestamps. */
function rowOf(collection: string, doc: Record<string, unknown>) {
  const spec = SCHEMA[collection]
  const row: Record<string, unknown> = { id: doc.id, created_at: doc.createdAt ?? new Date().toISOString(), updated_at: doc.updatedAt ?? new Date().toISOString() }
  for (const c of spec.columns) {
    const [field, type] = c
    if (!(field in doc)) continue
    let v = doc[field]
    if (/^uuid\[\]/.test(type)) v = Array.isArray(v) ? v.map(idOf).filter(Boolean) : []
    else if (/^uuid\b/.test(type)) v = idOf(v)
    row[columnOf(c)] = coerceNull(type, v)
  }
  return row
}

importerApp.post('/docs', async (c) => {
  const denied = await guard(c)
  if (denied) return denied
  const { collection, docs } = (await c.req.json()) as { collection: string; docs: Record<string, unknown>[] }
  if (!COLLECTIONS.includes(collection) || !Array.isArray(docs)) return c.json({ ok: false, error: 'invalid_body' }, 400)
  const results: { id: unknown; ok: boolean; error?: string }[] = []
  for (const doc of docs) {
    try {
      const row = rowOf(collection, doc)
      // Upload documents get their storage path from /admin/import/file first.
      if (UPLOADS[collection] && typeof doc.storagePath === 'string') {
        row.storage_path = doc.storagePath
        if (collection === 'media') row.url = publicUrl(doc.storagePath)
      }
      await tables.upsertRow(SCHEMA[collection].table, row)
      if (collection === 'users' && typeof doc.username === 'string') await mirrorAuthUser('user', String(doc.id), doc.username)
      if (collection === 'partners' && typeof doc.username === 'string' && /^[6-9]\d{9}$/.test(doc.username)) await mirrorAuthUser('partner', String(doc.id), doc.username)
      results.push({ id: doc.id, ok: true })
    } catch (err) {
      results.push({ id: doc.id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return c.json({ ok: results.every((r) => r.ok), results })
})

importerApp.post('/file', async (c) => {
  const denied = await guard(c)
  if (denied) return denied
  const form = await c.req.parseBody()
  const collection = String(form.collection ?? '')
  const path = String(form.path ?? '')
  const file = form.file
  const bucket = UPLOADS[collection]
  if (!bucket || !/^[a-z-]+\/[A-Za-z0-9._/-]{1,200}$/.test(path) || path.includes('..') || !(file instanceof File)) return c.json({ ok: false, error: 'invalid_body' }, 400)
  await putFile(bucket, path, file, file.type || 'application/octet-stream')
  return c.json({ ok: true, path, url: bucket === PUBLIC_BUCKET ? publicUrl(path) : null })
})

importerApp.post('/global', async (c) => {
  const denied = await guard(c)
  if (denied) return denied
  const { slug, data } = (await c.req.json()) as { slug: string; data: Record<string, unknown> }
  if (slug !== 'business-config' || !data || typeof data !== 'object') return c.json({ ok: false, error: 'invalid_body' }, 400)
  await setGlobal(slug, data)
  return c.json({ ok: true })
})

/** Row counts per table, to verify an import. */
importerApp.get('/counts', async (c) => {
  const denied = await guard(c)
  if (denied) return denied
  const counts: Record<string, number> = {}
  for (const col of COLLECTIONS) counts[col] = (await tables.selectAll(SCHEMA[col].table)).length
  return c.json({ ok: true, counts })
})
