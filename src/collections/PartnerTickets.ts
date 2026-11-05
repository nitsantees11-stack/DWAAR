import type { CollectionConfig } from 'payload'
import { adminOnly, adminOnlyField, partnerOwnerOrAdmin } from '../access'

export const PartnerTickets: CollectionConfig = {
  slug: 'partner-tickets',
  labels: { singular: 'Partner ticket', plural: 'Partner tickets' },
  admin: {
    group: 'Partners',
    useAsTitle: 'topic',
    defaultColumns: ['partner', 'topic', 'status', 'booking', 'createdAt'],
    description: 'Partner support requests. SOS alerts arrive here as urgent safety tickets.',
  },
  defaultSort: '-createdAt',
  access: { create: adminOnly, read: partnerOwnerOrAdmin('partner'), update: adminOnly, delete: adminOnly },
  fields: [
    { name: 'partner', type: 'relationship', relationTo: 'partners', required: true, index: true, access: { update: adminOnlyField } },
    { name: 'booking', type: 'relationship', relationTo: 'bookings' },
    {
      name: 'topic',
      type: 'select',
      required: true,
      options: ['safety', 'payment', 'app', 'customer', 'other'].map((v) => ({ label: v, value: v })),
    },
    { name: 'message', type: 'textarea', required: true, maxLength: 1000 },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'open',
      index: true,
      options: ['open', 'in_progress', 'resolved'].map((v) => ({ label: v.replace('_', ' '), value: v })),
      admin: { position: 'sidebar' },
    },
    { name: 'urgent', type: 'checkbox', defaultValue: false, index: true, admin: { position: 'sidebar' } },
    {
      name: 'sos',
      type: 'group',
      admin: { condition: (_, s) => Boolean(s?.urgent) },
      fields: [
        { name: 'lat', type: 'number' },
        { name: 'lng', type: 'number' },
      ],
    },
    { name: 'reply', type: 'textarea', maxLength: 1000 },
  ],
}
