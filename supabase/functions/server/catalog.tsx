import { allDocs, getDocs, getGlobal, idOf, type Doc } from './db.tsx'

/**
 * The service catalog, stored as Payload-shaped documents (collections service-categories,
 * services, device-models, promotions, media, skill-tests and the business-config global).
 * Supabase is the source of truth: edit a row in the dashboard and the next read sees it.
 */
export type Category = Doc & {
  name: string
  slug: string
  status: 'live' | 'coming_soon'
  flow: 'pickup_drop' | 'doorstep' | 'roadside'
  order?: number
  heroImage?: unknown
  deviceTypes?: { value: string; label: string }[] | null
  serviceHours?: { startHour?: number | null; endHour?: number | null; allowAsap?: boolean | null } | null
  pricing?: { visitFeePaise?: number | null; nightVisitFeePaise?: number | null; cancelAfterAssignFeePaise?: number | null; declineFeePaise?: number | null } | null
  requireProblemVideo?: boolean | null
}
export type Service = Doc & {
  name: string
  slug: string
  category: string
  active?: boolean | null
  order?: number | null
  priceType: 'fixed' | 'range'
  priceFromPaise: number
  priceToPaise?: number | null
  tierPriced?: boolean | null
  warrantyDays?: number | null
  allowQuantity?: boolean | null
  ninetyMinPromise?: boolean | null
  isOtherProblem?: boolean | null
}
export type DeviceModel = Doc & { category: string; brand: string; model: string; deviceType?: string | null; tier: 'budget' | 'mid' | 'premium' | 'flagship' }
export type Promotion = Doc & {
  code: string
  active?: boolean | null
  discountType: 'percent' | 'flat'
  discountValue: number
  maxDiscountPaise?: number | null
  minOrderPaise?: number | null
  category?: string | null
  firstBookingOnly?: boolean | null
  validUntil?: string | null
}
export type BusinessConfig = {
  zone?: { name?: string | null; hubName?: string | null; centerLat?: number | null; centerLng?: number | null; radiusKm?: number | null; onlinePartners?: number | null } | null
  support?: { phone?: string | null; whatsapp?: string | null; email?: string | null; hours?: string | null } | null
  tierMultipliers?: { budget?: number | null; mid?: number | null; premium?: number | null; flagship?: number | null } | null
  rewards?: { referralRewardPaise?: number | null; slaCreditPaise?: number | null } | null
  partnerPay?: {
    partnerSharePercent?: { category: string; percent: number }[] | null
    defaultSharePercent?: number | null
    visitFeeSharePercent?: number | null
    riderLegFeePaise?: number | null
    releasePenaltyPaise?: number | null
    payoutDay?: string | null
  } | null
}

const byOrder = (a: { order?: number | null }, b: { order?: number | null }) => (a.order ?? 0) - (b.order ?? 0)

/** Upload fields are stored as media ids; reads hand back the media document (depth 1). */
async function populateMedia<T extends Record<string, unknown>>(docs: T[], field: string): Promise<T[]> {
  const media = await getDocs<Doc>('media', docs.map((d) => idOf(d[field])))
  const byId = new Map(media.map((m) => [m.id, m]))
  return docs.map((d) => ({ ...d, [field]: byId.get(idOf(d[field]) ?? '') ?? null }))
}

export async function getConfig(): Promise<BusinessConfig> {
  return getGlobal<BusinessConfig>('business-config')
}

/** Business config without the admin-only partner pay rules. */
export async function getPublicConfig() {
  const { partnerPay: _private, ...rest } = (await getConfig()) as BusinessConfig & Record<string, unknown>
  return { ...rest, id: 'business-config', globalType: 'business-config' }
}

export async function loadCatalog() {
  const [categories, services, deviceModels, promotions] = await Promise.all([
    allDocs<Category>('service-categories'),
    allDocs<Service>('services'),
    allDocs<DeviceModel>('device-models'),
    allDocs<Promotion>('promotions'),
  ])
  return {
    categories: (await populateMedia(categories, 'heroImage')).sort(byOrder),
    services: services.sort(byOrder),
    deviceModels: deviceModels.sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model)),
    promotions: promotions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  }
}

/** What anyone may read: inactive services and inactive offers are hidden (as in Payload). */
export async function publicCatalog() {
  const cat = await loadCatalog()
  return {
    categories: cat.categories,
    services: cat.services.filter((s) => s.active !== false),
    deviceModels: cat.deviceModels,
    promotions: cat.promotions.filter((p) => p.active !== false),
    config: await getPublicConfig(),
  }
}

export function tierMultipliers(config: BusinessConfig) {
  const m = config.tierMultipliers ?? {}
  return { budget: m.budget ?? 0.7, mid: m.mid ?? 1, premium: m.premium ?? 1.8, flagship: m.flagship ?? 3 }
}
