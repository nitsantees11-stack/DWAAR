import Link from 'next/link'
import { Clock, ShieldCheck } from 'lucide-react'
import type { Service, ServiceCategory } from '@/payload-types'
import type { TFunction } from '@/lib/i18n'
import { formatINR } from '@/lib/money'
import { cx } from './ui'

export function servicePriceLabel(service: Service, t: TFunction) {
  return service.priceType === 'range' || service.tierPriced
    ? t('common.from', { price: formatINR(service.priceFromPaise) })
    : formatINR(service.priceFromPaise)
}

/** Compact card for horizontal rails. Expects an ancestor with a theme-* class. */
export function ServiceRailCard({ service, category, t }: { service: Service; category: ServiceCategory; t: TFunction }) {
  return (
    <Link
      href={`/services/${category.slug}/${service.slug}`}
      className="group flex w-[220px] shrink-0 snap-start flex-col rounded-3xl bg-surface p-4 ring-1 ring-line/80 shadow-card transition hover:-translate-y-0.5 hover:ring-(--accent)/40"
    >
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-(--accent-soft) px-2 py-0.5 text-[11px] font-bold text-(--accent-ink)">
          {service.durationLabel ?? '—'}
        </span>
        {service.popular && <span className="text-[11px] font-bold uppercase tracking-wider text-brand">{t('common.popular')}</span>}
      </div>
      <p className="mt-3 line-clamp-2 min-h-[44px] text-[16px] font-bold leading-snug">{service.name}</p>
      <p className="mt-1 line-clamp-2 text-[13px] text-muted">{service.description}</p>
      <div className="mt-auto flex items-end justify-between pt-4">
        <span className="font-display text-[18px] font-bold">{servicePriceLabel(service, t)}</span>
        <span className="rounded-full bg-ink px-3 py-1.5 text-[12px] font-bold text-white transition group-hover:bg-(--accent)">
          {t('common.book')}
        </span>
      </div>
    </Link>
  )
}

/** Full-width row used on section pages and search. */
export function ServiceRow({
  service,
  category,
  t,
  className,
}: {
  service: Service
  category: ServiceCategory
  t: TFunction
  className?: string
}) {
  return (
    <div className={cx('flex gap-4 rounded-3xl bg-surface p-4 ring-1 ring-line/80 shadow-card md:p-5', className)}>
      <Link href={`/services/${category.slug}/${service.slug}`} className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {service.popular && (
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand-ink">{t('common.popular')}</span>
          )}
          {service.allowQuantity && (
            <span className="rounded-full bg-line-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2">{t('svc.multi')}</span>
          )}
        </div>
        <p className="mt-1.5 text-[17px] font-bold leading-snug">{service.name}</p>
        <p className="mt-1 line-clamp-2 text-[14px] text-muted">{service.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
          {service.durationLabel && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {t('svc.duration', { d: service.durationLabel })}
            </span>
          )}
          {(service.warrantyDays ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              {t('common.warrantyDays', { days: service.warrantyDays ?? 0 })}
            </span>
          )}
        </div>
      </Link>
      <div className="flex shrink-0 flex-col items-end justify-between gap-3">
        <span className="text-right font-display text-[18px] font-bold leading-tight">{servicePriceLabel(service, t)}</span>
        <Link
          href={`/book/${category.slug}?service=${service.slug}`}
          className="inline-flex h-9 items-center rounded-xl bg-(--accent-soft) px-4 text-[13px] font-bold text-(--accent-ink) ring-1 ring-(--accent)/20 transition hover:bg-(--accent) hover:text-white"
        >
          {t('common.book')}
        </Link>
      </div>
    </div>
  )
}
