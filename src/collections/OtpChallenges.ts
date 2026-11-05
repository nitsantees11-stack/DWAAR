import type { CollectionConfig } from 'payload'
import { adminOnly } from '../access'

/** Hashed one-time codes. Only server actions (system context) touch these. */
export const OtpChallenges: CollectionConfig = {
  slug: 'otp-challenges',
  labels: { singular: 'OTP challenge', plural: 'OTP challenges' },
  admin: {
    useAsTitle: 'phone',
    group: 'System',
    defaultColumns: ['phone', 'purpose', 'attempts', 'consumed', 'expiresAt'],
  },
  access: { create: adminOnly, read: adminOnly, update: adminOnly, delete: adminOnly },
  fields: [
    { name: 'phone', type: 'text', required: true, index: true },
    {
      name: 'purpose',
      type: 'select',
      required: true,
      options: [
        { label: 'Login', value: 'login' },
        { label: 'Alternate WhatsApp', value: 'alt_whatsapp' },
        { label: 'Partner login', value: 'partner_login' },
      ],
    },
    { name: 'codeHash', type: 'text', required: true, admin: { readOnly: true } },
    { name: 'attempts', type: 'number', defaultValue: 0 },
    { name: 'expiresAt', type: 'date', required: true },
    { name: 'consumed', type: 'checkbox', defaultValue: false },
    { name: 'owner', type: 'relationship', relationTo: 'users' },
  ],
}
