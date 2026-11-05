import { Hono } from 'npm:hono@4'
import { z } from 'npm:zod@4'
import { createDoc, find, findOne, getDoc, getDocs, idOf, nowISO, pruneBefore, raw, saveDoc } from './db.tsx'
import { checkOtp, createSession, endSession, issueOtp, mirrorAuthUser, normalizePhone } from './auth.tsx'
import { getConfig } from './catalog.tsx'
import {
  BOOKING_STATUSES,
  PARTNER_ROLES,
  activeLegFor,
  canRelease,
  dispatchLegFor,
  isPartnerLegActive,
  noShowFrom,
  partnerEdgesFor,
  type BookingFlow,
  type BookingStatus,
  type DispatchLeg,
  type PartnerRole,
  type TransitionRequirement,
} from './lib-booking-machine.tsx'
import { distanceKm } from './lib-geo.tsx'
import {
  GEOFENCE_M,
  JOB_MEDIA_KINDS,
  LOCATION_MIN_INTERVAL_MS,
  LOCATION_RETENTION_MS,
  NO_SHOW_WAIT_MS,
  ONBOARDING_EDITABLE_STATUSES,
  PARTNER_DOCUMENT_TYPES,
  SCHEDULED_DISPATCH_LEAD_MS,
  SKILL_PASS_PERCENT,
  firstName,
  maskPhone,
  needsDrivingLicence,
  requiredDocuments,
} from './lib-partner-constants.tsx'
import { acceptOffer, advanceDispatch, declineOffer, onlineBlocker, releaseNonVisitLeg, updateBooking, updatePartner, type Booking, type Partner } from './engine.tsx'
import { amountDuePaise, appendLedger, ledgerEntries, partnerBalances } from './ledger.tsx'
import { PRIVATE_BUCKET, PUBLIC_BUCKET, extFor, publicUrl, putFile, streamPrivate } from './storage.tsx'
import { CORS_HEADERS, pfail as fail, route } from './partner-http.tsx'
import { DomainError } from './db.tsx'

/** dwaar Partner API v1 on Supabase. Mounted at /partner/v1; same contract as the Payload version. */
const TERMINAL: BookingStatus[] = ['COMPLETED', 'RETURNED', 'CANCELLED']
const API = '/api/partner/v1'
const idSchema = z.string().min(1).max(64)
const lat = z.number().min(-90).max(90)
const lng = z.number().min(-180).max(180)
const idem = z.string()

/* --------------------------------------------------------------------- DTOs */

async function mediaUrl(id: unknown) {
  const m = await getDoc<Booking>('media', idOf(id))
  return (m?.url as string) ?? null
}

export async function partnerDTO(p: Partner) {
  const categories = await getDocs<Booking>('service-categories', p.categories ?? [])
  return {
    id: p.id,
    phone: /^[6-9]\d{9}$/.test(p.username ?? '') ? p.username : null,
    email: p.externalEmail ?? null,
    identity: p.externalUserId ? 'external' : 'phone',
    name: p.name ?? null,
    photoUrl: await mediaUrl(p.photo),
    dateOfBirth: p.dateOfBirth ?? null,
    languages: p.languages ?? [],
    role: p.role ?? null,
    categories: (p.categories ?? []).map((cid: string) => {
      const c = categories.find((x) => x.id === cid)
      return c ? { id: c.id, key: c.icon, name: c.name, slug: c.slug, flow: c.flow } : { id: cid }
    }),
    zoneName: p.zoneName ?? null,
    homeLat: p.homeLat ?? null,
    homeLng: p.homeLng ?? null,
    serviceRadiusKm: p.serviceRadiusKm ?? null,
    vehicle: { type: p.vehicle?.type ?? null, number: p.vehicle?.number ?? null },
    verificationStatus: p.verificationStatus,
    rejectionReason: p.rejectionReason ?? null,
    accountStatus: p.accountStatus,
    isOnline: Boolean(p.isOnline),
    lastSeenAt: p.lastSeenAt ?? null,
    currentJobId: idOf(p.currentJob),
    rating: p.rating ?? 0,
    ratingCount: p.ratingCount ?? 0,
    acceptanceRate: p.acceptanceRate ?? 100,
    completionRate: p.completionRate ?? 100,
    reliabilityScore: p.reliabilityScore ?? 100,
    skillTestScore: p.skillTestScore ?? null,
    trainingCompletedAt: p.trainingCompletedAt ?? null,
    agreementAcceptedAt: p.agreementAcceptedAt ?? null,
    bank: {
      holderName: p.bank?.holderName ?? null,
      accountLast4: p.bank?.accountLast4 ?? null,
      ifsc: p.bank?.ifsc ?? null,
      upiId: p.bank?.upiId ?? null,
      verified: Boolean(p.bank?.verified),
    },
    preferences: {
      language: p.preferences?.language ?? 'hinglish',
      navigationApp: p.preferences?.navigationApp ?? 'google_maps',
      offerSound: p.preferences?.offerSound ?? true,
    },
  }
}

const INPUTS: Record<TransitionRequirement, string[]> = {
  location: ['lat', 'lng'],
  geofence: ['lat', 'lng'],
  serviceOtp: ['otp'],
  deliveryOtp: ['otp'],
  pickupChecklist: ['checklist.imei', 'checklist.simRemoved', 'checklist.memoryCardRemoved', 'checklist.conditionNotes?'],
  pickupPhotos: ['mediaIds'],
  quote: ['diagnosis', 'items', 'totalPaise', 'videoMediaId?'],
  payment: [],
}

export function allowedActions(booking: Booking, partner: Partner) {
  const flow = booking.flow as BookingFlow
  const status = booking.status as BookingStatus
  const role = partner.role as PartnerRole
  const base = `jobs/${booking.id}`
  const out: Record<string, unknown>[] = []
  if (idOf(booking.assignedPartner) === partner.id && !TERMINAL.includes(status)) {
    const collected = Boolean(booking.paymentCollection?.collectedAt) || booking.payment?.status === 'paid'
    for (const edge of partnerEdgesFor(flow, role, status, { declined: booking.quote?.outcome === 'declined' })) {
      if (edge.to === 'QUOTE_SENT') {
        out.push({ action: 'quote', method: 'POST', path: `${base}/quote`, to: 'QUOTE_SENT', requires: edge.requires, inputs: INPUTS.quote })
        continue
      }
      const needs = edge.requires.filter((r) => r !== 'payment')
      out.push({
        action: 'transition',
        method: 'POST',
        path: `${base}/transition`,
        to: edge.to,
        requires: edge.requires,
        inputs: ['to', ...new Set(needs.flatMap((r) => INPUTS[r]))],
        ...(edge.requires.includes('payment') && !collected ? { blockedBy: 'payment' } : {}),
        ...(edge.requires.includes('geofence') ? { rules: { geofenceMeters: GEOFENCE_M } } : {}),
        ...(edge.requires.includes('pickupPhotos') ? { rules: { minPickupPhotos: 4 } } : {}),
      })
      if (edge.requires.includes('payment') && !collected) {
        out.push({ action: 'payment', method: 'POST', path: `${base}/payment`, inputs: ['method', 'amountPaise', 'reference?'], rules: { amountDuePaise: amountDuePaise(booking) } })
      }
    }
    const leg = activeLegFor(flow, status)
    if (leg && isPartnerLegActive(flow, status, leg) && status !== 'PARTNER_ASSIGNED') {
      out.push({ action: 'media', method: 'POST', path: `${base}/media`, inputs: ['file', 'kind'] })
      if (['ARRIVED', 'IN_PROGRESS', 'APPROVED', 'AT_HUB'].includes(status)) {
        out.push({ action: 'parts', method: 'POST', path: `${base}/parts`, inputs: ['parts[].name', 'parts[].pricePaise', 'parts[].billMediaId?'] })
      }
    }
    if (canRelease(flow, status) || (flow === 'pickup_drop' && (status === 'AT_HUB' || status === 'OUT_FOR_DELIVERY') && dispatchLegFor(flow, status))) {
      out.push({ action: 'release', method: 'POST', path: `${base}/release`, inputs: ['reason'] })
    }
    if (status === noShowFrom(flow) && booking.arrivedAt) {
      out.push({
        action: 'no_show',
        method: 'POST',
        path: `${base}/no-show`,
        inputs: ['lat', 'lng'],
        notBefore: new Date(new Date(booking.arrivedAt).getTime() + NO_SHOW_WAIT_MS).toISOString(),
        rules: { waitMinutes: NO_SHOW_WAIT_MS / 60000, geofenceMeters: GEOFENCE_M },
      })
    }
  }
  if ((status === 'COMPLETED' || status === 'RETURNED') && !booking.customerRatingByPartner?.stars) {
    out.push({ action: 'rate_customer', method: 'POST', path: `${base}/rate-customer`, inputs: ['stars', 'comment?'] })
  }
  return out
}

function partnerLeg(booking: Booking, partner: Partner): DispatchLeg | null {
  const flow = booking.flow as BookingFlow
  if (flow !== 'pickup_drop') return 'visit'
  if (idOf(booking.hubPartner) === partner.id) return 'hub'
  if (idOf(booking.riderPartner) === partner.id) return ['OUT_FOR_DELIVERY', 'COMPLETED', 'RETURNED'].includes(booking.status) ? 'delivery' : 'pickup'
  return activeLegFor(flow, booking.status as BookingStatus)
}

const mediaRef = (m: Booking | string | null | undefined, byId: Map<string, Booking>) => {
  const mid = idOf(m)
  if (!mid) return null
  const doc = byId.get(mid)
  return { id: mid, kind: doc?.kind ?? null, mimeType: doc?.mimeType ?? null, url: `${API}/files/job-media/${mid}` }
}

/** The job as the partner app sees it; exact coordinates only while the partner's leg is live. */
export async function jobDTO(booking: Booking, partner: Partner) {
  const flow = booking.flow as BookingFlow
  const status = booking.status as BookingStatus
  const [category, customer] = await Promise.all([getDoc<Booking>('service-categories', idOf(booking.category)), getDoc<Booking>('users', idOf(booking.customer))])
  const mediaIds = [booking.quote?.videoMedia, ...(booking.pickupChecklist?.photos ?? []), ...(booking.partsUsed ?? []).map((p: Booking) => p.bill)]
  const media = new Map((await getDocs<Booking>('job-media', mediaIds.map(idOf))).map((m) => [m.id, m]))
  const leg = partnerLeg(booking, partner)
  const holdsLeg = idOf(booking.assignedPartner) === partner.id
  const live = holdsLeg && leg !== null && isPartnerLegActive(flow, status, leg)
  const videoId = idOf(booking.problem?.video)
  return {
    id: booking.id,
    bookingCode: booking.bookingCode,
    title: booking.title,
    status,
    flow,
    leg,
    isMine: holdsLeg,
    category: category ? { id: category.id, name: category.name, slug: category.slug } : { id: idOf(booking.category) },
    device: { label: booking.deviceLabel ?? null, type: booking.device?.type ?? null, brand: booking.device?.brand ?? null, model: booking.device?.model ?? null, notes: booking.device?.notes ?? null },
    problem: {
      description: booking.problem?.description ?? null,
      videoUrl: videoId ? `${API}/files/problem-videos/${videoId}` : null,
      ninetyMinPromise: Boolean(booking.problem?.ninetyMinPromise),
    },
    lines: (booking.lines ?? []).map((l: Booking) => ({ name: l.name, quantity: l.quantity, minPaise: l.minPaise, maxPaise: l.maxPaise })),
    schedule: { mode: booking.schedule?.mode, startAt: booking.schedule?.startAt ?? null, endAt: booking.schedule?.endAt ?? null, label: booking.scheduleLabel ?? null },
    customer: { firstName: firstName(booking.address?.contactName ?? customer?.name), maskedPhone: maskPhone(booking.address?.contactPhone ?? customer?.username) },
    address: {
      label: booking.address?.label ?? null,
      line: booking.address?.line ?? null,
      landmark: booking.address?.landmark ?? null,
      location: live && booking.address?.lat != null && booking.address?.lng != null ? { lat: booking.address.lat, lng: booking.address.lng } : null,
    },
    promisedBy: booking.promisedBy ?? null,
    arrivedAt: booking.arrivedAt ?? null,
    startedAt: booking.startedAt ?? null,
    completedAt: booking.completedAt ?? null,
    pricing: {
      estimateMinPaise: booking.pricing?.estimateMinPaise ?? 0,
      estimateMaxPaise: booking.pricing?.estimateMaxPaise ?? 0,
      visitFeePaise: booking.pricing?.visitFeePaise ?? 0,
      finalPaise: booking.pricing?.finalPaise ?? null,
      amountDuePaise: amountDuePaise(booking),
    },
    payment: {
      method: booking.payment?.method ?? null,
      status: booking.payment?.status ?? 'pending',
      collection: booking.paymentCollection?.collectedAt
        ? { method: booking.paymentCollection.method, amountPaise: booking.paymentCollection.amountPaise, reference: booking.paymentCollection.reference ?? null, collectedAt: booking.paymentCollection.collectedAt }
        : null,
    },
    quote: booking.quote?.sentAt
      ? {
          diagnosis: booking.quote.diagnosis ?? null,
          items: (booking.quote.items ?? []).map((i: Booking) => ({ label: i.label, grade: i.grade ?? null, pricePaise: i.pricePaise, isExtraPart: Boolean(i.isExtraPart) })),
          totalPaise: booking.quote.totalPaise ?? 0,
          video: mediaRef(booking.quote.videoMedia, media),
          sentAt: booking.quote.sentAt,
          respondedAt: booking.quote.respondedAt ?? null,
          outcome: booking.quote.outcome ?? null,
        }
      : null,
    pickupChecklist: booking.pickupChecklist?.imei
      ? {
          imei: booking.pickupChecklist.imei,
          simRemoved: Boolean(booking.pickupChecklist.simRemoved),
          memoryCardRemoved: Boolean(booking.pickupChecklist.memoryCardRemoved),
          conditionNotes: booking.pickupChecklist.conditionNotes ?? null,
          photos: (booking.pickupChecklist.photos ?? []).map((p: string) => mediaRef(p, media)),
        }
      : null,
    partsUsed: (booking.partsUsed ?? []).map((p: Booking) => ({ name: p.name, pricePaise: p.pricePaise, bill: mediaRef(p.bill, media) })),
    cancellation: status === 'CANCELLED' ? { reason: booking.cancellation?.reason ?? null, at: booking.cancellation?.at ?? null, noShow: Boolean(booking.noShow?.markedAt) } : null,
    slaBreached: Boolean(booking.slaBreached),
    customerRating: booking.customerRatingByPartner?.stars ? { stars: booking.customerRatingByPartner.stars, comment: booking.customerRatingByPartner.comment ?? null } : null,
    updatedAt: booking.updatedAt,
    allowedActions: allowedActions(booking, partner),
  }
}

async function offerDTO(offer: Booking, zoneName: string | null) {
  const booking = await getDoc<Booking>('bookings', idOf(offer.booking))
  const category = booking ? await getDoc<Booking>('service-categories', idOf(booking.category)) : null
  const expiresMs = new Date(offer.expiresAt).getTime()
  return {
    id: offer.id,
    bookingId: idOf(offer.booking),
    status: offer.status,
    leg: offer.leg,
    offeredAt: offer.offeredAt,
    expiresAt: offer.expiresAt,
    expiresInSec: Math.max(0, Math.round((expiresMs - Date.now()) / 1000)),
    distanceKm: offer.distanceKm ?? null,
    estimatedEarningPaise: offer.estimatedEarningPaise ?? 0,
    rank: offer.rank ?? 1,
    job: booking
      ? {
          title: booking.title,
          category: category ? { id: category.id, name: category.name, slug: category.slug } : null,
          deviceLabel: booking.deviceLabel ?? null,
          schedule: { mode: booking.schedule?.mode, startAt: booking.schedule?.startAt ?? null, endAt: booking.schedule?.endAt ?? null },
          area: zoneName,
          landmark: null,
        }
      : null,
    actions:
      offer.status === 'offered' && expiresMs > Date.now()
        ? [
            { action: 'accept', method: 'POST', path: `offers/${offer.id}/accept` },
            { action: 'decline', method: 'POST', path: `offers/${offer.id}/decline`, inputs: ['reason'] },
          ]
        : [],
  }
}

/* --------------------------------------------------------------- helpers */

const isWorker = (b: Booking, pid: string) => [b.assignedPartner, b.riderPartner, b.hubPartner].map(idOf).includes(pid)

/** Bookings this partner works (any leg), newest first. */
async function partnerBookings(partnerId: string) {
  const lists = await Promise.all(['assignedPartner', 'riderPartner', 'hubPartner'].map((f) => find<Booking>('bookings', f, partnerId)))
  const byId = new Map<string, Booking>()
  for (const b of lists.flat()) byId.set(b.id, b)
  return [...byId.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

async function loadJob(partner: Partner, bookingId: string) {
  const b = await getDoc<Booking>('bookings', bookingId)
  if (!b || !isWorker(b, partner.id)) throw fail(404, 'not_found')
  return b
}

function requireAssignee(booking: Booking, partner: Partner) {
  if (idOf(booking.assignedPartner) !== partner.id) throw fail(403, 'not_assigned')
  if (TERMINAL.includes(booking.status)) throw fail(409, 'job_closed')
}

async function respond(partner: Partner, bookingId: string, status = 200) {
  const booking = await loadJob(partner, bookingId)
  const fresh = (await getDoc<Partner>('partners', partner.id)) ?? partner
  return { status, body: { job: await jobDTO(booking, fresh) } }
}

async function checkMedia(bookingId: string, ids: string[], kinds: string[]) {
  if (ids.length === 0) return
  const docs = (await getDocs<Booking>('job-media', ids)).filter((m) => idOf(m.booking) === bookingId && kinds.includes(m.kind))
  if (docs.length !== new Set(ids).size) throw fail(400, 'invalid_media', 'mediaIds')
}

/** Partner write through the booking engine; a wrong booking OTP still counts as an attempt. */
async function writeAsPartner(partner: Partner, booking: Booking, data: Booking, transition: Record<string, unknown> = {}) {
  try {
    await updateBooking(booking.id, { actor: 'partner', partner, transition }, () => ({ ...data }))
  } catch (err) {
    if (err instanceof DomainError && err.code === 'otp_wrong') {
      const kind = err.extra.params?.kind === 'delivery' ? 'delivery' : 'service'
      await updateBooking(booking.id, { actor: 'dispatcher', skipEvents: true }, (cur) => ({ otpAttempts: { ...cur.otpAttempts, [kind]: (cur.otpAttempts?.[kind] ?? 0) + 1 } }))
      const left = Number(err.extra.params?.left ?? 0)
      throw fail(400, left > 0 ? 'otp_wrong' : 'otp_locked', 'otp', { left })
    }
    throw err
  }
}

async function heartbeat(partner: Partner, extra: Booking = {}) {
  return updatePartner(partner.id, () => ({ lastSeenAt: nowISO(), ...extra }))
}

let lastPrune = 0
async function prune() {
  if (Date.now() - lastPrune < 10 * 60 * 1000) return
  lastPrune = Date.now()
  try {
    await pruneBefore('partner-locations', 'recordedAt', new Date(Date.now() - LOCATION_RETENTION_MS).toISOString())
  } catch (err) {
    console.error('partner retention prune failed', err)
  }
}

/* ------------------------------------------------------------------ routes */

const FLOW_FOR_ROLE: Record<PartnerRole, string> = { technician: 'doorstep', mechanic: 'roadside', rider: 'pickup_drop', hub_technician: 'pickup_drop' }
const rolesForFlow = (flow: string) => PARTNER_ROLES.filter((r) => FLOW_FOR_ROLE[r] === flow)

/** Live categories in catalog order: the only ones a partner may choose. */
async function liveCategories() {
  const { allDocs } = await import('./db.tsx')
  return (await allDocs<Booking>('service-categories')).filter((c) => c.status === 'live').sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

/**
 * Category id, key (the icon: ac, bike, mobile…) or slug -> live categories (deduplicated).
 * Unknown, coming-soon or ambiguous values fail with `invalid_category` naming the value.
 */
async function resolveCategoryRefs(refs: string[], field = 'categories') {
  const live = await liveCategories()
  const out: Booking[] = []
  for (const raw of refs) {
    const ref = String(raw).trim()
    const lower = ref.toLowerCase()
    const byKey = live.filter((c) => c.icon === lower)
    const hit = live.find((c) => c.id === ref) ?? (byKey.length === 1 ? byKey[0] : undefined) ?? live.find((c) => c.slug === lower)
    if (!hit) throw fail(400, 'invalid_category', field, { value: ref.slice(0, 64) })
    if (!out.some((c) => c.id === hit.id)) out.push(hit)
  }
  return out
}
const EDITABLE = ONBOARDING_EDITABLE_STATUSES

function docDTO(d: Booking) {
  return {
    id: d.id,
    type: d.type,
    status: d.status,
    rejectionReason: d.rejectionReason ?? null,
    expiresAt: d.expiresAt ?? null,
    superseded: Boolean(d.superseded),
    mimeType: d.mimeType ?? null,
    url: `${API}/files/partner-documents/${d.id}`,
    createdAt: d.createdAt,
  }
}

async function currentDocuments(partnerId: string) {
  const all = (await find<Booking>('partner-documents', 'owner', partnerId)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const latest = new Map<string, Booking>()
  for (const d of all) if (!latest.has(d.type)) latest.set(d.type, d)
  return { all, latest }
}

async function onboardingStatus(partner: Partner) {
  const { latest } = await currentDocuments(partner.id)
  const needed = requiredDocuments(partner.role)
  const missing = needed.filter((t) => !latest.has(t) || latest.get(t)!.status === 'rejected')
  const rejected = [...latest.values()].filter((d) => d.status === 'rejected').map((d) => ({ type: d.type, reason: d.rejectionReason ?? null }))
  const steps = [
    { step: 'profile', done: Boolean(partner.name && partner.dateOfBirth) },
    { step: 'role', done: Boolean(partner.role && (partner.categories ?? []).length > 0 && (!needsDrivingLicence(partner.role) || (partner.vehicle?.type && partner.vehicle?.number))) },
    { step: 'documents', done: missing.length === 0, missing, rejected },
    { step: 'bank', done: Boolean((partner.bank?.accountLast4 && partner.bank?.ifsc) || partner.bank?.upiId) },
    { step: 'skill_test', done: (partner.skillTestScore ?? 0) >= SKILL_PASS_PERCENT, score: partner.skillTestScore ?? null, passPercent: SKILL_PASS_PERCENT },
    { step: 'training', done: Boolean(partner.trainingCompletedAt) },
    { step: 'agreement', done: Boolean(partner.agreementAcceptedAt) },
  ]
  return {
    verificationStatus: partner.verificationStatus,
    rejectionReason: partner.rejectionReason ?? null,
    canEdit: EDITABLE.includes(partner.verificationStatus),
    canSubmit: EDITABLE.includes(partner.verificationStatus) && steps.slice(0, 5).every((s) => s.done),
    canGoOnline: partner.verificationStatus === 'approved' && partner.accountStatus === 'active',
    steps,
  }
}

const reload = async (id: string) => (await getDoc<Partner>('partners', id)) as Partner

const routes = [
  route('get', 'health', { auth: false }, async () => ({ body: { service: 'dwaar-partner-api', version: 'v1', backend: 'supabase', serverTime: nowISO() } })),

  /** Allowed values for `categories` in PATCH /me, and which roles may pick each one. */
  route('get', 'categories', { auth: false }, async () => {
    const live = await liveCategories()
    return {
      body: {
        categories: live.map((c) => ({ id: c.id, key: c.icon, slug: c.slug, name: c.name, flow: c.flow, roles: rolesForFlow(c.flow) })),
        roles: Object.fromEntries(PARTNER_ROLES.map((r) => [r, live.filter((c) => c.flow === FLOW_FOR_ROLE[r]).map((c) => c.icon)])),
        accepts: 'PATCH /me categories takes any of id, key or slug; ids are stored.',
      },
    }
  }),

  /* auth */
  route('post', 'auth/otp/request', { auth: false, body: z.object({ phone: z.string().max(20), idempotencyKey: idem }) }, async ({ body }) => {
    const phone = normalizePhone(body.phone)
    if (!phone) throw fail(400, 'invalid_phone', 'phone')
    const r = await issueOtp(phone, 'partner_login')
    return { body: { challengeId: r.challengeId, resendInSec: r.resendInSec, expiresInSec: r.expiresInSec, demoCode: r.demoCode } }
  }),
  route(
    'post',
    'auth/otp/verify',
    { auth: false, body: z.object({ challengeId: z.string().min(1).max(64), phone: z.string().max(20), code: z.string().max(10), idempotencyKey: idem }) },
    async ({ body }) => {
      const phone = normalizePhone(body.phone)
      if (!phone) throw fail(400, 'invalid_phone', 'phone')
      await checkOtp(body.challengeId, phone, 'partner_login', body.code)
      let partner = await findOne<Partner>('partners', 'username', phone)
      if (partner?.accountStatus === 'deleted') throw fail(403, 'account_deleted')
      if (!partner) {
        try {
          partner = await createDoc('partners', { username: phone, verificationStatus: 'draft', accountStatus: 'active' })
        } catch {
          partner = await findOne<Partner>('partners', 'username', phone)
          if (!partner) throw fail(500, 'server_error')
        }
      }
      await mirrorAuthUser('partner', partner.id, phone)
      const session = await createSession('partner', partner.id)
      return { body: { token: session.token, exp: session.exp, partner: await partnerDTO(partner) } }
    },
  ),
  route('post', 'auth/logout', { body: z.object({ idempotencyKey: idem }) }, async ({ token }) => {
    // Partners signed in through the Partner app's headers have no session here.
    if (token) await endSession(token)
    return { body: { loggedOut: true } }
  }),

  /* me & onboarding */
  route('get', 'me', {}, async ({ partner }) => {
    const fresh = await reload(partner.id)
    return { body: { partner: await partnerDTO(fresh), onboarding: await onboardingStatus(fresh) } }
  }),
  route(
    'patch',
    'me',
    {
      body: z
        .object({
          name: z.string().trim().min(2).max(60),
          dateOfBirth: z.iso.date(),
          languages: z.array(z.enum(['hi', 'en', 'pa', 'bgc', 'bn'])).max(5),
          role: z.enum(PARTNER_ROLES),
          categories: z.array(z.string().min(1).max(64)).min(1).max(5),
          zoneName: z.string().trim().max(80),
          homeLat: lat,
          homeLng: lng,
          serviceRadiusKm: z.number().min(1).max(30),
          vehicle: z.object({ type: z.enum(['motorbike', 'scooter', 'bicycle', 'car', 'none']), number: z.string().trim().toUpperCase().regex(/^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{0,3}\s?\d{4}$/).optional() }),
          preferences: z.object({ language: z.enum(['hinglish', 'en', 'hi']).optional(), navigationApp: z.enum(['google_maps', 'mappls', 'waze']).optional(), offerSound: z.boolean().optional() }),
          idempotencyKey: idem,
        })
        .partial()
        .strict(),
    },
    async ({ partner, body }) => {
      const { idempotencyKey: _k, ...changes } = body
      const editable = EDITABLE.includes(partner.verificationStatus)
      const locked = (['name', 'dateOfBirth', 'role', 'categories', 'vehicle'] as const).find((f) => f in changes)
      if (locked && !editable) throw fail(409, 'profile_locked', locked)
      const role = (changes.role ?? partner.role) as PartnerRole | undefined
      if (changes.categories || changes.role) {
        // Ids, keys (ac, bike, mobile) or slugs are accepted; ids are what gets stored.
        const cats = await resolveCategoryRefs(changes.categories ?? partner.categories ?? [])
        if (role && cats.some((c) => c.flow !== FLOW_FOR_ROLE[role])) throw fail(400, 'category_role_mismatch', 'categories')
        if (changes.categories) changes.categories = cats.map((c) => c.id)
      }
      if (changes.vehicle && changes.vehicle.type !== 'none' && !changes.vehicle.number) throw fail(400, 'vehicle_number_required', 'vehicle.number')
      const patch: Booking = { ...changes }
      if (changes.dateOfBirth) patch.dateOfBirth = new Date(`${changes.dateOfBirth}T00:00:00Z`).toISOString()
      const updated = await updatePartner(partner.id, (p) => (changes.preferences ? { ...patch, preferences: { ...p.preferences, ...changes.preferences } } : patch))
      return { body: { partner: await partnerDTO(updated as Partner) } }
    },
  ),
  route('post', 'me/photo', { multipart: true, body: z.object({ idempotencyKey: idem }).passthrough() }, async ({ partner, file }) => {
    if (!EDITABLE.includes(partner.verificationStatus)) throw fail(409, 'profile_locked', 'photo')
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw fail(400, 'image_required', 'file')
    if (file.size > 8 * 1024 * 1024) throw fail(413, 'file_too_large', 'file')
    const filename = `partner-${partner.id}-${Date.now()}.${extFor(file.type)}`
    const storagePath = `partners/${filename}`
    await putFile(PUBLIC_BUCKET, storagePath, file, file.type)
    const media = await createDoc('media', { alt: `dwaar partner ${partner.name ?? ''}`.trim(), filename, mimeType: file.type, filesize: file.size, url: publicUrl(storagePath), storagePath })
    const updated = await updatePartner(partner.id, () => ({ photo: media.id }))
    return { status: 201, body: { partner: await partnerDTO(updated as Partner) } }
  }),
  route('get', 'me/documents', {}, async ({ partner }) => {
    const { all } = await currentDocuments(partner.id)
    return { body: { documents: all.map(docDTO), required: requiredDocuments(partner.role) } }
  }),
  route(
    'post',
    'me/documents',
    { multipart: true, body: z.object({ type: z.enum(PARTNER_DOCUMENT_TYPES), expiresAt: z.iso.date().optional(), idempotencyKey: idem }) },
    async ({ partner, body, file }) => {
      const renewing = partner.verificationStatus === 'approved' && ['driving_licence', 'vehicle_rc', 'police_verification'].includes(body.type)
      if (!EDITABLE.includes(partner.verificationStatus) && !renewing) throw fail(409, 'profile_locked', 'type')
      if (!file) throw fail(400, 'file_required', 'file')
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) throw fail(400, 'file_type', 'file')
      if (file.size > 8 * 1024 * 1024) throw fail(413, 'file_too_large', 'file')
      if ((body.type === 'driving_licence' || body.type === 'vehicle_rc') && !body.expiresAt) throw fail(400, 'expiry_required', 'expiresAt')
      if (body.expiresAt && new Date(body.expiresAt).getTime() <= Date.now()) throw fail(400, 'document_expired', 'expiresAt')
      const { latest } = await currentDocuments(partner.id)
      const filename = `${partner.id}-${body.type}-${Date.now()}.${extFor(file.type)}`
      const storagePath = `partner-documents/${partner.id}/${filename}`
      await putFile(PRIVATE_BUCKET, storagePath, file, file.type)
      const doc = await createDoc('partner-documents', {
        owner: partner.id,
        type: body.type,
        status: 'pending',
        expiresAt: body.expiresAt ? new Date(`${body.expiresAt}T00:00:00Z`).toISOString() : null,
        superseded: false,
        filename,
        mimeType: file.type,
        filesize: file.size,
        storagePath,
      })
      const prev = latest.get(body.type)
      // A renewal keeps the old approved licence active until the new one is approved.
      if (prev && !(renewing && prev.status === 'approved')) await saveDoc('partner-documents', { ...prev, superseded: true })
      return { status: 201, body: { document: docDTO(doc) } }
    },
  ),
  route(
    'post',
    'me/bank',
    {
      body: z
        .object({
          holderName: z.string().trim().min(2).max(80),
          accountNumber: z.string().regex(/^\d{9,18}$/).optional(),
          ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/).optional(),
          upiId: z.string().trim().regex(/^[\w.-]{2,}@[a-zA-Z]{2,}$/).optional(),
          idempotencyKey: idem,
        })
        .refine((b) => (b.accountNumber && b.ifsc) || b.upiId, { message: 'bank_or_upi', path: ['accountNumber'] }),
    },
    async ({ partner, body }) => {
      // Only the last 4 digits are stored; changing details resets verification.
      const updated = await updatePartner(partner.id, (p) => ({
        bank: {
          holderName: body.holderName,
          accountLast4: body.accountNumber ? body.accountNumber.slice(-4) : (p.bank?.accountLast4 ?? null),
          ifsc: body.ifsc ?? p.bank?.ifsc ?? null,
          upiId: body.upiId ?? p.bank?.upiId ?? null,
          verified: false,
        },
      }))
      return { body: { bank: (await partnerDTO(updated as Partner)).bank } }
    },
  ),
  route('get', 'skill-test', {}, async ({ partner, query }) => {
    const ref = query.get('category')
    if (!ref) throw fail(400, 'category_required', 'category')
    const [{ id: category }] = await resolveCategoryRefs([ref], 'category')
    if (!(partner.categories ?? []).includes(category)) throw fail(403, 'category_not_selected', 'category')
    const test = await findOne<Booking>('skill-tests', 'category', category)
    if (!test) throw fail(404, 'not_found')
    return {
      body: {
        test: {
          id: test.id,
          title: test.title,
          category,
          passPercent: SKILL_PASS_PERCENT,
          // Answers never leave the server.
          questions: (test.questions ?? []).map((q: Booking, index: number) => ({ index, question: q.question, options: (q.options ?? []).map((o: Booking) => o.text) })),
        },
      },
    }
  }),
  route(
    'post',
    'skill-test/submit',
    { body: z.object({ category: z.string().min(1).max(64), answers: z.array(z.number().int().min(0).max(3)).min(1).max(100), idempotencyKey: idem }) },
    async ({ partner, body }) => {
      const [{ id: category }] = await resolveCategoryRefs([body.category], 'category')
      if (!(partner.categories ?? []).includes(category)) throw fail(403, 'category_not_selected', 'category')
      if (!EDITABLE.includes(partner.verificationStatus)) throw fail(409, 'profile_locked')
      const test = await findOne<Booking>('skill-tests', 'category', category)
      if (!test) throw fail(404, 'not_found')
      const questions: Booking[] = test.questions ?? []
      if (body.answers.length !== questions.length) throw fail(400, 'answers_count', 'answers', { expected: questions.length })
      const correct = questions.filter((q, i) => q.correctIndex === body.answers[i]).length
      const score = Math.round((correct / questions.length) * 100)
      await updatePartner(partner.id, () => ({ skillTestScore: score }))
      return { body: { score, correct, total: questions.length, passed: score >= SKILL_PASS_PERCENT, passPercent: SKILL_PASS_PERCENT } }
    },
  ),
  route('get', 'onboarding/status', {}, async ({ partner }) => ({ body: { onboarding: await onboardingStatus(await reload(partner.id)) } })),
  route(
    'post',
    'onboarding/submit',
    { body: z.object({ trainingAcknowledged: z.literal(true), agreementAccepted: z.literal(true), idempotencyKey: idem }) },
    async ({ partner }) => {
      const fresh = await reload(partner.id)
      if (!EDITABLE.includes(fresh.verificationStatus)) throw fail(409, 'already_submitted')
      const status = await onboardingStatus(fresh)
      const pending = status.steps.slice(0, 5).find((s) => !s.done)
      if (pending) throw fail(409, 'onboarding_incomplete', pending.step)
      const now = nowISO()
      const updated = (await updatePartner(partner.id, (p) => ({
        trainingCompletedAt: p.trainingCompletedAt ?? now,
        agreementAcceptedAt: now,
        verificationStatus: 'submitted',
        submittedAt: now,
        rejectionReason: null,
      }))) as Partner
      return { body: { partner: await partnerDTO(updated), onboarding: await onboardingStatus(updated) } }
    },
  ),

  /* live: presence, location, offers */
  route('post', 'presence', { body: z.object({ online: z.boolean(), lat: lat.optional(), lng: lng.optional(), idempotencyKey: idem }) }, async ({ partner, body }) => {
    if (body.online) {
      const blocker = await onlineBlocker(partner)
      if (blocker) {
        if (partner.isOnline) await heartbeat(partner, { isOnline: false })
        throw fail(403, blocker)
      }
      if (body.lat === undefined || body.lng === undefined) throw fail(400, 'location_required', 'lat')
    }
    await heartbeat(partner, { isOnline: body.online, ...(body.lat !== undefined && body.lng !== undefined ? { lastLat: body.lat, lastLng: body.lng } : {}) })
    if (body.online && body.lat !== undefined && body.lng !== undefined) {
      await createDoc('partner-locations', { partner: partner.id, booking: null, lat: body.lat, lng: body.lng, recordedAt: nowISO() })
    }
    if (body.online) await advanceDispatch()
    return { body: { partner: await partnerDTO(await reload(partner.id)) } }
  }),
  route(
    'post',
    'location',
    {
      body: z.object({
        lat,
        lng,
        accuracy: z.number().min(0).max(10000).optional(),
        heading: z.number().min(0).max(360).optional(),
        speed: z.number().min(0).max(100).optional(),
        bookingId: z.string().min(1).max(64).optional(),
        idempotencyKey: idem,
      }),
    },
    async ({ partner, body }) => {
      // Rate limit per partner, checked atomically on a short-lived key.
      const slot = `loc:${partner.id}`
      const last = (await raw.get(slot)) as { at?: number } | undefined
      const wait = LOCATION_MIN_INTERVAL_MS - (Date.now() - (last?.at ?? 0))
      if (wait > 0) throw fail(429, 'too_frequent', undefined, { retryAfterMs: wait })
      await raw.set(slot, { at: Date.now() })
      let booking: Booking | null = null
      if (body.bookingId) {
        booking = await getDoc<Booking>('bookings', body.bookingId)
        if (!booking || !isWorker(booking, partner.id)) throw fail(404, 'not_found', 'bookingId')
        if (idOf(booking.assignedPartner) !== partner.id) throw fail(403, 'not_assigned', 'bookingId')
      }
      const recordedAt = nowISO()
      await createDoc('partner-locations', { partner: partner.id, booking: booking?.id ?? null, lat: body.lat, lng: body.lng, accuracy: body.accuracy ?? null, heading: body.heading ?? null, speed: body.speed ?? null, recordedAt })
      await heartbeat(partner, { lastLat: body.lat, lastLng: body.lng })
      // Riders have no ARRIVED status: the first fix inside the geofence while on the way marks arrival.
      if (booking && booking.flow === 'pickup_drop' && booking.status === 'ON_THE_WAY' && !booking.arrivedAt) {
        const bLat = booking.address?.lat
        const bLng = booking.address?.lng
        if (bLat != null && bLng != null && distanceKm(body.lat, body.lng, bLat, bLng) * 1000 <= GEOFENCE_M) {
          await updateBooking(booking.id, { actor: 'dispatcher', skipEvents: true }, (cur) => (cur.arrivedAt ? {} : { arrivedAt: recordedAt }))
        }
      }
      await prune()
      return { status: 201, body: { recordedAt, nextAllowedAt: new Date(Date.now() + LOCATION_MIN_INTERVAL_MS).toISOString() } }
    },
  ),
  route('get', 'offers', {}, async ({ partner }) => {
    await advanceDispatch()
    await heartbeat(partner)
    const now = Date.now()
    const mine = (await find<Booking>('job-offers', 'partner', partner.id))
      .filter((o) => o.status === 'offered' && new Date(o.expiresAt).getTime() > now)
      .sort((a, b) => String(b.offeredAt).localeCompare(String(a.offeredAt)))
      .slice(0, 20)
    const zone = (await getConfig()).zone?.name ?? null
    return { body: { offers: await Promise.all(mine.map((o) => offerDTO(o, zone))), serverTime: nowISO() } }
  }),
  route('post', 'offers/:id/accept', { body: z.object({ idempotencyKey: idem }) }, async ({ partner, params }) => {
    const { booking } = await acceptOffer(partner, params.id)
    return { body: { job: await jobDTO((await getDoc<Booking>('bookings', booking.id)) ?? booking, await reload(partner.id)) } }
  }),
  route('post', 'offers/:id/decline', { body: z.object({ reason: z.string().trim().min(2).max(200), idempotencyKey: idem }) }, async ({ partner, params, body }) => {
    const offer = await declineOffer(partner, params.id, body.reason)
    return { body: { offer: { id: offer.id, status: 'declined' } } }
  }),

  /* jobs */
  route('get', 'jobs', {}, async ({ partner, query }) => {
    const state = query.get('state') ?? 'active'
    if (!['active', 'upcoming', 'past'].includes(state)) throw fail(400, 'invalid_state', 'state')
    await advanceDispatch()
    const now = Date.now()
    const classify = (b: Booking) => {
      if (idOf(b.assignedPartner) !== partner.id || TERMINAL.includes(b.status)) return 'past'
      const start = b.schedule?.startAt ? new Date(b.schedule.startAt).getTime() : 0
      if (b.schedule?.mode === 'scheduled' && b.status === 'PARTNER_ASSIGNED' && start - SCHEDULED_DISPATCH_LEAD_MS > now) return 'upcoming'
      return 'active'
    }
    const list = (await partnerBookings(partner.id)).slice(0, 100).filter((b) => classify(b) === state)
    return { body: { state, jobs: await Promise.all(list.map((b) => jobDTO(b, partner))) } }
  }),
  route('get', 'jobs/:id', {}, async ({ partner, params }) => {
    await advanceDispatch({ bookingId: params.id })
    return respond(partner, params.id)
  }),
  route(
    'post',
    'jobs/:id/transition',
    {
      body: z.object({
        to: z.enum(BOOKING_STATUSES),
        otp: z.string().regex(/^\d{4}$/).optional(),
        lat: lat.optional(),
        lng: lng.optional(),
        checklist: z.object({ imei: z.string().regex(/^\d{15}$/), simRemoved: z.boolean(), memoryCardRemoved: z.boolean(), conditionNotes: z.string().trim().max(500).optional() }).optional(),
        mediaIds: z.array(idSchema).max(12).optional(),
        idempotencyKey: idem,
      }),
    },
    async ({ partner, params, body }) => {
      const booking = await loadJob(partner, params.id)
      requireAssignee(booking, partner)
      if (body.to === 'QUOTE_SENT') throw fail(400, 'use_quote_endpoint', 'to')
      if (body.to === 'BOOKED') throw fail(400, 'use_release_endpoint', 'to')
      if (body.to === 'CANCELLED') throw fail(400, 'use_no_show_endpoint', 'to')
      const data: Booking = { status: body.to }
      if (body.checklist || body.mediaIds) {
        await checkMedia(booking.id, body.mediaIds ?? [], ['pickup_photo'])
        data.pickupChecklist = { ...booking.pickupChecklist, ...body.checklist, photos: body.mediaIds ?? booking.pickupChecklist?.photos ?? [] }
      }
      await writeAsPartner(partner, booking, data, { otp: body.otp, lat: body.lat, lng: body.lng })
      if (body.lat !== undefined && body.lng !== undefined) {
        await createDoc('partner-locations', { partner: partner.id, booking: booking.id, lat: body.lat, lng: body.lng, recordedAt: nowISO() })
        await heartbeat(partner, { lastLat: body.lat, lastLng: body.lng })
      }
      if (body.to === 'ON_THE_WAY') await updatePartner(partner.id, () => ({ currentJob: booking.id }))
      return respond(partner, booking.id)
    },
  ),
  route('post', 'jobs/:id/media', { multipart: true, body: z.object({ kind: z.enum(JOB_MEDIA_KINDS), idempotencyKey: idem }) }, async ({ partner, params, body, file }) => {
    const booking = await loadJob(partner, params.id)
    requireAssignee(booking, partner)
    if (!file) throw fail(400, 'file_required', 'file')
    const video = body.kind === 'quote_video'
    if (video ? !/^video\//.test(file.type) : !/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) throw fail(400, 'file_type', 'file')
    if (file.size > (video ? 50 : 10) * 1024 * 1024) throw fail(413, 'file_too_large', 'file')
    const filename = `${booking.bookingCode}-${body.kind}-${Date.now()}.${extFor(file.type)}`
    const storagePath = `job-media/${booking.id}/${filename}`
    await putFile(PRIVATE_BUCKET, storagePath, file, file.type)
    const media = await createDoc('job-media', { booking: booking.id, partner: partner.id, kind: body.kind, filename, mimeType: file.type, filesize: file.size, storagePath })
    return { status: 201, body: { media: { id: media.id, kind: media.kind, mimeType: media.mimeType, url: `${API}/files/job-media/${media.id}` } } }
  }),
  route(
    'post',
    'jobs/:id/quote',
    {
      body: z.object({
        diagnosis: z.string().trim().min(3).max(1000),
        items: z
          .array(z.object({ label: z.string().trim().min(2).max(80), grade: z.enum(['original', 'premium', 'normal', 'labour']).optional(), pricePaise: z.number().int().min(0).max(10_000_000), isExtraPart: z.boolean().optional() }))
          .min(1)
          .max(20),
        totalPaise: z.number().int().min(1).max(50_000_000),
        videoMediaId: idSchema.optional(),
        idempotencyKey: idem,
      }),
    },
    async ({ partner, params, body }) => {
      const booking = await loadJob(partner, params.id)
      requireAssignee(booking, partner)
      if (body.videoMediaId) await checkMedia(booking.id, [body.videoMediaId], ['quote_video'])
      await writeAsPartner(partner, booking, {
        status: 'QUOTE_SENT',
        quote: { ...booking.quote, diagnosis: body.diagnosis, items: body.items, totalPaise: body.totalPaise, videoMedia: body.videoMediaId ?? null },
      })
      return respond(partner, booking.id)
    },
  ),
  route(
    'post',
    'jobs/:id/parts',
    { body: z.object({ parts: z.array(z.object({ name: z.string().trim().min(2).max(80), pricePaise: z.number().int().min(0).max(5_000_000), billMediaId: idSchema.optional() })).min(1).max(10), idempotencyKey: idem }) },
    async ({ partner, params, body }) => {
      const booking = await loadJob(partner, params.id)
      requireAssignee(booking, partner)
      if (!['ARRIVED', 'IN_PROGRESS', 'APPROVED', 'AT_HUB'].includes(booking.status)) throw fail(409, 'parts_not_allowed_now')
      await checkMedia(booking.id, body.parts.map((p) => p.billMediaId).filter((x): x is string => Boolean(x)), ['part_bill'])
      await writeAsPartner(partner, booking, { partsUsed: [...(booking.partsUsed ?? []), ...body.parts.map((p) => ({ name: p.name, pricePaise: p.pricePaise, bill: p.billMediaId ?? null }))] })
      return respond(partner, booking.id)
    },
  ),
  route(
    'post',
    'jobs/:id/payment',
    { body: z.object({ method: z.enum(['cash', 'upi']), amountPaise: z.number().int().min(0), reference: z.string().trim().max(60).optional(), idempotencyKey: idem }) },
    async ({ partner, params, body }) => {
      const booking = await loadJob(partner, params.id)
      requireAssignee(booking, partner)
      const canComplete = partnerEdgesFor(booking.flow, partner.role as PartnerRole, booking.status).some((e) => e.to === 'COMPLETED')
      if (!canComplete) throw fail(409, 'payment_not_allowed_now')
      if (booking.paymentCollection?.collectedAt || booking.payment?.status === 'paid') throw fail(409, 'already_paid')
      const due = amountDuePaise(booking)
      if (body.amountPaise !== due) throw fail(400, 'amount_mismatch', 'amountPaise', { expected: due })
      if (body.method === 'upi' && !body.reference) throw fail(400, 'reference_required', 'reference')
      await writeAsPartner(partner, booking, {
        paymentCollection: { method: body.method, amountPaise: body.amountPaise, reference: body.reference ?? null, collectedBy: partner.id, collectedAt: nowISO() },
        payment: { ...booking.payment, status: 'paid' },
      })
      if (body.method === 'cash') {
        // Cash the partner now holds for dwaar; it is netted off the next payout.
        await appendLedger({ partner: partner.id, booking: booking.id, type: 'cod_collected', amountPaise: -body.amountPaise, note: `Cash collected ${booking.bookingCode}`, entryKey: `${booking.id}:cod_collected` })
      }
      return respond(partner, booking.id)
    },
  ),
  route('post', 'jobs/:id/no-show', { body: z.object({ lat, lng, idempotencyKey: idem }) }, async ({ partner, params, body }) => {
    const booking = await loadJob(partner, params.id)
    requireAssignee(booking, partner)
    await writeAsPartner(partner, booking, { status: 'CANCELLED' }, { noShow: true, lat: body.lat, lng: body.lng })
    return respond(partner, booking.id)
  }),
  route('post', 'jobs/:id/release', { body: z.object({ reason: z.string().trim().min(3).max(200), idempotencyKey: idem }) }, async ({ partner, params, body }) => {
    const booking = await loadJob(partner, params.id)
    requireAssignee(booking, partner)
    if (canRelease(booking.flow, booking.status)) await writeAsPartner(partner, booking, { status: 'BOOKED' }, { releaseReason: body.reason })
    else await releaseNonVisitLeg(booking, partner, body.reason)
    return { body: { released: true, bookingId: booking.id } }
  }),
  route(
    'post',
    'jobs/:id/rate-customer',
    { body: z.object({ stars: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional(), idempotencyKey: idem }) },
    async ({ partner, params, body }) => {
      const booking = await loadJob(partner, params.id)
      if (booking.status !== 'COMPLETED' && booking.status !== 'RETURNED') throw fail(409, 'cannot_rate')
      if (booking.customerRatingByPartner?.stars) throw fail(409, 'already_rated')
      await updateBooking(booking.id, { actor: 'dispatcher', skipEvents: true }, () => ({ customerRatingByPartner: { stars: body.stars, comment: body.comment ?? null } }))
      return respond(partner, booking.id)
    },
  ),

  /* money */
  route('get', 'earnings', {}, async ({ partner, query }) => {
    const from = query.get('from')
    const to = query.get('to')
    const valid = (v: string | null) => !v || !Number.isNaN(Date.parse(v))
    if (!valid(from) || !valid(to)) throw fail(400, 'invalid_range', 'from')
    const all = await ledgerEntries(partner.id)
    const inRange = all.filter((e) => (!from || e.createdAt >= new Date(from).toISOString()) && (!to || e.createdAt <= new Date(to).toISOString()))
    const byType: Record<string, number> = {}
    const jobs = new Set<string>()
    for (const e of inRange) {
      byType[e.type] = (byType[e.type] ?? 0) + (e.amountPaise ?? 0)
      if (e.type === 'job_earning' && e.booking) jobs.add(idOf(e.booking) as string)
    }
    const config = await getConfig()
    const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const target = DAYS.indexOf(config.partnerPay?.payoutDay ?? 'mon')
    const next = new Date()
    next.setUTCDate(next.getUTCDate() + ((target - next.getUTCDay() + 7) % 7 || 7))
    next.setUTCHours(4, 30, 0, 0) // 10:00 IST
    return {
      body: {
        from: from ? new Date(from).toISOString() : null,
        to: to ? new Date(to).toISOString() : null,
        jobsCount: jobs.size,
        byTypePaise: byType,
        periodEarningsPaise: ['job_earning', 'visit_share', 'parts_reimbursement', 'incentive', 'penalty', 'adjustment'].reduce((s, t) => s + (byType[t] ?? 0), 0),
        balances: await partnerBalances(partner.id, all),
        payoutDay: config.partnerPay?.payoutDay ?? 'mon',
        nextPayoutAt: next.toISOString(),
      },
    }
  }),
  route('get', 'ledger', {}, async ({ partner, query }) => {
    const page = Math.max(1, Number(query.get('page') ?? 1) || 1)
    const limit = Math.min(100, Math.max(1, Number(query.get('limit') ?? 30) || 30))
    const all = await ledgerEntries(partner.id)
    return {
      body: {
        entries: all.slice((page - 1) * limit, page * limit).map((e) => ({ id: e.id, type: e.type, amountPaise: e.amountPaise, note: e.note ?? null, bookingId: idOf(e.booking), createdAt: e.createdAt })),
        page,
        totalPages: Math.max(1, Math.ceil(all.length / limit)),
        totalEntries: all.length,
      },
    }
  }),
  route('get', 'payouts', {}, async ({ partner }) => {
    const entries = await ledgerEntries(partner.id)
    const payouts = (await find<Booking>('payouts', 'partner', partner.id)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50)
    return {
      body: {
        payouts: payouts.map((p) => ({ id: p.id, amountPaise: p.amountPaise, status: p.status, reference: p.reference ?? null, periodStart: p.periodStart ?? null, periodEnd: p.periodEnd ?? null, createdAt: p.createdAt })),
        balances: await partnerBalances(partner.id, entries),
      },
    }
  }),
  route('post', 'payouts/request', { body: z.object({ idempotencyKey: idem }) }, async ({ partner }) => {
    if (partner.verificationStatus !== 'approved') throw fail(403, 'not_approved')
    if (!partner.bank?.upiId && !(partner.bank?.accountLast4 && partner.bank?.ifsc)) throw fail(409, 'bank_missing', 'bank')
    const { withLock } = await import('./db.tsx')
    return withLock(`payout:${partner.id}`, async () => {
      const last = (await find<Booking>('payouts', 'partner', partner.id)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
      if (last && (last.status === 'requested' || last.status === 'processing')) throw fail(409, 'payout_pending')
      const week = 7 * 24 * 60 * 60 * 1000
      if (last && last.status !== 'failed' && Date.now() - new Date(last.createdAt).getTime() < week) {
        throw fail(409, 'payout_weekly_limit', undefined, { nextAt: new Date(new Date(last.createdAt).getTime() + week).toISOString() })
      }
      const balances = await partnerBalances(partner.id)
      if (balances.payablePaise <= 0) throw fail(409, 'nothing_to_pay', undefined, { cashInHandPaise: balances.cashInHandPaise })
      const payout = await createDoc('payouts', { partner: partner.id, amountPaise: balances.payablePaise, status: 'requested', periodStart: last?.periodEnd ?? partner.createdAt, periodEnd: nowISO(), reference: null })
      // Reserve the amount right away so it cannot be requested twice.
      await appendLedger({ partner: partner.id, type: 'payout', amountPaise: -payout.amountPaise, note: 'Payout requested', entryKey: `payout:${payout.id}`, payout: payout.id })
      return { status: 201, body: { payout: { id: payout.id, amountPaise: payout.amountPaise, status: payout.status, periodStart: payout.periodStart, periodEnd: payout.periodEnd } } }
    })
  }),

  /* support */
  route('get', 'tickets', {}, async ({ partner }) => {
    const list = (await find<Booking>('partner-tickets', 'partner', partner.id)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50)
    return { body: { tickets: list.map(ticketDTO) } }
  }),
  route(
    'post',
    'tickets',
    { body: z.object({ topic: z.enum(['safety', 'payment', 'app', 'customer', 'other']), message: z.string().trim().min(5).max(1000), bookingId: z.string().min(1).max(64).optional(), idempotencyKey: idem }) },
    async ({ partner, body }) => {
      const booking = body.bookingId ? await loadJob(partner, body.bookingId).catch(() => { throw fail(404, 'not_found', 'bookingId') }) : null
      const ticket = await createDoc('partner-tickets', { partner: partner.id, booking: booking?.id ?? null, topic: body.topic, message: body.message, status: 'open', urgent: false })
      return { status: 201, body: { ticket: ticketDTO(ticket) } }
    },
  ),
  route('post', 'sos', { body: z.object({ lat, lng, bookingId: z.string().min(1).max(64).optional(), idempotencyKey: idem }) }, async ({ partner, body }) => {
    const booking = body.bookingId ? await loadJob(partner, body.bookingId).catch(() => { throw fail(404, 'not_found', 'bookingId') }) : null
    const config = await getConfig()
    const ticket = await createDoc('partner-tickets', {
      partner: partner.id,
      booking: booking?.id ?? null,
      topic: 'safety',
      urgent: true,
      status: 'open',
      sos: { lat: body.lat, lng: body.lng },
      message: `SOS from ${partner.name ?? partner.username} at ${body.lat.toFixed(5)}, ${body.lng.toFixed(5)}${booking ? ` during ${booking.bookingCode}` : ''}`,
    })
    console.error('PARTNER SOS', JSON.stringify({ ticket: ticket.id, partner: partner.id, booking: booking?.id, lat: body.lat, lng: body.lng }))
    return { status: 201, body: { ticket: ticketDTO(ticket), hubPhone: config.support?.phone ?? null, emergency: '112' } }
  }),

  /* private files */
  route('get', 'files/:collection/:id', {}, async ({ partner, params }) => {
    const collection = params.collection
    if (!['job-media', 'partner-documents', 'problem-videos'].includes(collection)) throw fail(404, 'not_found')
    const doc = await getDoc<Booking>(collection, params.id)
    if (!doc?.storagePath) throw fail(404, 'not_found')
    let allowed = false
    if (collection === 'partner-documents') allowed = idOf(doc.owner) === partner.id
    else {
      const booking = await getDoc<Booking>('bookings', idOf(doc.booking))
      allowed = (collection === 'job-media' && idOf(doc.partner) === partner.id) || Boolean(booking && isWorker(booking, partner.id))
    }
    if (!allowed) throw fail(404, 'not_found')
    return streamPrivate(doc.storagePath, doc.filename)
  }),
]

function ticketDTO(t: Booking) {
  return { id: t.id, topic: t.topic, message: t.message, status: t.status, urgent: Boolean(t.urgent), reply: t.reply ?? null, bookingId: idOf(t.booking), createdAt: t.createdAt, updatedAt: t.updatedAt }
}

export const partnerApp = new Hono()
for (const r of routes) partnerApp[r.method](`/${r.path}`, r.run)
partnerApp.options('/*', () => new Response(null, { status: 204, headers: CORS_HEADERS }))
