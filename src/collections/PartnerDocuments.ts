import type { Access, CollectionConfig } from 'payload'
import { adminOnly, adminOnlyField, isAdminReq, isPartnerReq } from '../access'
import { PARTNER_DOCUMENT_TYPES } from '../lib/partner/constants'

/**
 * Private KYC files. Only admins and the owning partner can read them, and every file
 * response is `private, no-store` so no CDN or browser cache keeps a copy.
 */
/** Own documents only. File downloads authenticate with the partner token directly. */
const readOwn: Access = ({ req }) => {
  if (isAdminReq(req)) return true
  if (isPartnerReq(req) && req.user) return { owner: { equals: req.user.id } }
  return false
}

export const PartnerDocuments: CollectionConfig = {
  slug: 'partner-documents',
  labels: { singular: 'Partner document', plural: 'Partner documents' },
  admin: {
    useAsTitle: 'type',
    group: 'Partners',
    defaultColumns: ['owner', 'type', 'status', 'expiresAt', 'createdAt'],
    description: 'KYC uploads. Approve or reject each one; the partner re-uploads rejected documents.',
  },
  access: {
    // Uploads arrive only through the partner API (system write with the owner set server-side).
    create: adminOnly,
    read: readOwn,
    update: adminOnly,
    delete: adminOnly,
  },
  upload: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    modifyResponseHeaders: ({ headers }) => {
      headers.set('Cache-Control', 'private, no-store')
      return headers
    },
  },
  fields: [
    { name: 'owner', type: 'relationship', relationTo: 'partners', required: true, index: true, access: { update: adminOnlyField } },
    {
      name: 'type',
      type: 'select',
      required: true,
      index: true,
      options: PARTNER_DOCUMENT_TYPES.map((value) => ({ label: value.replace(/_/g, ' '), value })),
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      index: true,
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'Approved', value: 'approved' },
        { label: 'Rejected', value: 'rejected' },
      ],
      admin: { position: 'sidebar' },
    },
    { name: 'rejectionReason', type: 'text', admin: { position: 'sidebar', condition: (_, s) => s?.status === 'rejected' } },
    { name: 'expiresAt', type: 'date', admin: { position: 'sidebar', description: 'Driving licence / RC validity.' } },
    { name: 'superseded', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar', description: 'A newer upload of this type exists.' } },
  ],
}
