// Copied from src/lib/pricing.ts for the Supabase function. Keep both in sync (supabase/tests checks this).
import type { BookingFlow } from './lib-booking-machine.tsx'
import { roundPaise } from './lib-money.tsx'

export type DeviceTier = 'budget' | 'mid' | 'premium' | 'flagship'

export interface TierMultipliers {
  budget: number
  mid: number
  premium: number
  flagship: number
}

export interface PricedLine {
  priceType: 'fixed' | 'range'
  priceFromPaise: number
  priceToPaise?: number | null
  tierPriced?: boolean | null
  quantity: number
}

export interface PriceQuote {
  linesMinPaise: number
  linesMaxPaise: number
  visitFeePaise: number
  subtotalMinPaise: number
  subtotalMaxPaise: number
  discountPaise: number
  payableMinPaise: number
  payableMaxPaise: number
}

export interface CouponRule {
  discountType: 'percent' | 'flat'
  discountValue: number
  maxDiscountPaise?: number | null
  minOrderPaise?: number | null
}

export function lineRange(line: PricedLine, tier: DeviceTier, multipliers: TierMultipliers) {
  const mult = line.tierPriced ? (multipliers[tier] ?? 1) : 1
  const from = line.priceFromPaise
  const to = line.priceType === 'range' ? Math.max(from, line.priceToPaise ?? from) : from
  const qty = Math.max(1, line.quantity)
  return {
    min: roundPaise(from * mult) * qty,
    max: roundPaise(to * mult) * qty,
  }
}

export function couponDiscount(rule: CouponRule | null, subtotalMinPaise: number) {
  if (!rule) return 0
  if (subtotalMinPaise < (rule.minOrderPaise ?? 0)) return 0
  const raw =
    rule.discountType === 'percent'
      ? Math.round((subtotalMinPaise * rule.discountValue) / 100)
      : rule.discountValue
  const capped = rule.maxDiscountPaise ? Math.min(raw, rule.maxDiscountPaise) : raw
  return Math.max(0, Math.min(capped, subtotalMinPaise))
}

/**
 * Pickup & drop: pickup is free, the estimate is the repair range.
 * Doorstep / roadside: bill = max(visit fee, labour) — the visit fee covers the first slice of work.
 */
export function priceBooking(args: {
  flow: BookingFlow
  lines: PricedLine[]
  tier: DeviceTier
  multipliers: TierMultipliers
  visitFeePaise: number
  coupon: CouponRule | null
}): PriceQuote {
  const ranges = args.lines.map((l) => lineRange(l, args.tier, args.multipliers))
  const linesMinPaise = ranges.reduce((s, r) => s + r.min, 0)
  const linesMaxPaise = ranges.reduce((s, r) => s + r.max, 0)
  const visitFeePaise = args.flow === 'pickup_drop' ? 0 : args.visitFeePaise
  const subtotalMinPaise = Math.max(visitFeePaise, linesMinPaise)
  const subtotalMaxPaise = Math.max(visitFeePaise, linesMaxPaise)
  const discountPaise = couponDiscount(args.coupon, subtotalMinPaise)
  return {
    linesMinPaise,
    linesMaxPaise,
    visitFeePaise,
    subtotalMinPaise,
    subtotalMaxPaise,
    discountPaise,
    payableMinPaise: Math.max(0, subtotalMinPaise - discountPaise),
    payableMaxPaise: Math.max(0, subtotalMaxPaise - discountPaise),
  }
}

export function isNightHour(date: Date, startHour = 22, endHour = 6) {
  const h = date.getHours()
  return h >= startHour || h < endHour
}
