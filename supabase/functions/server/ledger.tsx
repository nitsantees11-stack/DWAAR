import { UniqueViolation, createDoc, find, idOf } from './db.tsx'
import { getConfig, type BusinessConfig } from './catalog.tsx'
import type { BookingFlow, DispatchLeg } from './lib-booking-machine.tsx'
import type { LedgerType } from './lib-partner-constants.tsx'

// deno-lint-ignore no-explicit-any
type Booking = Record<string, any>
type PartnerPay = NonNullable<BusinessConfig['partnerPay']>

export async function getPartnerPay(): Promise<{ pay: PartnerPay; config: BusinessConfig }> {
  const config = await getConfig()
  return { pay: config.partnerPay ?? {}, config }
}

export function sharePercentFor(pay: PartnerPay, categoryId: string | null) {
  const row = (pay.partnerSharePercent ?? []).find((r) => idOf(r.category) === categoryId)
  return row?.percent ?? pay.defaultSharePercent ?? 80
}

/** Parts the partner paid for and proved with a bill photo. */
export function billedPartsPaise(booking: Booking) {
  return ((booking.partsUsed ?? []) as Booking[]).filter((p) => idOf(p.bill)).reduce((sum, p) => sum + (p.pricePaise ?? 0), 0)
}

/** What the customer pays in total for the job (locked quote, else the fixed estimate). */
export function amountDuePaise(booking: Booking): number {
  return booking.pricing?.finalPaise ?? booking.pricing?.estimateMaxPaise ?? 0
}

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
export async function appendLedger(entry: EntryInput): Promise<boolean> {
  if (!entry.amountPaise) return false
  try {
    await createDoc('earnings-ledger', { ...entry, booking: entry.booking ?? null, payout: entry.payout ?? null })
    return true
  } catch (err) {
    if (err instanceof UniqueViolation) return false
    throw err
  }
}

/** Earnings for a COMPLETED booking, once per booking (same rules as the Payload app). */
export async function writeCompletionLedger(booking: Booking) {
  const { pay } = await getPartnerPay()
  const flow = booking.flow as BookingFlow
  const worker = flow === 'pickup_drop' ? idOf(booking.hubPartner) : idOf(booking.assignedPartner)
  const code = booking.bookingCode
  if (worker) {
    const b = jobEarningBreakdown(booking, pay)
    await appendLedger({ partner: worker, booking: booking.id, type: 'job_earning', amountPaise: b.jobEarning, note: `Job ${code}`, entryKey: `${booking.id}:job_earning` })
    if (flow !== 'pickup_drop') {
      await appendLedger({ partner: worker, booking: booking.id, type: 'visit_share', amountPaise: b.visitShare, note: `Visit fee share ${code}`, entryKey: `${booking.id}:visit_share` })
    }
    await appendLedger({ partner: worker, booking: booking.id, type: 'parts_reimbursement', amountPaise: b.parts, note: `Parts with bill ${code}`, entryKey: `${booking.id}:parts_reimbursement` })
  }
  if (flow === 'pickup_drop') {
    const offers = await find<Booking>('job-offers', 'booking', booking.id)
    for (const offer of offers) {
      if (offer.status !== 'accepted' || !['pickup', 'delivery'].includes(offer.leg)) continue
      const rider = idOf(offer.partner)
      if (!rider) continue
      await appendLedger({
        partner: rider,
        booking: booking.id,
        type: 'job_earning',
        amountPaise: pay.riderLegFeePaise ?? 4000,
        note: `${offer.leg === 'pickup' ? 'Pickup' : 'Delivery'} leg ${code}`,
        entryKey: `${booking.id}:rider:${offer.leg}:${offer.round ?? 0}`,
      })
    }
  }
}

export async function writeReleasePenalty(args: { partner: string; booking: Booking; round: number; reason?: string }) {
  const { pay } = await getPartnerPay()
  return appendLedger({
    partner: args.partner,
    booking: args.booking.id,
    type: 'penalty',
    amountPaise: -(pay.releasePenaltyPaise ?? 5000),
    note: `Released ${args.booking.bookingCode}${args.reason ? `: ${args.reason}` : ''}`.slice(0, 200),
    entryKey: `${args.booking.id}:release:${args.round}:${args.partner}`,
  })
}

/**
 * A payout marked `failed` (e.g. in the Supabase dashboard) gives the reserved amount back,
 * exactly once. Run before every balance read so dashboard edits take effect.
 */
export async function refundFailedPayouts(partnerId: string) {
  for (const p of await find<Booking>('payouts', 'partner', partnerId)) {
    if (p.status !== 'failed') continue
    await appendLedger({ partner: partnerId, type: 'adjustment', amountPaise: p.amountPaise, note: `Payout ${p.id} failed, amount returned`, payout: p.id, entryKey: `payout-failed:${p.id}` })
  }
}

const EARNING_TYPES: LedgerType[] = ['job_earning', 'visit_share', 'parts_reimbursement', 'incentive', 'penalty', 'adjustment']

export async function ledgerEntries(partnerId: string) {
  await refundFailedPayouts(partnerId)
  return (await find<Booking>('earnings-ledger', 'partner', partnerId)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

export async function partnerBalances(partnerId: string, entries?: Booking[]) {
  const rows = entries ?? (await ledgerEntries(partnerId))
  let earnings = 0
  let cod = 0
  let paid = 0
  for (const e of rows) {
    const amount = e.amountPaise ?? 0
    if (EARNING_TYPES.includes(e.type)) earnings += amount
    else if (e.type === 'cod_collected' || e.type === 'cod_deposited') cod += amount
    else if (e.type === 'payout') paid += amount
  }
  return { earningsPaise: earnings, cashInHandPaise: Math.max(0, -cod), paidOutPaise: -paid, payablePaise: earnings + cod + paid }
}
