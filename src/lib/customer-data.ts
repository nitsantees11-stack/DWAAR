import type { Address, Booking, BookingEvent, SupportTicket, User, Warranty } from '@/payload-types'
import { isActive, type BookingFlow, type BookingStatus } from './booking-machine'
import { isSupabase } from './backend'
import { getPayloadClient } from './payload'
import { sb } from './sb'

/**
 * Reads that act for the signed-in customer. Payload: access rules scope every result to them.
 * Supabase: the function scopes by the session cookie.
 */
export async function getMyBookings(user: User, limit = 50): Promise<Booking[]> {
  if (isSupabase()) {
    const res = await sb<{ bookings: Booking[] }>(`/c/bookings?limit=${limit}`)
    return res.ok ? (res as { bookings: Booking[] }).bookings : []
  }
  const payload = await getPayloadClient()
  const res = await payload.find({
    collection: 'bookings',
    overrideAccess: false,
    user,
    depth: 1,
    limit,
    sort: '-createdAt',
  })
  return res.docs
}

/** One booking of the customer with its event trail and warranty, or null if not theirs. */
export async function getMyBooking(user: User, id: string): Promise<{ booking: Booking; events: BookingEvent[]; warranty: Warranty | null } | null> {
  if (isSupabase()) {
    const res = await sb<{ booking: Booking; events: BookingEvent[]; warranty: Warranty | null }>(`/c/bookings/${encodeURIComponent(id)}`)
    if (!res.ok) return null
    const r = res as { booking: Booking; events: BookingEvent[]; warranty: Warranty | null }
    return { booking: r.booking, events: r.events, warranty: r.warranty }
  }
  const payload = await getPayloadClient()
  let booking: Booking
  try {
    booking = await payload.findByID({ collection: 'bookings', id, overrideAccess: false, user, depth: 1 })
  } catch {
    return null
  }
  const [events, warranties] = await Promise.all([
    payload.find({
      collection: 'booking-events',
      overrideAccess: false,
      user,
      depth: 0,
      pagination: false,
      sort: '-createdAt',
      where: { booking: { equals: booking.id } },
    }),
    payload.find({ collection: 'warranties', overrideAccess: false, user, depth: 0, limit: 1, where: { booking: { equals: booking.id } } }),
  ])
  return { booking, events: events.docs, warranty: warranties.docs[0] ?? null }
}

export function isBookingActive(booking: Pick<Booking, 'flow' | 'status'>) {
  return isActive(booking.flow as BookingFlow, booking.status as BookingStatus)
}

export async function getMyAddresses(user: User): Promise<Address[]> {
  if (isSupabase()) {
    const res = await sb<{ addresses: Address[] }>('/c/addresses')
    return res.ok ? (res as { addresses: Address[] }).addresses : []
  }
  const payload = await getPayloadClient()
  const res = await payload.find({
    collection: 'addresses',
    overrideAccess: false,
    user,
    depth: 0,
    pagination: false,
    sort: '-createdAt',
  })
  return [...res.docs].sort((a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)))
}

export async function getMyWaitlist(user: User): Promise<string[]> {
  if (isSupabase()) {
    const res = await sb<{ categoryIds: string[] }>('/c/waitlist')
    return res.ok ? (res as { categoryIds: string[] }).categoryIds : []
  }
  const payload = await getPayloadClient()
  const res = await payload.find({
    collection: 'waitlist-entries',
    overrideAccess: false,
    user,
    depth: 0,
    pagination: false,
  })
  return res.docs.map((entry) => (typeof entry.category === 'object' ? entry.category.id : entry.category))
}

export async function getMyWarranties(user: User): Promise<Warranty[]> {
  if (isSupabase()) {
    const res = await sb<{ warranties: Warranty[] }>('/c/warranties')
    return res.ok ? (res as { warranties: Warranty[] }).warranties : []
  }
  const payload = await getPayloadClient()
  const res = await payload.find({
    collection: 'warranties',
    overrideAccess: false,
    user,
    depth: 0,
    pagination: false,
    sort: '-createdAt',
  })
  return res.docs
}

export async function getMyTickets(user: User): Promise<SupportTicket[]> {
  if (isSupabase()) {
    const res = await sb<{ tickets: SupportTicket[] }>('/c/tickets')
    return res.ok ? (res as { tickets: SupportTicket[] }).tickets : []
  }
  const payload = await getPayloadClient()
  const res = await payload.find({
    collection: 'support-tickets',
    overrideAccess: false,
    user,
    depth: 1,
    limit: 30,
    sort: '-createdAt',
  })
  return res.docs
}
