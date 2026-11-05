/* E2E: Partner API identity from the Partner app's own login (X-Dwaar-User-* headers). Test data is removed at the end. */
import { randomBytes, randomUUID } from 'node:crypto'
import config from '@payload-config'
import { getPayload, handleEndpoints } from 'payload'
import sharp from 'sharp'

const KEY = randomBytes(24).toString('hex')
process.env.PARTNER_API_KEY = KEY // ephemeral, this process only
const RUN = randomBytes(4).toString('hex')
const UID = `e2e-ext-${RUN}-a`
const UID_B = `e2e-ext-${RUN}-b`
const UID_RACE = `e2e-ext-${RUN}-race`
const noise = Buffer.alloc(120 * 120 * 3); for (let i = 0; i < noise.length; i++) noise[i] = (i * 31) % 251
const PNG = await sharp(noise, { raw: { width: 120, height: 120, channels: 3 } }).png().toBuffer()

const results: { name: string; ok: boolean; info?: string }[] = []
const check = (name: string, cond: unknown, info?: unknown) => results.push({ name, ok: Boolean(cond), info: cond ? undefined : JSON.stringify(info)?.slice(0, 400) })

type Who = { id?: string; email?: string; name?: string; token?: string }
async function api(method: string, path: string, o: { who?: Who; body?: any; key?: string | null; idem?: string | null; file?: any; raw?: boolean } = {}) {
  const headers = new Headers()
  const key = o.key === undefined ? KEY : o.key
  if (key) headers.set('x-dwaar-partner-key', key)
  if (o.who?.token) headers.set('authorization', `Bearer ${o.who.token}`)
  if (o.who?.id) headers.set('x-dwaar-user-id', o.who.id)
  if (o.who?.email) headers.set('x-dwaar-user-email', o.who.email)
  if (o.who?.name) headers.set('x-dwaar-user-name', o.who.name)
  const idem = o.idem === undefined ? randomUUID() : o.idem
  let body: BodyInit | undefined
  if (o.file) {
    const fd = new FormData()
    fd.set('file', new File([PNG], 'doc.png', { type: 'image/png' }))
    fd.set('_payload', JSON.stringify({ ...o.file, ...(idem ? { idempotencyKey: idem } : {}) }))
    body = fd
  } else if (method !== 'GET') {
    headers.set('content-type', 'application/json')
    body = JSON.stringify({ ...(idem ? { idempotencyKey: idem } : {}), ...o.body })
  }
  const res = await handleEndpoints({ config, request: new Request(`http://localhost:3000/api/partner/v1/${path}`, { method, headers, body }) })
  if (o.raw) return { status: res.status, headers: res.headers, json: null as any, bytes: (await res.arrayBuffer()).byteLength }
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { json = text.slice(0, 200) }
  return { status: res.status, headers: res.headers, json, bytes: 0 }
}

const payload = await getPayload({ config })
const extPartners = async (uid: string) => (await payload.find({ collection: 'partners', overrideAccess: true, depth: 0, pagination: false, where: { externalUserId: { equals: uid } } })).docs as any[]

async function cleanup() {
  const P = ((await payload.find({ collection: 'partners', overrideAccess: true, depth: 0, pagination: false, where: { or: [{ externalUserId: { like: `e2e-ext-${RUN}` } }, { username: { equals: '6999900071' } }] } })).docs as any[]).map((d) => d.id)
  if (!P.length) return
  await payload.delete({ collection: 'partner-documents', overrideAccess: true, where: { owner: { in: P } } })
  for (const id of P) await payload.delete({ collection: 'idempotency-keys', overrideAccess: true, where: { scopeKey: { like: `p:${id}` } } })
  await payload.delete({ collection: 'idempotency-keys', overrideAccess: true, where: { scopeKey: { like: 'phone:6999900071' } } })
  await payload.delete({ collection: 'otp-challenges', overrideAccess: true, where: { phone: { equals: '6999900071' } } })
  await payload.delete({ collection: 'partners', overrideAccess: true, where: { id: { in: P } } })
}

try {
  const A: Who = { id: UID, email: 'Ravi.K@Example.com', name: encodeURIComponent('Ravi Kumār Singh') }

  // Partner key is still required for everything.
  check('identity headers without partner key -> missing_api_key', (await api('GET', 'me', { who: A, key: null })).json?.error === 'missing_api_key')
  check('identity headers with wrong partner key -> invalid_api_key', (await api('GET', 'me', { who: A, key: 'x'.repeat(48) })).json?.error === 'invalid_api_key')
  check('wrong key never creates a partner', (await extPartners(UID)).length === 0)
  // Without identity headers the old errors stay.
  check('no token, no headers -> missing_token', (await api('GET', 'me')).json?.error === 'missing_token')
  check('foreign token, no headers -> invalid_token', (await api('GET', 'me', { who: { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig' } })).json?.error === 'invalid_token')

  // Foreign token + headers: identity from headers, new partner in pending_verification.
  const first = await api('GET', 'me', { who: { ...A, token: 'foreign.jwt.token' } })
  check('foreign token + headers -> 200', first.status === 200, first.json)
  const p = first.json?.partner
  check('new partner is pending_verification', p?.verificationStatus === 'pending_verification', p)
  check('name header is URL-decoded', p?.name === 'Ravi Kumār Singh', p?.name)
  check('email stored (lower-cased)', p?.email === 'ravi.k@example.com', p?.email)
  check('identity external, no phone exposed', p?.identity === 'external' && p?.phone === null, p)
  check('onboarding is editable for pending_verification', first.json?.onboarding?.canEdit === true, first.json?.onboarding)
  const stored = await extPartners(UID)
  check('exactly one partner linked to the user id', stored.length === 1 && stored[0].id === p?.id, stored.length)

  // Same user again: found by user id, no duplicate; no Authorization header at all also works.
  const again = await api('GET', 'me', { who: { id: UID } })
  check('same user id (no Authorization) -> same partner', again.status === 200 && again.json?.partner?.id === p?.id, again.json)
  const moved = await api('GET', 'me', { who: { id: UID, email: 'ravi.new@example.com' } })
  check('changed email header updates the partner', moved.json?.partner?.email === 'ravi.new@example.com', moved.json?.partner)
  check('still one partner after repeat requests', (await extPartners(UID)).length === 1)

  // Bad headers.
  check('malformed URL-encoded name -> 400 invalid_identity', (await api('GET', 'me', { who: { id: UID, name: '%E0%A4' } })).json?.error === 'invalid_identity')
  check('invalid user id -> 400 invalid_identity', (await api('GET', 'me', { who: { id: 'bad id with spaces' } })).json?.error === 'invalid_identity')
  check('invalid email -> 400 invalid_identity', (await api('GET', 'me', { who: { id: UID, email: 'not-an-email' } })).json?.error === 'invalid_identity')

  // Race: two first requests for a new user id create one partner.
  const [r1, r2] = await Promise.all([api('GET', 'me', { who: { id: UID_RACE } }), api('GET', 'me', { who: { id: UID_RACE } })])
  check('concurrent first requests both succeed', r1.status === 200 && r2.status === 200, [r1.json, r2.json])
  check('concurrent first requests create one partner', (await extPartners(UID_RACE)).length === 1 && r1.json?.partner?.id === r2.json?.partner?.id)

  // Writes work with header identity, including idempotent replay.
  const idem = randomUUID()
  const patch1 = await api('PATCH', 'me', { who: { id: UID }, idem, body: { name: 'Ravi Kumar', dateOfBirth: '1993-02-11' } })
  const patch2 = await api('PATCH', 'me', { who: { id: UID }, idem, body: { name: 'Ravi Kumar', dateOfBirth: '1993-02-11' } })
  check('PATCH me via headers', patch1.status === 200 && patch1.json?.partner?.name === 'Ravi Kumar', patch1.json)
  check('idempotent replay via headers', patch2.headers.get('idempotent-replay') === 'true', patch2.status)

  // Private files: upload and read back as the header partner; another partner cannot.
  const up = await api('POST', 'me/documents', { who: { id: UID }, file: { type: 'pan' } })
  check('document upload via headers -> 201', up.status === 201, up.json)
  const docId = up.json?.document?.id
  const file = await api('GET', `files/partner-documents/${docId}`, { who: { id: UID }, raw: true })
  check('own document file streams via headers', file.status === 200 && (file.headers.get('content-type') ?? '').startsWith('image/') && file.bytes > 100, [file.status, file.headers.get('content-type'), file.bytes])
  check('file response is private, no-store', file.headers.get('cache-control') === 'private, no-store')
  const other = await api('GET', `files/partner-documents/${docId}`, { who: { id: UID_B }, raw: true })
  check("another partner cannot read the document", other.status === 404, other.status)

  // Our own token wins over the headers.
  const otp = await api('POST', 'auth/otp/request', { body: { phone: '6999900071' } })
  const ver = await api('POST', 'auth/otp/verify', { body: { phone: '6999900071', challengeId: otp.json?.challengeId, code: otp.json?.demoCode } })
  const own = await api('GET', 'me', { who: { token: ver.json?.token, id: UID } })
  check('own valid token beats identity headers', own.status === 200 && own.json?.partner?.id === ver.json?.partner?.id && own.json?.partner?.id !== p?.id, own.json?.partner)
  check('OTP partner keeps phone identity', own.json?.partner?.identity === 'phone' && own.json?.partner?.phone === '6999900071', own.json?.partner)

  // Logout with header identity is a no-op success; deleted accounts are refused.
  check('logout via headers -> 200', (await api('POST', 'auth/logout', { who: { id: UID } })).json?.loggedOut === true)
  await payload.update({ collection: 'partners', id: p.id, overrideAccess: true, data: { accountStatus: 'deleted' } as any })
  check('deleted partner via headers -> 401 account_deleted', (await api('GET', 'me', { who: { id: UID } })).json?.error === 'account_deleted')
  check('deleted partner is not re-created', (await extPartners(UID)).length === 1)
} catch (err) {
  check('harness crashed', false, String((err as Error)?.stack ?? err))
} finally {
  await cleanup()
  const left = (await payload.count({ collection: 'partners', overrideAccess: true, where: { externalUserId: { like: `e2e-ext-${RUN}` } } })).totalDocs
  check('test partners cleaned up', left === 0, left)
  const passed = results.filter((r) => r.ok).length
  const { writeFileSync } = await import('node:fs')
  writeFileSync('.tmp/ext-identity-results.json', JSON.stringify({ passed, failed: results.length - passed, failures: results.filter((r) => !r.ok), all: results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}`) }, null, 1))
  process.exit(0)
}
