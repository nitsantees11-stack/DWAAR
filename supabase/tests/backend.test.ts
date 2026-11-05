// End-to-end test of the dwaar Supabase backend against real Postgres (PGlite + the generated
// schema). Supabase Auth/Storage are doubles. Catalog data comes from the running Payload app.
// Run:
//   SRC=http://localhost:3000 IMPORT_TOKEN=$(cat .tmp/dwaar-import-token) deno test --no-config \
//     --import-map=supabase/tests/import_map.json -A --no-check supabase/tests/backend.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { run } from './pg.ts'

Deno.env.set('SUPABASE_URL', 'http://supabase.test')
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key-for-tests')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key-for-tests')
const KEY = 'partner-key-' + crypto.randomUUID()
Deno.env.set('PARTNER_API_KEY', KEY)
const SRC = Deno.env.get('SRC') ?? 'http://localhost:3000'
const IMPORT_TOKEN = Deno.env.get('IMPORT_TOKEN') ?? ''

const { app } = await import('../functions/server/app.tsx')
const BASE = 'http://fn/make-server-4d6fa028'

type Res = { status: number; json: any; headers: Headers; bytes?: number }
async function call(method: string, path: string, o: { body?: unknown; headers?: Record<string, string>; form?: FormData; raw?: boolean } = {}): Promise<Res> {
  const headers = new Headers({ Authorization: 'Bearer anon-key-for-tests', ...(o.headers ?? {}) })
  let body: BodyInit | undefined
  if (o.form) body = o.form
  else if (o.body !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(o.body)
  }
  const res = await app.fetch(new Request(`${BASE}${path}`, { method, headers, body }))
  if (o.raw) return { status: res.status, json: null, headers: res.headers, bytes: (await res.arrayBuffer()).byteLength }
  const text = await res.text()
  let json: any = text
  try {
    json = JSON.parse(text)
  } catch { /* text */ }
  return { status: res.status, json, headers: res.headers }
}
const customer = (token: string) => ({ 'x-dwaar-session': token })
const p = (method: string, path: string, o: { token?: string; who?: Record<string, string>; body?: any; key?: string | null; idem?: string; form?: FormData; raw?: boolean } = {}) => {
  const headers: Record<string, string> = {}
  const key = o.key === undefined ? KEY : o.key
  if (key) headers['x-dwaar-partner-key'] = key
  if (o.token) headers['x-dwaar-partner-token'] = o.token
  Object.assign(headers, o.who ?? {})
  const body = method === 'GET' || o.form ? undefined : { idempotencyKey: o.idem ?? crypto.randomUUID(), ...(o.body ?? {}) }
  if (o.form) o.form.set('_payload', JSON.stringify({ idempotencyKey: o.idem ?? crypto.randomUUID(), ...(o.body ?? {}) }))
  return call(method, `/partner/v1/${path}`, { body, headers, form: o.form, raw: o.raw })
}
const imp = (path: string, body: unknown) => call('POST', `/admin/import${path}`, { body, headers: { 'x-dwaar-import-token': IMPORT_TOKEN } })
const sql = run
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const pngForm = () => {
  const f = new FormData()
  f.set('file', new File([PNG], 'p.png', { type: 'image/png' }))
  return f
}
async function fetchAll(col: string) {
  const r = await fetch(`${SRC}/api/${col}?pagination=false&depth=0`)
  return (await r.json()).docs as Record<string, unknown>[]
}
const HOME = { lat: 28.4595, lng: 77.0726 }
const NEAR = { lat: 28.4612, lng: 77.0712 }

Deno.test('dwaar backend on Postgres', async (t) => {
  let AC: Record<string, any>
  let acService: Record<string, any>

  await t.step('import: token required, catalog + config copy from Payload', async () => {
    assertEquals((await call('POST', '/admin/import/docs', { body: { collection: 'users', docs: [] } })).status, 403)
    assertEquals((await call('POST', '/admin/import/docs', { body: { collection: 'users', docs: [] }, headers: { 'x-dwaar-import-token': 'x'.repeat(40) } })).status, 403)
    for (const col of ['media', 'service-categories', 'services', 'device-models', 'promotions']) {
      const docs = await fetchAll(col)
      if (col === 'media') for (const d of docs) d.storagePath = `catalog/${d.filename}`
      const r = await imp('/docs', { collection: col, docs })
      assert(r.json.ok, `${col}: ${JSON.stringify(r.json.results?.filter((x: any) => !x.ok)).slice(0, 400)}`)
    }
    const cfg = await (await fetch(`${SRC}/api/globals/business-config?depth=0`)).json()
    cfg.partnerPay = { defaultSharePercent: 80, visitFeeSharePercent: 80, riderLegFeePaise: 4000, releasePenaltyPaise: 5000, payoutDay: 'mon' }
    assert((await imp('/global', { slug: 'business-config', data: cfg })).json.ok)
    const again = await imp('/docs', { collection: 'services', docs: await fetchAll('services') })
    assert(again.json.ok, 're-import is an upsert')
    const counts = (await call('GET', '/admin/import/counts', { headers: { 'x-dwaar-import-token': IMPORT_TOKEN } })).json.counts
    assertEquals([counts['service-categories'], counts.services, counts['device-models'], counts.promotions], [5, 21, 52, 3])
    const file = new FormData()
    file.set('collection', 'media')
    file.set('path', 'catalog/test.png')
    file.set('file', new File([PNG], 'test.png', { type: 'image/png' }))
    const up = await call('POST', '/admin/import/file', { form: file, headers: { 'x-dwaar-import-token': IMPORT_TOKEN } })
    assert(up.json.ok && up.json.url.endsWith('/catalog/test.png'), JSON.stringify(up.json))
  })

  await t.step('public catalog', async () => {
    const r = await call('GET', '/catalog')
    assertEquals(r.status, 200)
    assertEquals(r.json.categories.length, 5)
    assert(r.json.services.every((s: any) => s.active !== false))
    assert(!('partnerPay' in r.json.config), 'partner pay stays private')
    const mobile = r.json.categories.find((c: any) => c.heroImage)
    assert(mobile?.heroImage?.url?.startsWith('https://storage.test/make-4d6fa028-public/catalog/'), JSON.stringify(mobile?.heroImage))
    AC = r.json.categories.find((c: any) => c.icon === 'ac')
    acService = r.json.services.find((s: any) => s.category === AC.id && !s.isOtherProblem)
    assert(AC && acService)
  })

  let cust = ''
  let custId = ''
  let addressId = ''
  let bookingId = ''
  await t.step('customer login, onboarding, address', async () => {
    assertEquals((await call('POST', '/c/auth/otp/start', { body: { phone: '123' } })).json.error, 'phone')
    const s = await call('POST', '/c/auth/otp/start', { body: { phone: '+91 98765 43210' } })
    assert(/^\d{6}$/.test(s.json.demoCode))
    assertEquals((await call('POST', '/c/auth/otp/start', { body: { phone: '9876543210' } })).json.error, 'otp_wait')
    const wrong = await call('POST', '/c/auth/otp/verify', { body: { phone: '9876543210', challengeId: s.json.challengeId, code: s.json.demoCode === '000000' ? '111111' : '000000' } })
    assertEquals([wrong.json.error, wrong.json.params?.left], ['otp_wrong', 4])
    const v = await call('POST', '/c/auth/otp/verify', { body: { phone: '9876543210', challengeId: s.json.challengeId, code: s.json.demoCode, lang: 'en' } })
    assert(v.json.ok && v.json.needsOnboarding && v.json.user.language === 'en', JSON.stringify(v.json))
    assertEquals((await call('POST', '/c/auth/otp/verify', { body: { phone: '9876543210', challengeId: s.json.challengeId, code: s.json.demoCode } })).json.error, 'otp_expired', 'no replay')
    cust = v.json.token
    custId = v.json.user.id
    assertEquals((await call('GET', '/c/me')).status, 401)
    assert((await call('POST', '/c/onboarding', { body: { name: 'Asha', language: 'hinglish' }, headers: customer(cust) })).json.user.onboarded)
    const bad = await call('POST', '/c/me/settings', { body: { group: 'preferences', values: { defaultPayment: 'bitcoin' } }, headers: customer(cust) })
    assertEquals(bad.json.error, 'invalid')
    const ok = await call('POST', '/c/me/settings', { body: { group: 'preferences', values: { defaultPayment: 'cod' } }, headers: customer(cust) })
    assertEquals(ok.json.user.preferences.defaultPayment, 'cod')
    const a = await call('POST', '/c/addresses', {
      headers: customer(cust),
      body: { label: 'home', contactName: 'Asha', contactPhone: '9876543210', flat: 'B-12', area: 'Sector 29', city: 'Gurugram', pincode: '122001', ...HOME },
    })
    assert(a.json.ok && a.json.address.isDefault, JSON.stringify(a.json))
    addressId = a.json.id
    const other = await call('POST', '/c/addresses', { headers: customer(cust), body: { label: 'work', contactName: 'Asha', contactPhone: '9876543210', flat: '1', area: 'Udyog Vihar', city: 'Gurugram', pincode: '122016', isDefault: true } })
    const list = (await call('GET', '/c/addresses', { headers: customer(cust) })).json.addresses
    assert(list[0].id === other.json.id && list.filter((x: any) => x.isDefault).length === 1, 'one default address')
    assert((await call('POST', `/c/addresses/${addressId}/default`, { headers: customer(cust) })).json.ok)
    const authMirror = (await import('./supabase-js.test-double.ts')).authUsers
    assert(authMirror.has(custId), 'customer mirrored into Supabase Auth')
  })

  await t.step('customer books an AC service (server re-derives the price)', async () => {
    const slots = (await import('../functions/server/lib-slots.tsx')).buildSlots(new Date(), AC.serviceHours?.startHour ?? 9, AC.serviceHours?.endHour ?? 21).flat()
    assert(slots.length > 0, 'a bookable slot exists')
    const type = AC.deviceTypes?.[0]?.value
    const draft = { categorySlug: AC.slug, lines: [{ serviceId: acService.id, quantity: 1 }], device: { type, brand: 'Voltas' }, schedule: { mode: 'scheduled', startAt: slots[0].startISO } }
    assertEquals((await call('POST', '/c/bookings', { headers: customer(cust), body: { ...draft, addressId, paymentMethod: 'cod', trustAccepted: true, idemKey: 'short' } })).json.error, 'invalid')
    const badSlot = await call('POST', '/c/bookings', { headers: customer(cust), body: { ...draft, schedule: { mode: 'scheduled', startAt: '2020-01-01T00:00:00.000Z' }, addressId, paymentMethod: 'cod', trustAccepted: true, idemKey: crypto.randomUUID() } })
    assertEquals(badSlot.json.error, 'slot')
    const idemKey = crypto.randomUUID()
    const made = await call('POST', '/c/bookings', { headers: customer(cust), body: { ...draft, addressId, paymentMethod: 'cod', trustAccepted: true, idemKey } })
    assert(made.json.ok, JSON.stringify(made.json))
    bookingId = made.json.id
    const dup = await call('POST', '/c/bookings', { headers: customer(cust), body: { ...draft, addressId, paymentMethod: 'cod', trustAccepted: true, idemKey } })
    assertEquals(dup.json.id, bookingId, 'idempotent create')
    const b = (await call('GET', `/c/bookings/${bookingId}`, { headers: customer(cust) })).json
    assertEquals(b.booking.status, 'BOOKED')
    assertEquals(b.booking.category.id, AC.id, 'category populated')
    assert(!('otpAttempts' in b.booking) && /^\d{4}$/.test(b.booking.serviceOtp))
    assertEquals(b.events.length, 1)
    assert(b.booking.pricing.estimateMinPaise > 0)
    const list = (await call('GET', '/c/bookings', { headers: customer(cust) })).json.bookings
    assertEquals(list.length, 1)
  })

  const tech: { token: string; id: string }[] = []
  await t.step('partner API: key, OTP login, onboarding, header identity', async () => {
    assertEquals((await p('GET', 'me', { key: null })).json.error, 'missing_api_key')
    assertEquals((await p('GET', 'me', { key: 'wrong' })).json.error, 'invalid_api_key')
    assertEquals((await p('GET', 'me')).json.error, 'missing_token')
    assertEquals((await p('GET', 'me', { token: 'not-ours-token-xxxxxxxxxxxx' })).json.error, 'invalid_token')
    assertEquals((await p('POST', 'auth/otp/request', { body: { phone: '9810000099' }, idem: 'x' })).json.error, 'idempotency_key_required')
    for (const phone of ['9810000091', '9810000092']) {
      const r1 = await p('POST', 'auth/otp/request', { body: { phone } })
      const r2 = await p('POST', 'auth/otp/verify', { body: { phone, challengeId: r1.json.challengeId, code: r1.json.demoCode } })
      assert(r2.json.ok && r2.json.partner.verificationStatus === 'draft', JSON.stringify(r2.json))
      tech.push({ token: r2.json.token, id: r2.json.partner.id })
      // One technician picks the category by key (`ac`), the other by id.
      const pick = phone.endsWith('91') ? ['ac'] : [AC.id]
      const patch = await p('PATCH', 'me', { token: r2.json.token, body: { name: `Tech ${phone.slice(-2)}`, dateOfBirth: '1994-05-10', role: 'technician', categories: pick, ...{ homeLat: NEAR.lat, homeLng: NEAR.lng }, serviceRadiusKm: 8 } })
      assert(patch.json.ok, JSON.stringify(patch.json))
      assertEquals(patch.json.partner.categories.map((c: any) => [c.id, c.key]), [[AC.id, 'ac']], 'stored as the category id')
      const wrongRole = await p('PATCH', 'me', { token: r2.json.token, body: { role: 'rider' } })
      assertEquals(wrongRole.json.error, 'category_role_mismatch')
      const doc = await p('POST', 'me/documents', { token: r2.json.token, form: pngForm(), body: { type: 'pan' } })
      assertEquals(doc.status, 201)
      const file = await p('GET', `files/partner-documents/${doc.json.document.id}`, { token: r2.json.token, raw: true })
      assert(file.status === 200 && file.headers.get('cache-control') === 'private, no-store' && (file.bytes ?? 0) > 10)
    }
    // Category values: discoverable, and keys / slugs / ids are all accepted.
    assertEquals((await p('GET', 'categories', { key: null })).json.error, 'missing_api_key')
    const cats = (await p('GET', 'categories')).json
    assertEquals(cats.categories.map((c: any) => c.key).sort(), ['ac', 'bike', 'mobile'])
    assertEquals(cats.roles, { technician: ['ac'], mechanic: ['bike'], rider: ['mobile'], hub_technician: ['mobile'] })
    assert(cats.categories.every((c: any) => c.id && c.slug && c.name && c.roles.length > 0))
    const T0 = tech[0].token
    assertEquals((await p('PATCH', 'me', { token: T0, body: { categories: [AC.slug] } })).json.partner.categories[0].id, AC.id, 'slug accepted')
    assertEquals((await p('PATCH', 'me', { token: T0, body: { categories: ['AC', AC.id] } })).json.partner.categories.length, 1, 'case-insensitive key, duplicates merged')
    assertEquals((await p('PATCH', 'me', { token: T0, body: { categories: ['bike'] } })).json.error, 'category_role_mismatch')
    const soon = await p('PATCH', 'me', { token: T0, body: { categories: ['fridge'] } })
    assertEquals([soon.json.error, soon.json.params?.value], ['invalid_category', 'fridge'], 'coming-soon category refused')
    assertEquals((await p('PATCH', 'me', { token: T0, body: { categories: ['washing-machine'] } })).json.error, 'invalid_category')
    assertEquals((await p('PATCH', 'me', { token: T0, body: { role: 'mechanic', categories: ['bike'] } })).json.partner.categories[0].key, 'bike', 'role + key together')
    assertEquals((await p('PATCH', 'me', { token: T0, body: { role: 'technician', categories: ['ac'] } })).json.partner.role, 'technician')
    assertEquals((await p('GET', 'skill-test?category=bike', { token: T0 })).json.error, 'category_not_selected', 'skill test resolves keys')
    assertEquals((await p('GET', 'skill-test?category=ac', { token: T0 })).json.error, 'not_found', 'key resolved and selected (no test imported here)')
    // Multipart with plain form fields (no _payload), as the Partner app sends it.
    const plain = async (fields: Record<string, string>, file: File | null, headers: Record<string, string> = {}) => {
      const f = new FormData()
      if (file) f.set('file', file)
      for (const [k, v] of Object.entries(fields)) f.set(k, v)
      return call('POST', '/partner/v1/me/documents', { form: f, headers: { 'x-dwaar-partner-key': KEY, 'x-dwaar-partner-token': T0, ...headers } })
    }
    const pngFile = (name = 'a.png', type = 'image/png') => new File([PNG], name, { type })
    const ok1 = await plain({ type: 'aadhaar_front', idempotencyKey: crypto.randomUUID() }, pngFile())
    assert(ok1.status === 201 && ok1.json.ok && ok1.json.document.type === 'aadhaar_front', JSON.stringify(ok1.json))
    assertEquals((await plain({ idempotencyKey: crypto.randomUUID() }, pngFile())).json.field, 'type')
    assertEquals((await plain({ type: 'aadhaar_back', idempotencyKey: crypto.randomUUID() }, null)).json.error, 'file_required')
    assertEquals((await plain({ type: 'vehicle_rc', expiresAt: '', idempotencyKey: crypto.randomUUID() }, pngFile())).json.error, 'expiry_required')
    const dlc = await plain({ type: 'driving_licence', expiresAt: '2030-01-01', idempotencyKey: crypto.randomUUID() }, pngFile())
    assert(String(dlc.json.document?.expiresAt).startsWith('2030-01-01'), JSON.stringify(dlc.json))
    const oct = await plain({ type: 'bank_proof', idempotencyKey: crypto.randomUUID() }, pngFile('bank.png', 'application/octet-stream'))
    assertEquals(oct.json.document?.mimeType, 'image/png', 'octet-stream typed from the extension')
    const ik = crypto.randomUUID()
    const k1 = await plain({ type: 'selfie' }, pngFile(), { 'idempotency-key': ik })
    const k2 = await plain({ type: 'selfie' }, pngFile(), { 'idempotency-key': ik })
    assert(k1.status === 201 && k2.headers.get('idempotent-replay') === 'true' && k2.json.document.id === k1.json.document.id, 'Idempotency-Key header')
    const otherDoc = (await p('GET', 'me/documents', { token: tech[0].token })).json.documents[0].id
    assertEquals((await p('GET', `files/partner-documents/${otherDoc}`, { token: tech[1].token, raw: true })).status, 404, 'cannot read another partner document')
    assertEquals((await p('POST', 'presence', { token: tech[0].token, body: { online: true, ...NEAR } })).json.error, 'not_approved')
    await sql(`update dw_partners set verification_status = 'approved' where id = any($1::uuid[])`, [tech.map((x) => x.id)])

    // Partner app identity through headers.
    const who = { 'x-dwaar-user-id': 'app-user-42', 'x-dwaar-user-email': 'Ravi@Example.com', 'x-dwaar-user-name': encodeURIComponent('Ravi Kumār') }
    assertEquals((await p('GET', 'me', { who, key: null })).json.error, 'missing_api_key')
    const first = await p('GET', 'me', { who, token: 'foreign-token-xxxxxxxxxxxxxxxx' })
    assert(first.json.ok, JSON.stringify(first.json))
    assertEquals(first.json.partner.verificationStatus, 'pending_verification')
    assertEquals(first.json.partner.name, 'Ravi Kumār')
    assertEquals(first.json.partner.email, 'ravi@example.com')
    assertEquals(first.json.partner.phone, null)
    assert(first.json.onboarding.canEdit)
    const again = await p('GET', 'me', { who: { 'x-dwaar-user-id': 'app-user-42' } })
    assertEquals(again.json.partner.id, first.json.partner.id)
    const [r1, r2] = await Promise.all([p('GET', 'me', { who: { 'x-dwaar-user-id': 'app-user-race' } }), p('GET', 'me', { who: { 'x-dwaar-user-id': 'app-user-race' } })])
    assert(r1.json.ok && r2.json.ok && r1.json.partner.id === r2.json.partner.id, 'race creates one partner')
    assertEquals((await sql(`select count(*)::int as n from dw_partners where external_user_id = 'app-user-race'`))[0].n, 1)
    assertEquals((await p('GET', 'me', { who: { 'x-dwaar-user-id': 'a', 'x-dwaar-user-name': '%E0%A4' } })).json.error, 'invalid_identity')
    const own = await p('GET', 'me', { token: tech[0].token, who })
    assertEquals(own.json.partner.id, tech[0].id, 'own token wins over headers')
    const idem = crypto.randomUUID()
    const w1 = await p('PATCH', 'me', { who, idem, body: { dateOfBirth: '1990-01-01' } })
    const w2 = await p('PATCH', 'me', { who, idem, body: { dateOfBirth: '1990-01-01' } })
    assert(w1.json.ok && w2.headers.get('idempotent-replay') === 'true', 'idempotent replay')
  })

  let offerId = ''
  await t.step('dispatch: offer, first accept wins', async () => {
    for (const x of tech) assert((await p('POST', 'presence', { token: x.token, body: { online: true, ...NEAR } })).json.partner.isOnline)
    // Bring the slot within the dispatch window (T-60 min).
    const iso = (min: number) => new Date(Date.now() + min * 60_000).toISOString()
    await sql(`update dw_bookings set schedule = schedule || jsonb_build_object('startAt', $2::text, 'endAt', $3::text) where id = $1`, [bookingId, iso(30), iso(150)])
    // The dispatch sweep runs at most every 3 s per instance.
    await new Promise((r) => setTimeout(r, 3100))
    let offers: any[] = []
    for (const x of tech) {
      const r = await p('GET', 'offers', { token: x.token })
      if (r.json.offers?.length) offers = r.json.offers.map((o: any) => ({ ...o, who: x }))
    }
    assertEquals(offers.length, 1, 'one partner at a time')
    const offer = offers[0]
    offerId = offer.id
    assert(offer.job && offer.job.area && !('address' in offer.job), 'no customer address before accept')
    const [a1, a2] = await Promise.all([p('POST', `offers/${offer.id}/accept`, { token: offer.who.token }), p('POST', `offers/${offer.id}/accept`, { token: offer.who.token })])
    const oks = [a1, a2].filter((r) => r.json.ok)
    assertEquals(oks.length, 1, `exactly one accept wins: ${JSON.stringify([a1.json.error, a2.json.error])}`)
    const job = oks[0].json.job
    assertEquals(job.status, 'PARTNER_ASSIGNED')
    if (offer.who.id !== tech[0].id) tech.reverse()
    const otherOffer = await p('POST', `offers/${offer.id}/accept`, { token: tech[1].token })
    assertEquals(otherOffer.json.error, 'not_found', 'someone else’s offer')
    const b = (await call('GET', `/c/bookings/${bookingId}`, { headers: customer(cust) })).json.booking
    assert(b.partner?.name && b.status === 'PARTNER_ASSIGNED', JSON.stringify(b.partner))
  })

  await t.step('job: on the way, arrive (geofence), OTP start, payment, complete', async () => {
    const T = tech[0].token
    assertEquals((await p('POST', `jobs/${bookingId}/transition`, { token: T, body: { to: 'ON_THE_WAY' } })).json.error, 'location_required')
    assertEquals((await p('POST', `jobs/${bookingId}/transition`, { token: T, body: { to: 'ON_THE_WAY', ...NEAR } })).json.job.status, 'ON_THE_WAY')
    assertEquals((await p('POST', `jobs/${bookingId}/transition`, { token: T, body: { to: 'ARRIVED', lat: 28.49, lng: 77.08 } })).json.error, 'outside_geofence')
    const arrived = await p('POST', `jobs/${bookingId}/transition`, { token: T, body: { to: 'ARRIVED', ...HOME } })
    assertEquals(arrived.json.job.status, 'ARRIVED')
    assert(arrived.json.job.address.location, 'exact location while the leg is live')
    const otp = (await call('GET', `/c/bookings/${bookingId}`, { headers: customer(cust) })).json.booking.serviceOtp
    const wrong = await p('POST', `jobs/${bookingId}/transition`, { token: T, body: { to: 'IN_PROGRESS', otp: otp === '0000' ? '1111' : '0000' } })
    assertEquals([wrong.json.error, wrong.json.params?.left], ['otp_wrong', 4])
    assertEquals((await sql(`select otp_attempts->>'service' as n from dw_bookings where id = $1`, [bookingId]))[0].n, '1', 'wrong OTP counted')
    assertEquals((await p('POST', `jobs/${bookingId}/transition`, { token: T, body: { to: 'IN_PROGRESS', otp } })).json.job.status, 'IN_PROGRESS')
    const blocked = await p('POST', `jobs/${bookingId}/transition`, { token: T, body: { to: 'COMPLETED' } })
    assertEquals(blocked.json.error, 'payment_required')
    const job = (await p('GET', `jobs/${bookingId}`, { token: T })).json.job
    const due = job.pricing.amountDuePaise
    assertEquals((await p('POST', `jobs/${bookingId}/payment`, { token: T, body: { method: 'cash', amountPaise: due + 1 } })).json.error, 'amount_mismatch')
    assert((await p('POST', `jobs/${bookingId}/payment`, { token: T, body: { method: 'cash', amountPaise: due } })).json.ok)
    const done = await p('POST', `jobs/${bookingId}/transition`, { token: T, body: { to: 'COMPLETED' } })
    assertEquals(done.json.job.status, 'COMPLETED')
    const ledger = await sql<{ type: string; amount_paise: number }>(`select type, amount_paise from dw_earnings_ledger where partner = $1`, [tech[0].id])
    assert(ledger.some((e) => e.type === 'job_earning' && e.amount_paise > 0), JSON.stringify(ledger))
    assert(ledger.some((e) => e.type === 'cod_collected' && e.amount_paise === -due))
    const earn = (await p('GET', 'earnings', { token: T })).json
    assertEquals(earn.balances.cashInHandPaise, due)
    const partner = (await sql<{ current_job: string | null; stats: any }>(`select current_job, stats from dw_partners where id = $1`, [tech[0].id]))[0]
    assertEquals(partner.current_job, null, 'partner free again')
    assertEquals(partner.stats.jobsCompleted, 1)
    const events = (await call('GET', `/c/bookings/${bookingId}`, { headers: customer(cust) })).json.events.map((e: any) => e.status)
    assertEquals(events.slice().reverse(), ['BOOKED', 'PARTNER_ASSIGNED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'])
    if ((acService.warrantyDays ?? 0) > 0) assertEquals((await call('GET', '/c/warranties', { headers: customer(cust) })).json.warranties.length, 1)
  })

  await t.step('customer rates; second rating refused; partner average updates', async () => {
    assert((await call('POST', `/c/bookings/${bookingId}/rate`, { headers: customer(cust), body: { stars: 4 } })).json.ok)
    assertEquals((await call('POST', `/c/bookings/${bookingId}/rate`, { headers: customer(cust), body: { stars: 5 } })).json.error, 'already_rated')
    const r = (await sql<{ rating: number; rating_count: number }>(`select rating, rating_count from dw_partners where id = $1`, [tech[0].id]))[0]
    assertEquals([r.rating, r.rating_count], [4, 1])
    assertEquals((await call('POST', `/c/bookings/${bookingId}/cancel`, { headers: customer(cust), body: { reason: 'mistake' } })).json.error, 'cannot_cancel')
  })

  await t.step('cancel before assignment is free; other customers cannot see the booking', async () => {
    const slots = (await import('../functions/server/lib-slots.tsx')).buildSlots(new Date(), AC.serviceHours?.startHour ?? 9, AC.serviceHours?.endHour ?? 21).flat()
    const draft = { categorySlug: AC.slug, lines: [{ serviceId: acService.id, quantity: 1 }], device: { type: AC.deviceTypes?.[0]?.value, brand: 'LG' }, schedule: { mode: 'scheduled', startAt: slots[slots.length - 1].startISO } }
    const made = await call('POST', '/c/bookings', { headers: customer(cust), body: { ...draft, addressId, paymentMethod: 'upi', trustAccepted: true, idemKey: crypto.randomUUID() } })
    const s = await call('POST', '/c/auth/otp/start', { body: { phone: '9876500000' } })
    const v = await call('POST', '/c/auth/otp/verify', { body: { phone: '9876500000', challengeId: s.json.challengeId, code: s.json.demoCode } })
    assertEquals((await call('GET', `/c/bookings/${made.json.id}`, { headers: customer(v.json.token) })).status, 404)
    assertEquals((await call('POST', `/c/bookings/${made.json.id}/cancel`, { headers: customer(v.json.token), body: { reason: 'mistake' } })).status, 404)
    assert((await call('POST', `/c/bookings/${made.json.id}/cancel`, { headers: customer(cust), body: { reason: 'plan_changed' } })).json.ok)
    const b = (await call('GET', `/c/bookings/${made.json.id}`, { headers: customer(cust) })).json.booking
    assertEquals([b.status, b.pricing.cancelFeePaise], ['CANCELLED', 0])
  })

  await t.step('support, SOS, logout', async () => {
    assertEquals((await p('POST', 'sos', { token: tech[0].token, body: { ...NEAR } })).json.emergency, '112')
    assertEquals((await call('POST', '/c/tickets', { headers: customer(cust), body: { topic: 'booking', message: 'AC still dripping a bit', bookingId } })).status, 200)
    assert((await p('POST', 'auth/logout', { token: tech[1].token })).json.ok)
    assertEquals((await p('GET', 'me', { token: tech[1].token })).json.error, 'invalid_token')
    assert((await call('POST', '/c/auth/logout', { headers: customer(cust) })).json.ok)
    assertEquals((await call('GET', '/c/me', { headers: customer(cust) })).status, 401)
  })
})
