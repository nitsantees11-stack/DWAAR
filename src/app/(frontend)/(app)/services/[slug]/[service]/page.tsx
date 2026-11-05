import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ArrowRight, Check, Clock, Info, Layers, ShieldCheck } from 'lucide-react'
import { CategoryIcon } from '@/components/CategoryIcon'
import { ServiceRow, servicePriceLabel } from '@/components/ServiceCard'
import { cx, ui } from '@/components/ui'
import { getBusinessConfig, getCategoryBySlug, getServiceBySlug, getServices, servicesFor, tierMultipliers } from '@/lib/catalog'
import { relId } from '@/lib/media'
import { formatRange } from '@/lib/money'
import { lineRange, type DeviceTier } from '@/lib/pricing'
import { getAppContext } from '@/lib/session'
import { themeClass } from '@/lib/theme'

type Props = { params: Promise<{ slug: string; service: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { service: serviceSlug } = await params
  const service = await getServiceBySlug(serviceSlug)
  return service && !service.isOtherProblem ? { title: service.name, description: service.description } : {}
}

const TIERS: DeviceTier[] = ['budget', 'mid', 'premium', 'flagship']

export default async function ServicePage({ params }: Props) {
  const { slug, service: serviceSlug } = await params
  const { t } = await getAppContext()
  const [category, service] = await Promise.all([getCategoryBySlug(slug), getServiceBySlug(serviceSlug)])
  if (!category || !service || relId(service.category) !== category.id || service.isOtherProblem) notFound()

  const [allServices, config] = await Promise.all([getServices(), getBusinessConfig()])
  const others = servicesFor(allServices, category.id).filter((s) => s.id !== service.id).slice(0, 4)
  const multipliers = tierMultipliers(config)
  const live = category.status === 'live'

  return (
    <div className={themeClass(category.icon)}>
      <div className={`${ui.narrow} pt-6`}>
        <Link href={`/services/${category.slug}`} className="inline-flex items-center gap-2 rounded-full bg-(--accent-soft) py-1 pl-1 pr-3 text-[13px] font-bold text-(--accent-ink)">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-(--accent) text-white">
            <CategoryIcon icon={category.icon} className="h-3.5 w-3.5" />
          </span>
          {category.name}
        </Link>
        <h1 className={`${ui.h1} mt-4`}>{service.name}</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{service.description}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          {service.durationLabel && (
            <span className={ui.chip}>
              <Clock className="h-3.5 w-3.5" />
              {t('svc.duration', { d: service.durationLabel })}
            </span>
          )}
          {(service.warrantyDays ?? 0) > 0 && (
            <span className={ui.chip}>
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              {t('common.warrantyDays', { days: service.warrantyDays ?? 0 })}
            </span>
          )}
          {service.allowQuantity && (
            <span className={ui.chip}>
              <Layers className="h-3.5 w-3.5" />
              {t('svc.multi')}
            </span>
          )}
        </div>

        <div className={`${ui.card} mt-6 p-5`}>
          <div className="flex items-end justify-between gap-4">
            <p className="font-display text-[32px] font-extrabold leading-none tracking-tight">{servicePriceLabel(service, t)}</p>
            {live && (
              <Link href={`/book/${category.slug}?service=${service.slug}`} className={`${ui.btn} ${ui.accent}`}>
                {t('common.bookNow')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
          <p className="mt-3 flex items-start gap-2 text-[13px] text-muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            {service.priceType === 'range' ? t('svc.rangeNote') : t('svc.fixedNote')}
          </p>
        </div>

        {service.tierPriced && (
          <section className={`${ui.card} mt-4 p-5`}>
            <p className="text-[15px] font-bold">{t('svc.tierTitle')}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2">
              {TIERS.map((tier) => {
                const r = lineRange(
                  { priceType: service.priceType, priceFromPaise: service.priceFromPaise, priceToPaise: service.priceToPaise, tierPriced: true, quantity: 1 },
                  tier,
                  multipliers,
                )
                return (
                  <div key={tier} className={cx('rounded-2xl p-3', tier === 'mid' ? 'bg-(--accent-soft)' : 'bg-line-2')}>
                    <dt className="text-[12px] font-bold uppercase tracking-wider text-muted">{t(`tier.${tier}`)}</dt>
                    <dd className="mt-1 font-display text-[16px] font-bold">{formatRange(r.min, r.max)}</dd>
                  </div>
                )
              })}
            </dl>
          </section>
        )}

        {(service.includes ?? []).length > 0 && (
          <section className={`${ui.card} mt-4 p-5`}>
            <p className="text-[15px] font-bold">{t('svc.includes')}</p>
            <ul className="mt-3 space-y-2">
              {(service.includes ?? []).map((inc) => (
                <li key={inc.id ?? inc.item} className="flex items-start gap-2.5 text-[14px]">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success-soft text-success">
                    <Check className="h-3 w-3" />
                  </span>
                  {inc.item}
                </li>
              ))}
            </ul>
          </section>
        )}

        {others.length > 0 && (
          <section className="mt-10">
            <h2 className={ui.h2}>{t('svc.more')}</h2>
            <div className="mt-4 space-y-3">
              {others.map((s) => (
                <ServiceRow key={s.id} service={s} category={category} t={t} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
