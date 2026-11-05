import { DomainError, UniqueViolation, createDoc, find, getDoc, getDocs, idOf, nowISO, saveDoc, withLock } from './db.tsx'
import { getConfig } from './catalog.tsx'
import { randomInt } from './auth.tsx'
import {
  LEG_STATUS,
  canRelease,
  canTransition,
  customerCan,
  dispatchLegFor,
  isOperationalEdge,
  noShowFrom,
  partnerEdge,
  roleForLeg,
  type BookingFlow,
  type BookingStatus,
  type DispatchLeg,
  type PartnerRole,
  type TransitionRequirement,
} from './lib-booking-machine.tsx'
import { distanceKm, etaMinutesFor, isNum } from './lib-geo.tsx'
import {
  DEFAULT_SERVICE_RADIUS_KM,
  GEOFENCE_M,
  MANUAL_ASSIGN_AFTER_MS,
  MAX_BOOKING_OTP_ATTEMPTS,
  MAX_OFFER_ATTEMPTS,
  NO_SHOW_WAIT_MS,
  OFFER_TTL_MS,
  ONLINE_FRESH_MS,
  RANK_WEIGHTS,
  RELEASE_RELIABILITY_DROP,
  SCHEDULED_DISPATCH_LEAD_MS,
  needsDrivingLicence,
} from './lib-partner-constants.tsx'
import { estimateEarningPaise, getPartnerPay, writeCompletionLedger, writeReleasePenalty } from './ledger.tsx'

/**
 * Booking engine: the Payload Bookings hooks (enforceTransitions + recordEvents) and the
 * dispatch engine, on the Supabase document store. Every booking write goes through
 * `updateBooking`, which holds a per-booking lock while it validates and saves, then runs the
 * side effects (events, dispatch, ledger, warranty, wallet, ratings) after releasing it.
 */
// deno-lint-ignore no-explicit-any
export type Booking = Record<string, any>
// deno-lint-ignore no-explicit-any
export type Partner = Record<string, any>

export type Actor = 'customer' | 'partner' | 'dispatcher' | 'system'

export interface TransitionInput {
  otp?: string
  lat?: number
  lng?: number
  noShow?: boolean
  releaseReason?: string
}

export interface WriteCtx {
  actor: Actor
  /** The partner making a partner-actor write (from the authenticated session, never input). */
  partner?: Partner
  transition?: TransitionInput
  eventNote?: string
  /** Dispatcher bookkeeping writes: no event row, no side effects (as in Payload). */
  skipEvents?: boolean
  releasedBy?: string | null
  releasedRound?: number
}

const TERMINAL: BookingStatus[] = ['COMPLETED', 'RETURNED', 'CANCELLED']

/* ------------------------------------------------------------- transitions */

function within(lat: number | undefined, lng: number | undefined, booking: Booking) {
  const bLat = booking.address?.lat
  const bLng = booking.address?.lng
  if (!isNum(bLat) || !isNum(bLng)) return true
  if (!isNum(lat) || !isNum(lng)) return false
  return distanceKm(lat, lng, bLat, bLng) * 1000 <= GEOFENCE_M
}

/** Fixed-price lines can never be re-priced by a partner; only extra parts may be added. */
async function checkQuote(merged: Booking, actor: Actor) {
  const quote = merged.quote ?? {}
  const items: Booking[] = quote.items ?? []
  const total = quote.totalPaise ?? 0
  if (actor !== 'partner') {
    if (total <= 0) throw new DomainError('quote_total_required', 400, { field: 'totalPaise' })
    return
  }
  if (items.length === 0) throw new DomainError('quote_items_required', 400, { field: 'items' })
  if (items.some((i) => !isNum(i.pricePaise) || i.pricePaise < 0)) throw new DomainError('quote_invalid', 400, { field: 'items' })
  const services = await getDocs<Booking>('services', (merged.lines ?? []).map((l: Booking) => idOf(l.service)))
  const repriceable = services.some((s) => s.priceType === 'range' || s.tierPriced)
  const itemsSum = items.reduce((sum, i) => sum + (i.pricePaise ?? 0), 0)
  if (!repriceable) {
    if (items.some((i) => !i.isExtraPart)) throw new DomainError('fixed_price', 400, { field: 'items' })
    const expected = (merged.pricing?.estimateMaxPaise ?? 0) + itemsSum
    if (total !== expected) throw new DomainError('quote_total_mismatch', 400, { field: 'totalPaise', params: { expected } })
  } else if (total !== itemsSum || total <= 0) {
    throw new DomainError('quote_total_mismatch', 400, { field: 'totalPaise', params: { expected: itemsSum } })
  }
}

async function checkPickup(merged: Booking) {
  const c = merged.pickupChecklist ?? {}
  if (!c.imei || !/^\d{15}$/.test(c.imei)) throw new DomainError('imei_required', 400, { field: 'checklist.imei' })
  if (c.simRemoved !== true) throw new DomainError('sim_not_removed', 400, { field: 'checklist.simRemoved' })
  if (c.memoryCardRemoved !== true) throw new DomainError('memory_card_not_removed', 400, { field: 'checklist.memoryCardRemoved' })
  const ids = new Set(((c.photos ?? []) as unknown[]).map(idOf).filter(Boolean) as string[])
  const media = await getDocs<Booking>('job-media', [...ids])
  const ok = media.filter((m) => idOf(m.booking) === merged.id && m.kind === 'pickup_photo')
  if (ok.length < 4) throw new DomainError('pickup_photos_required', 400, { field: 'mediaIds', params: { min: 4 } })
}

function checkOtp(kind: 'service' | 'delivery', given: string | undefined, original: Booking) {
  const attempts = original.otpAttempts?.[kind] ?? 0
  if (attempts >= MAX_BOOKING_OTP_ATTEMPTS) throw new DomainError('otp_locked', 423, { field: 'otp' })
  const expected = kind === 'service' ? original.serviceOtp : original.deliveryOtp
  if (!given) throw new DomainError('otp_required', 400, { field: 'otp' })
  if (!expected || given !== expected) {
    throw new DomainError('otp_wrong', 400, { field: 'otp', params: { left: Math.max(0, MAX_BOOKING_OTP_ATTEMPTS - attempts - 1), kind } })
  }
}

async function requirementCheck(need: TransitionRequirement, merged: Booking, original: Booking, input: TransitionInput) {
  switch (need) {
    case 'location':
      if (!isNum(input.lat) || !isNum(input.lng)) throw new DomainError('location_required', 400, { field: 'lat' })
      return
    case 'geofence':
      if (!within(input.lat, input.lng, merged)) throw new DomainError('outside_geofence', 400, { field: 'lat', params: { meters: GEOFENCE_M } })
      return
    case 'serviceOtp':
      return checkOtp('service', input.otp, original)
    case 'deliveryOtp':
      return checkOtp('delivery', input.otp, original)
    case 'pickupChecklist':
      return
    case 'pickupPhotos':
      return checkPickup(merged)
    case 'quote':
      return checkQuote(merged, 'partner')
    case 'payment':
      return
  }
}

/** The status validator: every booking write passes through here, whoever makes it. */
async function enforce(data: Booking, original: Booking, ctx: WriteCtx) {
  const now = new Date()
  const nowIso = now.toISOString()
  const from = original.status as BookingStatus
  const flow = original.flow as BookingFlow
  const target = (data.status ?? from) as BookingStatus
  const merged = { ...original, ...data }
  const newAssignee = idOf(data.assignedPartner)
  if (from === target) return data

  const input = ctx.transition ?? {}
  switch (ctx.actor) {
    case 'customer':
      if (!customerCan(flow, from, target)) throw new DomainError('transition_not_allowed', 409)
      break
    case 'dispatcher':
      if (!(from === 'BOOKED' && target === 'PARTNER_ASSIGNED' && newAssignee)) throw new DomainError('transition_not_allowed', 409)
      break
    case 'system':
      if (!canTransition(flow, from, target) && !isOperationalEdge(flow, from, target)) throw new DomainError('transition_not_allowed', 409)
      if (from === 'BOOKED' && target === 'PARTNER_ASSIGNED' && !idOf(merged.assignedPartner)) throw new DomainError('assignee_required', 400)
      break
    case 'partner': {
      const partner = ctx.partner ? await getDoc<Partner>('partners', ctx.partner.id) : null
      if (!partner) throw new DomainError('unauthorized', 401)
      if (partner.accountStatus !== 'active' || partner.verificationStatus !== 'approved') throw new DomainError('partner_inactive', 403)
      if (idOf(original.assignedPartner) !== partner.id) throw new DomainError('not_assigned', 403)
      if (target === 'BOOKED') {
        if (!canRelease(flow, from)) throw new DomainError('cannot_release', 409)
        if (!input.releaseReason) throw new DomainError('reason_required', 400, { field: 'reason' })
      } else if (target === 'CANCELLED') {
        if (!input.noShow || from !== noShowFrom(flow)) throw new DomainError('transition_not_allowed', 409)
        if (!original.arrivedAt) throw new DomainError('not_arrived', 409)
        const waited = now.getTime() - new Date(original.arrivedAt).getTime()
        if (waited < NO_SHOW_WAIT_MS) throw new DomainError('wait_longer', 409, { params: { minutes: Math.ceil((NO_SHOW_WAIT_MS - waited) / 60000) } })
        if (!within(input.lat, input.lng, original)) throw new DomainError('outside_geofence', 400, { field: 'lat', params: { meters: GEOFENCE_M } })
        const category = await getDoc<Booking>('service-categories', idOf(original.category))
        data.noShow = { markedAt: nowIso, waitedMinutes: Math.floor(waited / 60000) }
        data.cancellation = { reason: 'customer_no_show', at: nowIso }
        data.pricing = { ...original.pricing, ...data.pricing, cancelFeePaise: category?.pricing?.cancelAfterAssignFeePaise ?? 0 }
      } else {
        const edge = partnerEdge(flow, partner.role as PartnerRole, from, target, { declined: original.quote?.outcome === 'declined' })
        if (!edge) throw new DomainError('transition_not_allowed', 409)
        for (const need of edge.requires) await requirementCheck(need, merged, original, input)
      }
      break
    }
  }

  if (target === 'QUOTE_SENT' && ctx.actor !== 'partner') await checkQuote(merged, ctx.actor)
  if (target === 'COMPLETED') {
    const collected = Boolean(merged.paymentCollection?.collectedAt)
    if (!collected && merged.payment?.status !== 'paid') throw new DomainError('payment_required', 409, { field: 'payment' })
  }

  // Effects of entering the new status.
  data.statusChangedAt = nowIso
  if (target === 'ARRIVED') data.arrivedAt = original.arrivedAt ?? nowIso
  if (target === 'IN_PROGRESS') data.startedAt = original.startedAt ?? nowIso
  if ((target === 'ARRIVED' || target === 'PICKED_UP') && original.promisedBy && !original.slaBreached) {
    const at = target === 'PICKED_UP' && original.arrivedAt ? new Date(original.arrivedAt) : now
    if (at.getTime() > new Date(original.promisedBy).getTime()) {
      const config = await getConfig()
      data.slaBreached = true
      data.slaCreditPaise = config.rewards?.slaCreditPaise ?? 0
    }
  }
  if (target === 'QUOTE_SENT') data.quote = { ...original.quote, ...data.quote, sentAt: nowIso, outcome: null }
  if (target === 'APPROVED') {
    data.quote = { ...original.quote, ...data.quote, respondedAt: nowIso, outcome: 'approved' }
    data.pricing = { ...original.pricing, ...data.pricing, finalPaise: merged.quote?.totalPaise ?? 0 }
  }
  if (target === 'DECLINED') data.quote = { ...original.quote, ...data.quote, respondedAt: nowIso, outcome: 'declined' }
  if (target === 'AT_HUB') {
    data.assignedPartner = null
    data.dispatch = { leg: 'hub', round: original.dispatch?.round ?? 0, attempts: 0, startedAt: null, lastOfferAt: null }
  }
  if (target === 'OUT_FOR_DELIVERY') {
    data.assignedPartner = null
    data.deliveryOtp = String(randomInt(1000, 10000))
    data.otpAttempts = { ...original.otpAttempts, delivery: 0 }
    data.needsManualAssignment = false
    data.dispatch = { leg: 'delivery', round: original.dispatch?.round ?? 0, attempts: 0, startedAt: null, lastOfferAt: null }
  }
  if (target === 'BOOKED') {
    ctx.releasedBy = idOf(original.assignedPartner)
    ctx.releasedRound = original.dispatch?.round ?? 0
    data.assignedPartner = null
    if (flow === 'pickup_drop') data.riderPartner = null
    data.partner = { name: null, rating: null, maskedPhone: null, etaMinutes: null }
    data.promisedBy = null
    data.arrivedAt = null
    data.needsManualAssignment = false
    data.dispatch = { leg: dispatchLegFor(flow, 'BOOKED'), round: (original.dispatch?.round ?? 0) + 1, attempts: 0, startedAt: null, lastOfferAt: null }
  }
  if (target === 'COMPLETED' && !merged.pricing?.finalPaise) {
    data.pricing = { ...original.pricing, ...data.pricing, finalPaise: merged.paymentCollection?.amountPaise ?? original.pricing?.estimateMaxPaise }
  }
  if (target === 'COMPLETED' || target === 'RETURNED') data.completedAt = nowIso
  return data
}

/* ------------------------------------------------------------------ writes */

/** Creates a booking (customer checkout). Status, dispatch state and the event row are server-set. */
export async function createBooking(data: Booking, ctx: WriteCtx) {
  const nowIso = nowISO()
  const doc = await createDoc('bookings', {
    ...data,
    status: 'BOOKED',
    statusChangedAt: nowIso,
    dispatch: { leg: dispatchLegFor(data.flow, 'BOOKED'), round: 0, attempts: 0 },
  })
  await runEffects(doc, null, ctx)
  return doc
}

/**
 * Updates one booking under its lock. `change` receives the current document and returns the
 * fields to write (shallow merge, like Payload); `where` makes the write conditional. Returns
 * null when `where` rejected the current state.
 */
export async function updateBooking(
  id: string,
  ctx: WriteCtx,
  change: (current: Booking) => Booking | Promise<Booking>,
  where?: (current: Booking) => boolean,
): Promise<Booking | null> {
  const result = await withLock(`booking:${id}`, async () => {
    const original = await getDoc<Booking>('bookings', id)
    if (!original) throw new DomainError('not_found', 404)
    if (where && !where(original)) return null
    const data = await enforce({ ...(await change(original)) }, original, ctx)
    const saved = await saveDoc('bookings', { ...original, ...data }, original)
    return { saved, original }
  })
  if (!result) return null
  await runEffects(result.saved, result.original, ctx)
  return result.saved
}

async function safely(label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (err) {
    console.error(`booking effect failed: ${label}`, err)
  }
}

export async function updatePartner(id: string, fn: (p: Partner) => Partner | Promise<Partner>) {
  return withLock(`partner:${id}`, async () => {
    const p = await getDoc<Partner>('partners', id)
    if (!p) return null
    const patch = await fn(p)
    if (!patch || Object.keys(patch).length === 0) return p
    const next = { ...p, ...patch }
    // Only approved + active partners can be online.
    if (next.verificationStatus !== 'approved' || next.accountStatus !== 'active') next.isOnline = false
    return saveDoc('partners', next, p)
  })
}

export async function updateUser(id: string, fn: (u: Booking) => Booking | Promise<Booking>) {
  return withLock(`user:${id}`, async () => {
    const u = await getDoc<Booking>('users', id)
    if (!u) return null
    return saveDoc('users', { ...u, ...(await fn(u)) }, u)
  })
}

async function clearCurrentJob(partnerId: string, bookingId: string) {
  await updatePartner(partnerId, (p) => (idOf(p.currentJob) === bookingId ? { currentJob: null } : {}))
}

/** Side effects of a booking write (the Payload recordEvents hook). */
async function runEffects(doc: Booking, prev: Booking | null, ctx: WriteCtx) {
  if (ctx.skipEvents) return
  const created = prev === null
  const statusChanged = created || prev.status !== doc.status
  const actor = ctx.actor === 'dispatcher' ? 'system' : ctx.actor

  if (statusChanged) {
    await createDoc('booking-events', {
      booking: doc.id,
      status: doc.status,
      actor,
      partner: ctx.actor === 'partner' ? (ctx.partner?.id ?? null) : null,
      note: ctx.eventNote ? ctx.eventNote.slice(0, 250) : null,
    })
  }

  if (created) {
    if (doc.schedule?.mode === 'asap') await safely('dispatch on create', () => dispatchBooking(doc.id))
    return
  }

  const prevAssigned = idOf(prev.assignedPartner)
  const nowAssigned = idOf(doc.assignedPartner)
  if (prevAssigned && prevAssigned !== nowAssigned) await safely('free partner', () => clearCurrentJob(prevAssigned, doc.id))
  if (nowAssigned && TERMINAL.includes(doc.status)) await safely('free partner', () => clearCurrentJob(nowAssigned, doc.id))

  if (statusChanged) {
    const status = doc.status as BookingStatus
    if (status === 'CANCELLED') await safely('withdraw offers', () => withdrawOpenOffers(doc.id))
    if (status === 'BOOKED' && ctx.releasedBy) {
      const releasedBy = ctx.releasedBy
      await safely('release', async () => {
        await withdrawOpenOffers(doc.id)
        await penalizeRelease(releasedBy, doc, Number(ctx.releasedRound ?? 0), ctx.transition?.releaseReason)
        await dispatchBooking(doc.id)
      })
    }
    if (status === 'AT_HUB' || status === 'OUT_FOR_DELIVERY') await safely('dispatch next leg', () => dispatchBooking(doc.id))
    if (status === 'COMPLETED') {
      await safely('completion ledger', () => writeCompletionLedger(doc))
      const worker = doc.flow === 'pickup_drop' ? idOf(doc.hubPartner) : idOf(doc.assignedPartner)
      if (worker) {
        await safely('partner stats', () =>
          updatePartner(worker, (p) => {
            const stats = p.stats ?? {}
            const done = (stats.jobsCompleted ?? 0) + 1
            const released = stats.jobsReleased ?? 0
            return { stats: { ...stats, jobsCompleted: done }, completionRate: Math.round((done / (done + released)) * 100) }
          }),
        )
      }
    }
  }

  // SLA breach: credit the customer's dwaar Cash once.
  if (doc.slaBreached && !prev.slaBreached && (doc.slaCreditPaise ?? 0) > 0) {
    await safely('sla credit', () => updateUser(idOf(doc.customer) as string, (u) => ({ walletPaise: (u.walletPaise ?? 0) + (doc.slaCreditPaise ?? 0) })))
  }

  // Customer rated the job: roll it into the partner's average.
  if (doc.rating?.stars && !prev.rating?.stars) {
    const rated = new Set([idOf(doc.assignedPartner), idOf(doc.hubPartner)].filter((x): x is string => Boolean(x)))
    for (const pid of rated) {
      await safely('partner rating', () =>
        updatePartner(pid, (p) => {
          const count = (p.ratingCount ?? 0) + 1
          const avg = ((p.rating ?? 0) * (p.ratingCount ?? 0) + (doc.rating?.stars ?? 0)) / count
          return { rating: Math.round(avg * 100) / 100, ratingCount: count }
        }),
      )
    }
  }

  // Warranty starts when the job completes.
  const warrantyDays = doc.warrantyDays ?? 0
  if (statusChanged && doc.status === 'COMPLETED' && warrantyDays > 0) {
    await safely('warranty', async () => {
      const existing = await find('warranties', 'booking', doc.id)
      if (existing.length > 0) return
      const start = new Date()
      await createDoc('warranties', {
        booking: doc.id,
        customer: idOf(doc.customer),
        title: doc.title ?? 'Repair',
        deviceLabel: doc.deviceLabel ?? '',
        days: warrantyDays,
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + warrantyDays * 86_400_000).toISOString(),
        status: 'active',
        claimsUsed: 0,
      })
    })
  }
}

/* ---------------------------------------------------------------- dispatch */

const DISPATCHER: WriteCtx = { actor: 'dispatcher', skipEvents: true }

function rate(accepted: number, received: number) {
  return received > 0 ? Math.round((accepted / received) * 100) : 100
}

async function targetFor(booking: Booking, leg: DispatchLeg) {
  const config = await getConfig()
  const hub = { lat: config.zone?.centerLat ?? 28.4683, lng: config.zone?.centerLng ?? 77.0629, supportPhone: config.support?.phone ?? null }
  if (leg === 'hub') return hub
  const lat = booking.address?.lat
  const lng = booking.address?.lng
  return isNum(lat) && isNum(lng) ? { lat, lng, supportPhone: hub.supportPhone } : hub
}

/** A driving licence on file must still be valid for riders and mechanics. */
export async function hasValidLicence(partner: Partner) {
  if (!needsDrivingLicence(partner.role)) return true
  const docs = (await find<Booking>('partner-documents', 'owner', partner.id))
    .filter((d) => d.type === 'driving_licence' && d.status === 'approved')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const dl = docs[0]
  if (!dl) return false
  return !dl.expiresAt || new Date(dl.expiresAt).getTime() > Date.now()
}

/** Reasons a partner may not be online right now, or null if they may. */
export async function onlineBlocker(partner: Partner) {
  if (partner.accountStatus !== 'active') return 'account_inactive'
  if (partner.verificationStatus === 'suspended') return 'account_suspended'
  if (partner.verificationStatus !== 'approved') return 'not_approved'
  if (!(await hasValidLicence(partner))) return 'licence_expired'
  return null
}

function windowOf(b: Booking) {
  const start = new Date(b.schedule?.startAt ?? b.createdAt).getTime()
  const end = new Date(b.schedule?.endAt ?? start + 60 * 60 * 1000).getTime()
  return { start, end }
}

/**
 * Eligible partners for a leg, best first: approved + active + online and fresh, right role and
 * category, free, within their own service radius. Distance 60%, rating 25%, acceptance 15%.
 */
export async function rankCandidates(booking: Booking, leg: DispatchLeg, exclude: Set<string>) {
  const role = roleForLeg(booking.flow as BookingFlow, leg)
  const categoryId = idOf(booking.category)
  const target = await targetFor(booking, leg)
  const fresh = Date.now() - ONLINE_FRESH_MS
  const pool = (await find<Partner>('partners', 'role', role)).filter(
    (p) =>
      p.verificationStatus === 'approved' &&
      p.accountStatus === 'active' &&
      p.isOnline === true &&
      p.lastSeenAt &&
      new Date(p.lastSeenAt).getTime() > fresh &&
      (!categoryId || ((p.categories ?? []) as unknown[]).map(idOf).includes(categoryId)) &&
      !exclude.has(p.id) &&
      isNum(p.lastLat) &&
      isNum(p.lastLng),
  )
  if (pool.length === 0) return []
  const mine = windowOf(booking)
  const scheduled = booking.schedule?.mode === 'scheduled' && leg !== 'hub' && leg !== 'delivery'
  const out: { partner: Partner; km: number; score: number }[] = []
  for (const p of pool) {
    const busy = (await find<Booking>('bookings', 'assignedPartner', p.id)).filter((b) => b.id !== booking.id && !TERMINAL.includes(b.status))
    if (!scheduled && busy.length > 0) continue
    if (scheduled && busy.some((b) => windowOf(b).start < mine.end && mine.start < windowOf(b).end)) continue
    if (!scheduled && idOf(p.currentJob) && idOf(p.currentJob) !== booking.id) continue
    if (!(await hasValidLicence(p))) continue
    const km = distanceKm(p.lastLat, p.lastLng, target.lat, target.lng)
    const radius = p.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM
    if (km > radius) continue
    const closeness = Math.max(0, 1 - km / radius)
    const rating = (p.ratingCount ?? 0) > 0 ? (p.rating ?? 0) / 5 : 0.9
    const acceptance = (p.acceptanceRate ?? 100) / 100
    out.push({ partner: p, km, score: RANK_WEIGHTS.distance * closeness + RANK_WEIGHTS.rating * rating + RANK_WEIGHTS.acceptance * acceptance })
  }
  return out.sort((a, b) => b.score - a.score || a.km - b.km)
}

export function isDispatchDue(booking: Booking, leg: DispatchLeg, now = Date.now()) {
  if (leg === 'hub' || leg === 'delivery') return true
  if (booking.schedule?.mode !== 'scheduled' || !booking.schedule.startAt) return true
  return new Date(booking.schedule.startAt).getTime() - SCHEDULED_DISPATCH_LEAD_MS <= now
}

/**
 * Offers the booking's open leg to the next best partner, one at a time. Idempotent. After 5
 * offers or 10 minutes it flags needsManualAssignment.
 */
export async function dispatchBooking(bookingId: string): Promise<Booking | null> {
  const booking = await getDoc<Booking>('bookings', bookingId)
  if (!booking) return null
  const leg = dispatchLegFor(booking.flow as BookingFlow, booking.status as BookingStatus)
  if (!leg || idOf(booking.assignedPartner) || booking.needsManualAssignment) return null
  if (!isDispatchDue(booking, leg)) return null

  const now = Date.now()
  const round = booking.dispatch?.round ?? 0
  const prior = (await find<Booking>('job-offers', 'booking', booking.id)).filter((o) => o.leg === leg && (o.round ?? 0) === round)
  if (prior.some((o) => o.status === 'offered' && new Date(o.expiresAt).getTime() > now)) return null
  if (prior.some((o) => o.status === 'accepted')) return null

  const sameLeg = booking.dispatch?.leg === leg && (booking.dispatch?.round ?? 0) === round
  const startedAt = sameLeg && booking.dispatch?.startedAt ? new Date(booking.dispatch.startedAt).getTime() : null
  const attempts = prior.length
  if (attempts >= MAX_OFFER_ATTEMPTS || (startedAt && now - startedAt >= MANUAL_ASSIGN_AFTER_MS)) {
    await updateBooking(booking.id, DISPATCHER, (b) => ({ needsManualAssignment: true, dispatch: { ...b.dispatch, leg, round, attempts } }))
    return null
  }

  const exclude = new Set(prior.map((o) => idOf(o.partner)).filter((x): x is string => Boolean(x)))
  const [best] = await rankCandidates(booking, leg, exclude)
  const dispatchState = { leg, round, attempts, startedAt: new Date(startedAt ?? now).toISOString(), lastOfferAt: booking.dispatch?.lastOfferAt ?? null }
  if (!best) {
    if (!startedAt) await updateBooking(booking.id, DISPATCHER, () => ({ dispatch: dispatchState }))
    return null
  }

  const { pay } = await getPartnerPay()
  let offer: Booking
  try {
    offer = await createDoc('job-offers', {
      booking: booking.id,
      partner: best.partner.id,
      leg,
      round,
      status: 'offered',
      offeredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + OFFER_TTL_MS).toISOString(),
      distanceKm: Math.round(best.km * 100) / 100,
      estimatedEarningPaise: estimateEarningPaise(booking, leg, pay),
      rank: attempts + 1,
      offerKey: `${booking.id}:${leg}:${round}:${best.partner.id}`,
      acceptLock: null,
      manual: false,
    })
  } catch (err) {
    if (err instanceof UniqueViolation) return null
    throw err
  }
  await updateBooking(booking.id, DISPATCHER, () => ({ dispatch: { ...dispatchState, attempts: attempts + 1, lastOfferAt: offer.offeredAt } }))
  await updatePartner(best.partner.id, (p) => {
    const stats = p.stats ?? {}
    const received = (stats.offersReceived ?? 0) + 1
    return { stats: { ...stats, offersReceived: received }, acceptanceRate: rate(stats.offersAccepted ?? 0, received) }
  })
  return offer
}

/** Moves an offer that is still open; concurrent closers cannot double-count. */
async function closeOffer(offerId: string, status: 'expired' | 'withdrawn' | 'declined', extra: Booking = {}) {
  return withLock(`offer:${offerId}`, async () => {
    const offer = await getDoc<Booking>('job-offers', offerId)
    if (!offer || offer.status !== 'offered') return false
    await saveDoc('job-offers', { ...offer, status, respondedAt: status === 'declined' ? nowISO() : (offer.respondedAt ?? null), ...extra }, offer)
    return true
  })
}

export async function withdrawOpenOffers(bookingId: string, exceptId?: string) {
  for (const o of await find<Booking>('job-offers', 'booking', bookingId)) {
    if (o.status === 'offered' && o.id !== exceptId) await closeOffer(o.id, 'withdrawn')
  }
}

let lastSweep = 0
const SWEEP_EVERY_MS = 3000

/**
 * Lazy runner, called on partner polls and booking reads: expires overdue offers (offering the
 * next partner) and dispatches due legs that have no open offer. Idempotent.
 */
export async function advanceDispatch(opts: { bookingId?: string } = {}) {
  const now = Date.now()
  const sweep = now - lastSweep >= SWEEP_EVERY_MS
  if (!sweep && !opts.bookingId) return
  if (sweep) lastSweep = now
  const kick = new Set<string>()
  const open = sweep ? await find<Booking>('job-offers', 'status', 'offered') : (await find<Booking>('job-offers', 'booking', opts.bookingId)).filter((o) => o.status === 'offered')
  for (const o of open) {
    if (new Date(o.expiresAt).getTime() > now) continue
    if (await closeOffer(o.id, 'expired')) {
      const b = idOf(o.booking)
      if (b) kick.add(b)
    }
  }
  if (opts.bookingId) kick.add(opts.bookingId)
  if (sweep) {
    for (const status of ['BOOKED', 'AT_HUB', 'OUT_FOR_DELIVERY']) {
      for (const b of await find<Booking>('bookings', 'status', status)) {
        if (idOf(b.assignedPartner) || b.needsManualAssignment) continue
        const leg = dispatchLegFor(b.flow as BookingFlow, b.status as BookingStatus)
        if (leg && isDispatchDue(b, leg)) kick.add(b.id)
      }
    }
  }
  for (const id of kick) {
    try {
      await dispatchBooking(id)
    } catch (err) {
      console.error(`dispatch failed for booking ${id}`, err)
    }
  }
}

/** Booking fields written when a partner takes a leg. */
export async function buildAssignment(booking: Booking, partner: Partner, leg: DispatchLeg, km?: number): Promise<Booking> {
  const target = await targetFor(booking, leg)
  const dist = km ?? (isNum(partner.lastLat) && isNum(partner.lastLng) ? distanceKm(partner.lastLat, partner.lastLng, target.lat, target.lng) : 3)
  const eta = etaMinutesFor(dist)
  const slotEnd = booking.schedule?.mode === 'scheduled' ? (booking.schedule.endAt ?? booking.schedule.startAt) : null
  const promisedBy = slotEnd && new Date(slotEnd).getTime() > Date.now() + eta * 60_000 ? slotEnd : new Date(Date.now() + (eta + 10) * 60_000).toISOString()
  return {
    assignedPartner: partner.id,
    needsManualAssignment: false,
    ...(leg === 'visit' || leg === 'pickup' ? { status: 'PARTNER_ASSIGNED', promisedBy } : {}),
    ...(leg === 'pickup' || leg === 'delivery' ? { riderPartner: partner.id } : {}),
    ...(leg === 'hub' ? { hubPartner: partner.id } : {}),
    ...(leg === 'hub'
      ? {}
      : {
          partner: {
            name: partner.name ?? 'dwaar partner',
            rating: (partner.ratingCount ?? 0) > 0 ? partner.rating : null,
            // Calls go through the hub's bridged number; neither side sees the other's phone.
            maskedPhone: target.supportPhone ?? null,
            etaMinutes: eta,
          },
        }),
  }
}

/** Writes the assignment, conditional on the leg still being open and nobody assigned. */
export async function assignPartner(booking: Booking, partner: Partner, leg: DispatchLeg, km?: number) {
  const legStatus = LEG_STATUS[leg]
  return updateBooking(
    booking.id,
    { actor: 'dispatcher', eventNote: `Accepted by ${partner.name ?? 'partner'}` },
    (current) => buildAssignment(current, partner, leg, km),
    (current) => current.status === legStatus && !idOf(current.assignedPartner),
  )
}

/**
 * First write wins: the offer takes the unique acceptLock for (booking, leg, round), so a second
 * accept for the same leg fails atomically. Other open offers for the booking are withdrawn.
 */
export async function acceptOffer(partner: Partner, offerId: string) {
  const offer = await getDoc<Booking>('job-offers', offerId)
  if (!offer || idOf(offer.partner) !== partner.id) throw new DomainError('not_found', 404)
  if (offer.status === 'expired') throw new DomainError('offer_expired', 409)
  if (offer.status !== 'offered') throw new DomainError(offer.status === 'withdrawn' ? 'already_assigned' : 'offer_not_open', 409)
  if (new Date(offer.expiresAt).getTime() <= Date.now()) {
    if (await closeOffer(offer.id, 'expired')) await dispatchBooking(idOf(offer.booking) as string)
    throw new DomainError('offer_expired', 409)
  }
  const blocker = await onlineBlocker(partner)
  if (blocker) throw new DomainError(blocker, 403)

  const bookingId = idOf(offer.booking) as string
  const booking = await getDoc<Booking>('bookings', bookingId)
  if (!booking) throw new DomainError('not_found', 404)
  const leg = offer.leg as DispatchLeg
  if (booking.status !== LEG_STATUS[leg] || idOf(booking.assignedPartner)) {
    await closeOffer(offer.id, 'withdrawn')
    throw new DomainError('already_assigned', 409)
  }

  const lockKey = `${bookingId}:${leg}:${offer.round ?? 0}`
  const locked = await withLock(`offer:${offer.id}`, async () => {
    const current = await getDoc<Booking>('job-offers', offer.id)
    if (!current) throw new DomainError('not_found', 404)
    if (current.status !== 'offered') return current.status === 'expired' ? 'offer_expired' : current.status === 'withdrawn' ? 'already_assigned' : 'offer_not_open'
    try {
      await saveDoc('job-offers', { ...current, status: 'accepted', respondedAt: nowISO(), acceptLock: lockKey }, current)
    } catch (err) {
      if (err instanceof UniqueViolation) return 'already_assigned'
      throw err
    }
    return null
  })
  if (locked) {
    if (locked === 'already_assigned') await closeOffer(offer.id, 'withdrawn')
    throw new DomainError(locked, 409)
  }

  const assigned = await assignPartner(booking, partner, leg, offer.distanceKm ?? 0)
  if (!assigned) {
    const current = await getDoc<Booking>('job-offers', offer.id)
    if (current) await saveDoc('job-offers', { ...current, status: 'withdrawn', acceptLock: null }, current)
    throw new DomainError('already_assigned', 409)
  }
  await withdrawOpenOffers(bookingId, offer.id)
  await updatePartner(partner.id, (p) => {
    const stats = p.stats ?? {}
    const accepted = (stats.offersAccepted ?? 0) + 1
    return {
      stats: { ...stats, offersAccepted: accepted },
      acceptanceRate: rate(accepted, Math.max(accepted, stats.offersReceived ?? 0)),
      ...(idOf(p.currentJob) ? {} : { currentJob: bookingId }),
    }
  })
  return { booking: assigned, offer: { ...offer, status: 'accepted' } }
}

export async function penalizeRelease(partnerId: string, booking: Booking, round: number, reason: string | undefined) {
  await writeReleasePenalty({ partner: partnerId, booking, round, reason })
  await updatePartner(partnerId, (p) => {
    const stats = p.stats ?? {}
    return {
      reliabilityScore: Math.max(0, (p.reliabilityScore ?? 100) - RELEASE_RELIABILITY_DROP),
      stats: { ...stats, jobsReleased: (stats.jobsReleased ?? 0) + 1 },
      ...(idOf(p.currentJob) === booking.id ? { currentJob: null } : {}),
    }
  })
}

/** Gives back a hub or delivery leg: drop the assignee, penalise, re-dispatch. */
export async function releaseNonVisitLeg(booking: Booking, partner: Partner, reason: string) {
  const leg = dispatchLegFor(booking.flow as BookingFlow, booking.status as BookingStatus)
  if (!leg || (leg !== 'hub' && leg !== 'delivery') || idOf(booking.assignedPartner) !== partner.id) throw new DomainError('cannot_release', 409)
  const round = (booking.dispatch?.round ?? 0) + 1
  await updateBooking(booking.id, DISPATCHER, () => ({
    assignedPartner: null,
    ...(leg === 'hub' ? { hubPartner: null } : {}),
    dispatch: { leg, round, attempts: 0, startedAt: null, lastOfferAt: null },
  }))
  await clearCurrentJob(partner.id, booking.id)
  await penalizeRelease(partner.id, booking, round - 1, reason)
  await dispatchBooking(booking.id)
}

export async function declineOffer(partner: Partner, offerId: string, reason: string) {
  const offer = await getDoc<Booking>('job-offers', offerId)
  if (!offer || idOf(offer.partner) !== partner.id) throw new DomainError('not_found', 404)
  if (offer.status !== 'offered') throw new DomainError(offer.status === 'expired' ? 'offer_expired' : 'offer_not_open', 409)
  if (!(await closeOffer(offer.id, 'declined', { declineReason: reason }))) throw new DomainError('offer_not_open', 409)
  await dispatchBooking(idOf(offer.booking) as string)
  return offer
}
