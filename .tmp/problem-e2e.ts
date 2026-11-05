import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import config from '@payload-config'
import { getPayload, handleEndpoints } from 'payload'
import { isFailure, resolveDraft } from '../src/lib/booking-server'
import { buildSlots } from '../src/lib/slots'
import { isWithinHoursIST } from '../src/lib/time'

const KEY = randomBytes(24).toString('hex')
process.env.PARTNER_API_KEY = KEY
const SCREEN = '5de64267-7988-4a8c-a3c9-063448b7d9b3'
const DEAD = '40a4865a-a34a-4c3c-8a40-c7b3c020efbd'
const OTHER = 'e7297ed1-977e-4118-b324-1f35427ed926'
const AC_JET = 'b661fb97-6992-44a2-ba1a-16ac83aebf3b'
const BASE = 'http://localhost:3000'

const results: { name: string; ok: boolean; info?: string }[] = []
const check = (name: string, cond: unknown, info?: unknown) => results.push({ name, ok: Boolean(cond), info: cond ? undefined : JSON.stringify(info)?.slice(0, 500) })
const payload = await getPayload({ config })

async function api(method: string, path: string, token?: string, body?: any) {
  const headers = new Headers({ 'x-dwaar-partner-key': KEY })
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (body) headers.set('content-type', 'application/json')
  const res = await handleEndpoints({ config, request: new Request(`${BASE}/api/partner/v1/${path}`, { method, headers, body: body ? JSON.stringify({ idempotencyKey: randomUUID(), ...body }) : undefined }) })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, type: res.headers.get('content-type') }
}

async function cleanup() {
  const del = async (collection: any, where: any) => { try { await payload.delete({ collection, overrideAccess: true, where }) } catch (e) { console.error('cleanup', collection, String(e).slice(0, 200)) } }
  const ids = async (collection: any, where: any) => ((await payload.find({ collection, overrideAccess: true, depth: 0, pagination: false, where })).docs as any[]).map((d) => d.id)
  const users = await ids('users', { username: { like: '69999' } })
  const partners = await ids('partners', { username: { like: '69999' } })
  const bookings = await ids('bookings', { bookingCode: { like: 'DWT' } })
  if (bookings.length) for (const c of ['booking-events', 'job-offers', 'job-media', 'partner-locations']) await del(c, { booking: { in: bookings } })
  if (partners.length) {
    for (const c of ['job-offers', 'earnings-ledger', 'payouts', 'partner-locations', 'partner-tickets', 'job-media']) await del(c, { partner: { in: partners } })
    await del('partner-documents', { owner: { in: partners } })
    for (const id of partners) await del('idempotency-keys', { scopeKey: { like: `p:${id}` } })
  }
  await del('idempotency-keys', { scopeKey: { like: 'phone:69999' } })
  if (users.length) await del('problem-videos', { owner: { in: users } })
  if (bookings.length) await del('bookings', { id: { in: bookings } })
  if (partners.length) await del('partners', { id: { in: partners } })
  if (users.length) await del('users', { id: { in: users } })
  await del('otp-challenges', { phone: { like: '69999' } })
}

await cleanup()
try {
  const pw = randomUUID()
  const A = await payload.create({ collection: 'users', overrideAccess: true, data: { username: '6999900098', password: pw, name: 'Video Tester', language: 'hinglish', onboarded: true } as any })
  const B = await payload.create({ collection: 'users', overrideAccess: true, data: { username: '6999900097', password: randomUUID(), name: 'Other Customer', language: 'hinglish', onboarded: true } as any })
  const mp4 = readFileSync('.tmp/problem.mp4')
  const webm = readFileSync('.tmp/problem.webm')
  // Mirrors the uploadProblemVideo server action's write.
  const mkVideo = (owner: string, buf: Buffer, type: string, ext: string) =>
    payload.create({ collection: 'problem-videos', overrideAccess: true, depth: 0, data: { owner, durationSec: 3 } as any, file: { data: buf, mimetype: type, name: `problem-${owner}-${Date.now()}.${ext}`, size: buf.length } })
  const vA = await mkVideo(A.id, mp4, 'video/mp4', 'mp4')
  const vA2 = await mkVideo(A.id, webm, 'video/webm', 'webm')
  const vB = await mkVideo(B.id, mp4, 'video/mp4', 'mp4')
  check('mp4 + webm problem videos stored', vA.id && vA2.id && (vA as any).mimeType === 'video/mp4' && (vA2 as any).mimeType === 'video/webm', [vA, vA2])
  let rejected = false
  try { await payload.create({ collection: 'problem-videos', overrideAccess: true, data: { owner: A.id } as any, file: { data: Buffer.from('%PDF-1.4 not a video'), mimetype: 'application/pdf', name: 'x.pdf', size: 20 } }) } catch { rejected = true }
  check('non-video upload rejected by collection', rejected)

  const user = (await payload.findByID({ collection: 'users', id: A.id, overrideAccess: true, depth: 0 })) as any
  const now = new Date()
  const slot = buildSlots(now, 9, 21).flat()[0]
  const schedule = isWithinHoursIST(now, 9, 21) ? { mode: 'asap' as const } : { mode: 'scheduled' as const, startAt: slot.startISO }
  const draft = (lines: string[], problem?: any, cat = 'mobile-repair') => ({ categorySlug: cat, lines: lines.map((serviceId) => ({ serviceId, quantity: 1 })), device: cat === 'ac-service-repair' ? { type: 'split' } : {}, schedule, problem })
  const r1 = await resolveDraft(payload, user, draft([SCREEN]))
  check('mobile without video -> problem_video', isFailure(r1) && r1.error === 'problem_video', r1)
  const r2 = await resolveDraft(payload, user, draft([SCREEN], { videoId: vA.id }))
  check('screen + own video -> ok, 90-min promise ON', !isFailure(r2) && r2.problem.ninetyMinPromise === true && r2.problem.videoId === vA.id, r2)
  const r3 = await resolveDraft(payload, user, draft([SCREEN, DEAD], { videoId: vA.id }))
  check('screen + phone dead -> 90-min promise OFF', !isFailure(r3) && r3.problem.ninetyMinPromise === false, r3)
  const r4 = await resolveDraft(payload, user, draft([OTHER], { videoId: vA.id, description: 'garam' }))
  check('Other with short text -> problem_text', isFailure(r4) && r4.error === 'problem_text', r4)
  const r5 = await resolveDraft(payload, user, draft([OTHER], { videoId: vA.id, description: '  Phone garam hokar 10 minute mein band ho jaata hai  ' }))
  check('Other with description -> ok, text trimmed, no promise, estimate 0', !isFailure(r5) && r5.problem.description === 'Phone garam hokar 10 minute mein band ho jaata hai' && r5.problem.ninetyMinPromise === false && r5.quote.payableMaxPaise === 0, r5)
  const r6 = await resolveDraft(payload, user, draft([SCREEN], { videoId: vB.id }))
  check("someone else's video -> problem_video", isFailure(r6) && r6.error === 'problem_video', r6)
  const acCat = (await payload.find({ collection: 'service-categories', overrideAccess: true, depth: 0, limit: 1, where: { slug: { equals: 'ac-service-repair' } } })).docs[0] as any
  const acSlot = buildSlots(now, acCat.serviceHours?.startHour ?? 9, acCat.serviceHours?.endHour ?? 21).flat()[0]
  const r8 = await resolveDraft(payload, user, { ...draft([AC_JET], undefined, 'ac-service-repair'), schedule: { mode: 'scheduled', startAt: acSlot.startISO } })
  check('AC booking unchanged: no video needed', !isFailure(r8) && r8.problem.videoId === undefined, r8)

  // Booking written the way createBooking writes it, then the video is linked.
  const b = await payload.create({
    collection: 'bookings', overrideAccess: true, context: { actor: 'customer', eventNote: 'e2e' },
    data: { bookingCode: `DWT${randomBytes(3).toString('hex').toUpperCase()}`, status: 'BOOKED', title: 'Screen Replacement', customer: A.id, category: '4e21f4fa-98b5-452f-a4d4-6134173dd2f5', flow: 'pickup_drop', lines: [{ service: SCREEN, name: 'Screen Replacement', quantity: 1, minPaise: 300000, maxPaise: 650000 }], device: {}, address: { label: 'home', line: 'Sector 29, Gurugram', lat: 28.4595, lng: 77.0726 }, schedule: { mode: 'scheduled', startAt: new Date(Date.now() + 2 * 864e5).toISOString(), endAt: new Date(Date.now() + 2 * 864e5 + 36e5).toISOString() }, scheduleLabel: 'test', pricing: { estimateMinPaise: 300000, estimateMaxPaise: 650000, visitFeePaise: 0, discountPaise: 0 }, payment: { method: 'upi', status: 'pending' }, serviceOtp: '4821', trustAccepted: true, problem: { video: vA.id, ninetyMinPromise: true } } as any,
  })
  await payload.update({ collection: 'problem-videos', id: vA.id, overrideAccess: true, data: { booking: b.id } as any })
  const r7 = await resolveDraft(payload, user, draft([SCREEN], { videoId: vA.id }))
  check('video already used on a booking -> problem_video', isFailure(r7) && r7.error === 'problem_video', r7)
  const stored = (await payload.findByID({ collection: 'bookings', id: b.id, overrideAccess: true, depth: 0 })) as any
  check('booking stores problem video + 90-min flag', stored.problem?.video === vA.id && stored.problem?.ninetyMinPromise === true, stored.problem)

  // Access
  let ownerRead = false, otherRead = true
  try { await payload.findByID({ collection: 'problem-videos', id: vA.id, overrideAccess: false, user: { ...A, collection: 'users' } as any }); ownerRead = true } catch {}
  try { await payload.findByID({ collection: 'problem-videos', id: vA.id, overrideAccess: false, user: { ...B, collection: 'users' } as any }) } catch { otherRead = false }
  check('owner can read own video', ownerRead)
  check('another customer cannot read it', !otherRead)

  // Partner API: assignee sees description/video and can stream it; others cannot.
  const login = async (phone: string) => {
    const r1 = await api('POST', 'auth/otp/request', undefined, { phone })
    const r2 = await api('POST', 'auth/otp/verify', undefined, { phone, challengeId: r1.json.challengeId, code: r1.json.demoCode })
    return { token: r2.json.token as string, id: r2.json.partner.id as string }
  }
  const P1 = await login('6999900011')
  const P2 = await login('6999900012')
  await payload.update({ collection: 'bookings', id: b.id, overrideAccess: true, context: { actor: 'dispatcher', skipBookingEvents: true }, data: { assignedPartner: P1.id, riderPartner: P1.id } as any })
  const job = await api('GET', `jobs/${b.id}`, P1.token)
  check('partner job DTO carries problem.videoUrl + promise', job.json?.job?.problem?.videoUrl === `/api/partner/v1/files/problem-videos/${vA.id}` && job.json.job.problem.ninetyMinPromise === true, job.json?.job?.problem ?? job.json)
  const f1 = await api('GET', `files/problem-videos/${vA.id}`, P1.token)
  check('assigned partner can stream the video', f1.status === 200 && /video\/mp4/.test(f1.type ?? ''), [f1.status, f1.type, f1.json])
  const f2 = await api('GET', `files/problem-videos/${vA.id}`, P2.token)
  check('unrelated partner gets 404', f2.status === 404, f2.status)
  const f3 = await api('GET', `files/problem-videos/${vB.id}`, P1.token)
  check('partner cannot read an unlinked video', f3.status === 404, f3.status)

  // Real pages from the dev server
  const login2 = await payload.login({ collection: 'users', data: { username: '6999900098', password: pw } as any })
  const page = async (path: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie: `app-session=${login2.token}; dwaar-lang=hinglish` }, redirect: 'manual' })
    return { status: res.status, html: await res.text(), location: res.headers.get('location') }
  }
  const book = await page('/book/mobile-repair')
  check('/book/mobile-repair renders (200)', book.status === 200, [book.status, book.location])
  check('wizard shows video card + required badge', book.html.includes('Problem ka video') && book.html.includes('Zaroori'), book.html.slice(0, 200))
  check('wizard lists "Other problem" with after-checkup price', book.html.includes('Other problem') && book.html.includes('Checkup ke baad'))
  check('wizard shows 90 min promise badges', (book.html.match(/90 min promise/g) ?? []).length >= 6, (book.html.match(/90 min promise/g) ?? []).length)
  const ac = await page('/book/ac-service-repair')
  check('/book/ac-service-repair unchanged (no video card)', ac.status === 200 && !ac.html.includes('Problem ka video'), ac.status)
  const cat = await page('/services/mobile-repair')
  check('category page does not list Other problem', cat.status === 200 && !cat.html.includes('other-problem') && !cat.html.includes('Problem list mein nahi hai'), cat.status)
  check('category FAQ explains the 90-min rule', cat.html.includes('Phone dead (on hi nahi hota)'))
  const det = await page('/services/mobile-repair/other-problem')
  check('Other problem has no public detail page (not-found UI)', det.html.includes('Yeh page nahi mila') && !det.html.includes('Apne shabdon mein likho'), det.status)
  const srch = await page('/search?q=other')
  check('search does not surface Other problem', srch.status === 200 && !srch.html.includes('Other problem'), srch.status)
  const bl = await page('/bookings')
  check('/bookings renders', bl.status === 200, bl.status)
  const bd = await page(`/bookings/${b.id}`)
  check('/bookings/[id] renders', bd.status === 200, bd.status)
} catch (err) {
  check('script crashed', false, String((err as Error)?.stack ?? err))
} finally {
  await cleanup()
  const passed = results.filter((r) => r.ok).length
  writeFileSync('.tmp/problem-results.json', JSON.stringify({ passed, failed: results.length - passed, fails: results.filter((r) => !r.ok), all: results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}`) }, null, 1))
  process.exit(0)
}
