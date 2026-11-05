import type { CollectionConfig } from 'payload'
import { adminOnly } from '../access'

/** Stored responses for partner API writes, keyed by caller + route + idempotencyKey. */
export const IdempotencyKeys: CollectionConfig = {
  slug: 'idempotency-keys',
  labels: { singular: 'Idempotency key', plural: 'Idempotency keys' },
  admin: { group: 'System', useAsTitle: 'scopeKey', defaultColumns: ['scopeKey', 'state', 'statusCode', 'createdAt'] },
  access: { create: adminOnly, read: adminOnly, update: adminOnly, delete: adminOnly },
  fields: [
    { name: 'scopeKey', type: 'text', required: true, unique: true, index: true },
    { name: 'state', type: 'select', required: true, defaultValue: 'pending', options: ['pending', 'done'].map((v) => ({ label: v, value: v })) },
    { name: 'statusCode', type: 'number' },
    { name: 'response', type: 'json' },
  ],
}
