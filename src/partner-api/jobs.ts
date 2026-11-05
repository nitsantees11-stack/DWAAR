import type { PayloadRequest } from 'payload'
import { z } from 'zod'
import type { Booking, JobMedia, Partner, User } from '@/payload-types'
import { BOOKING_STATUSES, canRelease, partnerEdgesFor, type BookingFlow, type BookingStatus, type PartnerRole } from '../lib/booking-machine'
import { JOB_MEDIA_KINDS, SCHEDULED_DISPATCH_LEAD_MS } from '../lib/partner/constants'
import { advanceDispatch, releaseNonVisitLeg } from '../lib/partner/dispatch'
import { amountDuePaise, appendLedger } from '../lib/partner/ledger'
import { domainErrorOf, idOf, nowISO } from '../lib/partner/sys'
import { asPartner, fail, route } from './http'
import { jobDTO } from './dto'

const TERMINAL: BookingStatus[] = ['COMPLETED', 'RETURNED', 'CANCELLED']
const id = z.string().min(1).max(64)
const lat = z.number().min(-90).max(90)
const lng = z.number().min(-180).max(180)

async function loadJob(req: PayloadRequest, partner: Partner, bookingId: string) {
  try {
    return (await req.payload.findByID({ collection: 'bookings', id: bookingId, depth: 1, ...asPartner(partner) })) as Booking
  } catch {
    throw fail(404, 'not_found')
  }
}

async function respond(req: PayloadRequest, partner: Partner, bookingId: string, status = 200) {
  const booking = await loadJob(req, partner, bookingId)
  const fresh = (await req.payload.findByID({ collection: 'partners', id: partner.id, overrideAccess: true, depth: 0 })) as Partner
  const customer = (await req.payload.findByID({ collection: 'users', id: idOf(booking.customer) as string, overrideAccess: true, depth: 0, select: { name: true, username: true } })) as User
  return { status, body: { job: jobDTO(booking, fresh, { customerName: customer?.name, customerPhone: customer?.username }) } }
}

function requireAssignee(booking: Booking, partner: Partner) {
  if (idOf(booking.assignedPartner) !== partner.id) throw fail(403, 'not_assigned')
  if (TERMINAL.includes(booking.status as BookingStatus)) throw fail(409, 'job_closed')
}

/** A media id must be this booking's job media of the given kind(s). */
async function checkMedia(req: PayloadRequest, bookingId: string, ids: string[], kinds: string[]) {
  if (ids.length === 0) return
  const { docs } = await req.payload.find({
    collection: 'job-media',
    overrideAccess: true,
    depth: 0,
    pagination: false,
    where: { and: [{ id: { in: ids } }, { booking: { equals: bookingId } }, { kind: { in: kinds } }] },
  })
  if (docs.length !== new Set(ids).size) throw fail(400, 'invalid_media', 'mediaIds')
}

/**
 * Partner-scoped booking write. Access rules apply as the partner (only the leg they hold), and
 * the Bookings hook validates the edge with the proof passed in context.
 */
async function writeAsPartner(req: PayloadRequest, partner: Partner, booking: Booking, data: Partial<Booking>, transition: Record<string, unknown> = {}) {
  try {
    await req.payload.update({
      collection: 'bookings',
      id: booking.id,
      depth: 0,
      ...asPartner(partner, { actor: 'partner', transition }),
      data,
    })
  } catch (err) {
    const d = domainErrorOf(err)
    if (d?.code === 'otp_wrong') {
      // The failed write rolled back, so count the wrong attempt separately (max 5 per booking).
      const kind = d.params?.kind === 'delivery' ? 'delivery' : 'service'
      const full = (await req.payload.findByID({ collection: 'bookings', id: booking.id, overrideAccess: true, depth: 0, showHiddenFields: true })) as Booking
      await req.payload.update({
        collection: 'bookings',
        id: booking.id,
        overrideAccess: true,
        depth: 0,
        context: { actor: 'dispatcher', skipBookingEvents: true },
        data: { otpAttempts: { ...full.otpAttempts, [kind]: (full.otpAttempts?.[kind] ?? 0) + 1 } },
      })
      const left = Number(d.params?.left ?? 0)
      throw fail(400, left > 0 ? 'otp_wrong' : 'otp_locked', 'otp', { left })
    }
    throw err
  }
}

const transitionBody = z.object({
  to: z.enum(BOOKING_STATUSES),
  otp: z.string().regex(/^\d{4}$/).optional(),
  lat: lat.optional(),
  lng: lng.optional(),
  checklist: z
    .object({
      imei: z.string().regex(/^\d{15}$/),
      simRemoved: z.boolean(),
      memoryCardRemoved: z.boolean(),
      conditionNotes: z.string().trim().max(500).optional(),
    })
    .optional(),
  mediaIds: z.array(id).max(12).optional(),
  idempotencyKey: z.string(),
})

export const jobEndpoints = [
  route('get', 'jobs', {}, async ({ req, partner, query }) => {
    const state = query.get('state') ?? 'active'
    if (!['active', 'upcoming', 'past'].includes(state)) throw fail(400, 'invalid_state', 'state')
    await advanceDispatch(req.payload)
    const { docs } = await req.payload.find({ collection: 'bookings', depth: 1, limit: 100, sort: '-updatedAt', ...asPartner(partner) })
    const now = Date.now()
    const classify = (b: Booking) => {
      const mine = idOf(b.assignedPartner) === partner.id
      if (!mine || TERMINAL.includes(b.status as BookingStatus)) return 'past'
      const start = b.schedule?.startAt ? new Date(b.schedule.startAt).getTime() : 0
      if (b.schedule?.mode === 'scheduled' && b.status === 'PARTNER_ASSIGNED' && start - SCHEDULED_DISPATCH_LEAD_MS > now) return 'upcoming'
      return 'active'
    }
    const jobs = (docs as Booking[]).filter((b) => classify(b) === state).map((b) => jobDTO(b, partner))
    return { body: { state, jobs } }
  }),

  route('get', 'jobs/:id', {}, async ({ req, partner, params }) => {
    await advanceDispatch(req.payload, { bookingId: params.id })
    return respond(req, partner, params.id)
  }),

  route('post', 'jobs/:id/transition', { body: transitionBody }, async ({ req, partner, params, body }) => {
    const booking = await loadJob(req, partner, params.id)
    requireAssignee(booking, partner)
    if (body.to === 'QUOTE_SENT') throw fail(400, 'use_quote_endpoint', 'to')
    if (body.to === 'BOOKED') throw fail(400, 'use_release_endpoint', 'to')
    if (body.to === 'CANCELLED') throw fail(400, 'use_no_show_endpoint', 'to')
    const data: Partial<Booking> = { status: body.to }
    if (body.checklist || body.mediaIds) {
      await checkMedia(req, booking.id, body.mediaIds ?? [], ['pickup_photo'])
      data.pickupChecklist = { ...booking.pickupChecklist, ...body.checklist, photos: body.mediaIds ?? (booking.pickupChecklist?.photos ?? []).map(idOf).filter((x): x is string => Boolean(x)) }
    }
    await writeAsPartner(req, partner, booking, data, { otp: body.otp, lat: body.lat, lng: body.lng })
    if (body.lat !== undefined && body.lng !== undefined) {
      await req.payload.create({ collection: 'partner-locations', overrideAccess: true, data: { partner: partner.id, booking: booking.id, lat: body.lat, lng: body.lng, recordedAt: nowISO() } })
      await req.payload.update({ collection: 'partners', id: partner.id, overrideAccess: true, depth: 0, data: { lastLat: body.lat, lastLng: body.lng, lastSeenAt: nowISO() } })
    }
    if (body.to === 'ON_THE_WAY') await req.payload.update({ collection: 'partners', id: partner.id, overrideAccess: true, depth: 0, data: { currentJob: booking.id } })
    return respond(req, partner, booking.id)
  }),

  route('post', 'jobs/:id/media', { multipart: true, body: z.object({ kind: z.enum(JOB_MEDIA_KINDS), idempotencyKey: z.string() }) }, async ({ req, partner, params, body }) => {
    const booking = await loadJob(req, partner, params.id)
    requireAssignee(booking, partner)
    const file = req.file
    if (!file) throw fail(400, 'file_required', 'file')
    const video = body.kind === 'quote_video'
    if (video ? !/^video\//.test(file.mimetype) : !/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.mimetype)) throw fail(400, 'file_type', 'file')
    if (file.size > (video ? 50 : 10) * 1024 * 1024) throw fail(413, 'file_too_large', 'file')
    const ext = file.mimetype.split('/')[1]?.replace('quicktime', 'mov') ?? 'bin'
    const media = (await req.payload.create({
      collection: 'job-media',
      overrideAccess: true,
      data: { booking: booking.id, partner: partner.id, kind: body.kind },
      file: { ...file, name: `${booking.bookingCode}-${body.kind}-${Date.now()}.${ext}` },
    })) as JobMedia
    return { status: 201, body: { media: { id: media.id, kind: media.kind, mimeType: media.mimeType, url: `/api/partner/v1/files/job-media/${media.id}` } } }
  }),

  route(
    'post',
    'jobs/:id/quote',
    {
      body: z.object({
        diagnosis: z.string().trim().min(3).max(1000),
        items: z
          .array(z.object({ label: z.string().trim().min(2).max(80), grade: z.enum(['original', 'premium', 'normal', 'labour']).optional(), pricePaise: z.number().int().min(0).max(10_000_000), isExtraPart: z.boolean().optional() }))
          .min(1)
          .max(20),
        totalPaise: z.number().int().min(1).max(50_000_000),
        videoMediaId: id.optional(),
        idempotencyKey: z.string(),
      }),
    },
    async ({ req, partner, params, body }) => {
      const booking = await loadJob(req, partner, params.id)
      requireAssignee(booking, partner)
      if (body.videoMediaId) await checkMedia(req, booking.id, [body.videoMediaId], ['quote_video'])
      await writeAsPartner(req, partner, booking, {
        status: 'QUOTE_SENT',
        quote: { ...booking.quote, diagnosis: body.diagnosis, items: body.items, totalPaise: body.totalPaise, videoMedia: body.videoMediaId ?? null },
      })
      return respond(req, partner, booking.id)
    },
  ),

  route(
    'post',
    'jobs/:id/parts',
    {
      body: z.object({
        parts: z.array(z.object({ name: z.string().trim().min(2).max(80), pricePaise: z.number().int().min(0).max(5_000_000), billMediaId: id.optional() })).min(1).max(10),
        idempotencyKey: z.string(),
      }),
    },
    async ({ req, partner, params, body }) => {
      const booking = await loadJob(req, partner, params.id)
      requireAssignee(booking, partner)
      if (!['ARRIVED', 'IN_PROGRESS', 'APPROVED', 'AT_HUB'].includes(booking.status)) throw fail(409, 'parts_not_allowed_now')
      await checkMedia(req, booking.id, body.parts.map((p) => p.billMediaId).filter((x): x is string => Boolean(x)), ['part_bill'])
      const existing = (booking.partsUsed ?? []).map((p) => ({ name: p.name, pricePaise: p.pricePaise, bill: idOf(p.bill) }))
      await writeAsPartner(req, partner, booking, {
        partsUsed: [...existing, ...body.parts.map((p) => ({ name: p.name, pricePaise: p.pricePaise, bill: p.billMediaId ?? null }))],
      })
      return respond(req, partner, booking.id)
    },
  ),

  route(
    'post',
    'jobs/:id/payment',
    { body: z.object({ method: z.enum(['cash', 'upi']), amountPaise: z.number().int().min(0), reference: z.string().trim().max(60).optional(), idempotencyKey: z.string() }) },
    async ({ req, partner, params, body }) => {
      const booking = await loadJob(req, partner, params.id)
      requireAssignee(booking, partner)
      const flow = booking.flow as BookingFlow
      const canComplete = partnerEdgesFor(flow, partner.role as PartnerRole, booking.status as BookingStatus).some((e) => e.to === 'COMPLETED')
      if (!canComplete) throw fail(409, 'payment_not_allowed_now')
      if (booking.paymentCollection?.collectedAt || booking.payment?.status === 'paid') throw fail(409, 'already_paid')
      const due = amountDuePaise(booking)
      if (body.amountPaise !== due) throw fail(400, 'amount_mismatch', 'amountPaise', { expected: due })
      if (body.method === 'upi' && !body.reference) throw fail(400, 'reference_required', 'reference')
      const at = nowISO()
      await writeAsPartner(req, partner, booking, {
        paymentCollection: { method: body.method, amountPaise: body.amountPaise, reference: body.reference, collectedBy: partner.id, collectedAt: at },
        payment: { ...booking.payment, status: 'paid' },
      })
      if (body.method === 'cash') {
        // Cash the partner now holds for dwaar; it is netted off the next payout.
        await appendLedger(req.payload, { partner: partner.id, booking: booking.id, type: 'cod_collected', amountPaise: -body.amountPaise, note: `Cash collected ${booking.bookingCode}`, entryKey: `${booking.id}:cod_collected` })
      }
      return respond(req, partner, booking.id)
    },
  ),

  route('post', 'jobs/:id/no-show', { body: z.object({ lat, lng, idempotencyKey: z.string() }) }, async ({ req, partner, params, body }) => {
    const booking = await loadJob(req, partner, params.id)
    requireAssignee(booking, partner)
    await writeAsPartner(req, partner, booking, { status: 'CANCELLED' }, { noShow: true, lat: body.lat, lng: body.lng })
    return respond(req, partner, booking.id)
  }),

  route('post', 'jobs/:id/release', { body: z.object({ reason: z.string().trim().min(3).max(200), idempotencyKey: z.string() }) }, async ({ req, partner, params, body }) => {
    const booking = await loadJob(req, partner, params.id)
    requireAssignee(booking, partner)
    if (canRelease(booking.flow as BookingFlow, booking.status as BookingStatus)) {
      await writeAsPartner(req, partner, booking, { status: 'BOOKED' }, { releaseReason: body.reason })
    } else {
      await releaseNonVisitLeg(req.payload, booking, partner, body.reason)
    }
    return { body: { released: true, bookingId: booking.id } }
  }),

  route(
    'post',
    'jobs/:id/rate-customer',
    { body: z.object({ stars: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional(), idempotencyKey: z.string() }) },
    async ({ req, partner, params, body }) => {
      const booking = await loadJob(req, partner, params.id)
      if (booking.status !== 'COMPLETED' && booking.status !== 'RETURNED') throw fail(409, 'cannot_rate')
      if (booking.customerRatingByPartner?.stars) throw fail(409, 'already_rated')
      await req.payload.update({
        collection: 'bookings',
        id: booking.id,
        overrideAccess: true,
        depth: 0,
        context: { actor: 'dispatcher', skipBookingEvents: true },
        data: { customerRatingByPartner: { stars: body.stars, comment: body.comment } },
      })
      return respond(req, partner, booking.id)
    },
  ),
]
