import type { GlobalConfig } from 'payload'
import { adminOnly } from '../access'
import { catalogGlobalAfterChange } from '../hooks/revalidate'

/** Business rules editable by the hub team without a code change. */
export const BusinessConfig: GlobalConfig = {
  slug: 'business-config',
  label: 'Business config',
  admin: { group: 'Catalog' },
  access: { read: () => true, update: adminOnly },
  hooks: { afterChange: [catalogGlobalAfterChange] },
  fields: [
    {
      name: 'zone',
      type: 'group',
      fields: [
        { name: 'name', type: 'text', required: true, defaultValue: 'Sector 29, Gurugram' },
        { name: 'hubName', type: 'text', defaultValue: 'dwaar Hub · Sector 29' },
        { name: 'centerLat', type: 'number', defaultValue: 28.4683 },
        { name: 'centerLng', type: 'number', defaultValue: 77.0629 },
        { name: 'radiusKm', type: 'number', defaultValue: 5 },
        { name: 'onlinePartners', type: 'number', defaultValue: 12, admin: { description: 'Shown on the home radar.' } },
      ],
    },
    {
      name: 'support',
      type: 'group',
      fields: [
        { name: 'phone', type: 'text', defaultValue: '+91 80000 12345' },
        { name: 'whatsapp', type: 'text', defaultValue: '918000012345' },
        { name: 'email', type: 'email', defaultValue: 'help@dwaar.in' },
        { name: 'hours', type: 'text', defaultValue: 'Subah 8 se raat 10 tak, roz' },
      ],
    },
    {
      name: 'tierMultipliers',
      type: 'group',
      admin: { description: 'Scales tier-priced services by phone segment.' },
      fields: [
        { name: 'budget', type: 'number', defaultValue: 0.7 },
        { name: 'mid', type: 'number', defaultValue: 1 },
        { name: 'premium', type: 'number', defaultValue: 1.8 },
        { name: 'flagship', type: 'number', defaultValue: 3 },
      ],
    },
    {
      name: 'rewards',
      type: 'group',
      fields: [
        { name: 'referralRewardPaise', type: 'number', defaultValue: 10000 },
        { name: 'slaCreditPaise', type: 'number', defaultValue: 10000 },
      ],
    },
    {
      name: 'partnerPay',
      type: 'group',
      label: 'Partner pay',
      access: { read: ({ req }) => req.user?.collection === 'admins' },
      admin: { description: 'How completed jobs turn into partner earnings. All amounts in paise.' },
      fields: [
        {
          name: 'partnerSharePercent',
          type: 'array',
          admin: { description: 'Share of the job amount per category. Categories not listed use the default.' },
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'category', type: 'relationship', relationTo: 'service-categories', required: true },
                { name: 'percent', type: 'number', required: true, min: 0, max: 100, defaultValue: 80 },
              ],
            },
          ],
        },
        { name: 'defaultSharePercent', type: 'number', min: 0, max: 100, defaultValue: 80 },
        { name: 'visitFeeSharePercent', type: 'number', min: 0, max: 100, defaultValue: 80 },
        {
          name: 'riderLegFeePaise',
          type: 'number',
          min: 0,
          defaultValue: 4000,
          admin: { description: 'Paid to a rider for each pickup or delivery leg of a hub repair.' },
        },
        {
          name: 'releasePenaltyPaise',
          type: 'number',
          min: 0,
          defaultValue: 5000,
          admin: { description: 'Charged when a partner releases a job they accepted.' },
        },
        {
          name: 'payoutDay',
          type: 'select',
          defaultValue: 'mon',
          options: [
            { label: 'Monday', value: 'mon' },
            { label: 'Tuesday', value: 'tue' },
            { label: 'Wednesday', value: 'wed' },
            { label: 'Thursday', value: 'thu' },
            { label: 'Friday', value: 'fri' },
            { label: 'Saturday', value: 'sat' },
            { label: 'Sunday', value: 'sun' },
          ],
        },
      ],
    },
  ],
}
