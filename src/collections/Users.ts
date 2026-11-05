import type { CollectionConfig } from 'payload'
import { adminOnly, adminOnlyField, selfOrAdmin } from '../access'

/**
 * Public app accounts. Phone number is the username; login happens through a
 * server-verified OTP (see src/app/(frontend)/actions/auth.ts). Never used for /admin.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: 'Customer', plural: 'Customers' },
  admin: {
    useAsTitle: 'username',
    defaultColumns: ['username', 'name', 'language', 'accountStatus', 'createdAt'],
    group: 'Customers',
  },
  auth: {
    loginWithUsername: { allowEmailLogin: false, requireEmail: false, requireUsername: true },
    tokenExpiration: 60 * 60 * 24 * 30,
    maxLoginAttempts: 0,
  },
  access: {
    // Accounts are created only by the server-side OTP flow.
    create: adminOnly,
    read: selfOrAdmin,
    update: selfOrAdmin,
    delete: adminOnly,
  },
  fields: [
    { name: 'name', type: 'text', maxLength: 60 },
    {
      name: 'gender',
      type: 'select',
      options: [
        { label: 'Male', value: 'male' },
        { label: 'Female', value: 'female' },
        { label: 'Other', value: 'other' },
        { label: 'Prefer not to say', value: 'na' },
      ],
    },
    { name: 'dateOfBirth', type: 'date', admin: { date: { pickerAppearance: 'dayOnly' } } },
    { name: 'altWhatsapp', type: 'text', maxLength: 10 },
    {
      name: 'language',
      type: 'select',
      defaultValue: 'hinglish',
      required: true,
      options: [
        { label: 'Hinglish', value: 'hinglish' },
        { label: 'English', value: 'en' },
        { label: 'हिन्दी', value: 'hi' },
      ],
    },
    {
      name: 'notifications',
      type: 'group',
      fields: [
        { name: 'bookingPush', type: 'checkbox', defaultValue: true },
        { name: 'bookingWhatsapp', type: 'checkbox', defaultValue: true },
        { name: 'bookingSms', type: 'checkbox', defaultValue: true },
        { name: 'bookingEmail', type: 'checkbox', defaultValue: false },
        { name: 'offersPush', type: 'checkbox', defaultValue: true },
        { name: 'offersWhatsapp', type: 'checkbox', defaultValue: false },
        { name: 'reminders', type: 'checkbox', defaultValue: true },
      ],
    },
    {
      name: 'privacy',
      type: 'group',
      fields: [
        { name: 'shareLiveLocation', type: 'checkbox', defaultValue: true },
        { name: 'personalisedOffers', type: 'checkbox', defaultValue: true },
        { name: 'usageAnalytics', type: 'checkbox', defaultValue: true },
      ],
    },
    {
      name: 'preferences',
      type: 'group',
      fields: [
        { name: 'haptics', type: 'checkbox', defaultValue: true },
        { name: 'reduceMotion', type: 'checkbox', defaultValue: false },
        {
          name: 'defaultPayment',
          type: 'select',
          defaultValue: 'upi',
          options: [
            { label: 'UPI', value: 'upi' },
            { label: 'Card', value: 'card' },
            { label: 'Cash after service', value: 'cod' },
          ],
        },
      ],
    },
    { name: 'onboarded', type: 'checkbox', defaultValue: false, admin: { position: 'sidebar' } },
    {
      name: 'walletPaise',
      type: 'number',
      defaultValue: 0,
      min: 0,
      admin: { position: 'sidebar', description: 'dwaar Cash in paise. Server-managed.' },
      access: { update: adminOnlyField },
    },
    {
      name: 'referralCode',
      type: 'text',
      index: true,
      admin: { position: 'sidebar', readOnly: true },
      access: { update: adminOnlyField },
    },
    {
      name: 'accountStatus',
      type: 'select',
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Deleted', value: 'deleted' },
      ],
      admin: { position: 'sidebar' },
      access: { update: adminOnlyField },
    },
  ],
}
