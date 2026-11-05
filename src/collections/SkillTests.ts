import type { CollectionConfig } from 'payload'
import { adminOnly } from '../access'
import { SKILL_PASS_PERCENT } from '../lib/partner/constants'

/**
 * Per-category skill test. Read only by admins: the partner API serves questions without
 * `correctIndex` and grades submissions on the server.
 */
export const SkillTests: CollectionConfig = {
  slug: 'skill-tests',
  labels: { singular: 'Skill test', plural: 'Skill tests' },
  admin: {
    group: 'Partners',
    useAsTitle: 'title',
    defaultColumns: ['title', 'category', 'updatedAt'],
    description: `Partners pass at ${SKILL_PASS_PERCENT}% or more.`,
  },
  access: { create: adminOnly, read: adminOnly, update: adminOnly, delete: adminOnly },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'category', type: 'relationship', relationTo: 'service-categories', required: true, unique: true, index: true },
    {
      name: 'questions',
      type: 'array',
      required: true,
      minRows: 1,
      fields: [
        { name: 'question', type: 'text', required: true },
        {
          name: 'options',
          type: 'array',
          required: true,
          minRows: 4,
          maxRows: 4,
          fields: [{ name: 'text', type: 'text', required: true }],
        },
        { name: 'correctIndex', type: 'number', required: true, min: 0, max: 3 },
      ],
    },
  ],
}
