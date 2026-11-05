import { APIError } from 'payload'
import type { CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { randomInt } from 'node:crypto'
import type { Booking, Partner, Service, ServiceCategory } from '@/payload-types'
import { isAdminReq, isPartnerReq } from '../access'
import {
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
  type PartnerRole,
  type TransitionRequirement,
} from '../lib/booking-machine'
import { distanceKm, isNum } from '../lib/geo'
import { GEOFENCE_M, MAX_BOOKING_OTP_ATTEMPTS, NO_SHOW_WAIT_MS } from '../lib/partner/constants'
import { buildAssignment, onlineBlocker } from '../lib/partner/dispatch'
import { DomainError, idOf, subReq } from '../lib/partner/sys'

export type BookingActor = 'customer' | 'partner' | 'dispatcher' | 'hub' | 'system'

/** What the partner API hands the hook as proof for an edge. Server-set only (req.context). */
export interface TransitionInput {
  otp?: string
  lat?: number
  lng?: number
  noShow?: boolean
  releaseReason?: string
}

/** The actor comes from req.context, never from request data. */
export function resolveActor(req: PayloadRequest, context: Record<string, unknown>): BookingActor {
  if (context.actor === 'customer') return 'customer'
  if (context.actor === 'dispatcher') return 'dispatcher'
  if (context.actor === 'partner') {
    if (!isPartnerReq(req) || context.partnerApi !== true) throw new DomainError('forbidden', 403)
    return 'partner'
  }
  if (isPartnerReq(req)) throw new DomainError('forbidden', 403)
  return isAdminReq(req) ? 'hub' : 'system'
}

function within(lat: number | undefined, lng: number | undefined, booking: Booking) {
  const bLat = booking.address?.lat
  const bLng = booking.address?.lng
  if (!isNum(bLat) || !isNum(bLng)) return true
  if (!isNum(lat) || !isNum(lng)) return false
  return distanceKm(lat, lng, bLat, bLng) * 1000 <= GEOFENCE_M
}

/** Fixed-price lines can never be re-priced by a partner; only extra parts may be added. */
async function checkQuote(req: PayloadRequest, merged: Booking, actor: BookingActor) {
  const quote = merged.quote ?? {}
  const items = quote.items ?? []
  const total = quote.totalPaise ?? 0
  if (actor !== 'partner') {
    if (total <= 0) throw new APIError('Quote bhejne se pehle quote total bharo.', 400, undefined, true)
    return
  }
  if (items.length === 0) throw new DomainError('quote_items_required', 400, { field: 'items' })
  if (items.some((i) => !isNum(i.pricePaise) || i.pricePaise < 0)) throw new DomainError('quote_invalid', 400, { field: 'items' })
  const serviceIds = (merged.lines ?? []).map((l) => idOf(l.service)).filter((x): x is string => Boolean(x))
  const { docs } = await req.payload.find({
    collection: 'services',
    overrideAccess: true,
    req: subReq(req),
    depth: 0,
    pagination: false,
    select: { priceType: true, tierPriced: true },
    where: { id: { in: serviceIds } },
  })
  const repriceable = (docs as Service[]).some((s) => s.priceType === 'range' || s.tierPriced)
  const itemsSum = items.reduce((sum, i) => sum + (i.pricePaise ?? 0), 0)
  if (!repriceable) {
    if (items.some((i) => !i.isExtraPart)) throw new DomainError('fixed_price', 400, { field: 'items' })
    const expected = (merged.pricing?.estimateMaxPaise ?? 0) + itemsSum
    if (total !== expected) throw new DomainError('quote_total_mismatch', 400, { field: 'totalPaise', params: { expected } })
  } else if (total !== itemsSum || total <= 0) {
    throw new DomainError('quote_total_mismatch', 400, { field: 'totalPaise', params: { expected: itemsSum } })
  }
}

async function checkPickup(req: PayloadRequest, merged: Booking) {
  const c = merged.pickupChecklist ?? {}
  if (!c.imei || !/^\d{15}$/.test(c.imei)) throw new DomainError('imei_required', 400, { field: 'checklist.imei' })
  if (c.simRemoved !== true) throw new DomainError('sim_not_removed', 400, { field: 'checklist.simRemoved' })
  if (c.memoryCardRemoved !== true) throw new DomainError('memory_card_not_removed', 400, { field: 'checklist.memoryCardRemoved' })
  const ids = (c.photos ?? []).map(idOf).filter((x): x is string => Boolean(x))
  const { totalDocs } = await req.payload.count({
    collection: 'job-media',
    overrideAccess: true,
    req: subReq(req),
    where: { and: [{ id: { in: ids.length ? ids : ['none'] } }, { booking: { equals: merged.id } }, { kind: { equals: 'pickup_photo' } }] },
  })
  if (totalDocs < 4) throw new DomainError('pickup_photos_required', 400, { field: 'mediaIds', params: { min: 4 } })
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

async function requirementCheck(
  req: PayloadRequest,
  need: TransitionRequirement,
  merged: Booking,
  original: Booking,
  input: TransitionInput,
) {
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
    case 'pickupPhotos':
      return need === 'pickupPhotos' ? checkPickup(req, merged) : undefined
    case 'quote':
      return checkQuote(req, merged, 'partner')
    case 'payment':
      return // checked for every actor below
  }
}

async function loadPartner(req: PayloadRequest, id: string) {
  try {
    return (await req.payload.findByID({ collection: 'partners', id, overrideAccess: true, depth: 0, req: subReq(req) })) as Partner
  } catch {
    return null
  }
}

/**
 * The only status validator. Every write that changes `status` passes through here, whoever
 * makes it: the customer app, the partner API, the dispatcher, the hub in Payload Admin, or the
 * CLI. The actor comes from `req.context` (server-set), and each actor only gets its own edges:
 *
 * - customer: CANCELLED, APPROVED, DECLINED (customerCan)
 * - dispatcher: BOOKED → PARTNER_ASSIGNED, only with an assignee (offer accept)
 * - partner: their role's edges from booking-machine, with OTP / geofence / photo / payment proof
 * - hub (admins) and system: any edge on the graph plus release / no-show; manual assign by
 *   choosing an assignedPartner
 */
export const enforceTransitions: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req, context }) => {
  const now = new Date()
  const nowIso = now.toISOString()
  if (operation === 'create') {
    data.status = 'BOOKED'
    data.statusChangedAt = nowIso
    data.dispatch = { leg: dispatchLegFor(data.flow, 'BOOKED'), round: 0, attempts: 0 }
    return data
  }
  const original = originalDoc as Booking
  const from = original.status as BookingStatus
  const to = (data.status ?? from) as BookingStatus
  const flow = (data.flow ?? original.flow) as BookingFlow
  const actor = resolveActor(req, context)
  const merged = { ...original, ...data } as Booking

  // Hub manual assign: choosing an assignee in Admin takes the open leg exactly like an accept.
  const newAssignee = idOf(data.assignedPartner)
  if (actor === 'hub' && newAssignee && newAssignee !== idOf(original.assignedPartner)) {
    const leg = dispatchLegFor(flow, from)
    if (!leg || idOf(original.assignedPartner)) {
      throw new APIError('Is stage par partner assign nahi ho sakta (leg already assigned or not open).', 400, undefined, true)
    }
    const partner = await loadPartner(req, newAssignee)
    if (!partner) throw new APIError('Partner nahi mila.', 400, undefined, true)
    if (partner.role !== roleForLeg(flow, leg)) {
      throw new APIError(`Is leg ke liye ${roleForLeg(flow, leg)} chahiye, ${partner.role ?? 'no role'} nahi.`, 400, undefined, true)
    }
    const blocker = await onlineBlocker(req.payload, partner, req)
    if (blocker && blocker !== 'licence_expired') throw new APIError(`Partner assign nahi ho sakta: ${blocker}.`, 400, undefined, true)
    Object.assign(data, await buildAssignment(req.payload, merged, partner, leg, undefined, req))
    context.manualAssign = { partnerId: partner.id, leg, round: original.dispatch?.round ?? 0 }
    context.eventNote = context.eventNote ?? `Assigned by hub: ${partner.name ?? partner.username}`
  }

  const target = (data.status ?? from) as BookingStatus
  if (from === target) return data

  const input = (context.transition ?? {}) as TransitionInput
  const offGraph = isOperationalEdge(flow, from, target)

  switch (actor) {
    case 'customer':
      if (!customerCan(flow, from, target)) throw new DomainError('transition_not_allowed', 409)
      break
    case 'dispatcher':
      if (!(from === 'BOOKED' && target === 'PARTNER_ASSIGNED' && newAssignee)) throw new DomainError('transition_not_allowed', 409)
      break
    case 'hub':
    case 'system':
      if (!canTransition(flow, from, target) && !offGraph) {
        throw new APIError(`Status ${from} se ${target} par nahi ja sakta.`, 400, undefined, true)
      }
      if (from === 'BOOKED' && target === 'PARTNER_ASSIGNED' && !idOf(merged.assignedPartner)) {
        throw new APIError('Pehle "Assigned partner" chuno — status apne aap badal jayega.', 400, undefined, true)
      }
      break
    case 'partner': {
      const partner = req.user ? await loadPartner(req, String(req.user.id)) : null
      if (!partner) throw new DomainError('unauthorized', 401)
      if (partner.accountStatus !== 'active' || partner.verificationStatus !== 'approved') throw new DomainError('partner_inactive', 403)
      if (idOf(original.assignedPartner) !== partner.id) throw new DomainError('not_assigned', 403)
      context.partnerId = partner.id
      if (target === 'BOOKED') {
        if (!canRelease(flow, from)) throw new DomainError('cannot_release', 409)
        if (!input.releaseReason) throw new DomainError('reason_required', 400, { field: 'reason' })
      } else if (target === 'CANCELLED') {
        if (!input.noShow || from !== noShowFrom(flow)) throw new DomainError('transition_not_allowed', 409)
        if (!original.arrivedAt) throw new DomainError('not_arrived', 409)
        const waited = now.getTime() - new Date(original.arrivedAt).getTime()
        if (waited < NO_SHOW_WAIT_MS) throw new DomainError('wait_longer', 409, { params: { minutes: Math.ceil((NO_SHOW_WAIT_MS - waited) / 60000) } })
        if (!within(input.lat, input.lng, original)) throw new DomainError('outside_geofence', 400, { field: 'lat', params: { meters: GEOFENCE_M } })
        const category = (await req.payload.findByID({ collection: 'service-categories', id: idOf(original.category) as string, overrideAccess: true, depth: 0, req: subReq(req) })) as ServiceCategory
        data.noShow = { markedAt: nowIso, waitedMinutes: Math.floor(waited / 60000) }
        data.cancellation = { reason: 'customer_no_show', at: nowIso }
        data.pricing = { ...original.pricing, ...data.pricing, cancelFeePaise: category?.pricing?.cancelAfterAssignFeePaise ?? 0 }
      } else {
        const edge = partnerEdge(flow, partner.role as PartnerRole, from, target, { declined: original.quote?.outcome === 'declined' })
        if (!edge) throw new DomainError('transition_not_allowed', 409)
        for (const need of edge.requires) await requirementCheck(req, need, merged, original, input)
      }
      break
    }
  }

  if (target === 'QUOTE_SENT' && actor !== 'partner') await checkQuote(req, merged, actor)
  if (target === 'COMPLETED') {
    const collected = Boolean(merged.paymentCollection?.collectedAt)
    if (!collected && merged.payment?.status !== 'paid') {
      if (actor === 'partner') throw new DomainError('payment_required', 409, { field: 'payment' })
      throw new APIError('Complete karne se pehle payment collect karo (ya payment status "paid" karo).', 400, undefined, true)
    }
  }

  // Effects of entering the new status.
  data.statusChangedAt = nowIso
  if (target === 'ARRIVED') data.arrivedAt = original.arrivedAt ?? nowIso
  if (target === 'IN_PROGRESS') data.startedAt = original.startedAt ?? nowIso
  if ((target === 'ARRIVED' || target === 'PICKED_UP') && original.promisedBy && !original.slaBreached) {
    const at = target === 'PICKED_UP' && original.arrivedAt ? new Date(original.arrivedAt) : now
    if (at.getTime() > new Date(original.promisedBy).getTime()) {
      const config = await req.payload.findGlobal({ slug: 'business-config', overrideAccess: true, depth: 0, req: subReq(req) })
      data.slaBreached = true
      data.slaCreditPaise = config.rewards?.slaCreditPaise ?? 0
    }
  }
  if (target === 'QUOTE_SENT') data.quote = { ...original.quote, ...data.quote, sentAt: nowIso, outcome: null }
  if (target === 'APPROVED') {
    const quoteTotal = merged.quote?.totalPaise ?? 0
    data.quote = { ...original.quote, ...data.quote, respondedAt: nowIso, outcome: 'approved' }
    data.pricing = { ...original.pricing, ...data.pricing, finalPaise: quoteTotal }
  }
  if (target === 'DECLINED') data.quote = { ...original.quote, ...data.quote, respondedAt: nowIso, outcome: 'declined' }
  if (target === 'AT_HUB') {
    // The pickup leg is over; the hub leg is dispatched to a hub technician.
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
    // Released: back to the pool with a fresh dispatch round.
    context.releasedBy = idOf(original.assignedPartner)
    context.releasedRound = original.dispatch?.round ?? 0
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
