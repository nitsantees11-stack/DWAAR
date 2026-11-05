import { z } from 'zod'
import type { Partner, PartnerDocument, SkillTest } from '@/payload-types'
import { PARTNER_ROLES, type PartnerRole } from '../lib/booking-machine'
import {
  ONBOARDING_EDITABLE_STATUSES,
  PARTNER_DOCUMENT_TYPES,
  SKILL_PASS_PERCENT,
  needsDrivingLicence,
  requiredDocuments,
} from '../lib/partner/constants'
import { idOf, nowISO } from '../lib/partner/sys'
import { asPartner, fail, route } from './http'
import { partnerDTO } from './dto'
import { FLOW_FOR_ROLE, resolveCategoryRefs } from './categories'

const EDITABLE_ONBOARDING = ONBOARDING_EDITABLE_STATUSES

async function reload(req: Parameters<Parameters<typeof route>[3]>[0]['req'], id: string) {
  return (await req.payload.findByID({ collection: 'partners', id, overrideAccess: true, depth: 1 })) as Partner
}

function docDTO(d: PartnerDocument) {
  return {
    id: d.id,
    type: d.type,
    status: d.status,
    rejectionReason: d.rejectionReason ?? null,
    expiresAt: d.expiresAt ?? null,
    superseded: Boolean(d.superseded),
    mimeType: d.mimeType ?? null,
    url: `/api/partner/v1/files/partner-documents/${d.id}`,
    createdAt: d.createdAt,
  }
}

/** Current (latest, not superseded) document per type. */
async function currentDocuments(req: Parameters<Parameters<typeof route>[3]>[0]['req'], partnerId: string) {
  const { docs } = await req.payload.find({
    collection: 'partner-documents',
    overrideAccess: true,
    depth: 0,
    pagination: false,
    sort: '-createdAt',
    where: { owner: { equals: partnerId } },
  })
  const latest = new Map<string, PartnerDocument>()
  for (const d of docs as PartnerDocument[]) if (!latest.has(d.type)) latest.set(d.type, d)
  return { all: docs as PartnerDocument[], latest }
}

/** Onboarding checklist: profile → role & categories (+ vehicle) → documents → bank → skill test → training → agreement → submit. */
export async function onboardingStatus(req: Parameters<Parameters<typeof route>[3]>[0]['req'], partner: Partner) {
  const { latest } = await currentDocuments(req, partner.id)
  const needed = requiredDocuments(partner.role)
  const missing = needed.filter((t) => !latest.has(t) || latest.get(t)!.status === 'rejected')
  const rejected = [...latest.values()].filter((d) => d.status === 'rejected').map((d) => ({ type: d.type, reason: d.rejectionReason ?? null }))
  const steps = [
    { step: 'profile', done: Boolean(partner.name && partner.dateOfBirth) },
    {
      step: 'role',
      done: Boolean(partner.role && (partner.categories ?? []).length > 0 && (!needsDrivingLicence(partner.role) || (partner.vehicle?.type && partner.vehicle?.number))),
    },
    { step: 'documents', done: missing.length === 0, missing, rejected },
    { step: 'bank', done: Boolean((partner.bank?.accountLast4 && partner.bank?.ifsc) || partner.bank?.upiId) },
    { step: 'skill_test', done: (partner.skillTestScore ?? 0) >= SKILL_PASS_PERCENT, score: partner.skillTestScore ?? null, passPercent: SKILL_PASS_PERCENT },
    { step: 'training', done: Boolean(partner.trainingCompletedAt) },
    { step: 'agreement', done: Boolean(partner.agreementAcceptedAt) },
  ]
  return {
    verificationStatus: partner.verificationStatus,
    rejectionReason: partner.rejectionReason ?? null,
    canEdit: EDITABLE_ONBOARDING.includes(partner.verificationStatus),
    canSubmit: EDITABLE_ONBOARDING.includes(partner.verificationStatus) && steps.slice(0, 5).every((s) => s.done),
    canGoOnline: partner.verificationStatus === 'approved' && partner.accountStatus === 'active',
    steps,
  }
}

const vehicleSchema = z.object({ type: z.enum(['motorbike', 'scooter', 'bicycle', 'car', 'none']), number: z.string().trim().toUpperCase().regex(/^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{0,3}\s?\d{4}$/).optional() })

const patchMe = z
  .object({
    name: z.string().trim().min(2).max(60),
    dateOfBirth: z.iso.date(),
    languages: z.array(z.enum(['hi', 'en', 'pa', 'bgc', 'bn'])).max(5),
    role: z.enum(PARTNER_ROLES),
    categories: z.array(z.string().min(1).max(64)).min(1).max(5),
    zoneName: z.string().trim().max(80),
    homeLat: z.number().min(-90).max(90),
    homeLng: z.number().min(-180).max(180),
    serviceRadiusKm: z.number().min(1).max(30),
    vehicle: vehicleSchema,
    preferences: z.object({
      language: z.enum(['hinglish', 'en', 'hi']).optional(),
      navigationApp: z.enum(['google_maps', 'mappls', 'waze']).optional(),
      offerSound: z.boolean().optional(),
    }),
    idempotencyKey: z.string(),
  })
  .partial()
  .strict()

const LOCKED_AFTER_SUBMIT = ['name', 'dateOfBirth', 'role', 'categories', 'vehicle'] as const

export const meEndpoints = [
  route('get', 'me', {}, async ({ req, partner }) => {
    const fresh = await reload(req, partner.id)
    return { body: { partner: partnerDTO(fresh), onboarding: await onboardingStatus(req, fresh) } }
  }),

  route('patch', 'me', { body: patchMe }, async ({ req, partner, body }) => {
    const { idempotencyKey: _k, ...changes } = body
    const editable = EDITABLE_ONBOARDING.includes(partner.verificationStatus)
    const locked = LOCKED_AFTER_SUBMIT.find((f) => f in changes)
    if (locked && !editable) throw fail(409, 'profile_locked', locked)
    const role = (changes.role ?? partner.role) as PartnerRole | undefined
    if (changes.categories || changes.role) {
      // Ids, keys (ac, bike, mobile) or slugs are accepted; ids are what gets stored.
      const refs = changes.categories ?? (partner.categories ?? []).map(idOf).filter((x): x is string => Boolean(x))
      const cats = await resolveCategoryRefs(req, refs)
      if (role && cats.some((c) => c.flow !== FLOW_FOR_ROLE[role])) throw fail(400, 'category_role_mismatch', 'categories')
      if (changes.categories) changes.categories = cats.map((c) => c.id)
    }
    if (changes.vehicle && changes.vehicle.type !== 'none' && !changes.vehicle.number) throw fail(400, 'vehicle_number_required', 'vehicle.number')
    const updated = (await req.payload.update({
      collection: 'partners',
      id: partner.id,
      ...asPartner(partner),
      depth: 1,
      data: (changes.preferences ? { ...changes, preferences: { ...partner.preferences, ...changes.preferences } } : changes) as Partial<Partner>,
    })) as Partner
    return { body: { partner: partnerDTO(updated) } }
  }),

  route('post', 'me/photo', { multipart: true, body: z.object({ idempotencyKey: z.string() }).passthrough() }, async ({ req, partner }) => {
    if (!EDITABLE_ONBOARDING.includes(partner.verificationStatus)) throw fail(409, 'profile_locked', 'photo')
    const file = req.file
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.mimetype)) throw fail(400, 'image_required', 'file')
    const media = await req.payload.create({
      collection: 'media',
      overrideAccess: true,
      data: { alt: `dwaar partner ${partner.name ?? ''}`.trim() },
      file: { ...file, name: `partner-${partner.id}-${Date.now()}.${file.mimetype.split('/')[1]}` },
    })
    const updated = (await req.payload.update({ collection: 'partners', id: partner.id, overrideAccess: true, depth: 1, data: { photo: media.id } })) as Partner
    return { status: 201, body: { partner: partnerDTO(updated) } }
  }),

  route('get', 'me/documents', {}, async ({ req, partner }) => {
    const { all } = await currentDocuments(req, partner.id)
    return { body: { documents: all.map(docDTO), required: requiredDocuments(partner.role) } }
  }),

  route(
    'post',
    'me/documents',
    { multipart: true, body: z.object({ type: z.enum(PARTNER_DOCUMENT_TYPES), expiresAt: z.iso.date().optional(), idempotencyKey: z.string() }) },
    async ({ req, partner, body }) => {
      const renewing = partner.verificationStatus === 'approved' && ['driving_licence', 'vehicle_rc', 'police_verification'].includes(body.type)
      if (!EDITABLE_ONBOARDING.includes(partner.verificationStatus) && !renewing) throw fail(409, 'profile_locked', 'type')
      const file = req.file
      if (!file) throw fail(400, 'file_required', 'file')
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.mimetype)) throw fail(400, 'file_type', 'file')
      if (file.size > 8 * 1024 * 1024) throw fail(413, 'file_too_large', 'file')
      if ((body.type === 'driving_licence' || body.type === 'vehicle_rc') && !body.expiresAt) throw fail(400, 'expiry_required', 'expiresAt')
      if (body.expiresAt && new Date(body.expiresAt).getTime() <= Date.now()) throw fail(400, 'document_expired', 'expiresAt')
      const { latest } = await currentDocuments(req, partner.id)
      const doc = (await req.payload.create({
        collection: 'partner-documents',
        overrideAccess: true,
        data: { owner: partner.id, type: body.type, status: 'pending', expiresAt: body.expiresAt },
        file: { ...file, name: `${partner.id}-${body.type}-${Date.now()}.${file.mimetype === 'application/pdf' ? 'pdf' : file.mimetype.split('/')[1]}` },
      })) as PartnerDocument
      const prev = latest.get(body.type)
      // A renewal keeps the old approved licence active until the new one is approved.
      if (prev && !(renewing && prev.status === 'approved')) {
        await req.payload.update({ collection: 'partner-documents', id: prev.id, overrideAccess: true, data: { superseded: true } })
      }
      return { status: 201, body: { document: docDTO(doc) } }
    },
  ),

  route(
    'post',
    'me/bank',
    {
      body: z
        .object({
          holderName: z.string().trim().min(2).max(80),
          accountNumber: z.string().regex(/^\d{9,18}$/).optional(),
          ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/).optional(),
          upiId: z.string().trim().regex(/^[\w.-]{2,}@[a-zA-Z]{2,}$/).optional(),
          idempotencyKey: z.string(),
        })
        .refine((b) => (b.accountNumber && b.ifsc) || b.upiId, { message: 'bank_or_upi', path: ['accountNumber'] }),
    },
    async ({ req, partner, body }) => {
      // Only the last 4 digits are stored; changing details resets verification.
      const updated = (await req.payload.update({
        collection: 'partners',
        id: partner.id,
        overrideAccess: true,
        depth: 1,
        data: {
          bank: {
            holderName: body.holderName,
            accountLast4: body.accountNumber ? body.accountNumber.slice(-4) : partner.bank?.accountLast4,
            ifsc: body.ifsc ?? partner.bank?.ifsc,
            upiId: body.upiId ?? partner.bank?.upiId,
            verified: false,
          },
        },
      })) as Partner
      return { body: { bank: partnerDTO(updated).bank } }
    },
  ),

  route('get', 'skill-test', {}, async ({ req, partner, query }) => {
    const ref = query.get('category')
    if (!ref) throw fail(400, 'category_required', 'category')
    const [{ id: category }] = await resolveCategoryRefs(req, [ref], 'category')
    if (!(partner.categories ?? []).map(idOf).includes(category)) throw fail(403, 'category_not_selected', 'category')
    const { docs } = await req.payload.find({ collection: 'skill-tests', overrideAccess: true, depth: 0, limit: 1, where: { category: { equals: category } } })
    const test = docs[0] as SkillTest | undefined
    if (!test) throw fail(404, 'not_found')
    return {
      body: {
        test: {
          id: test.id,
          title: test.title,
          category,
          passPercent: SKILL_PASS_PERCENT,
          // Answers never leave the server.
          questions: test.questions.map((q, index) => ({ index, question: q.question, options: (q.options ?? []).map((o) => o.text) })),
        },
      },
    }
  }),

  route(
    'post',
    'skill-test/submit',
    { body: z.object({ category: z.string().min(1).max(64), answers: z.array(z.number().int().min(0).max(3)).min(1).max(100), idempotencyKey: z.string() }) },
    async ({ req, partner, body }) => {
      const [{ id: category }] = await resolveCategoryRefs(req, [body.category], 'category')
      if (!(partner.categories ?? []).map(idOf).includes(category)) throw fail(403, 'category_not_selected', 'category')
      if (!EDITABLE_ONBOARDING.includes(partner.verificationStatus)) throw fail(409, 'profile_locked')
      const { docs } = await req.payload.find({ collection: 'skill-tests', overrideAccess: true, depth: 0, limit: 1, where: { category: { equals: category } } })
      const test = docs[0] as SkillTest | undefined
      if (!test) throw fail(404, 'not_found')
      if (body.answers.length !== test.questions.length) throw fail(400, 'answers_count', 'answers', { expected: test.questions.length })
      const correct = test.questions.filter((q, i) => q.correctIndex === body.answers[i]).length
      const score = Math.round((correct / test.questions.length) * 100)
      await req.payload.update({ collection: 'partners', id: partner.id, overrideAccess: true, data: { skillTestScore: score } })
      return { body: { score, correct, total: test.questions.length, passed: score >= SKILL_PASS_PERCENT, passPercent: SKILL_PASS_PERCENT } }
    },
  ),

  route('get', 'onboarding/status', {}, async ({ req, partner }) => {
    return { body: { onboarding: await onboardingStatus(req, await reload(req, partner.id)) } }
  }),

  route(
    'post',
    'onboarding/submit',
    { body: z.object({ trainingAcknowledged: z.literal(true), agreementAccepted: z.literal(true), idempotencyKey: z.string() }) },
    async ({ req, partner }) => {
      const fresh = await reload(req, partner.id)
      if (!EDITABLE_ONBOARDING.includes(fresh.verificationStatus)) throw fail(409, 'already_submitted')
      const status = await onboardingStatus(req, fresh)
      const pending = status.steps.slice(0, 5).find((s) => !s.done)
      if (pending) throw fail(409, 'onboarding_incomplete', pending.step)
      const now = nowISO()
      const updated = (await req.payload.update({
        collection: 'partners',
        id: partner.id,
        overrideAccess: true,
        depth: 1,
        data: {
          trainingCompletedAt: fresh.trainingCompletedAt ?? now,
          agreementAcceptedAt: now,
          verificationStatus: 'submitted',
          submittedAt: now,
          rejectionReason: null,
        },
      })) as Partner
      return { body: { partner: partnerDTO(updated), onboarding: await onboardingStatus(req, updated) } }
    },
  ),
]
