/* E2E: multipart uploads with plain form fields (file, type, expiresAt) in the Payload Partner API. Test data removed at the end. */
import { randomBytes, randomUUID } from 'node:crypto'
import config from '@payload-config'
import { getPayload, handleEndpoints } from 'payload'
import sharp from 'sharp'

const KEY = randomBytes(24).toString('hex')
process.env.PARTNER_API_KEY = KEY // ephemeral, this process only
const UID = `e2e-mp-${randomBytes(4).toString('hex')}`
const noise = Buffer.alloc(80 * 80 * 3); for (let i = 0; i < noise.length; i++) noise[i] = (i * 13) % 251
const PNG = await sharp(noise, { raw: { width: 80, height: 80, channels: 3 } }).png().toBuffer()
const results: { name: string; ok: boolean; info?: string }[] = []
const check = (name: string, cond: unknown, info?: unknown) => results.push({ name, ok: Boolean(cond), info: cond ? undefined : JSON.stringify(info)?.slice(0, 400) })

type Part = { file?: { bytes: Buffer; name: string; type: string }; fields?: Record<string, string>; payload?: Record<string, unknown>; idemHeader?: string }
async function upload(path: string, part: Part, who = UID) {
  const fd = new FormData()
  if (part.file) fd.set('file', new File([part.file.bytes], part.file.name, { type: part.file.type }))
  for (const [k, v] of Object.entries(part.fields ?? {})) fd.set(k, v)
  if (part.payload) fd.set('_payload', JSON.stringify(part.payload))
  const headers = new Headers({ 'x-dwaar-partner-key': KEY, 'x-dwaar-user-id': who })
  if (part.idemHeader) headers.set('idempotency-key', part.idemHeader)
  const res = await handleEndpoints({ config, request: new Request(`http://localhost:3000/api/partner/v1/${path}`, { method: 'POST', headers, body: fd }) })
  const ct = res.headers.get('content-type') ?? ''
  return { status: res.status, headers: res.headers, json: ct.includes('json') ? ((await res.json()) as any) : null, bytes: ct.includes('json') ? 0 : (await res.arrayBuffer()).byteLength }
}
async function get(path: string) {
  const res = await handleEndpoints({ config, request: new Request(`http://localhost:3000/api/partner/v1/${path}`, { headers: { 'x-dwaar-partner-key': KEY, 'x-dwaar-user-id': UID } }) })
  return { status: res.status, type: res.headers.get('content-type'), bytes: Buffer.from(await res.arrayBuffer()) }
}
const png = { bytes: PNG, name: 'pan.png', type: 'image/png' }

const payload = await getPayload({ config })
try {
  const pan = await upload('me/documents', { file: png, fields: { type: 'pan', idempotencyKey: randomUUID() } })
  check('plain fields: file + type -> 201 { ok, document }', pan.status === 201 && pan.json?.ok === true && pan.json?.document?.type === 'pan' && pan.json?.document?.status === 'pending', pan.json)
  const dl = await get(`files/partner-documents/${pan.json?.document?.id}`)
  check('saved file downloads unchanged', dl.status === 200 && dl.bytes.equals(PNG), [dl.status, dl.type, dl.bytes.length])

  const idem = randomUUID()
  const h1 = await upload('me/documents', { file: { ...png, name: 'selfie.png' }, fields: { type: 'selfie' }, idemHeader: idem })
  const h2 = await upload('me/documents', { file: { ...png, name: 'selfie.png' }, fields: { type: 'selfie' }, idemHeader: idem })
  check('Idempotency-Key header works for multipart', h1.status === 201, h1.json)
  check('repeat with the same key replays, no second file', h2.headers.get('idempotent-replay') === 'true' && h2.json?.document?.id === h1.json?.document?.id, [h2.status, h2.json])

  const dlc = await upload('me/documents', { file: { ...png, name: 'dl.png' }, fields: { type: 'driving_licence', expiresAt: '2030-01-01', idempotencyKey: randomUUID() } })
  check('optional expiresAt is read', dlc.status === 201 && String(dlc.json?.document?.expiresAt ?? '').startsWith('2030-01-01'), dlc.json)
  check('driving licence without expiresAt -> expiry_required', (await upload('me/documents', { file: png, fields: { type: 'driving_licence', idempotencyKey: randomUUID() } })).json?.error === 'expiry_required')
  check('empty expiresAt counts as not sent', (await upload('me/documents', { file: png, fields: { type: 'vehicle_rc', expiresAt: '', idempotencyKey: randomUUID() } })).json?.error === 'expiry_required')
  const noType = await upload('me/documents', { file: png, fields: { idempotencyKey: randomUUID() } })
  check('missing type -> invalid_body / type', noType.json?.error === 'invalid_body' && noType.json?.field === 'type', noType.json)
  check('unknown type -> invalid_body / type', (await upload('me/documents', { file: png, fields: { type: 'passport', idempotencyKey: randomUUID() } })).json?.field === 'type')
  check('no file -> file_required', (await upload('me/documents', { fields: { type: 'aadhaar_front', idempotencyKey: randomUUID() } })).json?.error === 'file_required')
  const octet = await upload('me/documents', { file: { bytes: PNG, name: 'front.png', type: 'application/octet-stream' }, fields: { type: 'aadhaar_front', idempotencyKey: randomUUID() } })
  check('octet-stream file typed from its extension', octet.status === 201 && octet.json?.document?.mimeType === 'image/png', octet.json)
  check('non image/PDF -> file_type', (await upload('me/documents', { file: { bytes: Buffer.from('hello'), name: 'a.txt', type: 'text/plain' }, fields: { type: 'aadhaar_back', idempotencyKey: randomUUID() } })).json?.error === 'file_type')
  const broken = await upload('me/documents', { file: { bytes: Buffer.from('%PDF-1.4 not really'), name: 'pan.pdf', type: 'application/pdf' }, fields: { type: 'pan', idempotencyKey: randomUUID() } })
  check('corrupt PDF -> 400 file_invalid (not a 500)', broken.status === 400 && broken.json?.error === 'file_invalid', broken.json)
  const legacy = await upload('me/documents', { file: { ...png, name: 'bank.png' }, payload: { type: 'bank_proof', idempotencyKey: randomUUID() } })
  check('legacy _payload JSON field still works', legacy.status === 201 && legacy.json?.document?.type === 'bank_proof', legacy.json)
  const docs = (await payload.find({ collection: 'partner-documents', overrideAccess: true, depth: 0, pagination: false, where: { owner: { equals: pan.json?.document ? (await payload.find({ collection: 'partners', overrideAccess: true, depth: 0, where: { externalUserId: { equals: UID } } })).docs[0]?.id : 'none' } } })).docs
  check('exactly the 5 accepted uploads were stored', docs.length === 5, docs.map((d: any) => d.type))

  // Job media: same parsing (kind as a plain field).
  const job = await upload(`jobs/${randomUUID()}/media`, { file: png, fields: { kind: 'pickup_photo', idempotencyKey: randomUUID() } })
  check('jobs/:id/media reads plain kind (reaches the job check)', job.status === 404 && job.json?.error === 'not_found', job.json)
  check('jobs/:id/media unknown kind -> invalid_body / kind', (await upload(`jobs/${randomUUID()}/media`, { file: png, fields: { kind: 'random', idempotencyKey: randomUUID() } })).json?.field === 'kind')
} catch (err) {
  check('harness crashed', false, String((err as Error)?.stack ?? err))
} finally {
  const ids = ((await payload.find({ collection: 'partners', overrideAccess: true, depth: 0, pagination: false, where: { externalUserId: { equals: UID } } })).docs as any[]).map((d) => d.id)
  if (ids.length) {
    await payload.delete({ collection: 'partner-documents', overrideAccess: true, where: { owner: { in: ids } } })
    for (const id of ids) await payload.delete({ collection: 'idempotency-keys', overrideAccess: true, where: { scopeKey: { like: `p:${id}` } } })
    await payload.delete({ collection: 'partners', overrideAccess: true, where: { id: { in: ids } } })
  }
  check('test data cleaned up', (await payload.count({ collection: 'partners', overrideAccess: true, where: { externalUserId: { equals: UID } } })).totalDocs === 0)
  const passed = results.filter((r) => r.ok).length
  const { writeFileSync } = await import('node:fs')
  writeFileSync('.tmp/multipart-results.json', JSON.stringify({ passed, failed: results.length - passed, failures: results.filter((r) => !r.ok), all: results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}`) }, null, 1))
  process.exit(0)
}
