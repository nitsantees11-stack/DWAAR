import type { CollectionConfig } from 'payload'
import { adminOnly, partnerOwnerOrAdmin } from '../access'

/**
 * One row per (booking leg, round, partner) offer. `offerKey` makes duplicate offers
 * impossible and `acceptLock` (unique, set only on accept) makes accept first-write-wins.
 */
export const JobOffers: CollectionConfig = {
  slug: 'job-offers',
  labels: { singular: 'Job offer', plural: 'Job offers' },
  admin: {
    group: 'Partners',
    defaultColumns: ['booking', 'partner', 'leg', 'status', 'rank', 'distanceKm', 'offeredAt', 'expiresAt'],
  },
  defaultSort: '-offeredAt',
  access: { create: adminOnly, read: partnerOwnerOrAdmin('partner'), update: adminOnly, delete: () => false },
  fields: [
    { name: 'booking', type: 'relationship', relationTo: 'bookings', required: true, index: true },
    { name: 'partner', type: 'relationship', relationTo: 'partners', required: true, index: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'offered',
      index: true,
      options: ['offered', 'accepted', 'declined', 'expired', 'withdrawn'].map((v) => ({ label: v, value: v })),
    },
    {
      type: 'row',
      fields: [
        { name: 'offeredAt', type: 'date', required: true, admin: { date: { pickerAppearance: 'dayAndTime' } } },
        { name: 'expiresAt', type: 'date', required: true, index: true, admin: { date: { pickerAppearance: 'dayAndTime' } } },
        { name: 'respondedAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
      ],
    },
    { name: 'declineReason', type: 'text', maxLength: 200 },
    {
      type: 'row',
      fields: [
        { name: 'distanceKm', type: 'number', min: 0 },
        { name: 'estimatedEarningPaise', type: 'number', min: 0 },
        { name: 'rank', type: 'number', min: 1, admin: { description: 'Attempt number for this leg.' } },
      ],
    },
    {
      name: 'leg',
      type: 'select',
      required: true,
      defaultValue: 'visit',
      options: ['visit', 'pickup', 'hub', 'delivery'].map((v) => ({ label: v, value: v })),
    },
    { name: 'round', type: 'number', defaultValue: 0, admin: { description: 'Dispatch round (bumps on release).' } },
    { name: 'offerKey', type: 'text', required: true, unique: true, index: true, admin: { readOnly: true } },
    { name: 'acceptLock', type: 'text', unique: true, index: true, admin: { readOnly: true } },
    { name: 'manual', type: 'checkbox', defaultValue: false, admin: { description: 'Assigned by the hub team.' } },
  ],
}
