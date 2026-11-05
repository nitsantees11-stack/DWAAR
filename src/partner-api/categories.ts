import type { PayloadRequest } from 'payload'
import type { ServiceCategory } from '@/payload-types'
import { PARTNER_ROLES, type PartnerRole } from '../lib/booking-machine'
import { fail, route } from './http'

/** Which category flow each partner role works. */
export const FLOW_FOR_ROLE: Record<PartnerRole, string> = {
  technician: 'doorstep',
  mechanic: 'roadside',
  rider: 'pickup_drop',
  hub_technician: 'pickup_drop',
}

/** Short, stable key the Partner app may send instead of an id: the category's icon (ac, bike, mobile…). */
export const categoryKey = (c: Pick<ServiceCategory, 'icon'>) => c.icon

export const rolesForFlow = (flow: string) => PARTNER_ROLES.filter((r) => FLOW_FOR_ROLE[r] === flow)

/** Categories a partner can choose: only live ones, in catalog order. */
export async function liveCategories(req: PayloadRequest) {
  const { docs } = await req.payload.find({
    collection: 'service-categories',
    overrideAccess: true,
    depth: 0,
    pagination: false,
    sort: 'order',
    where: { status: { equals: 'live' } },
  })
  return docs as ServiceCategory[]
}

/**
 * Turns what the Partner app sent (category id, key like `ac`, or slug) into live category ids.
 * Unknown, coming-soon or ambiguous values fail with `invalid_category` naming the value.
 */
export async function resolveCategoryRefs(req: PayloadRequest, refs: string[], field = 'categories') {
  const live = await liveCategories(req)
  const out: ServiceCategory[] = []
  for (const raw of refs) {
    const ref = raw.trim()
    const lower = ref.toLowerCase()
    const byId = live.find((c) => c.id === ref)
    const byKey = live.filter((c) => categoryKey(c) === lower)
    const bySlug = live.find((c) => c.slug === lower)
    const hit = byId ?? (byKey.length === 1 ? byKey[0] : undefined) ?? bySlug
    if (!hit) throw fail(400, 'invalid_category', field, { value: ref.slice(0, 64) })
    if (!out.some((c) => c.id === hit.id)) out.push(hit)
  }
  return out
}

export const categoryEndpoints = [
  /** Allowed values for `categories` in PATCH /me, and which roles may pick each one. */
  route('get', 'categories', { auth: false }, async ({ req }) => {
    const live = await liveCategories(req)
    return {
      body: {
        categories: live.map((c) => ({ id: c.id, key: categoryKey(c), slug: c.slug, name: c.name, flow: c.flow, roles: rolesForFlow(c.flow) })),
        roles: Object.fromEntries(PARTNER_ROLES.map((r) => [r, live.filter((c) => c.flow === FLOW_FOR_ROLE[r]).map(categoryKey)])),
        accepts: 'PATCH /me categories takes any of id, key or slug; ids are stored.',
      },
    }
  }),
]
