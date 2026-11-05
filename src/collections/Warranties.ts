import type { CollectionConfig } from 'payload'
import { adminOnly, ownerOrAdmin } from '../access'

/** Issued automatically when an app-approved booking completes. */
export const Warranties: CollectionConfig = {
  slug: 'warranties',
  admin: {
    useAsTitle: 'title',
    group: 'Operations',
    defaultColumns: ['title', 'customer', 'days', 'endsAt', 'status'],
  },
  access: {
    create: adminOnly,
    read: ownerOrAdmin('customer'),
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    { name: 'booking', type: 'relationship', relationTo: 'bookings', required: true, index: true },
    { name: 'customer', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'title', type: 'text', required: true },
    { name: 'deviceLabel', type: 'text' },
    { name: 'days', type: 'number', required: true, min: 1 },
    { name: 'startsAt', type: 'date', required: true },
    { name: 'endsAt', type: 'date', required: true },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Claimed', value: 'claimed' },
        { label: 'Expired', value: 'expired' },
        { label: 'Void', value: 'void' },
      ],
    },
    { name: 'claimsUsed', type: 'number', defaultValue: 0, min: 0, max: 2 },
  ],
}
