import type { Access, CollectionConfig, Where } from 'payload'
import { adminOnly, isAdminReq, isAppUserReq, isPartnerReq } from '../access'
import { JOB_MEDIA_KINDS } from '../lib/partner/constants'

/**
 * Private job evidence: pickup photos, bills, quote videos, signatures. Readable by admins,
 * the booking's customer and the partner who uploaded it / is assigned to the booking.
 * File reads go through access-checked handlers and are never cached publicly.
 */
const readJobMedia: Access = ({ req }): Where | boolean => {
  if (isAdminReq(req)) return true
  if (!req.user) return false
  if (isAppUserReq(req)) return { 'booking.customer': { equals: req.user.id } }
  if (isPartnerReq(req)) {
    return {
      or: [
        { partner: { equals: req.user.id } },
        { 'booking.assignedPartner': { equals: req.user.id } },
        { 'booking.riderPartner': { equals: req.user.id } },
        { 'booking.hubPartner': { equals: req.user.id } },
      ],
    }
  }
  return false
}

export const JobMedia: CollectionConfig = {
  slug: 'job-media',
  labels: { singular: 'Job media', plural: 'Job media' },
  admin: { group: 'Partners', defaultColumns: ['booking', 'kind', 'partner', 'createdAt'] },
  access: { create: adminOnly, read: readJobMedia, update: adminOnly, delete: adminOnly },
  upload: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf'],
    modifyResponseHeaders: ({ headers }) => {
      headers.set('Cache-Control', 'private, no-store')
      return headers
    },
  },
  fields: [
    { name: 'booking', type: 'relationship', relationTo: 'bookings', required: true, index: true },
    { name: 'partner', type: 'relationship', relationTo: 'partners', required: true, index: true },
    { name: 'kind', type: 'select', required: true, options: JOB_MEDIA_KINDS.map((value) => ({ label: value.replace(/_/g, ' '), value })) },
  ],
}
