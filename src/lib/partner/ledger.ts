import type { Payload, PayloadRequest, Where } from 'payload'
import type { Booking, BusinessConfig } from '@/payload-types'
import type { BookingFlow, DispatchLeg } from '../booking-machine'
import type { LedgerType } from './constants'
import { idOf, isUniqueViolation, subReq } from './sys'

type PartnerPay = NonNullable<BusinessConfig['partnerPay']>

export async function getPartnerPay(payload: Payload, req?: PayloadRequest): Promise<{ pay: PartnerPay; config: BusinessConfig }> {
  const config = await payload.findGlobal({ slug: 'business-config', overrideAccess: true, depth: 0, req: subReq(req) })
  return { pay: config.partnerPay ?? {}, config }
}

export function sharePercentFor(pay: PartnerPay, categoryId: string | null) {
  const row = (pay.partnerSharePercent ?? []).find((r) => idOf(r.category) === categoryId)
  return row?.percent ?? pay.defaultSharePercent ?? 80
}

/** Parts the partner paid for and proved with a bill photo. */
export function billedPartsPaise(booking: Pick<Booking, 'partsUsed'>) {
  return (booking.partsUsed ?? []).filter((p) => idOf(p.bill)).reduce((sum, p) => sum + (p.pricePaise ?? 0), 0)
}

/** What the customer pays in total for the job (locked quote, else the fixed estimate). */
export function amountDuePaise(booking: Pick<Booking, 'pricing'>) {
  return booking.pricing?.finalPaise ?? booking.pricing?.estimateMaxPaise ?? 0
}

/** Amounts that make up a technician/mechanic/hub technician's earning on one booking. */
export function jobEarningBreakdown(booking: Booking, pay: PartnerPay) {
  const visitFee = booking.pricing?.visitFeePaise ?? 0
  const discount = booking.pricing?.discountPaise ?? 0
  const parts = billedPartsPaise(booking)
  // Discounts are funded by dwaar, so partners earn on the pre-discount amount.
  const base = Math.max(0, amountDuePaise(booking) + discount - visitFee - parts)
  const share = sharePercentFor(pay, idOf(booking.category))
  return {
    jobEarning: Math.round((base * share) / 100),
    visitShare: Math.round((visitFee * (pay.visitFeeSharePercent ?? 80)) / 100),
    parts,
  }
}

/** Shown on an offer before accept. */
export function estimateEarningPaise(booking: Booking, leg: DispatchLeg, pay: PartnerPay) {
  if (leg === 'pickup' || leg === 'delivery') return pay.riderLegFeePaise ?? 4000
  const b = jobEarningBreakdown(booking, pay)
  return b.jobEarning + (leg === 'visit' ? b.visitShare : 0)
}

interface EntryInput {
  partner: string
  booking?: string | null
  type: LedgerType
  amountPaise: number
  note?: string
  entryKey: string
  payout?: string
}

/** Append one ledger row. A repeated `entryKey` is a no-op, which makes system writes idempotent. */
export async function appendLedger(payload: Payload, entry: EntryInput, req?: PayloadRequest): Promise<boolean> {
  if (!entry.amountPaise) return false
  const existing = await payload.count({
    collection: 'earnings-ledger',
    overrideAccess: true,
    req: subReq(req),
    where: { entryKey: { equals: entry.entryKey } },
  })
  if (existing.totalDocs > 0) return false
  try {
    await payload.create({
      collection: 'earnings-ledger',
      overrideAccess: true,
      req: subReq(req),
      data: { ...entry, booking: entry.booking ?? undefined },
    })
    return true
  } catch (err) {
    if (isUniqueViolation(err)) return false
    throw err
  }
}

/**
 * Earnings for a COMPLETED booking, once per booking: the job earning, the visit-fee share and
 * billed parts go to the partner who did the work (hub technician for hub repairs); riders get
 * their leg fee for each pickup / delivery leg they accepted.
 */
export async function writeCompletionLedger(payload: Payload, booking: Booking, req?: PayloadRequest) {
  const { pay } = await getPartnerPay(payload, req)
  const flow = booking.flow as BookingFlow
  const worker = flow === 'pickup_drop' ? idOf(booking.hubPartner) : idOf(booking.assignedPartner)
  const code = booking.bookingCode
  if (worker) {
    const b = jobEarningBreakdown(booking, pay)
    await appendLedger(payload, { partner: worker, booking: booking.id, type: 'job_earning', amountPaise: b.jobEarning, note: `Job ${code}`, entryKey: `${booking.id}:job_earning` }, req)
    if (flow !== 'pickup_drop') {
      await appendLedger(payload, { partner: worker, booking: booking.id, type: 'visit_share', amountPaise: b.visitShare, note: `Visit fee share ${code}`, entryKey: `${booking.id}:visit_share` }, req)
    }
    await appendLedger(payload, { partner: worker, booking: booking.id, type: 'parts_reimbursement', amountPaise: b.parts, note: `Parts with bill ${code}`, entryKey: `${booking.id}:parts_reimbursement` }, req)
  }
  if (flow === 'pickup_drop') {
    const { docs } = await payload.find({
      collection: 'job-offers',
      overrideAccess: true,
      req: subReq(req),
      depth: 0,
      pagination: false,
      where: { and: [{ booking: { equals: booking.id } }, { status: { equals: 'accepted' } }, { leg: { in: ['pickup', 'delivery'] } }] },
    })
    for (const offer of docs) {
      const rider = idOf(offer.partner)
      if (!rider) continue
      await appendLedger(
        payload,
        {
          partner: rider,
          booking: booking.id,
          type: 'job_earning',
          amountPaise: pay.riderLegFeePaise ?? 4000,
          note: `${offer.leg === 'pickup' ? 'Pickup' : 'Delivery'} leg ${code}`,
          entryKey: `${booking.id}:rider:${offer.leg}:${offer.round ?? 0}`,
        },
        req,
      )
    }
  }
}

export async function writeReleasePenalty(
  payload: Payload,
  args: { partner: string; booking: Booking; round: number; reason?: string },
  req?: PayloadRequest,
) {
  const { pay } = await getPartnerPay(payload, req)
  return appendLedger(
    payload,
    {
      partner: args.partner,
      booking: args.booking.id,
      type: 'penalty',
      amountPaise: -(pay.releasePenaltyPaise ?? 5000),
      note: `Released ${args.booking.bookingCode}${args.reason ? `: ${args.reason}` : ''}`.slice(0, 200),
      entryKey: `${args.booking.id}:release:${args.round}:${args.partner}`,
    },
    req,
  )
}

export interface Balances {
  /** Everything earned (job, visit, parts, incentives, penalties, adjustments). */
  earningsPaise: number
  /** Cash collected from customers and not yet deposited with the hub. */
  cashInHandPaise: number
  /** Already paid out or reserved for a payout request. */
  paidOutPaise: number
  /** What the next payout would be: earnings minus cash in hand minus paid out. */
  payablePaise: number
}

const EARNING_TYPES: LedgerType[] = ['job_earning', 'visit_share', 'parts_reimbursement', 'incentive', 'penalty', 'adjustment']

export async function partnerBalances(payload: Payload, partnerId: string, extra?: Where): Promise<Balances> {
  const { docs } = await payload.find({
    collection: 'earnings-ledger',
    overrideAccess: true,
    depth: 0,
    pagination: false,
    select: { type: true, amountPaise: true },
    where: extra ? { and: [{ partner: { equals: partnerId } }, extra] } : { partner: { equals: partnerId } },
  })
  let earnings = 0
  let cod = 0
  let paid = 0
  for (const e of docs) {
    const amount = e.amountPaise ?? 0
    if (EARNING_TYPES.includes(e.type as LedgerType)) earnings += amount
    else if (e.type === 'cod_collected' || e.type === 'cod_deposited') cod += amount
    else if (e.type === 'payout') paid += amount
  }
  // cod_collected rows are negative (owed to dwaar), deposits positive; payouts are negative.
  return {
    earningsPaise: earnings,
    cashInHandPaise: Math.max(0, -cod),
    paidOutPaise: -paid,
    payablePaise: earnings + cod + paid,
  }
}
