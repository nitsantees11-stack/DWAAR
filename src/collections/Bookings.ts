import type { Access, CollectionConfig, Where, FieldAccess } from 'payload'
import { adminOnly, adminOnlyField, isAdminReq, isAppUserReq, isPartnerApiReq } from '../access'
import { BOOKING_FLOWS, BOOKING_STATUSES } from '../lib/booking-machine'
import { enforceTransitions } from '../hooks/booking-transitions'
import { recordEvents } from '../hooks/booking-effects'

const statusOptions = BOOKING_STATUSES.map((s) => ({
  label: s
    .toLowerCase()
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' '),
  value: s,
}))

/** OTPs are visible to the booking's customer and hub admins only — never to partners. */
const ownerOrAdminField: FieldAccess = ({ req, doc }) => {
  if (isAdminReq(req)) return true
  if (!isAppUserReq(req) || !req.user) return false
  const customer = doc?.customer
  const id = typeof customer === 'object' && customer ? customer.id : customer
  return id === req.user.id
}

/** Server-owned fields: admins in Payload Admin, or trusted server code with overrideAccess. */
const systemOnly = { create: adminOnlyField, update: adminOnlyField }

/** Customers read their own bookings; partners (via the partner API) read the legs they work. */
const readBookings: Access = ({ req }): Where | boolean => {
  if (isAdminReq(req)) return true
  if (isAppUserReq(req) && req.user) return { customer: { equals: req.user.id } }
  if (isPartnerApiReq(req) && req.user) {
    return {
      or: [
        { assignedPartner: { equals: req.user.id } },
        { riderPartner: { equals: req.user.id } },
        { hubPartner: { equals: req.user.id } },
      ],
    }
  }
  return false
}

/** Partner writes are limited to the leg they currently hold; enforceTransitions does the rest. */
const updateBookings: Access = ({ req }) => {
  if (isAdminReq(req)) return true
  if (isPartnerApiReq(req) && req.user) return { assignedPartner: { equals: req.user.id } }
  return false
}

export const Bookings: CollectionConfig = {
  slug: 'bookings',
  admin: {
    useAsTitle: 'bookingCode',
    group: 'Operations',
    defaultColumns: ['bookingCode', 'title', 'status', 'assignedPartner', 'needsManualAssignment', 'scheduleLabel', 'createdAt'],
    listSearchableFields: ['bookingCode', 'title'],
  },
  defaultSort: '-createdAt',
  access: {
    // Customers never write bookings directly: creation and customer-side transitions go
    // through server actions (src/app/(frontend)/actions/bookings.ts) that enforce the machine.
    create: adminOnly,
    read: readBookings,
    update: updateBookings,
    delete: adminOnly,
  },
  hooks: { beforeChange: [enforceTransitions], afterChange: [recordEvents] },
  fields: [
    {
      type: 'row',
      fields: [
        { name: 'bookingCode', type: 'text', required: true, unique: true, index: true, admin: { readOnly: true } },
        {
          name: 'status',
          type: 'select',
          required: true,
          defaultValue: 'BOOKED',
          options: statusOptions,
          index: true,
        },
      ],
    },
    { name: 'title', type: 'text', required: true },
    { name: 'deviceLabel', type: 'text' },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'service-categories',
      required: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'flow',
      type: 'select',
      required: true,
      options: BOOKING_FLOWS.map((f) => ({ label: f, value: f })),
      admin: { position: 'sidebar', readOnly: true },
    },
    { name: 'statusChangedAt', type: 'date', admin: { position: 'sidebar', readOnly: true } },
    { name: 'completedAt', type: 'date', admin: { position: 'sidebar', readOnly: true } },
    {
      name: 'lines',
      type: 'array',
      required: true,
      minRows: 1,
      fields: [
        { name: 'service', type: 'relationship', relationTo: 'services', required: true },
        { name: 'name', type: 'text', required: true },
        { name: 'quantity', type: 'number', required: true, defaultValue: 1, min: 1 },
        { name: 'minPaise', type: 'number', required: true },
        { name: 'maxPaise', type: 'number', required: true },
      ],
    },
    {
      name: 'device',
      type: 'group',
      fields: [
        { name: 'type', type: 'text' },
        { name: 'brand', type: 'text' },
        { name: 'model', type: 'text' },
        { name: 'tier', type: 'text' },
        { name: 'notes', type: 'textarea', maxLength: 300 },
      ],
    },
    {
      name: 'problem',
      type: 'group',
      admin: { description: 'What the customer reported while booking.' },
      fields: [
        { name: 'description', type: 'textarea', maxLength: 500, admin: { description: 'Written by the customer for "Other problem".' } },
        { name: 'video', type: 'upload', relationTo: 'problem-videos' },
        {
          name: 'ninetyMinPromise',
          label: '90-min promise applies',
          type: 'checkbox',
          defaultValue: false,
          admin: { readOnly: true, description: 'Set at booking: every chosen problem is a 90-minute repair.' },
        },
      ],
    },
    {
      name: 'address',
      type: 'group',
      fields: [
        { name: 'ref', type: 'relationship', relationTo: 'addresses' },
        { name: 'label', type: 'text' },
        { name: 'contactName', type: 'text' },
        { name: 'contactPhone', type: 'text' },
        { name: 'line', type: 'text', required: true },
        { name: 'landmark', type: 'text' },
        { name: 'lat', type: 'number' },
        { name: 'lng', type: 'number' },
      ],
    },
    {
      name: 'schedule',
      type: 'group',
      fields: [
        {
          name: 'mode',
          type: 'select',
          required: true,
          options: [
            { label: 'Right now', value: 'asap' },
            { label: 'Scheduled', value: 'scheduled' },
          ],
        },
        { name: 'startAt', type: 'date' },
        { name: 'endAt', type: 'date' },
      ],
    },
    { name: 'scheduleLabel', type: 'text' },
    { name: 'altWhatsapp', type: 'text' },
    {
      name: 'pricing',
      type: 'group',
      fields: [
        { name: 'estimateMinPaise', type: 'number', required: true },
        { name: 'estimateMaxPaise', type: 'number', required: true },
        { name: 'visitFeePaise', type: 'number', defaultValue: 0 },
        { name: 'discountPaise', type: 'number', defaultValue: 0 },
        { name: 'couponCode', type: 'text' },
        { name: 'cancelFeePaise', type: 'number', defaultValue: 0 },
        { name: 'declineFeePaise', type: 'number', defaultValue: 0 },
        { name: 'finalPaise', type: 'number', admin: { description: 'Locked when the customer approves a quote.' } },
      ],
    },
    {
      name: 'quote',
      type: 'group',
      admin: { description: 'Filled by the hub after checkup. Customer approves in the app.' },
      fields: [
        { name: 'diagnosis', type: 'textarea' },
        {
          name: 'items',
          type: 'array',
          fields: [
            { name: 'label', type: 'text', required: true },
            {
              name: 'grade',
              type: 'select',
              options: [
                { label: 'Original', value: 'original' },
                { label: 'Premium', value: 'premium' },
                { label: 'Normal', value: 'normal' },
                { label: 'Labour', value: 'labour' },
              ],
            },
            { name: 'pricePaise', type: 'number', required: true, min: 0 },
            {
              name: 'isExtraPart',
              type: 'checkbox',
              defaultValue: false,
              admin: { description: 'Extra part on top of a fixed-price service.' },
            },
          ],
        },
        { name: 'totalPaise', type: 'number', min: 0 },
        { name: 'videoMedia', type: 'relationship', relationTo: 'job-media', admin: { description: 'Checkup video (optional).' } },
        { name: 'sentAt', type: 'date', admin: { readOnly: true } },
        { name: 'respondedAt', type: 'date', admin: { readOnly: true } },
        {
          name: 'outcome',
          type: 'select',
          options: [
            { label: 'Approved', value: 'approved' },
            { label: 'Declined', value: 'declined' },
          ],
          admin: { readOnly: true },
        },
      ],
    },
    {
      name: 'payment',
      type: 'group',
      fields: [
        {
          name: 'method',
          type: 'select',
          required: true,
          defaultValue: 'upi',
          options: [
            { label: 'UPI', value: 'upi' },
            { label: 'Card', value: 'card' },
            { label: 'Cash after service', value: 'cod' },
          ],
        },
        {
          name: 'status',
          type: 'select',
          defaultValue: 'pending',
          options: [
            { label: 'Pending', value: 'pending' },
            { label: 'Paid', value: 'paid' },
            { label: 'Refunded', value: 'refunded' },
          ],
        },
      ],
    },
    {
      name: 'partner',
      type: 'group',
      admin: { description: 'Assigned technician / rider (hub fills this).' },
      fields: [
        { name: 'name', type: 'text' },
        { name: 'rating', type: 'number', min: 0, max: 5 },
        { name: 'maskedPhone', type: 'text', admin: { description: 'Virtual number only, never the real one.' } },
        { name: 'etaMinutes', type: 'number', min: 0 },
      ],
    },
    {
      name: 'serviceOtp',
      type: 'text',
      admin: { readOnly: true, description: 'Customer shares this with the partner to start.' },
      access: { read: ownerOrAdminField, update: adminOnlyField },
    },
    { name: 'warrantyDays', type: 'number', defaultValue: 0, min: 0 },
    {
      name: 'cancellation',
      type: 'group',
      fields: [
        { name: 'reason', type: 'text' },
        { name: 'at', type: 'date' },
      ],
    },
    {
      name: 'rating',
      type: 'group',
      fields: [
        { name: 'stars', type: 'number', min: 1, max: 5 },
        { name: 'comment', type: 'textarea', maxLength: 500 },
        { name: 'at', type: 'date' },
      ],
    },
    { name: 'trustAccepted', type: 'checkbox', defaultValue: false },
    // --- Partner operations -------------------------------------------------------------
    {
      type: 'collapsible',
      label: 'Partner assignment',
      admin: { initCollapsed: false },
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'assignedPartner',
              type: 'relationship',
              relationTo: 'partners',
              index: true,
              admin: { description: 'Partner working the current leg. Pick one here to assign manually.' },
              access: systemOnly,
            },
            { name: 'riderPartner', type: 'relationship', relationTo: 'partners', index: true, admin: { readOnly: true }, access: systemOnly },
            { name: 'hubPartner', type: 'relationship', relationTo: 'partners', index: true, admin: { readOnly: true }, access: systemOnly },
          ],
        },
        {
          name: 'needsManualAssignment',
          type: 'checkbox',
          defaultValue: false,
          index: true,
          admin: { description: 'Dispatch gave up (5 offers or 10 minutes). Assign a partner by hand.' },
          access: systemOnly,
        },
        {
          type: 'row',
          fields: [
            { name: 'promisedBy', type: 'date', admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } }, access: systemOnly },
            { name: 'arrivedAt', type: 'date', admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } }, access: systemOnly },
            { name: 'startedAt', type: 'date', admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } }, access: systemOnly },
          ],
        },
        {
          type: 'row',
          fields: [
            { name: 'slaBreached', type: 'checkbox', defaultValue: false, admin: { readOnly: true }, access: systemOnly },
            { name: 'slaCreditPaise', type: 'number', min: 0, admin: { readOnly: true, description: 'dwaar Cash credited for the late arrival.' }, access: systemOnly },
          ],
        },
        {
          name: 'deliveryOtp',
          type: 'text',
          admin: { readOnly: true, description: 'Generated at Out for delivery. Customer shares it with the rider.' },
          access: { read: ownerOrAdminField, ...systemOnly },
        },
        {
          name: 'otpAttempts',
          type: 'group',
          admin: { description: 'Wrong OTP tries (max 5 each).' },
          access: { read: ({ req }) => isAdminReq(req), ...systemOnly },
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'service', type: 'number', defaultValue: 0, min: 0 },
                { name: 'delivery', type: 'number', defaultValue: 0, min: 0 },
              ],
            },
          ],
        },
        {
          name: 'dispatch',
          type: 'group',
          admin: { description: 'Dispatcher state for the open leg.' },
          access: systemOnly,
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'leg',
                  type: 'select',
                  options: ['visit', 'pickup', 'hub', 'delivery'].map((v) => ({ label: v, value: v })),
                },
                { name: 'round', type: 'number', defaultValue: 0 },
                { name: 'attempts', type: 'number', defaultValue: 0 },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'startedAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
                { name: 'lastOfferAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'collapsible',
      label: 'Job record (from the partner app)',
      admin: { initCollapsed: true },
      fields: [
        {
          name: 'pickupChecklist',
          type: 'group',
          fields: [
            { name: 'imei', type: 'text', maxLength: 15 },
            {
              type: 'row',
              fields: [
                { name: 'simRemoved', type: 'checkbox', defaultValue: false },
                { name: 'memoryCardRemoved', type: 'checkbox', defaultValue: false },
              ],
            },
            { name: 'conditionNotes', type: 'textarea', maxLength: 500 },
            { name: 'photos', type: 'relationship', relationTo: 'job-media', hasMany: true },
          ],
        },
        {
          name: 'partsUsed',
          type: 'array',
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'name', type: 'text', required: true, maxLength: 80 },
                { name: 'pricePaise', type: 'number', required: true, min: 0 },
                { name: 'bill', type: 'relationship', relationTo: 'job-media' },
              ],
            },
          ],
        },
        {
          name: 'paymentCollection',
          type: 'group',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'method',
                  type: 'select',
                  options: [
                    { label: 'Cash', value: 'cash' },
                    { label: 'UPI', value: 'upi' },
                  ],
                },
                { name: 'amountPaise', type: 'number', min: 0 },
                { name: 'reference', type: 'text', maxLength: 60 },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'collectedBy', type: 'relationship', relationTo: 'partners' },
                { name: 'collectedAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
              ],
            },
          ],
        },
        {
          name: 'noShow',
          type: 'group',
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'markedAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
                { name: 'waitedMinutes', type: 'number', min: 0 },
              ],
            },
          ],
        },
        {
          name: 'customerRatingByPartner',
          type: 'group',
          fields: [
            { name: 'stars', type: 'number', min: 1, max: 5 },
            { name: 'comment', type: 'textarea', maxLength: 500 },
          ],
        },
      ],
    },
    { name: 'idemKey', type: 'text', index: true, admin: { hidden: true } },
  ],
}
