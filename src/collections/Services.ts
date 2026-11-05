import type { CollectionConfig } from 'payload'
import { adminOnly, isAdminReq } from '../access'
import { catalogAfterChange, catalogAfterDelete } from '../hooks/revalidate'

/** Bookable line items inside a category (e.g. "Screen replacement", "AC jet service"). */
export const Services: CollectionConfig = {
  slug: 'services',
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'category', 'priceType', 'priceFromPaise', 'active'],
  },
  defaultSort: 'order',
  access: {
    read: ({ req }) => (isAdminReq(req) ? true : { active: { equals: true } }),
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  hooks: { afterChange: [catalogAfterChange], afterDelete: [catalogAfterDelete] },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'slug', useAsSlug: 'name' },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'service-categories',
      required: true,
      index: true,
      admin: { position: 'sidebar' },
    },
    { name: 'active', type: 'checkbox', defaultValue: true, admin: { position: 'sidebar' } },
    { name: 'popular', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar' } },
    { name: 'order', type: 'number', defaultValue: 0, admin: { position: 'sidebar' } },
    { name: 'description', type: 'textarea', required: true },
    {
      name: 'priceType',
      type: 'select',
      required: true,
      defaultValue: 'fixed',
      options: [
        { label: 'Fixed price', value: 'fixed' },
        { label: 'Range (final after checkup)', value: 'range' },
      ],
    },
    { name: 'priceFromPaise', type: 'number', required: true, min: 0 },
    {
      name: 'priceToPaise',
      type: 'number',
      min: 0,
      admin: { condition: (_, sibling) => sibling?.priceType === 'range' },
    },
    {
      name: 'tierPriced',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'Scale the price by device tier (budget / mid / premium / flagship).' },
    },
    { name: 'durationLabel', type: 'text', admin: { description: 'e.g. "45 min"' } },
    {
      name: 'ninetyMinPromise',
      label: '90-min promise',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description: 'Tick only if this repair is done pickup to drop within 90 minutes. Leave off for long jobs (phone dead, water damage).',
      },
    },
    {
      name: 'isOtherProblem',
      label: '"Other problem" option',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description: 'The customer writes the problem in their own words; price comes after checkup. Shown only in the booking flow.',
      },
    },
    { name: 'warrantyDays', type: 'number', defaultValue: 0, min: 0 },
    {
      name: 'allowQuantity',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'Customers can book more than one unit (e.g. 2 ACs).' },
    },
    { name: 'includes', type: 'array', fields: [{ name: 'item', type: 'text', required: true }] },
  ],
}
