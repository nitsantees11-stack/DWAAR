import Link from 'next/link'
import type { Metadata } from 'next'
import { ShieldCheck } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { cx, ui } from '@/components/ui'
import { getMyWarranties } from '@/lib/customer-data'
import type { DictKey } from '@/lib/i18n'
import { getAppContext } from '@/lib/session'
import { formatDate } from '@/lib/time'

export const metadata: Metadata = { title: 'Warranties' }

export default async function WarrantiesPage() {
  const { user, t, locale } = await getAppContext()
  const warranties = await getMyWarranties(user)
  const now = Date.now()

  return (
    <div className={ui.narrow}>
      <PageHeader title={t('warranty.title')} back="/account" />
      {warranties.length === 0 ? (
        <EmptyState Icon={ShieldCheck} title={t('warranty.empty')} body={t('warranty.emptyBody')} />
      ) : (
        <div className="space-y-3">
          {warranties.map((w) => {
            const ends = new Date(w.endsAt).getTime()
            const start = new Date(w.startsAt).getTime()
            const expired = ends <= now
            const status = w.status === 'active' && expired ? 'expired' : (w.status ?? 'active')
            const daysLeft = Math.max(0, Math.ceil((ends - now) / 86_400_000))
            const progress = Math.min(100, Math.max(0, ((now - start) / Math.max(1, ends - start)) * 100))
            const bookingId = typeof w.booking === 'object' ? w.booking.id : w.booking
            return (
              <div key={w.id} className={cx('overflow-hidden rounded-3xl ring-1 shadow-card', status === 'active' ? 'bg-success text-white ring-success' : 'bg-surface ring-line/80')}>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[17px] font-bold">{w.title}</p>
                      {w.deviceLabel && <p className={cx('text-[13px]', status === 'active' ? 'text-white/75' : 'text-muted')}>{w.deviceLabel}</p>}
                    </div>
                    <span className={cx('rounded-full px-2.5 py-1 text-[12px] font-bold', status === 'active' ? 'bg-white/20' : 'bg-line-2 text-muted')}>
                      {t(`warranty.${status}` as DictKey)}
                    </span>
                  </div>
                  {status === 'active' && (
                    <>
                      <p className="mt-4 font-display text-[30px] font-extrabold leading-none">{t('warranty.left', { days: daysLeft })}</p>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/20">
                        <div className={cx('h-full rounded-full bg-white', progress > 66 ? 'w-1/4' : progress > 33 ? 'w-1/2' : 'w-3/4')} />
                      </div>
                    </>
                  )}
                  <p className={cx('mt-3 text-[13px]', status === 'active' ? 'text-white/80' : 'text-muted')}>
                    {t('warranty.till', { date: formatDate(w.endsAt, locale) })} · {t('warranty.claims', { used: w.claimsUsed ?? 0 })}
                  </p>
                </div>
                <div className={cx('flex gap-2 px-5 pb-5', status !== 'active' && 'pt-0')}>
                  <Link href={`/bookings/${bookingId}`} className={cx(ui.btnSm, status === 'active' ? 'bg-white/15 text-white hover:bg-white/25' : ui.secondary)}>
                    {t('common.details')}
                  </Link>
                  {status === 'active' && (
                    <Link href={`/help?warranty=${w.id}`} className={cx(ui.btnSm, 'bg-white text-success hover:bg-white/90')}>
                      {t('warranty.claim')}
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
