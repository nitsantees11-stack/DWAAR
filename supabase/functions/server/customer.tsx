import { Hono, type Context } from 'npm:hono@4'
import { z } from 'npm:zod@4'
import { DomainError, createDoc, deleteDoc, find, findOne, getDoc, getDocs, idOf, nowISO, saveDoc } from './db.tsx'
import { checkOtp, createSession, endSession, issueOtp, mirrorAuthUser, normalizePhone, randomCode, randomInt, readSession } from './auth.tsx'
import { getConfig, tierMultipliers, type Category, type Promotion, type Service } from './catalog.tsx'
import { cancelPolicy, customerCan, isActive, type BookingFlow, type BookingStatus } from './lib-booking-machine.tsx'
import { formatINR } from './lib-money.tsx'
import { lineRange, priceBooking, type DeviceTier } from './lib-pricing.tsx'
import { buildSlots, slotRangeLabel } from './lib-slots.tsx'
import { formatDay, isNightIST, isWithinHoursIST } from './lib-time.tsx'
import { advanceDispatch, createBooking, updateBooking, updateUser, type Booking } from './engine.tsx'
import { PRIVATE_BUCKET, extFor, putFile, streamPrivate } from './storage.tsx'
import { errorOf, jsonBody, parse, send } from './http.tsx'

/**
 * Customer API (the dwaar app's server calls it; the browser never does). Sessions come in the
 * X-Dwaar-Session header. Every rule of the Payload server actions is enforced here.
 */
export const customerApp = new Hono()

const fail = (code: string, status = 400, extra: { field?: string; params?: Record<string, string | number> } = {}) => new DomainError(code, status, extra)

const DEFAULTS = {
  notifications: { bookingPush: true, bookingWhatsapp: true, bookingSms: true, bookingEmail: false, offersPush: true, offersWhatsapp: false, reminders: true },
  privacy: { shareLiveLocation: true, personalisedOffers: true, usageAnalytics: true },
  preferences: { haptics: true, reduceMotion: false, defaultPayment: 'upi' },
}

type User = Booking

async function currentUser(c: Context): Promise<User> {
  const session = await readSession(c.req.header('x-dwaar-session'), 'user')
  if (!session) throw fail('auth', 401)
  const user = await getDoc<User>('users', session.id)
  if (!user || user.accountStatus === 'deleted') throw fail('auth', 401)
  return user
}

type Handler = (c: Context, user: User) => Promise<Record<string, unknown>>
const authed = (fn: Handler) => async (c: Context) => {
  try {
    return send(c, { ok: true, ...(await fn(c, await currentUser(c))) })
  } catch (err) {
    const e = errorOf(err)
    return send(c, e.body, e.status)
  }
}
const open = (fn: (c: Context) => Promise<Record<string, unknown>>) => async (c: Context) => {
  try {
    return send(c, { ok: true, ...(await fn(c)) })
  } catch (err) {
    const e = errorOf(err)
    return send(c, e.body, e.status)
  }
}

/* -------------------------------------------------------------------- auth */

customerApp.post(
  '/auth/otp/start',
  open(async (c) => {
    const phone = normalizePhone((await jsonBody(c)).phone)
    if (!phone) throw fail('phone', 400, { field: 'phone' })
    return await issueOtp(phone, 'login')
  }),
)

customerApp.post(
  '/auth/otp/verify',
  open(async (c) => {
    const body = await jsonBody(c)
    const phone = normalizePhone(body.phone)
    if (!phone) throw fail('phone')
    await checkOtp(body.challengeId, phone, 'login', body.code)
    let user = await findOne<User>('users', 'username', phone)
    if (user?.accountStatus === 'deleted') throw fail('account_deleted', 403)
    if (!user) {
      const lang = ['hinglish', 'en', 'hi'].includes(body.lang as string) ? body.lang : 'hinglish'
      try {
        user = await createDoc('users', {
          username: phone,
          language: lang,
          onboarded: false,
          referralCode: `DW${randomCode(6)}`,
          walletPaise: 0,
          accountStatus: 'active',
          notifications: DEFAULTS.notifications,
          privacy: DEFAULTS.privacy,
          preferences: DEFAULTS.preferences,
        })
      } catch {
        user = await findOne<User>('users', 'username', phone)
        if (!user) throw fail('generic', 500)
      }
    }
    await mirrorAuthUser('user', user.id, phone)
    const session = await createSession('user', user.id)
    return { token: session.token, exp: session.exp, user, needsOnboarding: !user.onboarded || !user.name, lang: user.language ?? 'hinglish' }
  }),
)

customerApp.post(
  '/auth/logout',
  open(async (c) => {
    const token = c.req.header('x-dwaar-session')
    if (token) await endSession(token)
    return {}
  }),
)

/* ------------------------------------------------------------------ profile */

customerApp.get('/me', authed(async (_c, user) => ({ user })))

customerApp.post(
  '/onboarding',
  authed(async (c, user) => {
    const input = parse(z.object({ name: z.string().trim().min(2).max(60), language: z.enum(['hinglish', 'en', 'hi']) }), await jsonBody(c), 'name')
    return { user: await updateUser(user.id, () => ({ name: input.name, language: input.language, onboarded: true })) }
  }),
)

customerApp.post(
  '/me/profile',
  authed(async (c, user) => {
    const schema = z.object({
      name: z.string().trim().min(2).max(60),
      gender: z.enum(['male', 'female', 'other', 'na']).nullable().optional(),
      dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')),
    })
    const r = schema.safeParse(await jsonBody(c))
    if (!r.success) {
      const field = String(r.error.issues[0]?.path[0] ?? '')
      throw fail(field === 'name' ? 'name' : 'invalid', 400, { field })
    }
    const { name, gender, dateOfBirth } = r.data
    if (dateOfBirth) {
      const dob = new Date(`${dateOfBirth}T00:00:00Z`)
      if (Number.isNaN(dob.getTime()) || dob > new Date() || dob.getUTCFullYear() < 1900) throw fail('invalid', 400, { field: 'dateOfBirth' })
    }
    return { user: await updateUser(user.id, () => ({ name, gender: gender ?? null, dateOfBirth: dateOfBirth ? new Date(`${dateOfBirth}T00:00:00Z`).toISOString() : null })) }
  }),
)

customerApp.post(
  '/me/alt-whatsapp/otp',
  authed(async (c, user) => {
    const phone = normalizePhone((await jsonBody(c)).phone)
    if (!phone) throw fail('phone', 400, { field: 'phone' })
    if (phone === user.username) throw fail('same_number', 400, { field: 'phone' })
    return await issueOtp(phone, 'alt_whatsapp', user.id)
  }),
)

customerApp.post(
  '/me/alt-whatsapp/verify',
  authed(async (c, user) => {
    const body = await jsonBody(c)
    const phone = normalizePhone(body.phone)
    if (!phone) throw fail('invalid')
    await checkOtp(body.challengeId, phone, 'alt_whatsapp', body.code, user.id)
    return { user: await updateUser(user.id, () => ({ altWhatsapp: phone })) }
  }),
)

customerApp.delete('/me/alt-whatsapp', authed(async (_c, user) => ({ user: await updateUser(user.id, () => ({ altWhatsapp: null })) })))

customerApp.post(
  '/me/language',
  authed(async (c, user) => {
    const lang = parse(z.enum(['hinglish', 'en', 'hi']), (await jsonBody(c)).language, 'invalid')
    return { user: await updateUser(user.id, () => ({ language: lang })), lang }
  }),
)

const settingsSchemas = {
  notifications: z
    .object({ bookingPush: z.boolean(), bookingWhatsapp: z.boolean(), bookingSms: z.boolean(), bookingEmail: z.boolean(), offersPush: z.boolean(), offersWhatsapp: z.boolean(), reminders: z.boolean() })
    .partial(),
  privacy: z.object({ shareLiveLocation: z.boolean(), personalisedOffers: z.boolean(), usageAnalytics: z.boolean() }).partial(),
  preferences: z.object({ haptics: z.boolean(), reduceMotion: z.boolean(), defaultPayment: z.enum(['upi', 'card', 'cod']) }).partial(),
}

customerApp.post(
  '/me/settings',
  authed(async (c, user) => {
    const body = await jsonBody(c)
    const group = body.group as keyof typeof settingsSchemas
    const schema = settingsSchemas[group]
    if (!schema) throw fail('invalid')
    const values = parse(schema as z.ZodType<Record<string, unknown>>, body.values, 'invalid')
    return { user: await updateUser(user.id, (u) => ({ [group]: { ...DEFAULTS[group], ...(u[group] ?? {}), ...values } })) }
  }),
)

customerApp.post(
  '/account/delete',
  authed(async (c, user) => {
    if ((await jsonBody(c)).confirm !== 'DELETE') throw fail('confirm')
    const bookings = await find<Booking>('bookings', 'customer', user.id)
    if (bookings.some((b) => isActive(b.flow as BookingFlow, b.status as BookingStatus))) throw fail('active_bookings', 409)
    for (const a of await find<Booking>('addresses', 'owner', user.id)) await deleteDoc('addresses', a.id)
    await updateUser(user.id, () => ({ accountStatus: 'deleted', name: null, altWhatsapp: null, gender: null, dateOfBirth: null }))
    const token = c.req.header('x-dwaar-session')
    if (token) await endSession(token)
    return {}
  }),
)

/* ---------------------------------------------------------------- addresses */

const sortAddresses = (list: Booking[]) =>
  [...list].sort((a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)) || String(b.createdAt).localeCompare(String(a.createdAt)))

customerApp.get('/addresses', authed(async (_c, user) => ({ addresses: sortAddresses(await find('addresses', 'owner', user.id)) })))

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

customerApp.post(
  '/addresses',
  authed(async (c, user) => {
    const input = parse(addressSchema, await jsonBody(c), 'invalid')
    const { id, isDefault, lat, lng, ...fields } = input
    const existing = await find<Booking>('addresses', 'owner', user.id)
    const current = id ? existing.find((a) => a.id === id) : null
    if (id && !current) throw fail('not_found', 404)
    // Location is attached only when the customer allows live-location sharing.
    const allowLocation = user.privacy?.shareLiveLocation !== false
    const makeDefault = Boolean(isDefault) || existing.length === 0 || Boolean(current?.isDefault)
    const data = {
      ...fields,
      landmark: fields.landmark || null,
      lat: allowLocation ? (lat ?? null) : null,
      lng: allowLocation ? (lng ?? null) : null,
      isDefault: makeDefault,
      line: [fields.flat, fields.area, fields.city, fields.pincode].filter(Boolean).join(', '),
    }
    const saved = current ? await saveDoc('addresses', { ...current, ...data }) : await createDoc('addresses', { ...data, owner: user.id })
    if (makeDefault) for (const other of existing) if (other.id !== saved.id && other.isDefault) await saveDoc('addresses', { ...other, isDefault: false })
    return { id: saved.id, line: saved.line ?? '', address: saved }
  }),
)

customerApp.post(
  '/addresses/:id/default',
  authed(async (c, user) => {
    const list = await find<Booking>('addresses', 'owner', user.id)
    const id = c.req.param('id')
    if (!list.some((a) => a.id === id)) throw fail('not_found', 404)
    for (const a of list) if (Boolean(a.isDefault) !== (a.id === id)) await saveDoc('addresses', { ...a, isDefault: a.id === id })
    return {}
  }),
)

customerApp.delete(
  '/addresses/:id',
  authed(async (c, user) => {
    const a = await getDoc<Booking>('addresses', c.req.param('id'))
    if (!a || idOf(a.owner) !== user.id) throw fail('not_found', 404)
    await deleteDoc('addresses', a.id)
    if (a.isDefault) {
      const [next] = sortAddresses(await find('addresses', 'owner', user.id))
      if (next) await saveDoc('addresses', { ...next, isDefault: true })
    }
    return {}
  }),
)

/* --------------------------------------------------------------- waitlist */

customerApp.get('/waitlist', authed(async (_c, user) => ({ categoryIds: (await find<Booking>('waitlist-entries', 'user', user.id)).map((e) => idOf(e.category)) })))

customerApp.post(
  '/waitlist',
  authed(async (c, user) => {
    const body = await jsonBody(c)
    const category = await getDoc<Category>('service-categories', String(body.categoryId ?? ''))
    if (!category) throw fail('not_found', 404)
    if (category.status !== 'coming_soon') throw fail('invalid')
    const mine = (await find<Booking>('waitlist-entries', 'user', user.id)).filter((e) => idOf(e.category) === category.id)
    if (body.join && mine.length === 0) {
      try {
        await createDoc('waitlist-entries', { category: category.id, user: user.id })
      } catch {
        // already joined (unique category + user)
      }
    }
    if (!body.join) for (const e of mine) await deleteDoc('waitlist-entries', e.id)
    return { joined: Boolean(body.join) }
  }),
)

/* ---------------------------------------------------- warranties & tickets */

const newestFirst = (list: Booking[]) => [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

customerApp.get('/warranties', authed(async (_c, user) => ({ warranties: newestFirst(await find('warranties', 'customer', user.id)) })))

customerApp.get(
  '/tickets',
  authed(async (_c, user) => {
    const tickets = newestFirst(await find<Booking>('support-tickets', 'user', user.id)).slice(0, 30)
    const bookings = new Map((await getDocs<Booking>('bookings', tickets.map((t) => idOf(t.booking)))).map((b) => [b.id, b]))
    return { tickets: tickets.map((t) => ({ ...t, booking: bookings.get(idOf(t.booking) ?? '') ?? t.booking })) }
  }),
)

customerApp.post(
  '/tickets',
  authed(async (c, user) => {
    const schema = z.object({
      topic: z.enum(['booking', 'payment', 'warranty', 'account', 'other']),
      message: z.string().trim().min(10).max(1000),
      bookingId: z.string().max(64).optional().or(z.literal('')),
      warrantyId: z.string().max(64).optional().or(z.literal('')),
    })
    const input = parse(schema, await jsonBody(c), 'invalid')
    // Related records must belong to this customer.
    if (input.bookingId) {
      const b = await getDoc<Booking>('bookings', input.bookingId)
      if (!b || idOf(b.customer) !== user.id) throw fail('not_found', 404)
    }
    if (input.warrantyId) {
      const w = await getDoc<Booking>('warranties', input.warrantyId)
      if (!w || idOf(w.customer) !== user.id) throw fail('not_found', 404)
    }
    const ticket = await createDoc('support-tickets', {
      ticketCode: `T${Date.now().toString(36).toUpperCase().slice(-6)}`,
      user: user.id,
      topic: input.topic,
      message: input.message,
      booking: input.bookingId || null,
      warranty: input.warrantyId || null,
      status: 'open',
    })
    return { code: ticket.ticketCode, ticket }
  }),
)

/* ---------------------------------------------------------- problem videos */

export const PROBLEM_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
export const PROBLEM_VIDEO_MAX_BYTES = 25 * 1024 * 1024

customerApp.post(
  '/problem-videos',
  authed(async (c, user) => {
    const form = await c.req.parseBody()
    const file = form.video
    if (!(file instanceof Blob) || file.size === 0) throw fail('problem_video')
    const mimeType = file.type.split(';')[0].trim().toLowerCase()
    if (!PROBLEM_VIDEO_MIME_TYPES.includes(mimeType)) throw fail('video_type')
    if (file.size > PROBLEM_VIDEO_MAX_BYTES) throw fail('video_size', 413)
    const raw = Number(form.durationSec)
    const durationSec = Number.isFinite(raw) && raw > 0 ? Math.min(600, Math.round(raw)) : null
    const filename = `problem-${user.id}-${Date.now()}.${extFor(mimeType)}`
    const storagePath = `problem-videos/${user.id}/${filename}`
    try {
      await putFile(PRIVATE_BUCKET, storagePath, file, mimeType)
    } catch {
      throw fail('video_upload', 502)
    }
    const doc = await createDoc('problem-videos', { owner: user.id, booking: null, durationSec, filename, mimeType, filesize: file.size, storagePath })
    return { id: doc.id }
  }),
)

/** The customer's own problem video (e.g. to play it back on the booking page). */
customerApp.get('/problem-videos/:id/file', async (c) => {
  try {
    const user = await currentUser(c)
    const v = await getDoc<Booking>('problem-videos', c.req.param('id'))
    if (!v || idOf(v.owner) !== user.id || !v.storagePath) throw fail('not_found', 404)
    return streamPrivate(v.storagePath, v.filename)
  } catch (err) {
    const e = errorOf(err)
    return send(c, e.body, e.status)
  }
})

/* ----------------------------------------------------------------- bookings */

const id = z.string().min(1).max(64)
export const draftSchema = z.object({
  categorySlug: z.string().min(1).max(120),
  lines: z.array(z.object({ serviceId: id, quantity: z.number().int().min(1).max(5) })).min(1).max(8),
  device: z.object({
    type: z.string().max(40).optional(),
    brand: z.string().max(40).optional(),
    modelId: id.optional(),
    modelText: z.string().max(60).optional(),
    notes: z.string().max(300).optional(),
  }),
  schedule: z.discriminatedUnion('mode', [z.object({ mode: z.literal('asap') }), z.object({ mode: z.literal('scheduled'), startAt: z.string().max(40) })]),
  couponCode: z.string().max(30).optional(),
  problem: z.object({ description: z.string().max(500).optional(), videoId: id.optional() }).optional(),
})
type Draft = z.infer<typeof draftSchema>

export const createBookingSchema = draftSchema.extend({
  addressId: id,
  paymentMethod: z.enum(['upi', 'card', 'cod']),
  altWhatsapp: z.union([z.literal(''), z.string().regex(/^[6-9]\d{9}$/)]).optional(),
  trustAccepted: z.literal(true),
  idemKey: z.string().min(8).max(64),
})

/** Re-derives every price, slot and eligibility rule on the server from ids only. */
export async function resolveDraft(user: User, draft: Draft, now = new Date()) {
  const category = await findOne<Category>('service-categories', 'slug', draft.categorySlug)
  if (!category) throw fail('not_found', 404)
  if (category.status !== 'live') throw fail('category_unavailable')

  const wanted = new Map<string, number>()
  for (const line of draft.lines) wanted.set(line.serviceId, line.quantity)
  const services = (await getDocs<Service>('services', [...wanted.keys()])).filter((s) => idOf(s.category) === category.id && s.active !== false)
  if (services.length !== wanted.size) throw fail('services')

  const description = draft.problem?.description?.trim() || undefined
  if (services.some((s) => s.isOtherProblem) && (!description || description.length < 10)) throw fail('problem_text')
  let videoId: string | undefined
  if (draft.problem?.videoId) {
    const v = await getDoc<Booking>('problem-videos', draft.problem.videoId)
    if (!v || idOf(v.owner) !== user.id || idOf(v.booking)) throw fail('problem_video')
    videoId = v.id
  }
  if (category.requireProblemVideo && !videoId) throw fail('problem_video')
  const ninetyMinPromise = services.every((s) => s.ninetyMinPromise === true)

  let tier: DeviceTier = 'mid'
  let brand = draft.device.brand?.trim() || undefined
  let model = draft.device.modelText?.trim() || undefined
  let type = draft.device.type?.trim() || undefined
  if (draft.device.modelId) {
    const found = await getDoc<Booking>('device-models', draft.device.modelId)
    if (!found || idOf(found.category) !== category.id) throw fail('device')
    tier = found.tier
    brand = found.brand
    model = found.model
    type = found.deviceType ?? type
  }
  const deviceTypes = category.deviceTypes ?? []
  if (type && deviceTypes.length > 0 && !deviceTypes.some((d) => d.value === type)) throw fail('device')
  if (deviceTypes.length > 0 && !type) throw fail('device')
  const typeLabel = deviceTypes.find((d) => d.value === type)?.label

  const hours = category.serviceHours ?? {}
  const startHour = hours.startHour ?? 9
  const endHour = hours.endHour ?? 21
  let schedule: { mode: 'asap' | 'scheduled'; startAt: string; endAt: string }
  let scheduleLabel: string
  if (draft.schedule.mode === 'asap') {
    if (!hours.allowAsap || !isWithinHoursIST(now, startHour, endHour)) throw fail('slot')
    schedule = { mode: 'asap', startAt: now.toISOString(), endAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString() }
    scheduleLabel = 'ASAP (right now)'
  } else {
    const startAt = draft.schedule.startAt
    const slot = buildSlots(now, startHour, endHour).flat().find((s) => s.startISO === startAt)
    if (!slot) throw fail('slot')
    schedule = { mode: 'scheduled', startAt: slot.startISO, endAt: slot.endISO }
    scheduleLabel = `${formatDay(new Date(slot.startISO))}, ${slotRangeLabel(slot)} IST`
  }

  const flow = category.flow as BookingFlow
  const pricing = category.pricing ?? {}
  const night = isNightIST(new Date(schedule.startAt)) && (pricing.nightVisitFeePaise ?? 0) > 0
  const visitFeePaise = night ? (pricing.nightVisitFeePaise ?? 0) : (pricing.visitFeePaise ?? 0)
  const multipliers = tierMultipliers(await getConfig())

  const ordered = draft.lines.map((l) => services.find((s) => s.id === l.serviceId)).filter((s): s is Service => Boolean(s))
  const priced = ordered.map((service) => {
    const quantity = service.allowQuantity ? (wanted.get(service.id) ?? 1) : 1
    const line = { priceType: service.priceType, priceFromPaise: service.priceFromPaise, priceToPaise: service.priceToPaise, tierPriced: service.tierPriced, quantity }
    return { service, line, range: lineRange(line, tier, multipliers) }
  })

  let coupon: Promotion | null = null
  const code = draft.couponCode?.trim().toUpperCase()
  if (code) {
    const promo = await findOne<Promotion>('promotions', 'code', code)
    if (!promo || promo.active === false) throw fail('coupon_invalid')
    if (promo.validUntil && new Date(promo.validUntil) <= now) throw fail('coupon_expired')
    const promoCategory = idOf(promo.category)
    if (promoCategory && promoCategory !== category.id) throw fail('coupon_category')
    if (promo.firstBookingOnly) {
      const prior = (await find<Booking>('bookings', 'customer', user.id)).filter((b) => b.status !== 'CANCELLED')
      if (prior.length > 0) throw fail('coupon_first')
    }
    coupon = promo
  }

  const quote = priceBooking({
    flow,
    lines: priced.map((p) => p.line),
    tier,
    multipliers,
    visitFeePaise,
    coupon: coupon ? { discountType: coupon.discountType, discountValue: coupon.discountValue, maxDiscountPaise: coupon.maxDiscountPaise, minOrderPaise: coupon.minOrderPaise } : null,
  })
  if (coupon && quote.discountPaise <= 0) throw fail('coupon_min', 400, { params: { amount: formatINR(coupon.minOrderPaise ?? 0) } })

  return {
    category,
    flow,
    lines: priced.map(({ service, line, range }) => ({ service: service.id, name: service.name, quantity: line.quantity, minPaise: range.min, maxPaise: range.max })),
    device: { type: type ?? null, brand: brand ?? null, model: model ?? null, tier, notes: draft.device.notes?.trim() || null },
    deviceLabel: [brand, model].filter(Boolean).join(' ') || typeLabel || brand || '',
    schedule,
    scheduleLabel,
    quote,
    coupon,
    warrantyDays: Math.max(0, ...ordered.map((s) => s.warrantyDays ?? 0)),
    problem: { description: description ?? null, videoId: videoId ?? null, ninetyMinPromise },
  }
}

/** What a customer may see of a booking: hub-only counters stay hidden. */
async function customerView(bookings: Booking[]) {
  const categories = new Map((await getDocs<Category>('service-categories', bookings.map((b) => idOf(b.category)))).map((c) => [c.id, c]))
  return bookings.map(({ otpAttempts: _o, idemKey: _i, ...b }) => ({ ...b, category: categories.get(idOf(b.category) ?? '') ?? b.category }))
}

async function ownBooking(user: User, bookingId: string | undefined) {
  const b = await getDoc<Booking>('bookings', bookingId)
  if (!b || idOf(b.customer) !== user.id) throw fail('not_found', 404)
  return b
}

customerApp.get(
  '/bookings',
  authed(async (c, user) => {
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50))
    return { bookings: await customerView(newestFirst(await find('bookings', 'customer', user.id)).slice(0, limit)) }
  }),
)

customerApp.get(
  '/bookings/:id',
  authed(async (c, user) => {
    const b = await ownBooking(user, c.req.param('id'))
    // Booking reads keep dispatch moving (expired offers go to the next partner).
    await advanceDispatch({ bookingId: b.id }).catch(() => undefined)
    const fresh = (await getDoc<Booking>('bookings', b.id)) ?? b
    const [view] = await customerView([fresh])
    const events = newestFirst(await find('booking-events', 'booking', b.id))
    const warranties = await find('warranties', 'booking', b.id)
    return { booking: view, events, warranty: warranties[0] ?? null }
  }),
)

customerApp.post(
  '/bookings/preview-coupon',
  authed(async (c, user) => {
    const draft = draftSchema.safeParse(await jsonBody(c))
    if (!draft.success || !draft.data.couponCode) throw fail('coupon_invalid')
    const r = await resolveDraft(user, draft.data)
    return {
      code: r.coupon?.code ?? draft.data.couponCode.toUpperCase(),
      discountPaise: r.quote.discountPaise,
      payableMinPaise: r.quote.payableMinPaise,
      payableMaxPaise: r.quote.payableMaxPaise,
    }
  }),
)

customerApp.post(
  '/bookings',
  authed(async (c, user) => {
    const input = createBookingSchema.safeParse(await jsonBody(c))
    if (!input.success) throw fail('invalid')
    const data = input.data
    const duplicate = (await find<Booking>('bookings', 'idemKey', data.idemKey)).find((b) => idOf(b.customer) === user.id)
    if (duplicate) return { id: duplicate.id }
    const address = await getDoc<Booking>('addresses', data.addressId)
    if (!address || idOf(address.owner) !== user.id) throw fail('address')
    const r = await resolveDraft(user, data)
    const booking = await createBooking(
      {
        bookingCode: `DW${randomCode(7)}`,
        title: r.lines.length > 1 ? `${r.lines[0].name} +${r.lines.length - 1}` : r.lines[0].name,
        deviceLabel: r.deviceLabel,
        customer: user.id,
        category: r.category.id,
        flow: r.flow,
        lines: r.lines,
        device: r.device,
        address: {
          ref: address.id,
          label: address.label,
          contactName: address.contactName,
          contactPhone: address.contactPhone,
          line: address.line ?? [address.flat, address.area, address.city, address.pincode].filter(Boolean).join(', '),
          landmark: address.landmark ?? null,
          lat: address.lat ?? null,
          lng: address.lng ?? null,
        },
        schedule: r.schedule,
        scheduleLabel: r.scheduleLabel,
        altWhatsapp: data.altWhatsapp || user.altWhatsapp || null,
        pricing: {
          estimateMinPaise: r.quote.payableMinPaise,
          estimateMaxPaise: r.quote.payableMaxPaise,
          visitFeePaise: r.quote.visitFeePaise,
          discountPaise: r.quote.discountPaise,
          couponCode: r.coupon?.code ?? null,
          cancelFeePaise: 0,
          declineFeePaise: 0,
          finalPaise: null,
        },
        payment: { method: data.paymentMethod, status: 'pending' },
        serviceOtp: String(randomInt(1000, 10000)),
        otpAttempts: { service: 0, delivery: 0 },
        warrantyDays: r.warrantyDays,
        trustAccepted: true,
        idemKey: data.idemKey,
        problem: { description: r.problem.description, video: r.problem.videoId, ninetyMinPromise: r.problem.ninetyMinPromise },
        partsUsed: [],
      },
      { actor: 'customer', eventNote: 'Booked from the app' },
    )
    if (r.problem.videoId) {
      const v = await getDoc<Booking>('problem-videos', r.problem.videoId)
      if (v) await saveDoc('problem-videos', { ...v, booking: booking.id })
    }
    return { id: booking.id }
  }),
)

customerApp.post(
  '/bookings/:id/cancel',
  authed(async (c, user) => {
    const reason = parse(z.enum(['plan_changed', 'mistake', 'time', 'elsewhere', 'other']), (await jsonBody(c)).reason, 'invalid')
    const b = await ownBooking(user, c.req.param('id'))
    const category = await getDoc<Category>('service-categories', idOf(b.category))
    const flow = b.flow as BookingFlow
    if (!customerCan(flow, b.status, 'CANCELLED')) throw fail('cannot_cancel', 409)
    await updateBooking(b.id, { actor: 'customer', eventNote: `Cancelled by customer: ${reason}` }, (cur) => {
      const policy = cancelPolicy(flow, cur.status, category?.pricing?.cancelAfterAssignFeePaise ?? 0)
      if (!policy.allowed) throw fail('cannot_cancel', 409)
      return { status: 'CANCELLED', cancellation: { reason, at: nowISO() }, pricing: { ...cur.pricing, cancelFeePaise: policy.feePaise } }
    })
    return {}
  }),
)

customerApp.post(
  '/bookings/:id/quote',
  authed(async (c, user) => {
    const decision = parse(z.enum(['approve', 'decline']), (await jsonBody(c)).decision, 'invalid')
    const b = await ownBooking(user, c.req.param('id'))
    const category = await getDoc<Category>('service-categories', idOf(b.category))
    const to: BookingStatus = decision === 'approve' ? 'APPROVED' : 'DECLINED'
    await updateBooking(b.id, { actor: 'customer', eventNote: to === 'APPROVED' ? 'Quote approved in app' : 'Quote declined in app' }, (cur) => {
      if (cur.status !== 'QUOTE_SENT' || !customerCan(cur.flow, cur.status, to)) throw fail('cannot_respond', 409)
      return { status: to, ...(to === 'DECLINED' ? { pricing: { ...cur.pricing, declineFeePaise: category?.pricing?.declineFeePaise ?? 0 } } : {}) }
    })
    return {}
  }),
)

customerApp.post(
  '/bookings/:id/rate',
  authed(async (c, user) => {
    const input = parse(z.object({ stars: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional() }), await jsonBody(c), 'invalid')
    const b = await ownBooking(user, c.req.param('id'))
    await updateBooking(b.id, { actor: 'customer' }, (cur) => {
      if (cur.status !== 'COMPLETED' && cur.status !== 'RETURNED') throw fail('cannot_rate', 409)
      if (cur.rating?.stars) throw fail('already_rated', 409)
      return { rating: { stars: input.stars, comment: input.comment || null, at: nowISO() } }
    })
    return {}
  }),
)
