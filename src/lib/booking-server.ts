import { z } from 'zod'
import type { Payload } from 'payload'
import type { Promotion, Service, ServiceCategory, User } from '@/payload-types'
import type { BookingFlow } from './booking-machine'
import { fail, type ActionFailure } from './action-result'
import { tierMultipliers } from './catalog'
import { formatINR } from './money'
import { findBySlug } from './payload'
import { couponDiscount, lineRange, priceBooking, type DeviceTier, type PriceQuote } from './pricing'
import { buildSlots, slotRangeLabel } from './slots'
import { formatDay, isNightIST, isWithinHoursIST } from './time'

const id = z.string().min(1).max(64)

export const draftSchema = z.object({
  categorySlug: z.string().min(1).max(120),
  lines: z
    .array(z.object({ serviceId: id, quantity: z.number().int().min(1).max(5) }))
    .min(1)
    .max(8),
  device: z.object({
    type: z.string().max(40).optional(),
    brand: z.string().max(40).optional(),
    modelId: id.optional(),
    modelText: z.string().max(60).optional(),
    notes: z.string().max(300).optional(),
  }),
  schedule: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('asap') }),
    z.object({ mode: z.literal('scheduled'), startAt: z.string().max(40) }),
  ]),
  couponCode: z.string().max(30).optional(),
  problem: z
    .object({
      description: z.string().max(500).optional(),
      videoId: id.optional(),
    })
    .optional(),
})
export type BookingDraft = z.infer<typeof draftSchema>

export const createBookingSchema = draftSchema.extend({
  addressId: id,
  paymentMethod: z.enum(['upi', 'card', 'cod']),
  altWhatsapp: z.union([z.literal(''), z.string().regex(/^[6-9]\d{9}$/)]).optional(),
  trustAccepted: z.literal(true),
  idemKey: z.string().min(8).max(64),
})
export type CreateBookingInput = z.infer<typeof createBookingSchema>

export interface ResolvedDraft {
  category: ServiceCategory
  flow: BookingFlow
  services: Service[]
  lines: { service: string; name: string; quantity: number; minPaise: number; maxPaise: number }[]
  device: { type?: string; brand?: string; model?: string; tier: DeviceTier; notes?: string }
  deviceLabel: string
  schedule: { mode: 'asap' | 'scheduled'; startAt: string; endAt: string }
  scheduleLabel: string
  quote: PriceQuote
  coupon: Promotion | null
  warrantyDays: number
  problem: { description?: string; videoId?: string; ninetyMinPromise: boolean }
}

/**
 * Re-derives every price, slot and eligibility rule on the server from IDs only. The
 * client preview uses the same pricing functions, but nothing the browser computes is
 * trusted when a booking is written.
 */
export async function resolveDraft(
  payload: Payload,
  user: User,
  draft: BookingDraft,
  now = new Date(),
): Promise<ResolvedDraft | ActionFailure> {
  const category = await findBySlug('service-categories', draft.categorySlug, { depth: 0 })
  if (!category) return fail('not_found')
  if (category.status !== 'live') return fail('category_unavailable')

  const wanted = new Map<string, number>()
  for (const line of draft.lines) wanted.set(line.serviceId, line.quantity)
  const { docs: services } = await payload.find({
    collection: 'services',
    overrideAccess: false,
    user,
    depth: 0,
    pagination: false,
    where: { and: [{ id: { in: [...wanted.keys()] } }, { category: { equals: category.id } }] },
  })
  if (services.length !== wanted.size) return fail('services')

  // Problem report: "Other problem" needs the customer's own words; some categories need a video
  // the customer recorded (their own, not yet used on another booking).
  const description = draft.problem?.description?.trim() || undefined
  if (services.some((s) => s.isOtherProblem) && (!description || description.length < 10)) return fail('problem_text')
  let videoId: string | undefined
  if (draft.problem?.videoId) {
    const { docs } = await payload.find({
      collection: 'problem-videos',
      overrideAccess: false,
      user,
      depth: 0,
      limit: 1,
      where: { and: [{ id: { equals: draft.problem.videoId } }, { owner: { equals: user.id } }, { booking: { exists: false } }] },
    })
    if (!docs[0]) return fail('problem_video')
    videoId = docs[0].id
  }
  if (category.requireProblemVideo && !videoId) return fail('problem_video')
  // The 90-minute promise holds only when every chosen problem is a 90-minute repair.
  const ninetyMinPromise = services.every((s) => s.ninetyMinPromise === true)

  // Device: a catalog model fixes the tier; otherwise price as mid-range.
  let tier: DeviceTier = 'mid'
  let brand = draft.device.brand?.trim() || undefined
  let model = draft.device.modelText?.trim() || undefined
  let type = draft.device.type?.trim() || undefined
  if (draft.device.modelId) {
    const { docs } = await payload.find({
      collection: 'device-models',
      overrideAccess: false,
      user,
      depth: 0,
      limit: 1,
      where: { and: [{ id: { equals: draft.device.modelId } }, { category: { equals: category.id } }] },
    })
    const found = docs[0]
    if (!found) return fail('device')
    tier = found.tier
    brand = found.brand
    model = found.model
    type = found.deviceType ?? type
  }
  const deviceTypes = category.deviceTypes ?? []
  if (type && deviceTypes.length > 0 && !deviceTypes.some((d) => d.value === type)) return fail('device')
  if (deviceTypes.length > 0 && !type) return fail('device')
  const typeLabel = deviceTypes.find((d) => d.value === type)?.label

  // Schedule
  const hours = category.serviceHours ?? {}
  const startHour = hours.startHour ?? 9
  const endHour = hours.endHour ?? 21
  let schedule: ResolvedDraft['schedule']
  let scheduleLabel: string
  if (draft.schedule.mode === 'asap') {
    if (!hours.allowAsap || !isWithinHoursIST(now, startHour, endHour)) return fail('slot')
    schedule = {
      mode: 'asap',
      startAt: now.toISOString(),
      endAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    }
    scheduleLabel = 'ASAP (right now)'
  } else {
    const startAt = draft.schedule.startAt
    const slot = buildSlots(now, startHour, endHour)
      .flat()
      .find((s) => s.startISO === startAt)
    if (!slot) return fail('slot')
    schedule = { mode: 'scheduled', startAt: slot.startISO, endAt: slot.endISO }
    scheduleLabel = `${formatDay(new Date(slot.startISO))}, ${slotRangeLabel(slot)} IST`
  }

  const flow = category.flow as BookingFlow
  const pricing = category.pricing ?? {}
  const night = isNightIST(new Date(schedule.startAt)) && (pricing.nightVisitFeePaise ?? 0) > 0
  const visitFeePaise = night ? (pricing.nightVisitFeePaise ?? 0) : (pricing.visitFeePaise ?? 0)

  const config = await payload.findGlobal({ slug: 'business-config', overrideAccess: false, user, depth: 0 })
  const multipliers = tierMultipliers(config)

  const ordered = draft.lines
    .map((l) => services.find((s) => s.id === l.serviceId))
    .filter((s): s is Service => Boolean(s))
  const priced = ordered.map((service) => {
    const quantity = service.allowQuantity ? (wanted.get(service.id) ?? 1) : 1
    const line = {
      priceType: service.priceType,
      priceFromPaise: service.priceFromPaise,
      priceToPaise: service.priceToPaise,
      tierPriced: service.tierPriced,
      quantity,
    }
    const range = lineRange(line, tier, multipliers)
    return { service, line, range }
  })

  let coupon: Promotion | null = null
  const code = draft.couponCode?.trim().toUpperCase()
  if (code) {
    const { docs } = await payload.find({
      collection: 'promotions',
      overrideAccess: false,
      user,
      depth: 0,
      limit: 1,
      where: { code: { equals: code } },
    })
    const promo = docs[0]
    if (!promo) return fail('coupon_invalid')
    if (promo.validUntil && new Date(promo.validUntil) <= now) return fail('coupon_expired')
    const promoCategory = typeof promo.category === 'object' ? promo.category?.id : promo.category
    if (promoCategory && promoCategory !== category.id) return fail('coupon_category')
    if (promo.firstBookingOnly) {
      const prior = await payload.count({
        collection: 'bookings',
        overrideAccess: false,
        user,
        where: { and: [{ customer: { equals: user.id } }, { status: { not_equals: 'CANCELLED' } }] },
      })
      if (prior.totalDocs > 0) return fail('coupon_first')
    }
    coupon = promo
  }

  const quote = priceBooking({
    flow,
    lines: priced.map((p) => p.line),
    tier,
    multipliers,
    visitFeePaise,
    coupon: coupon
      ? {
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          maxDiscountPaise: coupon.maxDiscountPaise,
          minOrderPaise: coupon.minOrderPaise,
        }
      : null,
  })
  if (coupon && quote.discountPaise <= 0) {
    const minimum = coupon.minOrderPaise ?? 0
    return fail('coupon_min', { amount: formatINR(minimum) })
  }

  const deviceLabel = [brand, model].filter(Boolean).join(' ') || typeLabel || brand || ''
  return {
    category,
    flow,
    services: ordered,
    lines: priced.map(({ service, line, range }) => ({
      service: service.id,
      name: service.name,
      quantity: line.quantity,
      minPaise: range.min,
      maxPaise: range.max,
    })),
    device: { type, brand, model, tier, notes: draft.device.notes?.trim() || undefined },
    deviceLabel,
    schedule,
    scheduleLabel,
    quote,
    coupon,
    warrantyDays: Math.max(0, ...ordered.map((s) => s.warrantyDays ?? 0)),
    problem: { description, videoId, ninetyMinPromise },
  }
}

export function isFailure(value: unknown): value is ActionFailure {
  return Boolean(value && typeof value === 'object' && 'ok' in value && (value as { ok: unknown }).ok === false)
}

export { couponDiscount }
