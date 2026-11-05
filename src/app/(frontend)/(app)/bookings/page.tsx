import Link from 'next/link'
import type { Metadata } from 'next'
import { CalendarClock, ChevronRight, ClipboardList } from 'lucide-react'
import type { ServiceCategory } from '@/payload-types'
import { CategoryIcon } from '@/components/CategoryIcon'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { StatusPill } from '@/components/StatusPill'
import { cx, ui } from '@/components/ui'
import { getMyBookings, isBookingActive } from '@/lib/customer-data'
import { formatINR, formatRange } from '@/lib/money'
import { getAppContext } from '@/lib/session'
import { themeClass } from '@/lib/theme'
import { formatDateTime } from '@/lib/time'
import { scheduleText } from './schedule-text'

export const metadata: Metadata = { title: 'Bookings' }

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const { user, t, locale } = await getAppContext()
  const bookings = await getMyBookings(user, 100)
  const showPast = tab === 'past'
  const active = bookings.filter(isBookingActive)
  const past = bookings.filter((b) => !isBookingActive(b))
  const list = showPast ? past : active

  return (
    <div className={ui.narrow}>
      <PageHeader title={t('bookings.title')} />
      <div className="inline-flex rounded-full bg-line-2 p-1">
        {[
          { key: 'active', label: `${t('bookings.active')} · ${active.length}`, href: '/bookings' },
          { key: 'past', label: `${t('bookings.past')} · ${past.length}`, href: '/bookings?tab=past' },
        ].map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={cx(
              'rounded-full px-4 py-2 text-[14px] font-bold transition',
              (item.key === 'past') === showPast ? 'bg-surface text-ink shadow-card' : 'text-muted',
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        {list.length === 0 ? (
          <EmptyState
            Icon={ClipboardList}
            title={t('bookings.empty')}
            body={t('bookings.emptyBody')}
            action={
              <Link href="/" className={`${ui.btn} ${ui.brand}`}>
                {t('bookings.explore')}
              </Link>
            }
          />
        ) : (
          list.map((b) => {
            const category = b.category as ServiceCategory
            const amount = b.pricing?.finalPaise
            return (
              <Link
                key={b.id}
                href={`/bookings/${b.id}`}
                className={cx(themeClass(category?.icon), 'block rounded-3xl bg-surface p-4 ring-1 ring-line/80 shadow-card transition hover:ring-(--accent)/40')}
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-(--accent-soft) text-(--accent)">
                    <CategoryIcon icon={category?.icon} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-[16px] font-bold">{b.title}</p>
                      <ChevronRight className="h-5 w-5 shrink-0 text-faint" />
                    </div>
                    <p className="text-[13px] text-muted">
                      {b.bookingCode} · {b.deviceLabel || category?.name}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusPill status={b.status} t={t} />
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2">
                        <CalendarClock className="h-3.5 w-3.5" />
                        {scheduleText(b, t, locale)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-line-2 pt-3 text-[13px]">
                  <span className="text-muted">{formatDateTime(b.createdAt, locale)}</span>
                  <span className="font-display text-[15px] font-bold">
                    {amount
                      ? formatINR(amount)
                      : b.pricing.estimateMaxPaise > 0
                        ? formatRange(b.pricing.estimateMinPaise, b.pricing.estimateMaxPaise)
                        : t('book.otherPrice')}
                  </span>
                </div>
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}
