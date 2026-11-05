import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { adminOnly, adminOnlyField, appUserOrAdmin, isAppUserReq, ownerOrAdmin } from '../access'

const setUser: CollectionBeforeChangeHook = ({ data, req, operation }) => {
  if (operation === 'create' && isAppUserReq(req) && req.user) data.user = req.user.id
  return data
}

export const Waitlist: CollectionConfig = {
  slug: 'waitlist-entries',
  labels: { singular: 'Waitlist entry', plural: 'Waitlist' },
  admin: { group: 'Customers', defaultColumns: ['category', 'user', 'createdAt'] },
  access: {
    create: appUserOrAdmin,
    read: ownerOrAdmin('user'),
    update: adminOnly,
    delete: ownerOrAdmin('user'),
  },
  hooks: { beforeChange: [setUser] },
  fields: [
    { name: 'category', type: 'relationship', relationTo: 'service-categories', required: true },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      access: { update: adminOnlyField },
    },
  ],
}
