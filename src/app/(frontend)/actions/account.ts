'use server'

import { z } from 'zod'
import { fail, type ActionResult } from '@/lib/action-result'
import { isSupabase } from '@/lib/backend'
import { asAction, sb } from '@/lib/sb'
import { appAuth, getCurrentUser, setLangCookie } from '@/lib/app-auth'
import { isActive, type BookingFlow, type BookingStatus } from '@/lib/booking-machine'
import { normalizePhone } from '@/lib/otp'
import { checkOtp, issueOtp } from '@/lib/otp-flow'
import { getPayloadClient } from '@/lib/payload'

const profileSchema = z.object({
  name: z.string().trim().min(2).max(60),
  gender: z.enum(['male', 'female', 'other', 'na']).nullable().optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .or(z.literal('')),
})

export async function updateProfile(input: z.infer<typeof profileSchema>): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  const parsed = profileSchema.safeParse(input)
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? '')
    return fail(field === 'name' ? 'name' : 'invalid', undefined, field)
  }
  const { name, gender, dateOfBirth } = parsed.data
  if (dateOfBirth) {
    const dob = new Date(`${dateOfBirth}T00:00:00Z`)
    if (Number.isNaN(dob.getTime()) || dob > new Date() || dob.getUTCFullYear() < 1900) {
      return fail('invalid', undefined, 'dateOfBirth')
    }
  }
  if (isSupabase()) return asAction(await sb('/c/me/profile', { body: { name, gender: gender ?? null, dateOfBirth: dateOfBirth || null } }), () => ({}))
  const payload = await getPayloadClient()
  await payload.update({
    collection: 'users',
    id: user.id,
    overrideAccess: false,
    user,
    data: {
      name,
      gender: gender ?? null,
      dateOfBirth: dateOfBirth ? new Date(`${dateOfBirth}T00:00:00Z`).toISOString() : null,
    },
  })
  return { ok: true }
}

export async function requestAltWhatsappOtp(input: { phone: string }) {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  const phone = normalizePhone(input?.phone)
  if (!phone) return fail('phone', undefined, 'phone')
  if (phone === user.username) return fail('same_number', undefined, 'phone')
  if (isSupabase()) {
    const r = await sb('/c/me/alt-whatsapp/otp', { body: { phone } })
    return asAction(r, (x) => ({ challengeId: String(x.challengeId), demoCode: (x.demoCode as string | null) ?? null, resendInSec: Number(x.resendInSec ?? 30) }))
  }
  try {
    return await issueOtp(phone, 'alt_whatsapp', user.id)
  } catch {
    return fail('generic')
  }
}

export async function verifyAltWhatsapp(input: { challengeId: string; phone: string; code: string }): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  const phone = normalizePhone(input?.phone)
  if (!phone || typeof input?.challengeId !== 'string' || typeof input?.code !== 'string') return fail('invalid')
  if (isSupabase()) return asAction(await sb('/c/me/alt-whatsapp/verify', { body: { challengeId: input.challengeId, phone, code: input.code.trim() } }), () => ({}))
  const checked = await checkOtp(input.challengeId, phone, 'alt_whatsapp', input.code.trim(), user.id)
  if (!checked.ok) return checked
  const payload = await getPayloadClient()
  await payload.update({ collection: 'users', id: user.id, overrideAccess: false, user, data: { altWhatsapp: phone } })
  return { ok: true }
}

export async function removeAltWhatsapp(): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  if (isSupabase()) return asAction(await sb('/c/me/alt-whatsapp', { method: 'DELETE' }), () => ({}))
  const payload = await getPayloadClient()
  await payload.update({ collection: 'users', id: user.id, overrideAccess: false, user, data: { altWhatsapp: null } })
  return { ok: true }
}

export async function updateLanguage(input: { language: string }): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  const parsed = z.enum(['hinglish', 'en', 'hi']).safeParse(input?.language)
  if (!parsed.success) return fail('invalid')
  if (isSupabase()) {
    const r = await sb('/c/me/language', { body: { language: parsed.data } })
    if (r.ok) await setLangCookie(parsed.data)
    return asAction(r, () => ({}))
  }
  const payload = await getPayloadClient()
  await payload.update({ collection: 'users', id: user.id, overrideAccess: false, user, data: { language: parsed.data } })
  await setLangCookie(parsed.data)
  return { ok: true }
}

const settingsSchemas = {
  notifications: z
    .object({
      bookingPush: z.boolean(),
      bookingWhatsapp: z.boolean(),
      bookingSms: z.boolean(),
      bookingEmail: z.boolean(),
      offersPush: z.boolean(),
      offersWhatsapp: z.boolean(),
      reminders: z.boolean(),
    })
    .partial(),
  privacy: z
    .object({ shareLiveLocation: z.boolean(), personalisedOffers: z.boolean(), usageAnalytics: z.boolean() })
    .partial(),
  preferences: z
    .object({ haptics: z.boolean(), reduceMotion: z.boolean(), defaultPayment: z.enum(['upi', 'card', 'cod']) })
    .partial(),
}

export type SettingsGroup = keyof typeof settingsSchemas

/** One allowlisted settings group at a time; unknown keys are dropped by the schema. */
export async function updateSettings(input: { group: SettingsGroup; values: Record<string, unknown> }): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  const schema = settingsSchemas[input?.group]
  if (!schema) return fail('invalid')
  const parsed = schema.safeParse(input.values)
  if (!parsed.success) return fail('invalid')
  if (isSupabase()) return asAction(await sb('/c/me/settings', { body: { group: input.group, values: parsed.data } }), () => ({}))
  const current = (user[input.group] ?? {}) as Record<string, unknown>
  const payload = await getPayloadClient()
  await payload.update({
    collection: 'users',
    id: user.id,
    overrideAccess: false,
    user,
    data: { [input.group]: { ...current, ...parsed.data } },
  })
  return { ok: true }
}

const addressSchema = z.object({
  id: z.string().max(64).optional(),
  label: z.enum(['home', 'work', 'other']),
  contactName: z.string().trim().min(2).max(60),
  contactPhone: z.string().trim().regex(/^[6-9]\d{9}$/),
  flat: z.string().trim().min(1).max(80),
  area: z.string().trim().min(2).max(120),
  landmark: z.string().trim().max(120).optional().or(z.literal('')),
  city: z.string().trim().min(2).max(60),
  pincode: z.string().trim().regex(/^\d{6}$/),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  isDefault: z.boolean().optional(),
})
export type AddressInput = z.infer<typeof addressSchema>

export async function saveAddress(input: AddressInput): Promise<ActionResult<{ id: string; line: string }>> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  const parsed = addressSchema.safeParse(input)
  if (!parsed.success) return fail('invalid', undefined, String(parsed.error.issues[0]?.path[0] ?? ''))
  if (isSupabase()) return asAction(await sb('/c/addresses', { body: parsed.data }), (x) => ({ id: String(x.id), line: String(x.line ?? '') }))
  const { id, isDefault, lat, lng, ...fields } = parsed.data
  const payload = await getPayloadClient()

  const existing = await payload.find({ collection: 'addresses', overrideAccess: false, user, depth: 0, pagination: false })
  // Location is attached only when the customer allows live-location sharing.
  const allowLocation = user.privacy?.shareLiveLocation !== false
  const makeDefault = Boolean(isDefault) || existing.docs.length === 0 || (id ? existing.docs.find((a) => a.id === id)?.isDefault : false)
  const data = {
    ...fields,
    landmark: fields.landmark || undefined,
    lat: allowLocation ? (lat ?? null) : null,
    lng: allowLocation ? (lng ?? null) : null,
    isDefault: Boolean(makeDefault),
  }

  try {
    const saved = id
      ? await payload.update({ collection: 'addresses', id, overrideAccess: false, user, data })
      : await payload.create({ collection: 'addresses', overrideAccess: false, user, data: { ...data, owner: user.id } })
    if (data.isDefault) {
      for (const other of existing.docs) {
        if (other.id !== saved.id && other.isDefault) {
          await payload.update({ collection: 'addresses', id: other.id, overrideAccess: false, user, data: { isDefault: false } })
        }
      }
    }
    return { ok: true, id: saved.id, line: saved.line ?? '' }
  } catch {
    return fail('generic')
  }
}

export async function setDefaultAddress(input: { id: string }): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  if (isSupabase()) return asAction(await sb(`/c/addresses/${encodeURIComponent(String(input?.id ?? ''))}/default`, { method: 'POST', body: {} }), () => ({}))
  const payload = await getPayloadClient()
  const { docs } = await payload.find({ collection: 'addresses', overrideAccess: false, user, depth: 0, pagination: false })
  if (!docs.some((a) => a.id === input?.id)) return fail('not_found')
  for (const address of docs) {
    const shouldBe = address.id === input.id
    if (Boolean(address.isDefault) !== shouldBe) {
      await payload.update({ collection: 'addresses', id: address.id, overrideAccess: false, user, data: { isDefault: shouldBe } })
    }
  }
  return { ok: true }
}

export async function deleteAddress(input: { id: string }): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  if (isSupabase()) return asAction(await sb(`/c/addresses/${encodeURIComponent(String(input?.id ?? ''))}`, { method: 'DELETE' }), () => ({}))
  const payload = await getPayloadClient()
  try {
    const removed = await payload.delete({ collection: 'addresses', id: input.id, overrideAccess: false, user })
    if (removed.isDefault) {
      const { docs } = await payload.find({ collection: 'addresses', overrideAccess: false, user, depth: 0, limit: 1, sort: '-createdAt' })
      if (docs[0]) await payload.update({ collection: 'addresses', id: docs[0].id, overrideAccess: false, user, data: { isDefault: true } })
    }
    return { ok: true }
  } catch {
    return fail('not_found')
  }
}

export async function joinWaitlist(input: { categoryId: string; join: boolean }): Promise<ActionResult<{ joined: boolean }>> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  if (isSupabase()) {
    return asAction(await sb('/c/waitlist', { body: { categoryId: String(input?.categoryId ?? ''), join: Boolean(input?.join) } }), (x) => ({ joined: Boolean(x.joined) }))
  }
  const payload = await getPayloadClient()
  let category
  try {
    category = await payload.findByID({ collection: 'service-categories', id: input.categoryId, overrideAccess: false, user, depth: 0 })
  } catch {
    return fail('not_found')
  }
  if (category.status !== 'coming_soon') return fail('invalid')
  const { docs } = await payload.find({
    collection: 'waitlist-entries',
    overrideAccess: false,
    user,
    depth: 0,
    where: { category: { equals: category.id } },
  })
  if (input.join && docs.length === 0) {
    await payload.create({ collection: 'waitlist-entries', overrideAccess: false, user, data: { category: category.id, user: user.id } })
  }
  if (!input.join) {
    for (const entry of docs) await payload.delete({ collection: 'waitlist-entries', id: entry.id, overrideAccess: false, user })
  }
  return { ok: true, joined: input.join }
}

/**
 * Soft-deletes the account: profile data is cleared, addresses removed and the session ended.
 * Bookings/warranties stay for the retention period. `accountStatus` is admin-only, so the
 * final flag is written by this trusted action after all checks pass.
 */
export async function deleteAccount(input: { confirm: string }): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  if (input?.confirm !== 'DELETE') return fail('confirm')
  if (isSupabase()) {
    const r = await sb('/c/account/delete', { body: { confirm: 'DELETE' } })
    if (r.ok) await appAuth.clearSession()
    return asAction(r, () => ({}))
  }
  const payload = await getPayloadClient()
  const { docs: bookings } = await payload.find({
    collection: 'bookings',
    overrideAccess: false,
    user,
    depth: 0,
    pagination: false,
    select: { status: true, flow: true },
  })
  if (bookings.some((b) => isActive(b.flow as BookingFlow, b.status as BookingStatus))) return fail('active_bookings')

  const { docs: addresses } = await payload.find({ collection: 'addresses', overrideAccess: false, user, depth: 0, pagination: false })
  for (const address of addresses) await payload.delete({ collection: 'addresses', id: address.id, overrideAccess: false, user })
  await payload.update({
    collection: 'users',
    id: user.id,
    overrideAccess: true,
    data: { accountStatus: 'deleted', name: null, altWhatsapp: null, gender: null, dateOfBirth: null },
  })
  await appAuth.clearSession()
  return { ok: true }
}
