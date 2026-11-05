import type { CollectionConfig } from 'payload'
import { adminOnly, partnerOwnerOrAdmin } from '../access'
import { LEDGER_TYPES } from '../lib/partner/constants'

/**
 * Append-only money ledger. Every balance (earnings, cash in hand, payable) is a sum over
 * these rows. `entryKey` is unique so system writes are idempotent per booking and type.
 */
export const EarningsLedger: CollectionConfig = {
  slug: 'earnings-ledger',
  labels: { singular: 'Ledger entry', plural: 'Earnings ledger' },
  admin: {
    group: 'Partners',
    useAsTitle: 'entryKey',
    defaultColumns: ['partner', 'type', 'amountPaise', 'booking', 'note', 'createdAt'],
    description: 'Signed amounts in paise. Credits are positive; cash collected and payouts are negative.',
  },
  defaultSort: '-createdAt',
  access: { create: adminOnly, read: partnerOwnerOrAdmin('partner'), update: () => false, delete: () => false },
  fields: [
    { name: 'partner', type: 'relationship', relationTo: 'partners', required: true, index: true },
    { name: 'booking', type: 'relationship', relationTo: 'bookings', index: true },
    { name: 'type', type: 'select', required: true, index: true, options: LEDGER_TYPES.map((v) => ({ label: v.replace(/_/g, ' '), value: v })) },
    { name: 'amountPaise', type: 'number', required: true },
    { name: 'note', type: 'text', maxLength: 200 },
    { name: 'payout', type: 'relationship', relationTo: 'payouts' },
    {
      name: 'entryKey',
      type: 'text',
      unique: true,
      index: true,
      admin: { readOnly: true, description: 'Idempotency key for system entries.' },
      hooks: {
        // Manual admin entries (incentives, adjustments) get a unique key automatically.
        beforeValidate: [({ value }) => value || `manual:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`],
      },
    },
  ],
}
