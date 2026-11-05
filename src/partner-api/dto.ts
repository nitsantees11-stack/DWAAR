import type { Booking, JobOffer, Media, Partner, ServiceCategory } from '@/payload-types'
import {
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
} from '../lib/booking-machine'
import { GEOFENCE_M, NO_SHOW_WAIT_MS, firstName, maskPhone } from '../lib/partner/constants'
import { amountDuePaise } from '../lib/partner/ledger'
import { idOf } from '../lib/partner/sys'

const TERMINAL: BookingStatus[] = ['COMPLETED', 'RETURNED', 'CANCELLED']

export function partnerDTO(p: Partner) {
  const photo = typeof p.photo === 'object' && p.photo ? (p.photo as Media) : null
  return {
    id: p.id,
    // Partners from the Partner app's own login have no phone until they add one.
    phone: /^[6-9]\d{9}$/.test(p.username ?? '') ? p.username : null,
    email: p.externalEmail ?? null,
    identity: p.externalUserId ? ('external' as const) : ('phone' as const),
    name: p.name ?? null,
    photoUrl: photo?.url ?? null,
    dateOfBirth: p.dateOfBirth ?? null,
    languages: p.languages ?? [],
    role: p.role ?? null,
    categories: (p.categories ?? []).map((c) => (typeof c === 'object' ? { id: c.id, key: c.icon, name: c.name, slug: c.slug, flow: c.flow } : { id: c })),
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

export interface AllowedAction {
  action: 'transition' | 'quote' | 'payment' | 'parts' | 'media' | 'release' | 'no_show' | 'rate_customer'
  method: 'POST'
  path: string
  to?: BookingStatus
  requires?: TransitionRequirement[]
  inputs?: string[]
  /** For transitions gated on an earlier action (e.g. COMPLETED needs a payment first). */
  blockedBy?: string
  notBefore?: string
  rules?: Record<string, number | string>
}

/** Next steps for this partner on this booking, computed from the state machine and their role. */
export function allowedActions(booking: Booking, partner: Partner): AllowedAction[] {
  const flow = booking.flow as BookingFlow
  const status = booking.status as BookingStatus
  const role = partner.role as PartnerRole
  const base = `jobs/${booking.id}`
  const isAssignee = idOf(booking.assignedPartner) === partner.id
  const out: AllowedAction[] = []
  if (isAssignee && !TERMINAL.includes(status)) {
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

/** Which leg of this booking the partner holds (or held). */
export function partnerLeg(booking: Booking, partner: Partner): DispatchLeg | null {
  const flow = booking.flow as BookingFlow
  if (flow !== 'pickup_drop') return 'visit'
  if (idOf(booking.hubPartner) === partner.id) return 'hub'
  if (idOf(booking.riderPartner) === partner.id) return booking.status === 'OUT_FOR_DELIVERY' || booking.status === 'COMPLETED' || booking.status === 'RETURNED' ? 'delivery' : 'pickup'
  return activeLegFor(flow, booking.status as BookingStatus)
}

function mediaRef(m: unknown) {
  if (!m) return null
  if (typeof m === 'object' && 'id' in (m as object)) {
    const media = m as { id: string; kind?: string; mimeType?: string | null }
    return { id: media.id, kind: media.kind ?? null, mimeType: media.mimeType ?? null, url: `/api/partner/v1/files/job-media/${media.id}` }
  }
  return { id: String(m), url: `/api/partner/v1/files/job-media/${String(m)}` }
}

/**
 * The job as the partner app sees it. Customer first name, masked phone and address are part of
 * every accepted job; exact coordinates only while the partner's leg is live.
 */
export function jobDTO(booking: Booking, partner: Partner, opts: { customerName?: string | null; customerPhone?: string | null } = {}) {
  const flow = booking.flow as BookingFlow
  const status = booking.status as BookingStatus
  const category = typeof booking.category === 'object' ? (booking.category as ServiceCategory) : null
  const leg = partnerLeg(booking, partner)
  const holdsLeg = idOf(booking.assignedPartner) === partner.id
  const live = holdsLeg && leg !== null && isPartnerLegActive(flow, status, leg)
  return {
    id: booking.id,
    bookingCode: booking.bookingCode,
    title: booking.title,
    status,
    flow,
    leg,
    isMine: holdsLeg,
    category: category ? { id: category.id, name: category.name, slug: category.slug } : { id: idOf(booking.category) },
    device: {
      label: booking.deviceLabel ?? null,
      type: booking.device?.type ?? null,
      brand: booking.device?.brand ?? null,
      model: booking.device?.model ?? null,
      notes: booking.device?.notes ?? null,
    },
    // What the customer reported: their own words for "Other problem", and a recorded video.
    problem: {
      description: booking.problem?.description ?? null,
      videoUrl: idOf(booking.problem?.video) ? `/api/partner/v1/files/problem-videos/${idOf(booking.problem?.video)}` : null,
      ninetyMinPromise: Boolean(booking.problem?.ninetyMinPromise),
    },
    lines: (booking.lines ?? []).map((l) => ({ name: l.name, quantity: l.quantity, minPaise: l.minPaise, maxPaise: l.maxPaise })),
    schedule: { mode: booking.schedule?.mode, startAt: booking.schedule?.startAt ?? null, endAt: booking.schedule?.endAt ?? null, label: booking.scheduleLabel ?? null },
    customer: {
      firstName: firstName(booking.address?.contactName ?? opts.customerName),
      maskedPhone: maskPhone(booking.address?.contactPhone ?? opts.customerPhone),
    },
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
        ? {
            method: booking.paymentCollection.method,
            amountPaise: booking.paymentCollection.amountPaise,
            reference: booking.paymentCollection.reference ?? null,
            collectedAt: booking.paymentCollection.collectedAt,
          }
        : null,
    },
    quote: booking.quote?.sentAt
      ? {
          diagnosis: booking.quote.diagnosis ?? null,
          items: (booking.quote.items ?? []).map((i) => ({ label: i.label, grade: i.grade ?? null, pricePaise: i.pricePaise, isExtraPart: Boolean(i.isExtraPart) })),
          totalPaise: booking.quote.totalPaise ?? 0,
          video: mediaRef(booking.quote.videoMedia),
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
          photos: (booking.pickupChecklist.photos ?? []).map(mediaRef),
        }
      : null,
    partsUsed: (booking.partsUsed ?? []).map((p) => ({ name: p.name, pricePaise: p.pricePaise, bill: mediaRef(p.bill) })),
    cancellation: status === 'CANCELLED' ? { reason: booking.cancellation?.reason ?? null, at: booking.cancellation?.at ?? null, noShow: Boolean(booking.noShow?.markedAt) } : null,
    slaBreached: Boolean(booking.slaBreached),
    customerRating: booking.customerRatingByPartner?.stars ? { stars: booking.customerRatingByPartner.stars, comment: booking.customerRatingByPartner.comment ?? null } : null,
    updatedAt: booking.updatedAt,
    allowedActions: allowedActions(booking, partner),
  }
}

/** Pre-accept view of an offer: no customer identity, no address, only the area. */
export function offerDTO(offer: JobOffer, booking: Booking | null, zoneName: string | null) {
  const category = booking && typeof booking.category === 'object' ? (booking.category as ServiceCategory) : null
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
    actions: offer.status === 'offered' && expiresMs > Date.now()
      ? [
          { action: 'accept', method: 'POST', path: `offers/${offer.id}/accept` },
          { action: 'decline', method: 'POST', path: `offers/${offer.id}/decline`, inputs: ['reason'] },
        ]
      : [],
  }
}
