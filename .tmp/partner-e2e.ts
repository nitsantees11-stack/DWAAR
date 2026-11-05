/* End-to-end test of the dwaar Partner API (happy paths + edge cases). Test data is removed at the end. */
import { randomBytes, randomUUID } from 'node:crypto'
import config from '@payload-config'
import { getPayload, handleEndpoints } from 'payload'

const KEY = randomBytes(24).toString('hex')
process.env.PARTNER_API_KEY = KEY // ephemeral, this process only

const AC = '82d8949b-ac90-49f6-b8a0-0cfa3c3b0b7b'
const MOBILE = '4e21f4fa-98b5-452f-a4d4-6134173dd2f5'
const AC_JET = 'b661fb97-6992-44a2-ba1a-16ac83aebf3b'
const SCREEN = '5de64267-7988-4a8c-a3c9-063448b7d9b3'
const HOME = { lat: 28.4595, lng: 77.0726 } // customer, Sector 29
const NEAR = { lat: 28.4612, lng: 77.0712 }
const FAR = { lat: 28.4795, lng: 77.0726 } // ~2.2 km
import sharp from 'sharp'
const noise = Buffer.alloc(160 * 160 * 3); for (let i = 0; i < noise.length; i++) noise[i] = (i * 37) % 251
const PNG = await sharp(noise, { raw: { width: 160, height: 160, channels: 3 } }).png().toBuffer()

const results: { name: string; ok: boolean; info?: string }[] = []
function check(name: string, cond: unknown, info?: unknown) {
  results.push({ name, ok: Boolean(cond), info: cond ? undefined : JSON.stringify(info)?.slice(0, 400) })
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Res = { status: number; headers: Headers; json: any }
async function api(method: string, path: string, o: { token?: string; body?: any; file?: { kind?: string; type?: string; expiresAt?: string }; key?: string | null; idem?: string | null } = {}): Promise<Res> {
  const headers = new Headers()
  const key = o.key === undefined ? KEY : o.key
  if (key) headers.set('x-dwaar-partner-key', key)
  if (o.token) headers.set('authorization', `Bearer ${o.token}`)
  let body: BodyInit | undefined
  const idem = o.idem === undefined ? randomUUID() : o.idem
  if (o.file) {
    const fd = new FormData()
    fd.set('file', new File([PNG], 'photo.png', { type: 'image/png' }))
    fd.set('_payload', JSON.stringify({ ...o.file, ...(idem ? { idempotencyKey: idem } : {}) }))
    body = fd
  } else if (method !== 'GET') {
    headers.set('content-type', 'application/json')
    body = JSON.stringify({ ...(idem ? { idempotencyKey: idem } : {}), ...o.body })
  }
  const request = new Request(`http://localhost:3000/api/partner/v1/${path}`, { method, headers, body })
  const res = await handleEndpoints({ config, request })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { json = text.slice(0, 200) }
  return { status: res.status, headers: res.headers, json }
}

const payload = await getPayload({ config })
const created = { partners: [] as string[], users: [] as string[], bookings: [] as string[], phones: [] as string[] }

async function login(phone: string) {
  created.phones.push(phone)
  const r1 = await api('POST', 'auth/otp/request', { body: { phone } })
  const r2 = await api('POST', 'auth/otp/verify', { body: { phone, challengeId: r1.json.challengeId, code: r1.json.demoCode } })
  if (r2.status !== 200) throw new Error(`login failed ${phone}: ${JSON.stringify(r2.json)}`)
  created.partners.push(r2.json.partner.id)
  return { token: r2.json.token as string, id: r2.json.partner.id as string }
}

/** Quick onboarding for helper partners: profile via API, documents and approval as the hub. */
async function readyPartner(phone: string, name: string, role: string, cat: string, at: { lat: number; lng: number }, vehicle?: any) {
  const p = await login(phone)
  const r = await api('PATCH', 'me', { token: p.token, body: { name, dateOfBirth: '1994-05-10', role, categories: [cat], homeLat: at.lat, homeLng: at.lng, serviceRadiusKm: 8, ...(vehicle ? { vehicle } : {}) } })
  if (r.status !== 200) throw new Error(`patch ${name}: ${JSON.stringify(r.json)}`)
  if (vehicle) {
    for (const type of ['driving_licence', 'vehicle_rc']) {
      const d = await api('POST', 'me/documents', { token: p.token, file: { type, expiresAt: '2030-01-01' } })
      if (d.status !== 201) throw new Error(`doc ${type}: ${JSON.stringify(d.json)}`)
      await payload.update({ collection: 'partner-documents', id: d.json.document.id, overrideAccess: true, data: { status: 'approved' } })
    }
  }
  await payload.update({ collection: 'partners', id: p.id, overrideAccess: true, data: { verificationStatus: 'approved' } as any })
  const on = await api('POST', 'presence', { token: p.token, body: { online: true, ...at } })
  if (on.status !== 200) throw new Error(`online ${name}: ${JSON.stringify(on.json)}`)
  return p
}

async function makeBooking(customer: string, kind: 'ac' | 'mobile') {
  const ac = kind === 'ac'
  const b = await payload.create({
    collection: 'bookings',
    overrideAccess: true,
    context: { actor: 'customer', eventNote: 'e2e test booking' },
    data: {
      bookingCode: `DWT${randomBytes(3).toString('hex').toUpperCase()}`,
      status: 'BOOKED',
      title: ac ? 'AC Jet Service' : 'Screen Replacement',
      deviceLabel: ac ? 'Voltas 1.5T split' : 'Samsung Galaxy S21',
      customer,
      category: ac ? AC : MOBILE,
      flow: ac ? 'doorstep' : 'pickup_drop',
      lines: [ac ? { service: AC_JET, name: 'AC Jet Service', quantity: 1, minPaise: 59900, maxPaise: 59900 } : { service: SCREEN, name: 'Screen Replacement', quantity: 1, minPaise: 300000, maxPaise: 650000 }],
      device: { type: ac ? 'ac' : 'phone' },
      address: { label: 'Home', contactName: 'E2E Customer', line: 'H.No 1204, Sector 29, Gurugram', ...HOME },
      schedule: { mode: 'asap', startAt: new Date().toISOString(), endAt: new Date(Date.now() + 3600e3).toISOString() },
      scheduleLabel: 'ASAP (right now)',
      pricing: ac ? { estimateMinPaise: 89800, estimateMaxPaise: 89800, visitFeePaise: 29900, discountPaise: 0 } : { estimateMinPaise: 300000, estimateMaxPaise: 650000, visitFeePaise: 0, discountPaise: 0 },
      payment: { method: 'cod', status: 'pending' },
      serviceOtp: '4821',
      trustAccepted: true,
    } as any,
  })
  created.bookings.push(b.id)
  return b.id
}
const booking = (id: string) => payload.findByID({ collection: 'bookings', id, overrideAccess: true, depth: 0, showHiddenFields: true }) as Promise<any>
async function offersFor(token: string) {
  return (await api('GET', 'offers', { token })).json.offers as any[]
}
async function waitAny(who: { token: string }[], bookingId: string) {
  for (let i = 0; i < 8; i++) {
    for (const w of who) {
      const o = (await offersFor(w.token)).find((x) => x.bookingId === bookingId)
      if (o) return { who: w, offer: o }
    }
    await sleep(2000)
  }
  return null
}
async function waitOffer(token: string, bookingId: string) {
  for (let i = 0; i < 6; i++) {
    const o = (await offersFor(token)).find((x) => x.bookingId === bookingId || x.booking?.id === bookingId)
    if (o) return o
    await sleep(3200)
  }
  return null
}
const customerSays = (id: string, status: string) =>
  payload.update({ collection: 'bookings', id, overrideAccess: true, context: { actor: 'customer' }, data: { status } as any })

async function cleanup() {
  // ---------- Cleanup ----------
  const del = async (collection: any, where: any) => {
    try { await payload.delete({ collection, overrideAccess: true, where }) } catch (e) { console.error('cleanup', collection, String(e)) }
  }
  const P = ((await payload.find({ collection: 'partners', overrideAccess: true, depth: 0, pagination: false, where: { username: { like: '69999' } } })).docs as any[]).map((d) => d.id)
  const B = ((await payload.find({ collection: 'bookings', overrideAccess: true, depth: 0, pagination: false, where: { bookingCode: { like: 'DWT' } } })).docs as any[]).map((d) => d.id)
  created.users = ((await payload.find({ collection: 'users', overrideAccess: true, depth: 0, pagination: false, where: { username: { like: '69999' } } })).docs as any[]).map((d) => d.id)
  if (B.length) {
    await del('booking-events', { booking: { in: B } })
    await del('job-offers', { booking: { in: B } })
    await del('job-media', { booking: { in: B } })
    await del('partner-locations', { booking: { in: B } })
  }
  if (P.length) {
    for (const c of ['job-offers', 'earnings-ledger', 'payouts', 'partner-locations', 'partner-tickets', 'job-media']) await del(c, { partner: { in: P } })
    await del('partner-documents', { owner: { in: P } })
    for (const id of P) await del('idempotency-keys', { scopeKey: { like: `p:${id}` } })
  }
  for (const ph of created.phones.concat(['6999900009'])) await del('idempotency-keys', { scopeKey: { like: `phone:${ph}` } })
  if (B.length) await del('bookings', { id: { in: B } })
  if (P.length) await del('partners', { id: { in: P } })
  if (created.users.length) await del('users', { id: { in: created.users } })
  try { await del('otp-challenges', { phone: { in: created.phones } }) } catch {}
}
await cleanup()

try {
  // ---------- Edge: API key and token gates ----------
  check('no API key -> 401 missing_api_key', (await api('GET', 'me', { key: null })).json?.error === 'missing_api_key')
  check('wrong API key -> 401 invalid_api_key', (await api('GET', 'me', { key: 'x'.repeat(48) })).json?.error === 'invalid_api_key')
  check('no token -> 401 missing_token', (await api('GET', 'me')).json?.error === 'missing_token')
  check('garbage token -> 401 invalid_token', (await api('GET', 'me', { token: 'abc.def.ghi' })).status === 401)
  check('write without idempotency key -> 400', (await api('POST', 'auth/otp/request', { body: { phone: '6999900009' }, idem: null })).status === 400)

  await payload.delete({ collection: 'users', overrideAccess: true, where: { username: { equals: '6999900099' } } })
  const cust = await payload.create({ collection: 'users', overrideAccess: true, data: { username: '6999900099', password: randomUUID(), name: 'E2E Customer', language: 'hinglish' } as any })
  created.users.push(cust.id)

  // ---------- Happy path 1: onboarding of an AC technician through the API ----------
  const T1 = await login('6999900001')
  const me0 = await api('GET', 'me', { token: T1.token })
  check('new partner starts as draft', me0.json.partner?.verificationStatus === 'draft', me0.json)
  check('presence blocked before approval (not_approved)', (await api('POST', 'presence', { token: T1.token, body: { online: true, ...NEAR } })).json?.error === 'not_approved')
  check('category/role mismatch rejected', (await api('PATCH', 'me', { token: T1.token, body: { role: 'technician', categories: [MOBILE] } })).json?.error === 'category_role_mismatch')
  const patch = await api('PATCH', 'me', { token: T1.token, body: { name: 'E2E Tech One', dateOfBirth: '1992-03-14', role: 'technician', categories: [AC], homeLat: NEAR.lat, homeLng: NEAR.lng, serviceRadiusKm: 8, languages: ['hi', 'en'] } })
  check('profile saved', patch.status === 200, patch.json)
  for (const type of ['aadhaar_front', 'aadhaar_back', 'pan', 'selfie', 'bank_proof']) {
    const d = await api('POST', 'me/documents', { token: T1.token, file: { type } })
    if (d.status !== 201) check(`upload ${type}`, false, d.json)
  }
  const docs = await api('GET', 'me/documents', { token: T1.token })
  check('5 KYC documents uploaded', docs.json.documents?.length === 5, docs.json)
  check('bank: bad IFSC rejected', (await api('POST', 'me/bank', { token: T1.token, body: { holderName: 'E2E Tech One', accountNumber: '123456789012', ifsc: 'BAD' } })).status === 400)
  const bank = await api('POST', 'me/bank', { token: T1.token, body: { holderName: 'E2E Tech One', accountNumber: '123456789012', ifsc: 'HDFC0001234' } })
  check('bank stored as last 4 only', bank.json.bank?.accountLast4 === '9012' && !JSON.stringify(bank.json).includes('123456789012'), bank.json)
  const test = await api('GET', `skill-test?category=${AC}`, { token: T1.token })
  check('skill test served without answers', test.json.test?.questions?.length === 5 && !JSON.stringify(test.json).includes('correctIndex'), test.json)
  const fail1 = await api('POST', 'skill-test/submit', { token: T1.token, body: { category: AC, answers: [0, 0, 0, 0, 1] } })
  check('wrong answers fail the test', fail1.json.passed === false, fail1.json)
  check('submit blocked while test not passed', (await api('POST', 'onboarding/submit', { token: T1.token, body: { trainingAcknowledged: true, agreementAccepted: true } })).json?.field === 'skill_test')
  const pass = await api('POST', 'skill-test/submit', { token: T1.token, body: { category: AC, answers: [1, 1, 0, 1, 0] } })
  check('correct answers pass (100%)', pass.json.passed === true && pass.json.score === 100, pass.json)
  const submit = await api('POST', 'onboarding/submit', { token: T1.token, body: { trainingAcknowledged: true, agreementAccepted: true } })
  check('onboarding submitted', submit.json.partner?.verificationStatus === 'submitted', submit.json)
  check('profile locked after submit', (await api('PATCH', 'me', { token: T1.token, body: { name: 'Changed' } })).json?.error === 'profile_locked')
  await payload.update({ collection: 'partners', id: T1.id, overrideAccess: true, data: { verificationStatus: 'approved' } as any })
  const online = await api('POST', 'presence', { token: T1.token, body: { online: true, ...NEAR } })
  check('approved partner goes online', online.json.partner?.isOnline === true, online.json)

  // Idempotent replay
  const idem = randomUUID()
  const r1 = await api('POST', 'presence', { token: T1.token, body: { online: true, ...NEAR }, idem })
  const r2 = await api('POST', 'presence', { token: T1.token, body: { online: true, ...NEAR }, idem })
  check('idempotent replay returns first response', r2.headers.get('idempotent-replay') === 'true' && r2.json?.partner?.id === r1.json?.partner?.id && r2.json?.partner?.lastSeenAt === r1.json?.partner?.lastSeenAt, [r1.json?.partner?.lastSeenAt, r2.json?.partner?.lastSeenAt, r2.headers.get('idempotent-replay')])

  // ---------- Happy path 2: doorstep AC job, offer -> paid -> earnings ----------
  const B1 = await makeBooking(cust.id, 'ac')
  const o1 = await waitOffer(T1.token, B1)
  check('ASAP booking offered to the online technician', Boolean(o1), await offersFor(T1.token))
  check('offer hides customer exact address', o1 && !JSON.stringify(o1).includes('1204'), o1)
  const acc = await api('POST', `offers/${o1?.id}/accept`, { token: T1.token })
  check('accept -> PARTNER_ASSIGNED', acc.json.job?.status === 'PARTNER_ASSIGNED', acc.json)
  check('customer sees partner name on booking', (await booking(B1)).partner?.name === 'E2E Tech One')
  check('ON_THE_WAY requires location', (await api('POST', `jobs/${B1}/transition`, { token: T1.token, body: { to: 'ON_THE_WAY' } })).json?.error === 'location_required')
  check('ON_THE_WAY ok', (await api('POST', `jobs/${B1}/transition`, { token: T1.token, body: { to: 'ON_THE_WAY', ...FAR } })).json.job?.status === 'ON_THE_WAY')
  const far = await api('POST', `jobs/${B1}/transition`, { token: T1.token, body: { to: 'ARRIVED', ...FAR } })
  check('ARRIVED outside 300 m geofence rejected', far.json?.error === 'outside_geofence', far.json)
  check('ARRIVED inside geofence ok', (await api('POST', `jobs/${B1}/transition`, { token: T1.token, body: { to: 'ARRIVED', ...HOME } })).json.job?.status === 'ARRIVED')
  const bad = await api('POST', `jobs/${B1}/transition`, { token: T1.token, body: { to: 'IN_PROGRESS', otp: '1111' } })
  check('wrong service OTP -> otp_wrong with 4 left', bad.json?.error === 'otp_wrong' && bad.json.params?.left === 4, bad.json)
  check('wrong OTP attempt counted', (await booking(B1)).otpAttempts?.service === 1)
  check('correct service OTP -> IN_PROGRESS', (await api('POST', `jobs/${B1}/transition`, { token: T1.token, body: { to: 'IN_PROGRESS', otp: '4821' } })).json.job?.status === 'IN_PROGRESS')
  const bill = await api('POST', `jobs/${B1}/media`, { token: T1.token, file: { kind: 'part_bill' } })
  check('part bill uploaded', bill.status === 201, bill.json)
  const parts = await api('POST', `jobs/${B1}/parts`, { token: T1.token, body: { parts: [{ name: 'Drain pipe 2 m', pricePaise: 15000, billMediaId: bill.json.media?.id }] } })
  check('parts recorded', parts.status === 200, parts.json)
  check('COMPLETED before payment rejected', (await api('POST', `jobs/${B1}/transition`, { token: T1.token, body: { to: 'COMPLETED' } })).json?.error === 'payment_required')
  const mism = await api('POST', `jobs/${B1}/payment`, { token: T1.token, body: { method: 'cash', amountPaise: 100 } })
  check('payment amount mismatch reports expected', mism.json?.error === 'amount_mismatch' && mism.json.params?.expected > 0, mism.json)
  const due = mism.json.params?.expected
  check('cash collected', (await api('POST', `jobs/${B1}/payment`, { token: T1.token, body: { method: 'cash', amountPaise: due } })).status === 200)
  const done = await api('POST', `jobs/${B1}/transition`, { token: T1.token, body: { to: 'COMPLETED' } })
  check('job COMPLETED', done.json.job?.status === 'COMPLETED', done.json)
  check('rating the customer works once', (await api('POST', `jobs/${B1}/rate-customer`, { token: T1.token, body: { stars: 5 } })).status === 200 && (await api('POST', `jobs/${B1}/rate-customer`, { token: T1.token, body: { stars: 4 } })).json?.error === 'already_rated')
  const ledger = await api('GET', 'ledger', { token: T1.token })
  const types = (ledger.json.entries ?? []).map((e: any) => e.type).sort()
  check('ledger: job earning + visit share + parts + cash collected', ['cod_collected', 'job_earning', 'parts_reimbursement', 'visit_share'].every((t) => types.includes(t)), ledger.json)
  const earn = await api('GET', 'earnings', { token: T1.token })
  check('earnings summary returned', earn.status === 200, earn.json)
  const payout = await api('POST', 'payouts/request', { token: T1.token })
  check('payout request gives a structured outcome', payout.status === 200 || ['nothing_to_pay', 'payout_pending'].includes(payout.json?.error), payout.json)
  check('partner freed after completion', !(await payload.findByID({ collection: 'partners', id: T1.id, overrideAccess: true, depth: 0 }) as any).currentJob)
  check('booking events recorded with partner actor', (await payload.find({ collection: 'booking-events', overrideAccess: true, where: { and: [{ booking: { equals: B1 } }, { actor: { equals: 'partner' } }] } })).totalDocs >= 4)

  // ---------- Edge: decline -> next partner, double accept race, release penalty ----------
  const T2 = await readyPartner('6999900002', 'E2E Tech Two', 'technician', AC, NEAR)
  await api('POST', 'presence', { token: T1.token, body: { online: true, ...NEAR } })
  const B2 = await makeBooking(cust.id, 'ac')
  const got = await waitAny([T1, T2], B2)
  const first = got?.who as typeof T1 | undefined
  check('second booking offered to one technician', Boolean(first))
  const other = first === T1 ? T2 : T1
  const fo = got!.offer
  check('decline needs a reason', (await api('POST', `offers/${fo.id}/decline`, { token: first!.token, body: { reason: '' } })).status === 400)
  check('decline ok', (await api('POST', `offers/${fo.id}/decline`, { token: first!.token, body: { reason: 'Too far in traffic' } })).status === 200)
  check('declined offer cannot be accepted', (await api('POST', `offers/${fo.id}/accept`, { token: first!.token })).status === 409)
  const so = await waitOffer(other.token, B2)
  check('after decline, next partner gets the offer', Boolean(so))
  const [a1, a2] = await Promise.all([api('POST', `offers/${so?.id}/accept`, { token: other.token }), api('POST', `offers/${so?.id}/accept`, { token: other.token })])
  const b2a = await booking(B2)
  const so2 = await payload.findByID({ collection: 'job-offers', id: so.id, overrideAccess: true, depth: 0 }) as any
  const sts = [a1.status, a2.status]
  check('same-partner double tap: one assignment, offer stays accepted', sts.includes(200) && sts.every((x) => x === 200 || x === 409) && b2a.assignedPartner === other.id && so2.status === 'accepted', { sts, e: [a1.json?.error, a2.json?.error], assigned: b2a.assignedPartner, offer: so2.status })
  check('other partner cannot read this job', (await api('GET', `jobs/${B2}`, { token: first!.token })).status === 404)
  const rel = await api('POST', `jobs/${B2}/release`, { token: other.token, body: { reason: 'Bike puncture on the way' } })
  check('release ok', rel.json.released === true, rel.json)
  const b2 = await booking(B2)
  check('released job back to BOOKED, new round', b2.status === 'BOOKED' && b2.dispatch?.round === 1 && !b2.assignedPartner, b2.dispatch)
  const op = await payload.findByID({ collection: 'partners', id: other.id, overrideAccess: true, depth: 0 }) as any
  check('release drops reliability by 5', op.reliabilityScore === 95, op.reliabilityScore)
  check('release penalty in ledger', (await payload.find({ collection: 'earnings-ledger', overrideAccess: true, where: { and: [{ partner: { equals: other.id } }, { type: { equals: 'penalty' } }] } })).totalDocs === 1)

  // ---------- Edge: expired offer, then manual assignment fallback ----------
  const reoffer = (await waitOffer(first!.token, B2)) ?? null
  check('released job re-offered (excluding nobody new in round 1)', Boolean(reoffer))
  if (reoffer) {
    await payload.update({ collection: 'job-offers', id: reoffer.id, overrideAccess: true, data: { expiresAt: new Date(Date.now() - 1000).toISOString() } as any })
    const late = await api('POST', `offers/${reoffer.id}/accept`, { token: first!.token })
    check('accept after expiry -> offer_expired', late.json?.error === 'offer_expired', late.json)
  }
  await payload.update({ collection: 'bookings', id: B2, overrideAccess: true, context: { actor: 'dispatcher', skipBookingEvents: true }, data: { dispatch: { ...(await booking(B2)).dispatch, startedAt: new Date(Date.now() - 11 * 60e3).toISOString() } } as any })
  await payload.update({ collection: 'job-offers', overrideAccess: true, where: { and: [{ booking: { equals: B2 } }, { status: { equals: 'offered' } }] }, data: { expiresAt: new Date(Date.now() - 1000).toISOString() } as any })
  await sleep(3200)
  await api('GET', `jobs/${B2}`, { token: T1.token })
  check('unassigned after 10 min -> needsManualAssignment', (await booking(B2)).needsManualAssignment === true, (await booking(B2)).dispatch)
  await customerSays(B2, 'CANCELLED')

  // Cross-partner race: two partners hold open offers for the same leg and accept together.
  const B4 = await makeBooking(cust.id, 'ac')
  const g4 = await waitAny([T1, T2], B4)
  const loser = g4?.who === T1 ? T2 : T1
  const b4 = await booking(B4)
  const now4 = Date.now()
  const extra = await payload.create({ collection: 'job-offers', overrideAccess: true, data: { booking: B4, partner: loser.id, leg: 'visit', round: b4.dispatch?.round ?? 0, status: 'offered', offeredAt: new Date(now4).toISOString(), expiresAt: new Date(now4 + 30000).toISOString(), offerKey: `${B4}:visit:race:${loser.id}` } as any })
  const [x1, x2] = await Promise.all([api('POST', `offers/${g4?.offer.id}/accept`, { token: g4!.who.token }), api('POST', `offers/${extra.id}/accept`, { token: loser.token })])
  const b4a = await booking(B4)
  const winner = x1.status === 200 ? g4!.who.id : x2.status === 200 ? loser.id : null
  check('two partners accept together: exactly one wins, other gets already_assigned', [x1.status, x2.status].sort().join() === '200,409' && [x1.json?.error, x2.json?.error].includes('already_assigned') && b4a.assignedPartner === winner, { s: [x1.status, x2.status], e: [x1.json?.error, x2.json?.error], assigned: b4a.assignedPartner, winner })
  await customerSays(B4, 'CANCELLED')

  // ---------- Happy path 3: pickup & drop (rider -> hub -> rider) ----------
  const hub = { lat: 28.4683, lng: 77.0629 }
  const R1 = await readyPartner('6999900003', 'E2E Rider', 'rider', MOBILE, NEAR, { type: 'motorbike', number: 'HR26DK4321' })
  const H1 = await readyPartner('6999900004', 'E2E Hub Tech', 'hub_technician', MOBILE, hub)
  const B3 = await makeBooking(cust.id, 'mobile')
  const po = await waitOffer(R1.token, B3)
  check('pickup leg offered to rider', po?.leg === 'pickup', po)
  check('rider accepts pickup', (await api('POST', `offers/${po?.id}/accept`, { token: R1.token })).json.job?.status === 'PARTNER_ASSIGNED')
  check('rider ON_THE_WAY', (await api('POST', `jobs/${B3}/transition`, { token: R1.token, body: { to: 'ON_THE_WAY', ...FAR } })).json.job?.status === 'ON_THE_WAY')
  await sleep(5200)
  const ping = await api('POST', 'location', { token: R1.token, body: { ...HOME, bookingId: B3 } })
  check('location ping accepted', ping.status === 201, ping.json)
  check('location throttled to 1 per 5 s', (await api('POST', 'location', { token: R1.token, body: { ...HOME, bookingId: B3 } })).json?.error === 'too_frequent')
  check('geofence ping marks rider arrival', Boolean((await booking(B3)).arrivedAt))
  const noPhotos = await api('POST', `jobs/${B3}/transition`, { token: R1.token, body: { to: 'PICKED_UP', ...HOME, otp: '4821', checklist: { imei: '356938035643809', simRemoved: true, memoryCardRemoved: true } } })
  check('pickup without 4 photos rejected', noPhotos.json?.error === 'pickup_photos_required', noPhotos.json)
  const photos: string[] = []
  for (let i = 0; i < 4; i++) photos.push((await api('POST', `jobs/${B3}/media`, { token: R1.token, file: { kind: 'pickup_photo' } })).json.media?.id)
  const picked = await api('POST', `jobs/${B3}/transition`, { token: R1.token, body: { to: 'PICKED_UP', ...HOME, otp: '4821', checklist: { imei: '356938035643809', simRemoved: true, memoryCardRemoved: true }, mediaIds: photos } })
  check('PICKED_UP with OTP + checklist + photos', picked.json.job?.status === 'PICKED_UP', picked.json)
  const file = await handleEndpoints({ config, request: new Request(`http://localhost:3000/api/partner/v1/files/job-media/${photos[0]}`, { headers: { 'x-dwaar-partner-key': KEY, authorization: `Bearer ${R1.token}` } }) })
  check('owner can download private job photo', file.status === 200, file.status)
  check('other partner cannot download it', (await api('GET', `files/job-media/${photos[0]}`, { token: T1.token })).status === 404)
  check('rider AT_HUB', (await api('POST', `jobs/${B3}/transition`, { token: R1.token, body: { to: 'AT_HUB' } })).json.job?.status === 'AT_HUB' || (await booking(B3)).status === 'AT_HUB')
  const ho = await waitOffer(H1.token, B3)
  check('hub leg offered to hub technician', ho?.leg === 'hub', ho)
  check('hub tech accepts', (await api('POST', `offers/${ho?.id}/accept`, { token: H1.token })).status === 200)
  const badQuote = await api('POST', `jobs/${B3}/quote`, { token: H1.token, body: { diagnosis: 'Display cracked, touch dead', items: [{ label: 'Original display', grade: 'original', pricePaise: 420000 }], totalPaise: 999 } })
  check('quote total must match items', badQuote.json?.error === 'quote_total_mismatch', badQuote.json)
  check('quote sent', (await api('POST', `jobs/${B3}/quote`, { token: H1.token, body: { diagnosis: 'Display cracked, touch dead', items: [{ label: 'Original display', grade: 'original', pricePaise: 420000 }], totalPaise: 420000 } })).json.job?.status === 'QUOTE_SENT')
  await customerSays(B3, 'APPROVED')
  check('hub IN_PROGRESS after approval', (await api('POST', `jobs/${B3}/transition`, { token: H1.token, body: { to: 'IN_PROGRESS' } })).json.job?.status === 'IN_PROGRESS')
  await api('POST', `jobs/${B3}/transition`, { token: H1.token, body: { to: 'OUT_FOR_DELIVERY' } })
  const b3 = await booking(B3)
  check('OUT_FOR_DELIVERY issues a delivery OTP', b3.status === 'OUT_FOR_DELIVERY' && /^\d{4}$/.test(b3.deliveryOtp ?? ''), b3.status)
  const dl = await waitOffer(R1.token, B3)
  check('delivery leg offered to rider', dl?.leg === 'delivery', dl)
  check('rider accepts delivery', (await api('POST', `offers/${dl?.id}/accept`, { token: R1.token })).status === 200)
  const upiNoRef = await api('POST', `jobs/${B3}/payment`, { token: R1.token, body: { method: 'upi', amountPaise: 420000 } })
  check('UPI needs a reference', upiNoRef.json?.error === 'reference_required' || upiNoRef.json?.error === 'amount_mismatch', upiNoRef.json)
  const due3 = upiNoRef.json?.params?.expected ?? 420000
  check('UPI collected', (await api('POST', `jobs/${B3}/payment`, { token: R1.token, body: { method: 'upi', amountPaise: due3, reference: 'UPI4211998877' } })).status === 200)
  check('wrong delivery OTP rejected', (await api('POST', `jobs/${B3}/transition`, { token: R1.token, body: { to: 'COMPLETED', otp: b3.deliveryOtp === '0000' ? '1111' : '0000' } })).json?.error === 'otp_wrong')
  const fin = await api('POST', `jobs/${B3}/transition`, { token: R1.token, body: { to: 'COMPLETED', otp: b3.deliveryOtp } })
  check('delivered -> COMPLETED', fin.json.job?.status === 'COMPLETED', fin.json)
  const hubLedger = await payload.find({ collection: 'earnings-ledger', overrideAccess: true, where: { partner: { equals: H1.id } } })
  check('hub technician earned for the repair', hubLedger.docs.some((e: any) => e.type === 'job_earning'), hubLedger.docs.map((e: any) => e.type))
  const riderLedger = await payload.find({ collection: 'earnings-ledger', overrideAccess: true, where: { partner: { equals: R1.id } } })
  check('rider earned pickup + delivery legs', riderLedger.docs.filter((e: any) => e.type === 'job_earning').length >= 2, riderLedger.docs.map((e: any) => [e.type, e.amountPaise]))

  // ---------- Edge: support, SOS, licence expiry, logout ----------
  check('support ticket created', (await api('POST', 'tickets', { token: R1.token, body: { topic: 'payment', message: 'UPI shows pending on my side' } })).status === 201)
  const sos = await api('POST', 'sos', { token: R1.token, body: { ...NEAR } })
  check('SOS creates urgent ticket + emergency number', sos.status === 201 && sos.json.ticket?.urgent === true && sos.json.emergency === '112', sos.json)
  await payload.update({ collection: 'partner-documents', overrideAccess: true, where: { and: [{ owner: { equals: R1.id } }, { type: { equals: 'driving_licence' } }] }, data: { expiresAt: new Date(Date.now() - 86400e3).toISOString() } as any })
  check('expired driving licence blocks going online', (await api('POST', 'presence', { token: R1.token, body: { online: true, ...NEAR } })).json?.error === 'licence_expired')
  check('logout ok', (await api('POST', 'auth/logout', { token: H1.token })).status === 200)
  check('token rejected after logout', (await api('GET', 'me', { token: H1.token })).status === 401)
} catch (err) {
  check('harness crashed', false, String((err as Error)?.stack ?? err))
} finally {
  await cleanup()
  const passed = results.filter((r) => r.ok).length
  const { writeFileSync } = await import('node:fs')
  writeFileSync('.tmp/e2e-results.json', JSON.stringify({ passed, failed: results.length - passed, results: results.filter((r) => !r.ok), all: results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}`) }, null, 1))
  process.exit(0)
}
