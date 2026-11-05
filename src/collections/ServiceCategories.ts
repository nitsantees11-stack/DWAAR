import type { CollectionConfig } from 'payload'
import { adminOnly, publicRead } from '../access'
import { catalogAfterChange, catalogAfterDelete } from '../hooks/revalidate'

/** Category-driven architecture: a new vertical is a new row here, not new screens. */
export const ServiceCategories: CollectionConfig = {
  slug: 'service-categories',
  labels: { singular: 'Service category', plural: 'Service categories' },
  admin: {
    useAsTitle: 'name',
    group: 'Catalog',
    defaultColumns: ['name', 'status', 'flow', 'order'],
  },
  defaultSort: 'order',
  access: { read: publicRead, create: adminOnly, update: adminOnly, delete: adminOnly },
  hooks: { afterChange: [catalogAfterChange], afterDelete: [catalogAfterDelete] },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'slug', useAsSlug: 'name' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'live',
      options: [
        { label: 'Live', value: 'live' },
        { label: 'Coming soon', value: 'coming_soon' },
      ],
      admin: { position: 'sidebar' },
    },
    {
      name: 'flow',
      type: 'select',
      required: true,
      options: [
        { label: 'Pickup & drop (hub repair)', value: 'pickup_drop' },
        { label: 'Doorstep visit', value: 'doorstep' },
        { label: 'Roadside / on-spot', value: 'roadside' },
      ],
      admin: { position: 'sidebar' },
    },
    {
      name: 'icon',
      type: 'select',
      required: true,
      options: [
        { label: 'Mobile', value: 'mobile' },
        { label: 'AC', value: 'ac' },
        { label: 'Bike', value: 'bike' },
        { label: 'Fridge', value: 'fridge' },
        { label: 'Car', value: 'car' },
      ],
      admin: { position: 'sidebar' },
    },
    { name: 'order', type: 'number', defaultValue: 0, admin: { position: 'sidebar' } },
    { name: 'tagline', type: 'text', required: true },
    { name: 'description', type: 'textarea', required: true },
    { name: 'heroImage', type: 'upload', relationTo: 'media' },
    {
      name: 'promise',
      type: 'group',
      fields: [
        { name: 'value', type: 'text', admin: { description: 'Short, e.g. "90 min"' } },
        { name: 'label', type: 'text', admin: { description: 'e.g. "pickup se drop"' } },
      ],
    },
    {
      name: 'requireProblemVideo',
      label: 'Problem video required',
      type: 'checkbox',
      defaultValue: false,
      admin: { position: 'sidebar', description: 'Customers must record a short video of the problem before they can book.' },
    },
    {
      name: 'pricing',
      type: 'group',
      fields: [
        { name: 'visitFeePaise', type: 'number', defaultValue: 0, min: 0 },
        { name: 'nightVisitFeePaise', type: 'number', defaultValue: 0, min: 0 },
        {
          name: 'cancelAfterAssignFeePaise',
          type: 'number',
          defaultValue: 0,
          min: 0,
          admin: { description: 'Charged if cancelled after a partner is assigned.' },
        },
        {
          name: 'declineFeePaise',
          type: 'number',
          defaultValue: 0,
          min: 0,
          admin: { description: 'Charged if the customer declines the quote after checkup.' },
        },
      ],
    },
    {
      name: 'serviceHours',
      type: 'group',
      fields: [
        { name: 'startHour', type: 'number', defaultValue: 9, min: 0, max: 23 },
        { name: 'endHour', type: 'number', defaultValue: 21, min: 1, max: 24 },
        {
          name: 'allowAsap',
          type: 'checkbox',
          defaultValue: false,
          admin: { description: 'Show the "Abhi bulao" option (SOS style).' },
        },
      ],
    },
    {
      name: 'deviceTypes',
      type: 'array',
      admin: { description: 'e.g. Split AC / Window AC, Bike / Scooter' },
      fields: [
        { name: 'value', type: 'text', required: true },
        { name: 'label', type: 'text', required: true },
      ],
    },
    {
      name: 'brands',
      type: 'array',
      fields: [{ name: 'name', type: 'text', required: true }],
    },
    {
      name: 'highlights',
      type: 'array',
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'text', required: true },
      ],
    },
    {
      name: 'howItWorks',
      type: 'array',
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'body', type: 'text', required: true },
      ],
    },
    {
      name: 'faqs',
      type: 'array',
      fields: [
        { name: 'question', type: 'text', required: true },
        { name: 'answer', type: 'textarea', required: true },
      ],
    },
    { name: 'warrantyNote', type: 'textarea' },
    {
      name: 'launchNote',
      type: 'textarea',
      admin: { condition: (data) => data?.status === 'coming_soon' },
    },
  ],
}
