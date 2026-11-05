import type { Access, CollectionConfig, Where } from 'payload'
import { adminOnly, isAdminReq, isAppUserReq, isPartnerReq } from '../access'

export const PROBLEM_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
export const PROBLEM_VIDEO_MAX_BYTES = 25 * 1024 * 1024

/**
 * Private: the customer who recorded it, admins, and partners working the linked booking.
 * Files are served through access-checked handlers and never cached publicly.
 */
const readProblemVideo: Access = ({ req }): Where | boolean => {
  if (isAdminReq(req)) return true
  if (!req.user) return false
  if (isAppUserReq(req)) return { owner: { equals: req.user.id } }
  if (isPartnerReq(req)) {
    return {
      or: [
        { 'booking.assignedPartner': { equals: req.user.id } },
        { 'booking.riderPartner': { equals: req.user.id } },
        { 'booking.hubPartner': { equals: req.user.id } },
      ],
    }
  }
  return false
}

/** Video a customer records of the problem before booking. Uploaded first, linked on booking. */
export const ProblemVideos: CollectionConfig = {
  slug: 'problem-videos',
  labels: { singular: 'Problem video', plural: 'Problem videos' },
  admin: { group: 'Operations', defaultColumns: ['filename', 'owner', 'booking', 'createdAt'] },
  // Created only by the server action that validates the uploader and file.
  access: { create: adminOnly, read: readProblemVideo, update: adminOnly, delete: adminOnly },
  upload: {
    mimeTypes: PROBLEM_VIDEO_MIME_TYPES,
    modifyResponseHeaders: ({ headers }) => {
      headers.set('Cache-Control', 'private, no-store')
      return headers
    },
  },
  fields: [
    { name: 'owner', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'booking', type: 'relationship', relationTo: 'bookings', index: true, admin: { description: 'Set when the booking is confirmed.' } },
    { name: 'durationSec', type: 'number', min: 0 },
  ],
}
