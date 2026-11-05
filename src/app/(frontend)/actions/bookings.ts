'use server'

import { z } from 'zod'
import type { Booking, ServiceCategory } from '@/payload-types'
import { fail, type ActionResult } from '@/lib/action-result'
import { isSupabase } from '@/lib/backend'
import { asAction, sb } from '@/lib/sb'
import { getCurrentUser } from '@/lib/app-auth'
import { cancelPolicy, customerCan, type BookingFlow, type BookingStatus } from '@/lib/booking-machine'
import {
  createBookingSchema,
  draftSchema,
  isFailure,
  resolveDraft,
  type BookingDraft,
  type CreateBookingInput,
} from '@/lib/booking-server'
import { randomCode } from '@/lib/otp'
import { getPayloadClient } from '@/lib/payload'
import { randomInt } from 'node:crypto'

export async function previewCoupon(
  input: BookingDraft,
): Promise<ActionResult<{ code: string; discountPaise: number; payableMinPaise: number; payableMaxPaise: number }>> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  const parsed = draftSchema.safeParse(input)
  if (!parsed.success || !parsed.data.couponCode) return fail('coupon_invalid')
  if (isSupabase()) {
    return asAction(await sb('/c/bookings/preview-coupon', { body: parsed.data }), (x) => ({
      code: String(x.code),
      discountPaise: Number(x.discountPaise),
      payableMinPaise: Number(x.payableMinPaise),
      payableMaxPaise: Number(x.payableMaxPaise),
    }))
  }
  try {
    const payload = await getPayloadClient()
    const resolved = await resolveDraft(payload, user, parsed.data)
    if (isFailure(resolved)) return resolved
    return {
      ok: true,
      code: resolved.coupon?.code ?? parsed.data.couponCode.toUpperCase(),
      discountPaise: resolved.quote.discountPaise,
      payableMinPaise: resolved.quote.payableMinPaise,
      payableMaxPaise: resolved.quote.payableMaxPaise,
    }
  } catch {
    return fail('generic')
  }
}

/**
 * Bookings are admin-write-only at the collection boundary; customers create them only
 * through this action, which recomputes every price and rule from IDs before writing.
 */
export async function createBooking(input: CreateBookingInput): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  const parsed = createBookingSchema.safeParse(input)
  if (!parsed.success) return fail('invalid')
  const data = parsed.data
  if (isSupabase()) return asAction(await sb('/c/bookings', { body: data }), (x) => ({ id: String(x.id) }))

  try {
    const payload = await getPayloadClient()

    const duplicate = await payload.find({
      collection: 'bookings',
      overrideAccess: false,
      user,
      depth: 0,
      limit: 1,
      where: { idemKey: { equals: data.idemKey } },
    })
    if (duplicate.docs[0]) return { ok: true, id: duplicate.docs[0].id }

    let address
    try {
      address = await payload.findByID({ collection: 'addresses', id: data.addressId, overrideAccess: false, user, depth: 0 })
    } catch {
      return fail('address')
    }
    if (!address) return fail('address')

    const resolved = await resolveDraft(payload, user, data)
    if (isFailure(resolved)) return resolved

    const booking = await payload.create({
      collection: 'bookings',
      overrideAccess: true,
      context: { actor: 'customer', eventNote: 'Booked from the app' },
      data: {
        bookingCode: `DW${randomCode(7)}`,
        status: 'BOOKED',
        title:
          resolved.lines.length > 1
            ? `${resolved.lines[0].name} +${resolved.lines.length - 1}`
            : resolved.lines[0].name,
        deviceLabel: resolved.deviceLabel,
        customer: user.id,
        category: resolved.category.id,
        flow: resolved.flow,
        lines: resolved.lines,
        device: resolved.device,
        address: {
          ref: address.id,
          label: address.label,
          contactName: address.contactName,
          contactPhone: address.contactPhone,
          line: address.line ?? [address.flat, address.area, address.city, address.pincode].filter(Boolean).join(', '),
          landmark: address.landmark,
          lat: address.lat,
          lng: address.lng,
        },
        schedule: resolved.schedule,
        scheduleLabel: resolved.scheduleLabel,
        altWhatsapp: data.altWhatsapp || user.altWhatsapp || undefined,
        pricing: {
          estimateMinPaise: resolved.quote.payableMinPaise,
          estimateMaxPaise: resolved.quote.payableMaxPaise,
          visitFeePaise: resolved.quote.visitFeePaise,
          discountPaise: resolved.quote.discountPaise,
          couponCode: resolved.coupon?.code,
        },
        payment: { method: data.paymentMethod, status: 'pending' },
        serviceOtp: String(randomInt(1000, 10000)),
        warrantyDays: resolved.warrantyDays,
        trustAccepted: true,
        idemKey: data.idemKey,
        problem: {
          description: resolved.problem.description,
          video: resolved.problem.videoId,
          ninetyMinPromise: resolved.problem.ninetyMinPromise,
        },
      },
    })
    if (resolved.problem.videoId) {
      await payload.update({ collection: 'problem-videos', id: resolved.problem.videoId, overrideAccess: true, depth: 0, data: { booking: booking.id } })
    }
    return { ok: true, id: booking.id }
  } catch {
    return fail('generic')
  }
}

/** Loads a booking only if it belongs to the signed-in customer. */
async function ownBooking(id: string) {
  const user = await getCurrentUser()
  if (!user) return { user: null, booking: null } as const
  const payload = await getPayloadClient()
  try {
    const booking = (await payload.findByID({
      collection: 'bookings',
      id,
      overrideAccess: false,
      user,
      depth: 1,
    })) as Booking
    return { user, booking, payload } as const
  } catch {
    return { user, booking: null } as const
  }
}

const cancelSchema = z.object({
  id: z.string().min(1).max(64),
  reason: z.enum(['plan_changed', 'mistake', 'time', 'elsewhere', 'other']),
})

export async function cancelBooking(input: z.infer<typeof cancelSchema>): Promise<ActionResult> {
  const parsed = cancelSchema.safeParse(input)
  if (!parsed.success) return fail('invalid')
  if (isSupabase()) {
    if (!(await getCurrentUser())) return fail('auth')
    return asAction(await sb(`/c/bookings/${encodeURIComponent(parsed.data.id)}/cancel`, { body: { reason: parsed.data.reason } }), () => ({}))
  }
  const { user, booking, payload } = await ownBooking(parsed.data.id)
  if (!user) return fail('auth')
  if (!booking || !payload) return fail('not_found')

  const flow = booking.flow as BookingFlow
  const status = booking.status as BookingStatus
  if (!customerCan(flow, status, 'CANCELLED')) return fail('cannot_cancel')
  const category = booking.category as ServiceCategory
  const policy = cancelPolicy(flow, status, category?.pricing?.cancelAfterAssignFeePaise ?? 0)
  if (!policy.allowed) return fail('cannot_cancel')

  try {
    await payload.update({
      collection: 'bookings',
      id: booking.id,
      overrideAccess: true,
      context: { actor: 'customer', eventNote: `Cancelled by customer: ${parsed.data.reason}` },
      data: {
        status: 'CANCELLED',
        cancellation: { reason: parsed.data.reason, at: new Date().toISOString() },
        pricing: { ...booking.pricing, cancelFeePaise: policy.feePaise },
      },
    })
    return { ok: true }
  } catch {
    return fail('generic')
  }
}

const quoteSchema = z.object({ id: z.string().min(1).max(64), decision: z.enum(['approve', 'decline']) })

export async function respondToQuote(input: z.infer<typeof quoteSchema>): Promise<ActionResult> {
  const parsed = quoteSchema.safeParse(input)
  if (!parsed.success) return fail('invalid')
  if (isSupabase()) {
    if (!(await getCurrentUser())) return fail('auth')
    return asAction(await sb(`/c/bookings/${encodeURIComponent(parsed.data.id)}/quote`, { body: { decision: parsed.data.decision } }), () => ({}))
  }
  const { user, booking, payload } = await ownBooking(parsed.data.id)
  if (!user) return fail('auth')
  if (!booking || !payload) return fail('not_found')

  const flow = booking.flow as BookingFlow
  const status = booking.status as BookingStatus
  const to: BookingStatus = parsed.data.decision === 'approve' ? 'APPROVED' : 'DECLINED'
  if (status !== 'QUOTE_SENT' || !customerCan(flow, status, to)) return fail('cannot_respond')
  const category = booking.category as ServiceCategory

  try {
    await payload.update({
      collection: 'bookings',
      id: booking.id,
      overrideAccess: true,
      context: { actor: 'customer', eventNote: to === 'APPROVED' ? 'Quote approved in app' : 'Quote declined in app' },
      data: {
        status: to,
        ...(to === 'DECLINED'
          ? { pricing: { ...booking.pricing, declineFeePaise: category?.pricing?.declineFeePaise ?? 0 } }
          : {}),
      },
    })
    return { ok: true }
  } catch {
    return fail('generic')
  }
}

const rateSchema = z.object({
  id: z.string().min(1).max(64),
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
})

export async function rateBooking(input: z.infer<typeof rateSchema>): Promise<ActionResult> {
  const parsed = rateSchema.safeParse(input)
  if (!parsed.success) return fail('invalid')
  if (isSupabase()) {
    if (!(await getCurrentUser())) return fail('auth')
    return asAction(
      await sb(`/c/bookings/${encodeURIComponent(parsed.data.id)}/rate`, { body: { stars: parsed.data.stars, ...(parsed.data.comment ? { comment: parsed.data.comment } : {}) } }),
      () => ({}),
    )
  }
  const { user, booking, payload } = await ownBooking(parsed.data.id)
  if (!user) return fail('auth')
  if (!booking || !payload) return fail('not_found')
  if (booking.status !== 'COMPLETED' && booking.status !== 'RETURNED') return fail('cannot_rate')
  if (booking.rating?.stars) return fail('already_rated')

  try {
    await payload.update({
      collection: 'bookings',
      id: booking.id,
      overrideAccess: true,
      context: { actor: 'customer' },
      data: {
        rating: { stars: parsed.data.stars, comment: parsed.data.comment || undefined, at: new Date().toISOString() },
      },
    })
    return { ok: true }
  } catch {
    return fail('generic')
  }
}
