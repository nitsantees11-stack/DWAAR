import type { CollectionAfterChangeHook, CollectionConfig } from 'payload'
import { adminOnly, partnerOwnerOrAdmin } from '../access'

/** A failed payout gives the reserved amount back to the partner's ledger, exactly once. */
const refundFailed: CollectionAfterChangeHook = async ({ doc, previousDoc, req, operation }) => {
  if (operation !== 'update' || doc.status !== 'failed' || previousDoc?.status === 'failed') return doc
  const partner = typeof doc.partner === 'object' ? doc.partner.id : doc.partner
  try {
    await req.payload.create({
      collection: 'earnings-ledger',
      overrideAccess: true,
      req,
      data: {
        partner,
        type: 'adjustment',
        amountPaise: doc.amountPaise,
        note: `Payout ${doc.id} failed, amount returned`,
        payout: doc.id,
        entryKey: `payout-failed:${doc.id}`,
      },
    })
  } catch {
    // Unique entryKey: already refunded.
  }
  return doc
}

export const Payouts: CollectionConfig = {
  slug: 'payouts',
  labels: { singular: 'Payout', plural: 'Payouts' },
  admin: {
    group: 'Partners',
    defaultColumns: ['partner', 'amountPaise', 'status', 'periodStart', 'periodEnd', 'reference', 'createdAt'],
  },
  defaultSort: '-createdAt',
  access: { create: adminOnly, read: partnerOwnerOrAdmin('partner'), update: adminOnly, delete: () => false },
  hooks: { afterChange: [refundFailed] },
  fields: [
    { name: 'partner', type: 'relationship', relationTo: 'partners', required: true, index: true },
    { name: 'amountPaise', type: 'number', required: true, min: 1, admin: { readOnly: true } },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'requested',
      index: true,
      options: ['requested', 'processing', 'paid', 'failed'].map((v) => ({ label: v, value: v })),
    },
    { name: 'reference', type: 'text', admin: { description: 'Bank UTR / UPI reference once paid.' } },
    {
      type: 'row',
      fields: [
        { name: 'periodStart', type: 'date' },
        { name: 'periodEnd', type: 'date' },
      ],
    },
  ],
}
