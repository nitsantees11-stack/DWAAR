import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { adminOnlyField, appUserOrAdmin, isAppUserReq, ownerOrAdmin } from '../access'

const setOwner: CollectionBeforeChangeHook = ({ data, req, operation }) => {
  // Owner always comes from the authenticated app user, never from submitted data.
  if (operation === 'create' && isAppUserReq(req) && req.user) data.owner = req.user.id
  return data
}

export const Addresses: CollectionConfig = {
  slug: 'addresses',
  admin: {
    useAsTitle: 'line',
    group: 'Customers',
    defaultColumns: ['line', 'label', 'owner', 'isDefault'],
  },
  access: {
    create: appUserOrAdmin,
    read: ownerOrAdmin('owner'),
    update: ownerOrAdmin('owner'),
    delete: ownerOrAdmin('owner'),
  },
  hooks: { beforeChange: [setOwner] },
  fields: [
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      access: { update: adminOnlyField },
      admin: { position: 'sidebar' },
    },
    {
      name: 'label',
      type: 'select',
      required: true,
      defaultValue: 'home',
      options: [
        { label: 'Home', value: 'home' },
        { label: 'Work', value: 'work' },
        { label: 'Other', value: 'other' },
      ],
    },
    { name: 'contactName', type: 'text', required: true, maxLength: 60 },
    { name: 'contactPhone', type: 'text', required: true, maxLength: 10 },
    { name: 'flat', type: 'text', required: true, maxLength: 80 },
    { name: 'area', type: 'text', required: true, maxLength: 120 },
    { name: 'landmark', type: 'text', maxLength: 120 },
    { name: 'city', type: 'text', required: true, maxLength: 60 },
    { name: 'pincode', type: 'text', required: true, maxLength: 6 },
    {
      name: 'line',
      type: 'text',
      admin: { readOnly: true, description: 'Display line, built from the fields above.' },
      hooks: {
        beforeChange: [
          ({ siblingData }) =>
            [siblingData.flat, siblingData.area, siblingData.city, siblingData.pincode]
              .filter(Boolean)
              .join(', '),
        ],
      },
    },
    { name: 'lat', type: 'number' },
    { name: 'lng', type: 'number' },
    { name: 'isDefault', type: 'checkbox', defaultValue: false },
  ],
}
