import Link from 'next/link'
import { TicketPercent } from 'lucide-react'
import type { Promotion, ServiceCategory } from '@/payload-types'
import type { TFunction } from '@/lib/i18n'
import { formatINR } from '@/lib/money'
import { formatDate } from '@/lib/time'
import { themeClass } from '@/lib/theme'
import { CopyButton } from './CopyButton'
import { cx } from './ui'

export function OfferCard({
  promo,
  category,
  t,
  locale,
  className,
}: {
  promo: Promotion
  category?: ServiceCategory | null
  t: TFunction
  locale: string
  className?: string
}) {
  const headline =
    promo.discountType === 'percent' ? `${promo.discountValue}%` : formatINR(promo.discountValue)
  return (
    <div className={cx(themeClass(category?.icon), 'relative flex overflow-hidden rounded-3xl bg-surface ring-1 ring-line/80 shadow-card', className)}>
      <div className="flex w-24 shrink-0 flex-col items-center justify-center gap-1 bg-(--accent) px-2 text-white">
        <TicketPercent className="h-5 w-5 opacity-80" />
        <span className="font-display text-[26px] font-extrabold leading-none">{headline}</span>
        <span className="text-[11px] font-bold uppercase tracking-wider opacity-80">off</span>
      </div>
      <div className="relative flex min-w-0 flex-1 flex-col gap-2 border-l-2 border-dashed border-line p-4">
        <span className="absolute -left-[9px] -top-2 h-4 w-4 rounded-full bg-canvas" />
        <span className="absolute -bottom-2 -left-[9px] h-4 w-4 rounded-full bg-canvas" />
        <div>
          <p className="text-[15px] font-bold leading-snug">{promo.title}</p>
          <p className="mt-0.5 text-[13px] text-muted">{promo.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold text-ink-2">
          <span className="rounded-full bg-line-2 px-2 py-0.5">{category ? category.name : t('offers.all')}</span>
          {(promo.minOrderPaise ?? 0) > 0 && (
            <span className="rounded-full bg-line-2 px-2 py-0.5">{t('offers.min', { amount: formatINR(promo.minOrderPaise ?? 0) })}</span>
          )}
          {promo.maxDiscountPaise ? (
            <span className="rounded-full bg-line-2 px-2 py-0.5">{t('offers.max', { amount: formatINR(promo.maxDiscountPaise) })}</span>
          ) : null}
          {promo.firstBookingOnly && <span className="rounded-full bg-line-2 px-2 py-0.5">{t('offers.first')}</span>}
          {promo.validUntil && (
            <span className="rounded-full bg-line-2 px-2 py-0.5">{t('offers.till', { date: formatDate(promo.validUntil, locale) })}</span>
          )}
        </div>
        <div className="mt-auto flex items-center gap-2 pt-1">
          <span className="rounded-lg border border-dashed border-ink/30 px-2.5 py-1 font-mono text-[13px] font-bold tracking-wider">
            {promo.code}
          </span>
          <CopyButton value={promo.code} />
          {category && (
            <Link href={`/book/${category.slug}?coupon=${encodeURIComponent(promo.code)}`} className="ml-auto text-[13px] font-bold text-(--accent-ink)">
              {t('offers.use')}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
