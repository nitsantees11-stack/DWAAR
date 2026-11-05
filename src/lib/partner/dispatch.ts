import type { Payload, PayloadRequest } from 'payload'
import type { Booking, JobOffer, Partner, PartnerDocument } from '@/payload-types'
import {
  LEG_STATUS,
  dispatchLegFor,
  roleForLeg,
  type BookingFlow,
  type BookingStatus,
  type DispatchLeg,
} from '../booking-machine'
import { distanceKm, etaMinutesFor, isNum } from '../geo'
import {
  DEFAULT_SERVICE_RADIUS_KM,
  MANUAL_ASSIGN_AFTER_MS,
  MAX_OFFER_ATTEMPTS,
  OFFER_TTL_MS,
  ONLINE_FRESH_MS,
  RANK_WEIGHTS,
  RELEASE_RELIABILITY_DROP,
  SCHEDULED_DISPATCH_LEAD_MS,
  needsDrivingLicence,
} from './constants'
import { estimateEarningPaise, getPartnerPay, writeReleasePenalty } from './ledger'
import { DomainError, idOf, isUniqueViolation, nowISO, subReq } from './sys'

const DISPATCHER = { actor: 'dispatcher', skipBookingEvents: true }
const TERMINAL: BookingStatus[] = ['COMPLETED', 'RETURNED', 'CANCELLED']

function rate(accepted: number, received: number) {
  return received > 0 ? Math.round((accepted / received) * 100) : 100
}

async function loadBooking(payload: Payload, id: string, req?: PayloadRequest) {
  try {
    return (await payload.findByID({ collection: 'bookings', id, overrideAccess: true, depth: 0, req: subReq(req) })) as Booking
  } catch {
    return null
  }
}

/** Where the partner of a leg has to go: the customer for visits/pickups, the hub for hub repairs. */
async function targetFor(payload: Payload, booking: Booking, leg: DispatchLeg, req?: PayloadRequest) {
  const { config } = await getPartnerPay(payload, req)
  const hub = { lat: config.zone?.centerLat ?? 28.4683, lng: config.zone?.centerLng ?? 77.0629 }
  if (leg === 'hub') return { ...hub, supportPhone: config.support?.phone ?? null }
  const lat = booking.address?.lat
  const lng = booking.address?.lng
  return isNum(lat) && isNum(lng) ? { lat, lng, supportPhone: config.support?.phone ?? null } : { ...hub, supportPhone: config.support?.phone ?? null }
}

/** A driving licence on file must still be valid for riders and mechanics. */
export async function hasValidLicence(payload: Payload, partner: Pick<Partner, 'id' | 'role'>, req?: PayloadRequest) {
  if (!needsDrivingLicence(partner.role)) return true
  const { docs } = await payload.find({
    collection: 'partner-documents',
    overrideAccess: true,
    req: subReq(req),
    depth: 0,
    limit: 1,
    sort: '-createdAt',
    where: {
      and: [
        { owner: { equals: partner.id } },
        { type: { equals: 'driving_licence' } },
        { status: { equals: 'approved' } },
      ],
    },
  })
  const dl = docs[0] as PartnerDocument | undefined
  if (!dl) return false
  return !dl.expiresAt || new Date(dl.expiresAt).getTime() > Date.now()
}

/** Reasons a partner may not be online right now, or null if they may. */
export async function onlineBlocker(payload: Payload, partner: Partner, req?: PayloadRequest) {
  if (partner.accountStatus !== 'active') return 'account_inactive'
  if (partner.verificationStatus === 'suspended') return 'account_suspended'
  if (partner.verificationStatus !== 'approved') return 'not_approved'
  if (!(await hasValidLicence(payload, partner, req))) return 'licence_expired'
  return null
}

interface Candidate {
  partner: Partner
  km: number
  score: number
}

function windowOf(b: Pick<Booking, 'schedule' | 'createdAt'>) {
  const start = new Date(b.schedule?.startAt ?? b.createdAt).getTime()
  const end = new Date(b.schedule?.endAt ?? start + 60 * 60 * 1000).getTime()
  return { start, end }
}

/**
 * Eligible partners for a leg, best first: approved + active + online and fresh, right role
 * and category, free (no current job for ASAP, no overlapping job for scheduled), within their
 * own service radius. Ranked by distance 60%, rating 25%, acceptance rate 15%.
 */
export async function rankCandidates(
  payload: Payload,
  booking: Booking,
  leg: DispatchLeg,
  exclude: Set<string>,
  req?: PayloadRequest,
): Promise<Candidate[]> {
  const flow = booking.flow as BookingFlow
  const role = roleForLeg(flow, leg)
  const categoryId = idOf(booking.category)
  const target = await targetFor(payload, booking, leg, req)
  const { docs } = await payload.find({
    collection: 'partners',
    overrideAccess: true,
    req: subReq(req),
    depth: 0,
    limit: 200,
    where: {
      and: [
        { verificationStatus: { equals: 'approved' } },
        { accountStatus: { equals: 'active' } },
        { isOnline: { equals: true } },
        { role: { equals: role } },
        { lastSeenAt: { greater_than: new Date(Date.now() - ONLINE_FRESH_MS).toISOString() } },
        ...(categoryId ? [{ categories: { in: [categoryId] } }] : []),
      ],
    },
  })
  const pool = (docs as Partner[]).filter((p) => !exclude.has(p.id) && isNum(p.lastLat) && isNum(p.lastLng))
  if (pool.length === 0) return []

  // Busy check: other live bookings already assigned to these partners.
  const { docs: busy } = await payload.find({
    collection: 'bookings',
    overrideAccess: true,
    req: subReq(req),
    depth: 0,
    pagination: false,
    select: { assignedPartner: true, schedule: true, createdAt: true, status: true },
    where: {
      and: [
        { assignedPartner: { in: pool.map((p) => p.id) } },
        { status: { not_in: TERMINAL } },
        { id: { not_equals: booking.id } },
      ],
    },
  })
  const mine = windowOf(booking)
  const scheduled = booking.schedule?.mode === 'scheduled' && leg !== 'hub' && leg !== 'delivery'
  const blocked = new Set<string>()
  for (const b of busy as Booking[]) {
    const pid = idOf(b.assignedPartner)
    if (!pid) continue
    if (!scheduled) {
      blocked.add(pid)
      continue
    }
    const w = windowOf(b)
    if (w.start < mine.end && mine.start < w.end) blocked.add(pid)
  }

  const out: Candidate[] = []
  for (const p of pool) {
    if (blocked.has(p.id)) continue
    if (!scheduled && idOf(p.currentJob) && idOf(p.currentJob) !== booking.id) continue
    if (!(await hasValidLicence(payload, p, req))) continue
    const km = distanceKm(p.lastLat as number, p.lastLng as number, target.lat, target.lng)
    const radius = p.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM
    if (km > radius) continue
    const closeness = Math.max(0, 1 - km / radius)
    const rating = (p.ratingCount ?? 0) > 0 ? (p.rating ?? 0) / 5 : 0.9
    const acceptance = (p.acceptanceRate ?? 100) / 100
    const score = RANK_WEIGHTS.distance * closeness + RANK_WEIGHTS.rating * rating + RANK_WEIGHTS.acceptance * acceptance
    out.push({ partner: p, km, score })
  }
  return out.sort((a, b) => b.score - a.score || a.km - b.km)
}

async function setDispatch(payload: Payload, booking: Booking, data: Partial<Booking>, req?: PayloadRequest) {
  await payload.update({
    collection: 'bookings',
    id: booking.id,
    overrideAccess: true,
    req: subReq(req, DISPATCHER),
    depth: 0,
    data,
  })
}

/** Whether a leg is due for dispatch now (scheduled jobs go out 60 minutes before the slot). */
export function isDispatchDue(booking: Pick<Booking, 'schedule'>, leg: DispatchLeg, now = Date.now()) {
  if (leg === 'hub' || leg === 'delivery') return true
  if (booking.schedule?.mode !== 'scheduled' || !booking.schedule.startAt) return true
  return new Date(booking.schedule.startAt).getTime() - SCHEDULED_DISPATCH_LEAD_MS <= now
}

/**
 * Offers the booking's open leg to the next best partner, one at a time. Idempotent: does
 * nothing while an offer is still open, once a partner is assigned, or once the hub has been
 * asked to assign manually. After 5 offers or 10 minutes it flags needsManualAssignment.
 */
export async function dispatchBooking(payload: Payload, bookingId: string, req?: PayloadRequest): Promise<JobOffer | null> {
  const booking = await loadBooking(payload, bookingId, req)
  if (!booking) return null
  const flow = booking.flow as BookingFlow
  const leg = dispatchLegFor(flow, booking.status as BookingStatus)
  if (!leg || idOf(booking.assignedPartner) || booking.needsManualAssignment) return null
  if (!isDispatchDue(booking, leg)) return null

  const now = Date.now()
  const round = booking.dispatch?.round ?? 0
  const { docs: prior } = await payload.find({
    collection: 'job-offers',
    overrideAccess: true,
    req: subReq(req),
    depth: 0,
    pagination: false,
    where: { and: [{ booking: { equals: booking.id } }, { leg: { equals: leg } }, { round: { equals: round } }] },
  })
  if (prior.some((o) => o.status === 'offered' && new Date(o.expiresAt).getTime() > now)) return null
  if (prior.some((o) => o.status === 'accepted')) return null

  const sameLeg = booking.dispatch?.leg === leg && (booking.dispatch?.round ?? 0) === round
  const startedAt = sameLeg && booking.dispatch?.startedAt ? new Date(booking.dispatch.startedAt).getTime() : null
  const attempts = prior.length
  if (attempts >= MAX_OFFER_ATTEMPTS || (startedAt && now - startedAt >= MANUAL_ASSIGN_AFTER_MS)) {
    await setDispatch(payload, booking, { needsManualAssignment: true, dispatch: { ...booking.dispatch, leg, round, attempts } }, req)
    return null
  }

  const exclude = new Set(prior.map((o) => idOf(o.partner)).filter((x): x is string => Boolean(x)))
  const [best] = await rankCandidates(payload, booking, leg, exclude, req)
  const dispatchState = { leg, round, attempts, startedAt: new Date(startedAt ?? now).toISOString(), lastOfferAt: booking.dispatch?.lastOfferAt }
  if (!best) {
    if (!startedAt) await setDispatch(payload, booking, { dispatch: dispatchState }, req)
    return null
  }

  const { pay } = await getPartnerPay(payload, req)
  let offer: JobOffer
  try {
    offer = (await payload.create({
      collection: 'job-offers',
      overrideAccess: true,
      req: subReq(req),
      depth: 0,
      data: {
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
      },
    })) as JobOffer
  } catch (err) {
    if (isUniqueViolation(err)) return null
    throw err
  }
  await setDispatch(payload, booking, { dispatch: { ...dispatchState, attempts: attempts + 1, lastOfferAt: offer.offeredAt } }, req)
  const stats = best.partner.stats ?? {}
  const received = (stats.offersReceived ?? 0) + 1
  await payload.update({
    collection: 'partners',
    id: best.partner.id,
    overrideAccess: true,
    req: subReq(req),
    depth: 0,
    data: { stats: { ...stats, offersReceived: received }, acceptanceRate: rate(stats.offersAccepted ?? 0, received) },
  })
  return offer
}

async function closeOffer(payload: Payload, offer: JobOffer, status: 'expired' | 'withdrawn' | 'declined', extra: Partial<JobOffer> = {}, req?: PayloadRequest) {
  // Conditional: only an offer that is still open moves, so concurrent closers cannot double-count.
  const res = await payload.update({
    collection: 'job-offers',
    overrideAccess: true,
    req: subReq(req),
    depth: 0,
    where: { and: [{ id: { equals: offer.id } }, { status: { equals: 'offered' } }] },
    data: { status, respondedAt: status === 'declined' ? nowISO() : undefined, ...extra },
  })
  return res.docs.length > 0
}

/** Withdraw every open offer for a booking (it was assigned, cancelled or released). */
export async function withdrawOpenOffers(payload: Payload, bookingId: string, req?: PayloadRequest, exceptId?: string) {
  const { docs } = await payload.find({
    collection: 'job-offers',
    overrideAccess: true,
    req: subReq(req),
    depth: 0,
    pagination: false,
    where: { and: [{ booking: { equals: bookingId } }, { status: { equals: 'offered' } }] },
  })
  for (const o of docs as JobOffer[]) if (o.id !== exceptId) await closeOffer(payload, o, 'withdrawn', {}, req)
}

let lastSweep = 0
const SWEEP_EVERY_MS = 3000

/**
 * Lazy runner, safe to call on every partner poll and every booking read: expires overdue
 * offers (and offers the next partner), then dispatches due legs that have no open offer
 * (new ASAP bookings with nobody online yet, scheduled bookings reaching T-60 min, hub and
 * delivery legs). Everything it does is idempotent.
 */
export async function advanceDispatch(payload: Payload, opts: { bookingId?: string } = {}) {
  const now = Date.now()
  const sweep = now - lastSweep >= SWEEP_EVERY_MS
  if (!sweep && !opts.bookingId) return
  if (sweep) lastSweep = now
  const kick = new Set<string>()
  const overdue = await payload.find({
    collection: 'job-offers',
    overrideAccess: true,
    depth: 0,
    limit: 50,
    where: {
      and: [
        { status: { equals: 'offered' } },
        { expiresAt: { less_than_equal: new Date(now).toISOString() } },
        ...(sweep ? [] : [{ booking: { equals: opts.bookingId } }]),
      ],
    },
  })
  for (const o of overdue.docs as JobOffer[]) {
    if (await closeOffer(payload, o, 'expired')) {
      const b = idOf(o.booking)
      if (b) kick.add(b)
    }
  }
  if (opts.bookingId) kick.add(opts.bookingId)
  if (sweep) {
    const pending = await payload.find({
      collection: 'bookings',
      overrideAccess: true,
      depth: 0,
      limit: 50,
      sort: 'createdAt',
      select: { status: true, flow: true, assignedPartner: true, needsManualAssignment: true, schedule: true },
      where: { status: { in: ['BOOKED', 'AT_HUB', 'OUT_FOR_DELIVERY'] } },
    })
    for (const b of pending.docs as Booking[]) {
      if (idOf(b.assignedPartner) || b.needsManualAssignment) continue
      const leg = dispatchLegFor(b.flow as BookingFlow, b.status as BookingStatus)
      if (leg && isDispatchDue(b, leg)) kick.add(b.id)
    }
  }
  for (const id of kick) {
    try {
      await dispatchBooking(payload, id)
    } catch (err) {
      payload.logger.error({ err, msg: `dispatch failed for booking ${id}` })
    }
  }
}

export interface AcceptResult {
  booking: Booking
  offer: JobOffer
}

/**
 * Why an accept that could not lock its offer lost. Decided from stored state, not from the
 * database error text (a unique-lock conflict is not reported the same way by every adapter).
 */
async function lostRaceReason(payload: Payload, offerId: string, lockKey: string, bookingId: string) {
  const current = (await payload.findByID({ collection: 'job-offers', id: offerId, overrideAccess: true, depth: 0 })) as JobOffer
  if (current.status === 'expired') return 'offer_expired'
  if (current.status === 'withdrawn') return 'already_assigned'
  const holder = await payload.count({
    collection: 'job-offers',
    overrideAccess: true,
    where: { and: [{ acceptLock: { equals: lockKey } }, { id: { not_equals: offerId } }] },
  })
  if (holder.totalDocs > 0) return 'already_assigned'
  const booking = await loadBooking(payload, bookingId)
  if (booking && idOf(booking.assignedPartner)) return 'already_assigned'
  return 'offer_not_open'
}

/**
 * First write wins. The offer row takes a unique `acceptLock` for (booking, leg, round), so a
 * second accept for the same leg fails at the database; the booking is then updated only where
 * no partner is assigned yet. All other open offers for the booking are withdrawn.
 */
export async function acceptOffer(payload: Payload, partner: Partner, offerId: string): Promise<AcceptResult> {
  let offer: JobOffer
  try {
    offer = (await payload.findByID({ collection: 'job-offers', id: offerId, overrideAccess: true, depth: 0 })) as JobOffer
  } catch {
    throw new DomainError('not_found', 404)
  }
  if (idOf(offer.partner) !== partner.id) throw new DomainError('not_found', 404)
  if (offer.status === 'expired') throw new DomainError('offer_expired', 409)
  if (offer.status !== 'offered') throw new DomainError(offer.status === 'withdrawn' ? 'already_assigned' : 'offer_not_open', 409)
  if (new Date(offer.expiresAt).getTime() <= Date.now()) {
    if (await closeOffer(payload, offer, 'expired')) await dispatchBooking(payload, idOf(offer.booking) as string)
    throw new DomainError('offer_expired', 409)
  }
  const blocker = await onlineBlocker(payload, partner)
  if (blocker) throw new DomainError(blocker, 403)

  const bookingId = idOf(offer.booking) as string
  const booking = await loadBooking(payload, bookingId)
  if (!booking) throw new DomainError('not_found', 404)
  const leg = offer.leg as DispatchLeg
  const legStatus = LEG_STATUS[leg]
  if (booking.status !== legStatus || idOf(booking.assignedPartner)) {
    await closeOffer(payload, offer, 'withdrawn')
    throw new DomainError('already_assigned', 409)
  }

  const lockKey = `${bookingId}:${leg}:${offer.round ?? 0}`
  try {
    const locked = await payload.update({
      collection: 'job-offers',
      overrideAccess: true,
      depth: 0,
      where: { and: [{ id: { equals: offer.id } }, { status: { equals: 'offered' } }] },
      data: { status: 'accepted', respondedAt: nowISO(), acceptLock: lockKey },
    })
    if (locked.errors.length > 0 && locked.errors.some((e) => /unique|exists|duplicate|constraint/i.test(String(e.message)))) {
      throw new DomainError('already_assigned', 409)
    }
    if (locked.docs.length === 0) throw new DomainError(await lostRaceReason(payload, offer.id, lockKey, bookingId), 409)
  } catch (err) {
    if (err instanceof DomainError) {
      if (err.code === 'already_assigned') await closeOffer(payload, offer, 'withdrawn')
      throw err
    }
    if (isUniqueViolation(err)) {
      await closeOffer(payload, offer, 'withdrawn')
      throw new DomainError('already_assigned', 409)
    }
    throw err
  }

  const assigned = await assignPartner(payload, booking, partner, leg, { offerId: offer.id, km: offer.distanceKm ?? 0 })
  if (!assigned) {
    await payload.update({ collection: 'job-offers', id: offer.id, overrideAccess: true, depth: 0, data: { status: 'withdrawn', acceptLock: null } })
    throw new DomainError('already_assigned', 409)
  }
  await withdrawOpenOffers(payload, bookingId, undefined, offer.id)

  const stats = partner.stats ?? {}
  const accepted = (stats.offersAccepted ?? 0) + 1
  await payload.update({
    collection: 'partners',
    id: partner.id,
    overrideAccess: true,
    depth: 0,
    data: {
      stats: { ...stats, offersAccepted: accepted },
      acceptanceRate: rate(accepted, Math.max(accepted, stats.offersReceived ?? 0)),
      ...(idOf(partner.currentJob) ? {} : { currentJob: bookingId }),
    },
  })
  return { booking: assigned, offer: { ...offer, status: 'accepted' } }
}

/** Booking fields written when a partner takes a leg (accept or manual hub assign). */
export async function buildAssignment(
  payload: Payload,
  booking: Booking,
  partner: Partner,
  leg: DispatchLeg,
  km?: number,
  req?: PayloadRequest,
): Promise<Partial<Booking>> {
  const target = await targetFor(payload, booking, leg, req)
  const dist =
    km ?? (isNum(partner.lastLat) && isNum(partner.lastLng) ? distanceKm(partner.lastLat, partner.lastLng, target.lat, target.lng) : 3)
  const eta = etaMinutesFor(dist)
  const slotEnd = booking.schedule?.mode === 'scheduled' ? (booking.schedule.endAt ?? booking.schedule.startAt) : null
  const promisedBy =
    slotEnd && new Date(slotEnd).getTime() > Date.now() + eta * 60_000 ? slotEnd : new Date(Date.now() + (eta + 10) * 60_000).toISOString()
  return {
    assignedPartner: partner.id,
    needsManualAssignment: false,
    ...(leg === 'visit' || leg === 'pickup' ? { status: 'PARTNER_ASSIGNED' as const, promisedBy } : {}),
    ...(leg === 'pickup' || leg === 'delivery' ? { riderPartner: partner.id } : {}),
    ...(leg === 'hub' ? { hubPartner: partner.id } : {}),
    ...(leg === 'hub'
      ? {}
      : {
          partner: {
            name: partner.name ?? 'dwaar partner',
            rating: (partner.ratingCount ?? 0) > 0 ? partner.rating : undefined,
            // Calls go through the hub's bridged number; neither side sees the other's phone.
            maskedPhone: target.supportPhone ?? undefined,
            etaMinutes: eta,
          },
        }),
  }
}

/**
 * Writes the assignment onto the booking, conditional on the leg still being open and nobody
 * assigned. Visit and pickup legs move BOOKED → PARTNER_ASSIGNED (the dispatcher edge); hub and
 * delivery legs keep their status.
 */
export async function assignPartner(
  payload: Payload,
  booking: Booking,
  partner: Partner,
  leg: DispatchLeg,
  opts: { offerId?: string; km?: number },
  req?: PayloadRequest,
): Promise<Booking | null> {
  const legStatus = LEG_STATUS[leg]
  const data = await buildAssignment(payload, booking, partner, leg, opts.km, req)
  const res = await payload.update({
    collection: 'bookings',
    overrideAccess: true,
    req: subReq(req, { actor: 'dispatcher', offerId: opts.offerId, eventNote: `Accepted by ${partner.name ?? 'partner'}` }),
    depth: 0,
    where: { and: [{ id: { equals: booking.id } }, { status: { equals: legStatus } }, { assignedPartner: { exists: false } }] },
    data,
  })
  if (res.errors.length > 0) {
    const first = res.errors[0]
    throw new DomainError(/^[a-z_]+$/.test(String(first.message)) ? String(first.message) : 'assign_failed', 409)
  }
  return (res.docs[0] as Booking) ?? null
}

/**
 * Partner gives back a job they accepted. Visit/pickup legs go back to BOOKED through the state
 * machine (the Bookings hook applies the penalty and re-dispatches); a hub or delivery leg just
 * drops its assignee and re-dispatches.
 */
export async function releaseNonVisitLeg(payload: Payload, booking: Booking, partner: Partner, reason: string) {
  const leg = dispatchLegFor(booking.flow as BookingFlow, booking.status as BookingStatus)
  if (!leg || (leg !== 'hub' && leg !== 'delivery') || idOf(booking.assignedPartner) !== partner.id) {
    throw new DomainError('cannot_release', 409)
  }
  const round = (booking.dispatch?.round ?? 0) + 1
  await payload.update({
    collection: 'bookings',
    id: booking.id,
    overrideAccess: true,
    depth: 0,
    context: { actor: 'dispatcher', skipBookingEvents: true },
    data: {
      assignedPartner: null,
      ...(leg === 'hub' ? { hubPartner: null } : {}),
      dispatch: { leg, round, attempts: 0, startedAt: null, lastOfferAt: null },
    },
  })
  await penalizeRelease(payload, partner.id, booking, round - 1, reason)
  await dispatchBooking(payload, booking.id)
}

export async function penalizeRelease(payload: Payload, partnerId: string, booking: Booking, round: number, reason: string | undefined, req?: PayloadRequest) {
  await writeReleasePenalty(payload, { partner: partnerId, booking, round, reason }, req)
  const p = (await payload.findByID({ collection: 'partners', id: partnerId, overrideAccess: true, depth: 0, req: subReq(req) })) as Partner
  const stats = p.stats ?? {}
  await payload.update({
    collection: 'partners',
    id: partnerId,
    overrideAccess: true,
    depth: 0,
    req: subReq(req),
    data: {
      reliabilityScore: Math.max(0, (p.reliabilityScore ?? 100) - RELEASE_RELIABILITY_DROP),
      stats: { ...stats, jobsReleased: (stats.jobsReleased ?? 0) + 1 },
      ...(idOf(p.currentJob) === booking.id ? { currentJob: null } : {}),
    },
  })
}

export async function declineOffer(payload: Payload, partner: Partner, offerId: string, reason: string) {
  let offer: JobOffer
  try {
    offer = (await payload.findByID({ collection: 'job-offers', id: offerId, overrideAccess: true, depth: 0 })) as JobOffer
  } catch {
    throw new DomainError('not_found', 404)
  }
  if (idOf(offer.partner) !== partner.id) throw new DomainError('not_found', 404)
  if (offer.status !== 'offered') throw new DomainError(offer.status === 'expired' ? 'offer_expired' : 'offer_not_open', 409)
  if (!(await closeOffer(payload, offer, 'declined', { declineReason: reason }))) throw new DomainError('offer_not_open', 409)
  await dispatchBooking(payload, idOf(offer.booking) as string)
  return offer
}
