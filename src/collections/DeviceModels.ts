import type { CollectionConfig } from 'payload'
import { adminOnly, publicRead } from '../access'
import { catalogAfterChange, catalogAfterDelete } from '../hooks/revalidate'

export const DeviceModels: CollectionConfig = {
  slug: 'device-models',
  labels: { singular: 'Device model', plural: 'Device models' },
  admin: {
    useAsTitle: 'model',
    group: 'Catalog',
    defaultColumns: ['model', 'brand', 'category', 'deviceType', 'tier'],
  },
  defaultSort: 'brand',
  access: { read: publicRead, create: adminOnly, update: adminOnly, delete: adminOnly },
  hooks: { afterChange: [catalogAfterChange], afterDelete: [catalogAfterDelete] },
  fields: [
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'service-categories',
      required: true,
      index: true,
    },
    { name: 'brand', type: 'text', required: true, index: true },
    { name: 'model', type: 'text', required: true },
    { name: 'deviceType', type: 'text', admin: { description: 'Matches a category device type value.' } },
    {
      name: 'tier',
      type: 'select',
      required: true,
      defaultValue: 'mid',
      options: [
        { label: 'Budget', value: 'budget' },
        { label: 'Mid', value: 'mid' },
        { label: 'Premium', value: 'premium' },
        { label: 'Flagship', value: 'flagship' },
      ],
    },
  ],
}
