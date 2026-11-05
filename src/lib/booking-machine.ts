/**
 * The single source of truth for booking status transitions. Used by the Bookings
 * collection hook (so hub/admin edits are validated too) and by customer server actions.
 */
export const BOOKING_FLOWS = ['pickup_drop', 'doorstep', 'roadside'] as const
export type BookingFlow = (typeof BOOKING_FLOWS)[number]

export const BOOKING_STATUSES = [
  'BOOKED',
  'PARTNER_ASSIGNED',
  'ON_THE_WAY',
  'ARRIVED',
  'PICKED_UP',
  'AT_HUB',
  'QUOTE_SENT',
  'APPROVED',
  'DECLINED',
  'IN_PROGRESS',
  'OUT_FOR_DELIVERY',
  'COMPLETED',
  'RETURNED',
  'CANCELLED',
] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

type TransitionTable = Partial<Record<BookingStatus, readonly BookingStatus[]>>

const onSite: TransitionTable = {
  BOOKED: ['PARTNER_ASSIGNED', 'CANCELLED'],
  PARTNER_ASSIGNED: ['ON_THE_WAY', 'CANCELLED'],
  ON_THE_WAY: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['IN_PROGRESS', 'QUOTE_SENT'],
  IN_PROGRESS: ['QUOTE_SENT', 'COMPLETED'],
  QUOTE_SENT: ['APPROVED', 'DECLINED'],
  APPROVED: ['IN_PROGRESS', 'COMPLETED'],
}

const transitions: Record<BookingFlow, TransitionTable> = {
  pickup_drop: {
    BOOKED: ['PARTNER_ASSIGNED', 'CANCELLED'],
    PARTNER_ASSIGNED: ['ON_THE_WAY', 'CANCELLED'],
    ON_THE_WAY: ['PICKED_UP', 'CANCELLED'],
    PICKED_UP: ['AT_HUB'],
    AT_HUB: ['QUOTE_SENT'],
    QUOTE_SENT: ['APPROVED', 'DECLINED'],
    APPROVED: ['IN_PROGRESS'],
    IN_PROGRESS: ['OUT_FOR_DELIVERY'],
    DECLINED: ['OUT_FOR_DELIVERY'],
    OUT_FOR_DELIVERY: ['COMPLETED', 'RETURNED'],
  },
  doorstep: onSite,
  roadside: onSite,
}

export function nextStatuses(flow: BookingFlow, from: BookingStatus): readonly BookingStatus[] {
  return transitions[flow][from] ?? []
}

export function canTransition(flow: BookingFlow, from: BookingStatus, to: BookingStatus) {
  return nextStatuses(flow, from).includes(to)
}

/** Transitions a customer may trigger themselves. Everything else is hub-driven. */
export function customerCan(flow: BookingFlow, from: BookingStatus, to: BookingStatus) {
  if (!canTransition(flow, from, to)) return false
  if (to === 'CANCELLED') return true
  return from === 'QUOTE_SENT' && (to === 'APPROVED' || to === 'DECLINED')
}

export function isTerminal(flow: BookingFlow, status: BookingStatus) {
  return nextStatuses(flow, status).length === 0
}

export function isActive(flow: BookingFlow, status: BookingStatus) {
  return !isTerminal(flow, status)
}

/** Visible progress steps per flow. */
export const timelineSteps: Record<BookingFlow, BookingStatus[]> = {
  pickup_drop: [
    'BOOKED',
    'PARTNER_ASSIGNED',
    'PICKED_UP',
    'AT_HUB',
    'QUOTE_SENT',
    'APPROVED',
    'IN_PROGRESS',
    'OUT_FOR_DELIVERY',
    'COMPLETED',
  ],
  doorstep: ['BOOKED', 'PARTNER_ASSIGNED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'],
  roadside: ['BOOKED', 'PARTNER_ASSIGNED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'],
}

/** Maps any status (including off-timeline ones) onto the visible step index. */
export function timelineIndex(flow: BookingFlow, status: BookingStatus) {
  const steps = timelineSteps[flow]
  const direct = steps.indexOf(status)
  if (direct >= 0) return direct
  if (flow === 'pickup_drop') {
    if (status === 'ON_THE_WAY') return steps.indexOf('PARTNER_ASSIGNED')
    if (status === 'DECLINED' || status === 'RETURNED') return steps.indexOf('OUT_FOR_DELIVERY')
  } else if (status === 'QUOTE_SENT' || status === 'APPROVED' || status === 'DECLINED') {
    return steps.indexOf('IN_PROGRESS')
  }
  return 0
}

export interface CancelPolicy {
  allowed: boolean
  feePaise: number
}

/** Free before anyone is assigned; the category's fee once a partner is on the job. */
export function cancelPolicy(
  flow: BookingFlow,
  status: BookingStatus,
  cancelAfterAssignFeePaise: number,
): CancelPolicy {
  if (!canTransition(flow, status, 'CANCELLED')) return { allowed: false, feePaise: 0 }
  if (status === 'BOOKED') return { allowed: true, feePaise: 0 }
  return { allowed: true, feePaise: cancelAfterAssignFeePaise }
}

export function canReschedule(status: BookingStatus) {
  return status === 'BOOKED'
}

/** OTP is shown once a partner is assigned and until the job is started / picked up. */
export function showsServiceOtp(flow: BookingFlow, status: BookingStatus) {
  if (flow === 'pickup_drop') return status === 'PARTNER_ASSIGNED' || status === 'ON_THE_WAY'
  return status === 'PARTNER_ASSIGNED' || status === 'ON_THE_WAY' || status === 'ARRIVED'
}

// ---------------------------------------------------------------------------
// Partner side. The tables above stay the single transition graph; the rules below decide
// which actor may take which edge and what proof each edge needs. Both the Bookings hook
// (enforcement) and the partner API (allowedActions) read from here.
// ---------------------------------------------------------------------------

export const PARTNER_ROLES = ['technician', 'mechanic', 'rider', 'hub_technician'] as const
export type PartnerRole = (typeof PARTNER_ROLES)[number]

/** A booking is worked in legs; each leg is dispatched to one partner of one role. */
export type DispatchLeg = 'visit' | 'pickup' | 'hub' | 'delivery'

/** The status a booking sits in while a leg is waiting for a partner. */
export const LEG_STATUS: Record<DispatchLeg, BookingStatus> = {
  visit: 'BOOKED',
  pickup: 'BOOKED',
  hub: 'AT_HUB',
  delivery: 'OUT_FOR_DELIVERY',
}

export function dispatchLegFor(flow: BookingFlow, status: BookingStatus): DispatchLeg | null {
  if (status === 'BOOKED') return flow === 'pickup_drop' ? 'pickup' : 'visit'
  if (flow !== 'pickup_drop') return null
  if (status === 'AT_HUB') return 'hub'
  if (status === 'OUT_FOR_DELIVERY') return 'delivery'
  return null
}

/** Which leg a partner is working given the booking's current status. */
export function activeLegFor(flow: BookingFlow, status: BookingStatus): DispatchLeg | null {
  if (flow !== 'pickup_drop') {
    return ['BOOKED', 'PARTNER_ASSIGNED', 'ON_THE_WAY', 'ARRIVED', 'IN_PROGRESS', 'QUOTE_SENT', 'APPROVED', 'DECLINED'].includes(status)
      ? 'visit'
      : null
  }
  if (['BOOKED', 'PARTNER_ASSIGNED', 'ON_THE_WAY', 'PICKED_UP'].includes(status)) return 'pickup'
  if (['AT_HUB', 'QUOTE_SENT', 'APPROVED', 'DECLINED', 'IN_PROGRESS'].includes(status)) return 'hub'
  if (status === 'OUT_FOR_DELIVERY') return 'delivery'
  return null
}

export function roleForLeg(flow: BookingFlow, leg: DispatchLeg): PartnerRole {
  if (leg === 'hub') return 'hub_technician'
  if (leg === 'pickup' || leg === 'delivery') return 'rider'
  return flow === 'roadside' ? 'mechanic' : 'technician'
}

/** Inputs an edge needs. The partner app renders the matching form from this list. */
export type TransitionRequirement =
  | 'location'
  | 'geofence'
  | 'serviceOtp'
  | 'deliveryOtp'
  | 'pickupChecklist'
  | 'pickupPhotos'
  | 'quote'
  | 'payment'

export interface PartnerEdge {
  to: BookingStatus
  requires: TransitionRequirement[]
}

const visitEdges: Partial<Record<BookingStatus, PartnerEdge[]>> = {
  PARTNER_ASSIGNED: [{ to: 'ON_THE_WAY', requires: ['location'] }],
  ON_THE_WAY: [{ to: 'ARRIVED', requires: ['location', 'geofence'] }],
  ARRIVED: [
    { to: 'IN_PROGRESS', requires: ['serviceOtp'] },
    { to: 'QUOTE_SENT', requires: ['quote'] },
  ],
  IN_PROGRESS: [
    { to: 'QUOTE_SENT', requires: ['quote'] },
    { to: 'COMPLETED', requires: ['payment'] },
  ],
  APPROVED: [
    { to: 'IN_PROGRESS', requires: [] },
    { to: 'COMPLETED', requires: ['payment'] },
  ],
}

const partnerEdges: Record<PartnerRole, Partial<Record<BookingStatus, PartnerEdge[]>>> = {
  technician: visitEdges,
  mechanic: visitEdges,
  rider: {
    PARTNER_ASSIGNED: [{ to: 'ON_THE_WAY', requires: ['location'] }],
    ON_THE_WAY: [{ to: 'PICKED_UP', requires: ['location', 'serviceOtp', 'pickupChecklist', 'pickupPhotos'] }],
    PICKED_UP: [{ to: 'AT_HUB', requires: [] }],
    OUT_FOR_DELIVERY: [
      { to: 'COMPLETED', requires: ['deliveryOtp', 'payment'] },
      { to: 'RETURNED', requires: ['deliveryOtp'] },
    ],
  },
  hub_technician: {
    AT_HUB: [{ to: 'QUOTE_SENT', requires: ['quote'] }],
    APPROVED: [{ to: 'IN_PROGRESS', requires: [] }],
    IN_PROGRESS: [{ to: 'OUT_FOR_DELIVERY', requires: [] }],
    DECLINED: [{ to: 'OUT_FOR_DELIVERY', requires: [] }],
  },
}

/**
 * Off-graph edges only partners (and the hub) may take: releasing an accepted job puts the
 * booking back to BOOKED, and a no-show cancels after arrival. Customers never see them.
 */
const releaseFrom: BookingStatus[] = ['PARTNER_ASSIGNED', 'ON_THE_WAY']

export function canRelease(flow: BookingFlow, status: BookingStatus) {
  return releaseFrom.includes(status) && dispatchLegFor(flow, 'BOOKED') !== null
}

export function noShowFrom(flow: BookingFlow): BookingStatus {
  return flow === 'pickup_drop' ? 'ON_THE_WAY' : 'ARRIVED'
}

export function isOperationalEdge(flow: BookingFlow, from: BookingStatus, to: BookingStatus) {
  if (to === 'BOOKED') return canRelease(flow, from)
  if (to === 'CANCELLED') return from === noShowFrom(flow)
  return false
}

/** Edges a partner of `role` may take from `from`, already intersected with the flow graph. */
export function partnerEdgesFor(
  flow: BookingFlow,
  role: PartnerRole,
  from: BookingStatus,
  opts: { declined?: boolean } = {},
): PartnerEdge[] {
  const leg = activeLegFor(flow, from)
  if (!leg || roleForLeg(flow, leg) !== role) return []
  return (partnerEdges[role][from] ?? []).filter((edge) => {
    if (!canTransition(flow, from, edge.to)) return false
    // RETURNED is the hand-back of a declined repair; a repaired device is COMPLETED.
    if (edge.to === 'RETURNED') return Boolean(opts.declined)
    if (edge.to === 'COMPLETED' && from === 'OUT_FOR_DELIVERY') return !opts.declined
    return true
  })
}

export function partnerEdge(
  flow: BookingFlow,
  role: PartnerRole,
  from: BookingStatus,
  to: BookingStatus,
  opts: { declined?: boolean } = {},
): PartnerEdge | null {
  return partnerEdgesFor(flow, role, from, opts).find((e) => e.to === to) ?? null
}

/** Statuses at which a partner's own leg has ended (they are free again). */
export function legEndsAt(flow: BookingFlow, leg: DispatchLeg): BookingStatus[] {
  if (leg === 'pickup') return ['AT_HUB', 'CANCELLED', 'BOOKED']
  if (leg === 'hub') return ['OUT_FOR_DELIVERY', 'CANCELLED']
  return ['COMPLETED', 'RETURNED', 'CANCELLED', ...(flow === 'pickup_drop' ? [] : (['BOOKED'] as BookingStatus[]))]
}

/** Partner is "on the job" (exact customer location visible) while their leg is live. */
export function isPartnerLegActive(flow: BookingFlow, status: BookingStatus, leg: DispatchLeg) {
  return activeLegFor(flow, status) === leg && status !== 'BOOKED'
}
