import { z } from 'zod'
import type { Booking, JobOffer, Partner } from '@/payload-types'
import type { BookingFlow } from '../lib/booking-machine'
import { distanceKm } from '../lib/geo'
import { GEOFENCE_M, LOCATION_MIN_INTERVAL_MS, LOCATION_RETENTION_MS } from '../lib/partner/constants'
import { acceptOffer, advanceDispatch, declineOffer, onlineBlocker } from '../lib/partner/dispatch'
import { idOf, nowISO } from '../lib/partner/sys'
import { asPartner, fail, route } from './http'
import { jobDTO, offerDTO, partnerDTO } from './dto'
import type { PayloadRequest } from 'payload'

const lat = z.number().min(-90).max(90)
const lng = z.number().min(-180).max(180)

let lastPrune = 0
/** Keep 24 h of breadcrumbs and idempotency records; runs at most every 10 minutes per server. */
async function prune(req: PayloadRequest) {
  if (Date.now() - lastPrune < 10 * 60 * 1000) return
  lastPrune = Date.now()
  const cutoff = new Date(Date.now() - LOCATION_RETENTION_MS).toISOString()
  try {
    await req.payload.delete({ collection: 'partner-locations', overrideAccess: true, where: { recordedAt: { less_than: cutoff } } })
    await req.payload.delete({ collection: 'idempotency-keys', overrideAccess: true, where: { createdAt: { less_than: cutoff } } })
  } catch (err) {
    req.payload.logger.error({ err, msg: 'partner retention prune failed' })
  }
}

/** Liveness for dispatch: any poll counts as "seen". */
async function heartbeat(req: PayloadRequest, partner: Partner, extra: Partial<Partner> = {}) {
  await req.payload.update({ collection: 'partners', id: partner.id, overrideAccess: true, depth: 0, data: { lastSeenAt: nowISO(), ...extra } })
}

export const liveEndpoints = [
  route('post', 'presence', { body: z.object({ online: z.boolean(), lat: lat.optional(), lng: lng.optional(), idempotencyKey: z.string() }) }, async ({ req, partner, body }) => {
    if (body.online) {
      const blocker = await onlineBlocker(req.payload, partner)
      if (blocker) {
        if (partner.isOnline) await heartbeat(req, partner, { isOnline: false })
        throw fail(403, blocker)
      }
      if (body.lat === undefined || body.lng === undefined) throw fail(400, 'location_required', 'lat')
    }
    await heartbeat(req, partner, {
      isOnline: body.online,
      ...(body.lat !== undefined && body.lng !== undefined ? { lastLat: body.lat, lastLng: body.lng } : {}),
    })
    if (body.online && body.lat !== undefined && body.lng !== undefined) {
      await req.payload.create({ collection: 'partner-locations', overrideAccess: true, data: { partner: partner.id, lat: body.lat, lng: body.lng, recordedAt: nowISO() } })
    }
    if (body.online) await advanceDispatch(req.payload)
    const fresh = (await req.payload.findByID({ collection: 'partners', id: partner.id, overrideAccess: true, depth: 1 })) as Partner
    return { body: { partner: partnerDTO(fresh) } }
  }),

  route(
    'post',
    'location',
    {
      body: z.object({
        lat,
        lng,
        accuracy: z.number().min(0).max(10000).optional(),
        heading: z.number().min(0).max(360).optional(),
        speed: z.number().min(0).max(100).optional(),
        bookingId: z.string().min(1).max(64).optional(),
        idempotencyKey: z.string(),
      }),
    },
    async ({ req, partner, body }) => {
      const last = await req.payload.find({ collection: 'partner-locations', overrideAccess: true, depth: 0, limit: 1, sort: '-recordedAt', where: { partner: { equals: partner.id } } })
      const prev = last.docs[0]
      if (prev) {
        const wait = LOCATION_MIN_INTERVAL_MS - (Date.now() - new Date(prev.recordedAt).getTime())
        if (wait > 0) throw fail(429, 'too_frequent', undefined, { retryAfterMs: wait })
      }
      let booking: Booking | null = null
      if (body.bookingId) {
        try {
          booking = (await req.payload.findByID({ collection: 'bookings', id: body.bookingId, depth: 0, ...asPartner(partner) })) as Booking
        } catch {
          throw fail(404, 'not_found', 'bookingId')
        }
        if (idOf(booking.assignedPartner) !== partner.id) throw fail(403, 'not_assigned', 'bookingId')
      }
      const recordedAt = nowISO()
      await req.payload.create({
        collection: 'partner-locations',
        overrideAccess: true,
        data: { partner: partner.id, booking: booking?.id, lat: body.lat, lng: body.lng, accuracy: body.accuracy, heading: body.heading, speed: body.speed, recordedAt },
      })
      await heartbeat(req, partner, { lastLat: body.lat, lastLng: body.lng })
      // Riders have no ARRIVED status: the first fix inside the geofence while on the way marks arrival.
      if (booking && (booking.flow as BookingFlow) === 'pickup_drop' && booking.status === 'ON_THE_WAY' && !booking.arrivedAt) {
        const bLat = booking.address?.lat
        const bLng = booking.address?.lng
        if (bLat != null && bLng != null && distanceKm(body.lat, body.lng, bLat, bLng) * 1000 <= GEOFENCE_M) {
          await req.payload.update({ collection: 'bookings', id: booking.id, overrideAccess: true, depth: 0, context: { actor: 'dispatcher', skipBookingEvents: true }, data: { arrivedAt: recordedAt } })
        }
      }
      await prune(req)
      return { status: 201, body: { recordedAt, nextAllowedAt: new Date(Date.now() + LOCATION_MIN_INTERVAL_MS).toISOString() } }
    },
  ),

  route('get', 'offers', {}, async ({ req, partner }) => {
    await advanceDispatch(req.payload)
    await heartbeat(req, partner)
    const { docs } = await req.payload.find({
      collection: 'job-offers',
      depth: 0,
      limit: 20,
      sort: '-offeredAt',
      ...asPartner(partner),
      where: { and: [{ status: { equals: 'offered' } }, { expiresAt: { greater_than: nowISO() } }] },
    })
    const config = await req.payload.findGlobal({ slug: 'business-config', overrideAccess: true, depth: 0 })
    const offers = []
    for (const o of docs as JobOffer[]) {
      const b = (await req.payload.findByID({ collection: 'bookings', id: idOf(o.booking) as string, overrideAccess: true, depth: 1 })) as Booking
      offers.push(offerDTO(o, b, config.zone?.name ?? null))
    }
    return { body: { offers, serverTime: nowISO() } }
  }),

  route('post', 'offers/:id/accept', { body: z.object({ idempotencyKey: z.string() }) }, async ({ req, partner, params }) => {
    const { booking } = await acceptOffer(req.payload, partner, params.id)
    const full = (await req.payload.findByID({ collection: 'bookings', id: booking.id, depth: 1, ...asPartner(partner) })) as Booking
    const fresh = (await req.payload.findByID({ collection: 'partners', id: partner.id, overrideAccess: true, depth: 0 })) as Partner
    return { body: { job: jobDTO(full, fresh) } }
  }),

  route('post', 'offers/:id/decline', { body: z.object({ reason: z.string().trim().min(2).max(200), idempotencyKey: z.string() }) }, async ({ req, partner, params, body }) => {
    const offer = await declineOffer(req.payload, partner, params.id, body.reason)
    return { body: { offer: { id: offer.id, status: 'declined' } } }
  }),
]
