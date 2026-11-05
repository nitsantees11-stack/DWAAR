import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getBusinessConfig, getCategoryBySlug, getDeviceModels, getServices, servicesFor, tierMultipliers } from '@/lib/catalog'
import { getMyAddresses } from '@/lib/customer-data'
import { getAppContext } from '@/lib/session'
import { themeClass } from '@/lib/theme'
import { BookingWizard } from './BookingWizard'

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ service?: string; model?: string; mode?: string; coupon?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const category = await getCategoryBySlug(slug)
  return category ? { title: `Book ${category.name}` } : {}
}

export default async function BookPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  const { user } = await getAppContext()
  const category = await getCategoryBySlug(slug)
  if (!category) notFound()
  if (category.status !== 'live') redirect(`/services/${category.slug}`)

  const [allServices, models, addresses, config] = await Promise.all([
    getServices(),
    getDeviceModels(category.id),
    getMyAddresses(user),
    getBusinessConfig(),
  ])
  const services = servicesFor(allServices, category.id, { includeOther: true })
  const preselected = services.find((s) => s.slug === query.service)?.id
  const presetModel = models.find((m) => m.id === query.model)?.id

  return (
    <div className={themeClass(category.icon)}>
      <BookingWizard
        nowISO={new Date().toISOString()}
        category={{
          slug: category.slug,
          name: category.name,
          icon: category.icon,
          flow: category.flow,
          deviceTypes: (category.deviceTypes ?? []).map((d) => ({ value: d.value, label: d.label })),
          brands: (category.brands ?? []).map((b) => b.name),
          visitFeePaise: category.pricing?.visitFeePaise ?? 0,
          nightVisitFeePaise: category.pricing?.nightVisitFeePaise ?? 0,
          startHour: category.serviceHours?.startHour ?? 9,
          endHour: category.serviceHours?.endHour ?? 21,
          allowAsap: Boolean(category.serviceHours?.allowAsap),
          requireProblemVideo: Boolean(category.requireProblemVideo),
          promise: category.promise?.value ? { value: category.promise.value, label: category.promise.label ?? '' } : null,
        }}
        services={services.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          priceType: s.priceType,
          priceFromPaise: s.priceFromPaise,
          priceToPaise: s.priceToPaise ?? null,
          tierPriced: Boolean(s.tierPriced),
          allowQuantity: Boolean(s.allowQuantity),
          durationLabel: s.durationLabel ?? null,
          warrantyDays: s.warrantyDays ?? 0,
          popular: Boolean(s.popular),
          ninetyMinPromise: Boolean(s.ninetyMinPromise),
          isOtherProblem: Boolean(s.isOtherProblem),
        }))}
        models={models.map((m) => ({ id: m.id, brand: m.brand, model: m.model, tier: m.tier, deviceType: m.deviceType ?? null }))}
        addresses={addresses.map((a) => ({ id: a.id, label: a.label, line: a.line ?? '', landmark: a.landmark ?? '', contactName: a.contactName, isDefault: Boolean(a.isDefault) }))}
        multipliers={tierMultipliers(config)}
        user={{
          name: user.name ?? '',
          phone: user.username,
          altWhatsapp: user.altWhatsapp ?? '',
          defaultPayment: user.preferences?.defaultPayment ?? 'upi',
          allowLocation: user.privacy?.shareLiveLocation !== false,
        }}
        preset={{
          serviceId: preselected ?? null,
          modelId: presetModel ?? null,
          asap: query.mode === 'asap',
          coupon: typeof query.coupon === 'string' ? query.coupon.slice(0, 30) : '',
        }}
      />
    </div>
  )
}
