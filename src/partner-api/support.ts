import { z } from 'zod'
import type { Booking, PartnerTicket } from '@/payload-types'
import { idOf } from '../lib/partner/sys'
import { asPartner, fail, route } from './http'

function ticketDTO(t: PartnerTicket) {
  return {
    id: t.id,
    topic: t.topic,
    message: t.message,
    status: t.status,
    urgent: Boolean(t.urgent),
    reply: t.reply ?? null,
    bookingId: idOf(t.booking),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }
}

async function ownBooking(req: Parameters<Parameters<typeof route>[3]>[0]['req'], partner: Parameters<typeof asPartner>[0], bookingId?: string) {
  if (!bookingId) return null
  try {
    return (await req.payload.findByID({ collection: 'bookings', id: bookingId, depth: 0, ...asPartner(partner) })) as Booking
  } catch {
    throw fail(404, 'not_found', 'bookingId')
  }
}

export const supportEndpoints = [
  route('get', 'tickets', {}, async ({ req, partner }) => {
    const res = await req.payload.find({ collection: 'partner-tickets', depth: 0, limit: 50, sort: '-createdAt', ...asPartner(partner) })
    return { body: { tickets: (res.docs as PartnerTicket[]).map(ticketDTO) } }
  }),

  route(
    'post',
    'tickets',
    {
      body: z.object({
        topic: z.enum(['safety', 'payment', 'app', 'customer', 'other']),
        message: z.string().trim().min(5).max(1000),
        bookingId: z.string().min(1).max(64).optional(),
        idempotencyKey: z.string(),
      }),
    },
    async ({ req, partner, body }) => {
      const booking = await ownBooking(req, partner, body.bookingId)
      const ticket = (await req.payload.create({
        collection: 'partner-tickets',
        overrideAccess: true,
        data: { partner: partner.id, booking: booking?.id, topic: body.topic, message: body.message, status: 'open' },
      })) as PartnerTicket
      return { status: 201, body: { ticket: ticketDTO(ticket) } }
    },
  ),

  route(
    'post',
    'sos',
    { body: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), bookingId: z.string().min(1).max(64).optional(), idempotencyKey: z.string() }) },
    async ({ req, partner, body }) => {
      const booking = await ownBooking(req, partner, body.bookingId)
      const config = await req.payload.findGlobal({ slug: 'business-config', overrideAccess: true, depth: 0 })
      const ticket = (await req.payload.create({
        collection: 'partner-tickets',
        overrideAccess: true,
        data: {
          partner: partner.id,
          booking: booking?.id,
          topic: 'safety',
          urgent: true,
          status: 'open',
          sos: { lat: body.lat, lng: body.lng },
          message: `SOS from ${partner.name ?? partner.username} at ${body.lat.toFixed(5)}, ${body.lng.toFixed(5)}${booking ? ` during ${booking.bookingCode}` : ''}`,
        },
      })) as PartnerTicket
      // Shown at the top of Payload Admin (Partner ops) until resolved; also logged for on-call.
      req.payload.logger.error({ msg: 'PARTNER SOS', ticket: ticket.id, partner: partner.id, booking: booking?.id, lat: body.lat, lng: body.lng })
      return { status: 201, body: { ticket: ticketDTO(ticket), hubPhone: config.support?.phone ?? null, emergency: '112' } }
    },
  ),
]
