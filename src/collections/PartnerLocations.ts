import type { CollectionConfig } from 'payload'
import { adminOnly } from '../access'

/** Append-only GPS breadcrumbs. Rows older than 24 h are pruned by the location endpoint. */
export const PartnerLocations: CollectionConfig = {
  slug: 'partner-locations',
  labels: { singular: 'Partner location', plural: 'Partner locations' },
  admin: { group: 'Partners', defaultColumns: ['partner', 'booking', 'lat', 'lng', 'accuracy', 'recordedAt'] },
  defaultSort: '-recordedAt',
  access: { create: adminOnly, read: adminOnly, update: () => false, delete: adminOnly },
  fields: [
    { name: 'partner', type: 'relationship', relationTo: 'partners', required: true, index: true },
    { name: 'booking', type: 'relationship', relationTo: 'bookings', index: true },
    {
      type: 'row',
      fields: [
        { name: 'lat', type: 'number', required: true, min: -90, max: 90 },
        { name: 'lng', type: 'number', required: true, min: -180, max: 180 },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'accuracy', type: 'number', min: 0 },
        { name: 'heading', type: 'number', min: 0, max: 360 },
        { name: 'speed', type: 'number', min: 0 },
      ],
    },
    { name: 'recordedAt', type: 'date', required: true, index: true, admin: { date: { pickerAppearance: 'dayAndTime' } } },
  ],
}
