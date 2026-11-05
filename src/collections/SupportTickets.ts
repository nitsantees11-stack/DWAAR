import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { adminOnly, adminOnlyField, appUserOrAdmin, isAppUserReq, ownerOrAdmin } from '../access'

const prepare: CollectionBeforeChangeHook = ({ data, req, operation }) => {
  if (operation === 'create') {
    if (isAppUserReq(req) && req.user) data.user = req.user.id
    data.ticketCode = `T${Date.now().toString(36).toUpperCase().slice(-6)}`
    data.status = 'open'
  }
  return data
}

export const SupportTickets: CollectionConfig = {
  slug: 'support-tickets',
  labels: { singular: 'Support ticket', plural: 'Support tickets' },
  admin: {
    useAsTitle: 'ticketCode',
    group: 'Operations',
    defaultColumns: ['ticketCode', 'topic', 'status', 'user', 'createdAt'],
  },
  access: {
    create: appUserOrAdmin,
    read: ownerOrAdmin('user'),
    update: adminOnly,
    delete: adminOnly,
  },
  hooks: { beforeChange: [prepare] },
  fields: [
    { name: 'ticketCode', type: 'text', index: true, access: { update: adminOnlyField } },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      access: { update: adminOnlyField },
    },
    { name: 'booking', type: 'relationship', relationTo: 'bookings' },
    { name: 'warranty', type: 'relationship', relationTo: 'warranties' },
    {
      name: 'topic',
      type: 'select',
      required: true,
      options: [
        { label: 'Booking', value: 'booking' },
        { label: 'Payment', value: 'payment' },
        { label: 'Warranty claim', value: 'warranty' },
        { label: 'Account', value: 'account' },
        { label: 'Other', value: 'other' },
      ],
    },
    { name: 'message', type: 'textarea', required: true, maxLength: 1000 },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'open',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'In progress', value: 'in_progress' },
        { label: 'Resolved', value: 'resolved' },
      ],
      admin: { position: 'sidebar' },
      access: { update: adminOnlyField },
    },
    { name: 'reply', type: 'textarea', access: { create: adminOnlyField, update: adminOnlyField } },
  ],
}
