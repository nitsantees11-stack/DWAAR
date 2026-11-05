import { unstable_cache } from 'next/cache'
import type { BusinessConfig, DeviceModel, Promotion, Service, ServiceCategory } from '@/payload-types'
import { CATALOG_TAG } from '@/hooks/revalidate'
import { isSupabase } from './backend'
import { findBySlug, getPayloadClient } from './payload'
import { relId } from './media'
import { sb } from './sb'

/**
 * Public catalog reads, cached under the `catalog` tag. Every catalog collection, the
 * business config global and Media expire that tag on change/delete, so admin edits show
 * up on the next request. The hour-long revalidate is only a safety net for edits made
 * outside a Next.js request (e.g. the Payload CLI), which cannot reach the cache.
 */
const CACHE = { tags: [CATALOG_TAG], revalidate: 3600 }

const payloadCategories = unstable_cache(
  async (): Promise<ServiceCategory[]> => {
    const payload = await getPayloadClient()
    const res = await payload.find({
      collection: 'service-categories',
      overrideAccess: false,
      depth: 1,
      sort: 'order',
      pagination: false,
    })
    return res.docs
  },
  ['catalog:categories:v2'],
  CACHE,
)

const payloadCategoryBySlug = unstable_cache(
  async (slug: string) => findBySlug('service-categories', slug, { depth: 1 }),
  ['catalog:category-by-slug:v2'],
  CACHE,
)

const payloadServices = unstable_cache(
  async (): Promise<Service[]> => {
    const payload = await getPayloadClient()
    const res = await payload.find({
      collection: 'services',
      overrideAccess: false,
      depth: 0,
      sort: 'order',
      pagination: false,
    })
    return res.docs
  },
  ['catalog:services:v2'],
  CACHE,
)

const payloadServiceBySlug = unstable_cache(
  async (slug: string) => findBySlug('services', slug, { depth: 0 }),
  ['catalog:service-by-slug:v2'],
  CACHE,
)

const payloadDeviceModels = unstable_cache(
  async (categoryId: string): Promise<DeviceModel[]> => {
    const payload = await getPayloadClient()
    const res = await payload.find({
      collection: 'device-models',
      overrideAccess: false,
      depth: 0,
      where: { category: { equals: categoryId } },
      sort: ['brand', 'model'],
      pagination: false,
    })
    return res.docs
  },
  ['catalog:device-models'],
  CACHE,
)

const payloadPromotions = unstable_cache(
  async (): Promise<Promotion[]> => {
    const payload = await getPayloadClient()
    const res = await payload.find({
      collection: 'promotions',
      overrideAccess: false,
      depth: 0,
      sort: '-createdAt',
      pagination: false,
    })
    return res.docs
  },
  ['catalog:promotions'],
  CACHE,
)

const payloadBusinessConfig = unstable_cache(
  async (): Promise<BusinessConfig> => {
    const payload = await getPayloadClient()
    return payload.findGlobal({ slug: 'business-config', overrideAccess: false, depth: 0 })
  },
  ['catalog:business-config'],
  CACHE,
)

type SupabaseCatalog = {
  categories: ServiceCategory[]
  services: Service[]
  deviceModels: DeviceModel[]
  promotions: Promotion[]
  config: BusinessConfig
}

/**
 * Supabase backend: the whole public catalog in one call. Short revalidate because catalog edits
 * happen in the Supabase dashboard, which cannot expire this cache. Failures throw (never cached).
 */
const supabaseCatalog = unstable_cache(
  async (): Promise<SupabaseCatalog> => {
    const res = await sb<SupabaseCatalog>('/catalog', { auth: false })
    if (!res.ok) throw new Error(`catalog unavailable: ${res.error}`)
    return res as unknown as SupabaseCatalog
  },
  ['catalog:supabase:v1'],
  { tags: [CATALOG_TAG], revalidate: 60 },
)

export async function getCategories(): Promise<ServiceCategory[]> {
  return isSupabase() ? (await supabaseCatalog()).categories : payloadCategories()
}

export async function getCategoryBySlug(slug: string): Promise<ServiceCategory | null> {
  if (!isSupabase()) return payloadCategoryBySlug(slug)
  return (await supabaseCatalog()).categories.find((c) => c.slug === slug) ?? null
}

export async function getServices(): Promise<Service[]> {
  return isSupabase() ? (await supabaseCatalog()).services : payloadServices()
}

export async function getServiceBySlug(slug: string): Promise<Service | null> {
  if (!isSupabase()) return payloadServiceBySlug(slug)
  return (await supabaseCatalog()).services.find((s) => s.slug === slug) ?? null
}

export async function getDeviceModels(categoryId: string): Promise<DeviceModel[]> {
  if (!isSupabase()) return payloadDeviceModels(categoryId)
  return (await supabaseCatalog()).deviceModels.filter((m) => relId(m.category) === categoryId)
}

export async function getPromotions(): Promise<Promotion[]> {
  return isSupabase() ? (await supabaseCatalog()).promotions : payloadPromotions()
}

export async function getBusinessConfig(): Promise<BusinessConfig> {
  return isSupabase() ? (await supabaseCatalog()).config : payloadBusinessConfig()
}

/** Services of one category. The "Other problem" option only exists inside the booking flow. */
export function servicesFor(services: Service[], categoryId: string, opts: { includeOther?: boolean } = {}) {
  return services.filter((s) => relId(s.category) === categoryId && (opts.includeOther || !s.isOtherProblem))
}

export function livePromotions(promotions: Promotion[], now = new Date()) {
  return promotions.filter((p) => !p.validUntil || new Date(p.validUntil) > now)
}

export function tierMultipliers(config: BusinessConfig) {
  const m = config.tierMultipliers ?? {}
  return {
    budget: m.budget ?? 0.7,
    mid: m.mid ?? 1,
    premium: m.premium ?? 1.8,
    flagship: m.flagship ?? 3,
  }
}
