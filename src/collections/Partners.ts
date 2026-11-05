import { APIError } from 'payload'
import type { Access, CollectionBeforeChangeHook, CollectionConfig, FieldAccess } from 'payload'
import { adminOnly, adminOnlyField, isAdminReq, isPartnerApiReq } from '../access'
import { PARTNER_ROLES } from '../lib/booking-machine'
import {
  DEFAULT_SERVICE_RADIUS_KM,
  ONBOARDING_EDITABLE_STATUSES,
  PARTNER_VERIFICATION_STATUSES,
  requiredDocuments,
} from '../lib/partner/constants'

const label = (v: string) =>
  v
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
const options = (values: readonly string[]) => values.map((value) => ({ label: label(value), value }))

/** Admins see every partner; a partner (through the partner API) sees only themself. */
const selfOrAdmin: Access = ({ req }) => {
  if (isAdminReq(req)) return true
  if (isPartnerApiReq(req) && req.user) return { id: { equals: req.user.id } }
  return false
}

/** System fields: written only by admins or trusted server code (overrideAccess). */
const system = { update: adminOnlyField, create: adminOnlyField }
/** Profile fields freeze once the partner is submitted for review; only admins change them then. */
const profileEditable: FieldAccess = ({ req, doc }) => {
  if (isAdminReq(req)) return true
  const status = doc?.verificationStatus ?? 'draft'
  return ONBOARDING_EDITABLE_STATUSES.includes(status)
}

/**
 * Only approved + active partners can be online. Approving in Admin also requires every
 * required document for the role to be approved first.
 */
const partnerGuards: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  const verification = data.verificationStatus ?? originalDoc?.verificationStatus
  const account = data.accountStatus ?? originalDoc?.accountStatus
  if (verification !== 'approved' || account !== 'active') data.isOnline = false
  if (isAdminReq(req) && verification === 'approved' && originalDoc && originalDoc.verificationStatus !== 'approved') {
    const role = data.role ?? originalDoc.role
    const { docs } = await req.payload.find({
      collection: 'partner-documents',
      overrideAccess: true,
      depth: 0,
      pagination: false,
      where: { and: [{ owner: { equals: originalDoc.id } }, { status: { equals: 'approved' } }] },
    })
    const approved = new Set(docs.map((d) => d.type))
    const missing = requiredDocuments(role).filter((t) => !approved.has(t))
    if (missing.length > 0) {
      throw new APIError(`Approve these documents first: ${missing.join(', ')}.`, 400, undefined, true)
    }
  }
  if (data.verificationStatus === 'approved' && originalDoc?.verificationStatus !== 'approved') data.rejectionReason = null
  return data
}

/**
 * Service partners for the dwaar Partner app. Phone (10 digits) is the username and login
 * uses the same server-verified OTP + derived password as customers. Never `admin.user`:
 * partners cannot open /admin.
 */
export const Partners: CollectionConfig = {
  slug: 'partners',
  labels: { singular: 'Partner', plural: 'Partners' },
  admin: {
    useAsTitle: 'username',
    group: 'Partners',
    defaultColumns: ['username', 'name', 'role', 'verificationStatus', 'accountStatus', 'isOnline', 'rating'],
    listSearchableFields: ['username', 'name', 'zoneName'],
    description: 'Technicians, mechanics, riders and hub technicians. Review KYC in Partner verification.',
  },
  auth: {
    loginWithUsername: { allowEmailLogin: false, requireEmail: false, requireUsername: true },
    tokenExpiration: 60 * 60 * 24 * 7,
    maxLoginAttempts: 0,
  },
  hooks: { beforeChange: [partnerGuards] },
  access: {
    create: adminOnly,
    read: selfOrAdmin,
    update: selfOrAdmin,
    delete: adminOnly,
    // Partners never get into the CMS, even with a valid token.
    admin: ({ req }) => isAdminReq(req),
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Profile',
          fields: [
            { name: 'name', type: 'text', maxLength: 60, access: { update: profileEditable } },
            { name: 'photo', type: 'upload', relationTo: 'media', access: { update: profileEditable } },
            {
              name: 'dateOfBirth',
              type: 'date',
              admin: { date: { pickerAppearance: 'dayOnly' } },
              access: { update: profileEditable },
            },
            {
              name: 'languages',
              type: 'select',
              hasMany: true,
              options: [
                { label: 'Hindi', value: 'hi' },
                { label: 'English', value: 'en' },
                { label: 'Punjabi', value: 'pa' },
                { label: 'Haryanvi', value: 'bgc' },
                { label: 'Bengali', value: 'bn' },
              ],
            },
            {
              name: 'role',
              type: 'select',
              options: options(PARTNER_ROLES),
              index: true,
              access: { update: profileEditable },
            },
            {
              name: 'categories',
              type: 'relationship',
              relationTo: 'service-categories',
              hasMany: true,
              index: true,
              access: { update: profileEditable },
            },
            {
              type: 'row',
              fields: [
                { name: 'zoneName', type: 'text', defaultValue: 'Sector 29, Gurugram' },
                { name: 'serviceRadiusKm', type: 'number', min: 1, max: 30, defaultValue: DEFAULT_SERVICE_RADIUS_KM },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'homeLat', type: 'number', min: -90, max: 90 },
                { name: 'homeLng', type: 'number', min: -180, max: 180 },
              ],
            },
            {
              name: 'vehicle',
              type: 'group',
              access: { update: profileEditable },
              fields: [
                {
                  name: 'type',
                  type: 'select',
                  options: [
                    { label: 'Motorbike', value: 'motorbike' },
                    { label: 'Scooter', value: 'scooter' },
                    { label: 'Bicycle', value: 'bicycle' },
                    { label: 'Car', value: 'car' },
                    { label: 'None', value: 'none' },
                  ],
                },
                { name: 'number', type: 'text', maxLength: 13 },
              ],
            },
            {
              name: 'preferences',
              type: 'group',
              fields: [
                {
                  name: 'language',
                  type: 'select',
                  defaultValue: 'hinglish',
                  options: [
                    { label: 'Hinglish', value: 'hinglish' },
                    { label: 'English', value: 'en' },
                    { label: 'हिन्दी', value: 'hi' },
                  ],
                },
                {
                  name: 'navigationApp',
                  type: 'select',
                  defaultValue: 'google_maps',
                  options: [
                    { label: 'Google Maps', value: 'google_maps' },
                    { label: 'Mappls', value: 'mappls' },
                    { label: 'Waze', value: 'waze' },
                  ],
                },
                { name: 'offerSound', type: 'checkbox', defaultValue: true },
              ],
            },
          ],
        },
        {
          label: 'Verification',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'verificationStatus',
                  type: 'select',
                  required: true,
                  defaultValue: 'draft',
                  index: true,
                  options: options(PARTNER_VERIFICATION_STATUSES),
                  access: system,
                },
                {
                  name: 'accountStatus',
                  type: 'select',
                  required: true,
                  defaultValue: 'active',
                  index: true,
                  options: options(['active', 'suspended', 'deleted']),
                  access: system,
                },
              ],
            },
            {
              name: 'rejectionReason',
              type: 'textarea',
              admin: { description: 'Shown to the partner for needs changes / rejected.' },
              access: system,
            },
            {
              type: 'row',
              fields: [
                { name: 'skillTestScore', type: 'number', min: 0, max: 100, access: system },
                { name: 'trainingCompletedAt', type: 'date', access: system },
                { name: 'agreementAcceptedAt', type: 'date', access: system },
              ],
            },
            { name: 'submittedAt', type: 'date', admin: { readOnly: true }, access: system },
            {
              type: 'row',
              fields: [
                {
                  name: 'externalUserId',
                  label: 'Partner app user ID',
                  type: 'text',
                  unique: true,
                  index: true,
                  admin: { readOnly: true, description: 'Set when the partner signs in through the Partner app’s own login.' },
                  access: system,
                },
                { name: 'externalEmail', label: 'Partner app email', type: 'email', admin: { readOnly: true }, access: system },
              ],
            },
          ],
        },
        {
          label: 'Live & performance',
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'isOnline', type: 'checkbox', defaultValue: false, index: true, access: system },
                { name: 'lastSeenAt', type: 'date', index: true, access: system },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'lastLat', type: 'number', access: system },
                { name: 'lastLng', type: 'number', access: system },
              ],
            },
            { name: 'currentJob', type: 'relationship', relationTo: 'bookings', access: system },
            {
              type: 'row',
              fields: [
                { name: 'rating', type: 'number', min: 0, max: 5, defaultValue: 0, access: system },
                { name: 'ratingCount', type: 'number', min: 0, defaultValue: 0, access: system },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'acceptanceRate', type: 'number', min: 0, max: 100, defaultValue: 100, access: system },
                { name: 'completionRate', type: 'number', min: 0, max: 100, defaultValue: 100, access: system },
                { name: 'reliabilityScore', type: 'number', min: 0, max: 100, defaultValue: 100, access: system },
              ],
            },
            {
              name: 'stats',
              type: 'group',
              admin: { description: 'Counters behind the rates above.' },
              access: system,
              fields: [
                {
                  type: 'row',
                  fields: [
                    { name: 'offersReceived', type: 'number', defaultValue: 0 },
                    { name: 'offersAccepted', type: 'number', defaultValue: 0 },
                    { name: 'jobsCompleted', type: 'number', defaultValue: 0 },
                    { name: 'jobsReleased', type: 'number', defaultValue: 0 },
                  ],
                },
              ],
            },
          ],
        },
        {
          label: 'Bank',
          fields: [
            {
              name: 'bank',
              type: 'group',
              admin: { description: 'Only the last 4 digits of the account are stored.' },
              fields: [
                { name: 'holderName', type: 'text', maxLength: 80 },
                { name: 'accountLast4', type: 'text', maxLength: 4 },
                { name: 'ifsc', type: 'text', maxLength: 11 },
                { name: 'upiId', type: 'text', maxLength: 60 },
                { name: 'verified', type: 'checkbox', defaultValue: false, access: system },
              ],
            },
          ],
        },
      ],
    },
  ],
}
