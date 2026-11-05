import type { Access, CollectionConfig } from 'payload'
import { adminOnly, isAdminReq, isAppUserReq } from '../access'
import { BOOKING_STATUSES } from '../lib/booking-machine'

const readOwnBookingEvents: Access = ({ req }) => {
  if (isAdminReq(req)) return true
  if (isAppUserReq(req) && req.user) return { 'booking.customer': { equals: req.user.id } }
  return false
}

/** Immutable audit trail. Written only by the Bookings afterChange hook. */
export const BookingEvents: CollectionConfig = {
  slug: 'booking-events',
  labels: { singular: 'Booking event', plural: 'Booking events' },
  admin: { group: 'Operations', defaultColumns: ['booking', 'status', 'actor', 'createdAt'] },
  defaultSort: 'createdAt',
  access: { create: adminOnly, read: readOwnBookingEvents, update: () => false, delete: () => false },
  fields: [
    { name: 'booking', type: 'relationship', relationTo: 'bookings', required: true, index: true },
    { name: 'status', type: 'select', required: true, options: BOOKING_STATUSES.map((s) => ({ label: s, value: s })) },
    {
      name: 'actor',
      type: 'select',
      required: true,
      options: [
        { label: 'Customer', value: 'customer' },
        { label: 'Hub', value: 'hub' },
        { label: 'System', value: 'system' },
        { label: 'Partner', value: 'partner' },
      ],
    },
    { name: 'partner', type: 'relationship', relationTo: 'partners', index: true },
    { name: 'note', type: 'text' },
  ],
}
