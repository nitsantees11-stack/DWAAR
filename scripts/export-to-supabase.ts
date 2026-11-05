/**
 * One-time copy of every Payload record and file into the dwaar Supabase backend.
 *
 *   pnpm exec payload run --input '{"scriptPath":"scripts/export-to-supabase.ts","scriptArgs":["<payload app url>","<function url>"]}'
 *
 * The import token is read from .tmp/dwaar-import-token (never committed). Re-running is safe:
 * the function upserts by id. Private files are read through Payload's own access checks, signed
 * in as the account that owns them.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import config from '@payload-config'
import { getPayload } from 'payload'
import { derivedPassword } from '../src/lib/otp'
import { publicAnonKey } from '../utils/supabase/info'

const [appUrl = 'http://localhost:3000', fnUrl = 'https://kbyvmlxcgmrxxqhdawom.supabase.co/functions/v1/make-server-4d6fa028'] = process.argv.slice(2)
// The token never goes into git; a copy lives in the chat session's storage (.vfs-tmp).
const tokenFile = ['.tmp/dwaar-import-token', '.vfs-tmp/dwaar-import-token'].find((f) => existsSync(f))
if (!tokenFile) throw new Error('import token missing (.tmp/dwaar-import-token)')
const token = readFileSync(tokenFile, 'utf8').trim()
const payload = await getPayload({ config })
const log: string[] = []
const say = (line: string) => {
  log.push(line)
  console.log(line)
}

const headers = { Authorization: `Bearer ${publicAnonKey}`, apikey: publicAnonKey, 'x-dwaar-import-token': token }
async function post(path: string, body: unknown) {
  const res = await fetch(`${fnUrl}/admin/import${path}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; results?: { id: string; ok: boolean; error?: string }[] }
  if (!res.ok && !json.results) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`)
  return json
}
async function sendFile(collection: string, path: string, bytes: ArrayBuffer, type: string) {
  const form = new FormData()
  form.set('collection', collection)
  form.set('path', path)
  form.set('file', new File([bytes], path.split('/').pop() ?? 'file', { type }))
  const res = await fetch(`${fnUrl}/admin/import/file`, { method: 'POST', headers, body: form })
  if (!res.ok) throw new Error(`file ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`)
}

/** Payload JWT for the account that owns a private file (derived, server-only passwords). */
const tokens = new Map<string, string>()
async function ownerToken(collection: 'users' | 'partners', id: string) {
  if (tokens.has(id)) return tokens.get(id)!
  const doc = (await payload.findByID({ collection, id, overrideAccess: true, depth: 0 })) as { username: string; externalUserId?: string | null }
  const password =
    collection === 'users'
      ? derivedPassword(payload.secret, doc.username)
      : doc.externalUserId
        ? derivedPassword(payload.secret, `partner-ext:${doc.externalUserId}`)
        : derivedPassword(payload.secret, `partner:${doc.username}`)
  let t: string | undefined
  try {
    t = (await payload.login({ collection, overrideAccess: true, data: { username: doc.username, password } })).token
  } catch {
    // Same re-key the OTP login does: these accounts only ever sign in with OTP.
    await payload.update({ collection, id, overrideAccess: true, data: { password } })
    t = (await payload.login({ collection, overrideAccess: true, data: { username: doc.username, password } })).token
  }
  if (!t) throw new Error(`login failed for ${collection} ${id}`)
  tokens.set(id, t)
  return t
}

async function fetchFile(collection: string, filename: string, auth?: string) {
  const res = await fetch(`${appUrl}/api/${collection}/file/${encodeURIComponent(filename)}`, { headers: auth ? { Authorization: `JWT ${auth}` } : {} })
  if (!res.ok) throw new Error(`download ${collection}/${filename} -> ${res.status}`)
  return { bytes: await res.arrayBuffer(), type: res.headers.get('content-type') ?? 'application/octet-stream' }
}

const ORDER = [
  'media', 'service-categories', 'services', 'device-models', 'promotions', 'skill-tests', 'users', 'addresses', 'waitlist-entries', 'partners',
  'partner-documents', 'bookings', 'booking-events', 'warranties', 'support-tickets', 'problem-videos', 'job-offers', 'job-media',
  'partner-locations', 'payouts', 'earnings-ledger', 'partner-tickets',
] as const
const PATH_PREFIX: Record<string, string> = { media: 'catalog', 'partner-documents': 'partner-documents', 'problem-videos': 'problem-videos', 'job-media': 'job-media' }

const summary: Record<string, { docs: number; ok: number; files: number; errors: string[] }> = {}
let failed = 0
for (const collection of ORDER) {
  const { docs } = await payload.find({ collection, overrideAccess: true, depth: 0, pagination: false, showHiddenFields: true })
  const s: (typeof summary)[string] = { docs: docs.length, ok: 0, files: 0, errors: [] }
  summary[collection] = s
  const out: Record<string, unknown>[] = []
  for (const raw of docs as unknown as Record<string, unknown>[]) {
    const doc = { ...raw }
    const filename = typeof doc.filename === 'string' ? doc.filename : null
    if (PATH_PREFIX[collection] && filename) {
      try {
        let auth: string | undefined
        if (collection === 'partner-documents') auth = await ownerToken('partners', String(doc.owner))
        if (collection === 'problem-videos') auth = await ownerToken('users', String(doc.owner))
        if (collection === 'job-media') auth = await ownerToken('partners', String(doc.partner))
        const file = await fetchFile(collection, filename, auth)
        const owner = collection === 'media' ? '' : `${String(doc.owner ?? doc.booking ?? 'misc')}/`
        const path = `${PATH_PREFIX[collection]}/${owner}${filename}`
        await sendFile(collection, path, file.bytes, String(doc.mimeType ?? file.type))
        doc.storagePath = path
        s.files++
      } catch (err) {
        s.errors.push(`file ${filename}: ${(err as Error).message}`)
      }
    }
    out.push(doc)
  }
  for (let i = 0; i < out.length; i += 50) {
    const r = await post('/docs', { collection, docs: out.slice(i, i + 50) })
    for (const x of r.results ?? []) {
      if (x.ok) s.ok++
      else s.errors.push(`${x.id}: ${x.error}`)
    }
  }
  failed += s.errors.length
  say(`${collection.padEnd(18)} ${String(s.ok).padStart(3)}/${String(s.docs).padEnd(3)} files ${s.files}${s.errors.length ? `  ERRORS: ${s.errors.slice(0, 3).join(' | ')}` : ''}`)
}

const cfg = await payload.findGlobal({ slug: 'business-config', overrideAccess: true, depth: 0 })
await post('/global', { slug: 'business-config', data: cfg })
say('business-config    copied')

const counts = await (await fetch(`${fnUrl}/admin/import/counts`, { headers })).json()
say(`supabase counts: ${JSON.stringify(counts.counts)}`)
writeFileSync('.tmp/export-to-supabase.json', JSON.stringify({ at: new Date().toISOString(), fnUrl, failed, summary, counts: counts.counts }, null, 1))
process.exit(failed ? 1 : 0)
