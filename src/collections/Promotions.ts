import type { CollectionConfig } from 'payload'
import { adminOnly, isAdminReq } from '../access'
import { catalogAfterChange, catalogAfterDelete } from '../hooks/revalidate'

export const Promotions: CollectionConfig = {
  slug: 'promotions',
  labels: { singular: 'Offer', plural: 'Offers' },
  admin: {
    useAsTitle: 'title',
    group: 'Catalog',
    defaultColumns: ['title', 'code', 'discountType', 'discountValue', 'active'],
  },
  access: {
    read: ({ req }) => (isAdminReq(req) ? true : { active: { equals: true } }),
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  hooks: { afterChange: [catalogAfterChange], afterDelete: [catalogAfterDelete] },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'subtitle', type: 'text', required: true },
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      hooks: { beforeValidate: [({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)] },
    },
    { name: 'active', type: 'checkbox', defaultValue: true, admin: { position: 'sidebar' } },
    {
      name: 'discountType',
      type: 'select',
      required: true,
      defaultValue: 'percent',
      options: [
        { label: 'Percent', value: 'percent' },
        { label: 'Flat (paise)', value: 'flat' },
      ],
    },
    { name: 'discountValue', type: 'number', required: true, min: 1 },
    { name: 'maxDiscountPaise', type: 'number', min: 0 },
    { name: 'minOrderPaise', type: 'number', defaultValue: 0, min: 0 },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'service-categories',
      admin: { description: 'Leave empty to apply on every live category.' },
    },
    { name: 'firstBookingOnly', type: 'checkbox', defaultValue: false },
    { name: 'validUntil', type: 'date' },
  ],
}
