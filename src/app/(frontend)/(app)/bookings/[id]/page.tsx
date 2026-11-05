import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  BadgeCheck,
  CalendarClock,
  Check,
  CircleCheck,
  KeyRound,
  LifeBuoy,
  MapPin,
  Phone,
  ShieldCheck,
  Smartphone,
  Star,
} from 'lucide-react'
import type { ServiceCategory } from '@/payload-types'
import { CategoryIcon } from '@/components/CategoryIcon'
import { StatusPill } from '@/components/StatusPill'
import { cx, ui } from '@/components/ui'
import {
  cancelPolicy,
  customerCan,
  isActive,
  showsServiceOtp,
  timelineIndex,
  timelineSteps,
  type BookingFlow,
  type BookingStatus,
} from '@/lib/booking-machine'
import type { DictKey } from '@/lib/i18n'
import { formatINR, formatRange } from '@/lib/money'
import { getMyBooking } from '@/lib/customer-data'
import { getAppContext } from '@/lib/session'
import { themeClass } from '@/lib/theme'
import { formatDateTime } from '@/lib/time'
import { scheduleText } from '../schedule-text'
import { CancelPanel, LiveRefresh, QuoteActions, RatingForm } from './BookingActions'

export const metadata: Metadata = { title: 'Booking' }

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }

export default async function BookingPage({ params, searchParams }: Props) {
  const [{ id }, { created }] = await Promise.all([params, searchParams])
  const { user, t, locale } = await getAppContext()
  const found = await getMyBooking(user, id)
  if (!found) notFound()
  const { booking, events, warranty } = found

  const category = booking.category as ServiceCategory
  const flow = booking.flow as BookingFlow
  const status = booking.status as BookingStatus
  const steps = timelineSteps[flow]
  const index = timelineIndex(flow, status)
  const active = isActive(flow, status)
  const cancelled = status === 'CANCELLED'
  const policy = cancelPolicy(flow, status, category?.pricing?.cancelAfterAssignFeePaise ?? 0)
  const canCancel = customerCan(flow, status, 'CANCELLED') && policy.allowed
  const partner = booking.partner ?? {}
  const hasPartner = Boolean(partner.name)
  const quote = booking.quote ?? {}
  const pricing = booking.pricing

  return (
    <div className={cx(themeClass(category?.icon), ui.narrow, 'pt-6')}>
      {active && <LiveRefresh />}
      {created === '1' && (
        <div className="mb-4 flex items-center gap-3 rounded-3xl bg-success p-4 text-white motion-safe:animate-rise">
          <CircleCheck className="h-6 w-6 shrink-0" />
          <p className="text-[15px] font-bold">{t('booking.created')}</p>
        </div>
      )}

      {/* Summary */}
      <section className="overflow-hidden rounded-[30px] bg-night text-white">
        <div className="p-5 md:p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-(--accent)">
              <CategoryIcon icon={category?.icon} className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-bold uppercase tracking-wider text-white/60">
                {t('booking.id')} · {booking.bookingCode}
              </p>
              <h1 className="mt-0.5 font-display text-[24px] font-bold leading-tight">{booking.title}</h1>
              <p className="text-[13px] text-white/70">{category?.name}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusPill status={status} t={t} className="bg-white/15 text-white" />
            {active && (
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white/70">
                <span className="h-2 w-2 rounded-full bg-success motion-safe:animate-blink" />
                {t('booking.live')}
              </span>
            )}
          </div>
        </div>
        {!cancelled && (
          <ol className={cx('grid border-t border-white/10 bg-white/5 p-5 md:p-6', steps.length > 6 ? 'grid-cols-9' : 'grid-cols-6')}>
            {steps.map((s, i) => (
              <li key={s} className="relative flex flex-col items-center text-center">
                {i > 0 && <span className={cx('absolute right-1/2 top-3 h-0.5 w-full', i <= index ? 'bg-(--accent)' : 'bg-white/15')} />}
                <span
                  className={cx(
                    'relative grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold',
                    i < index ? 'bg-(--accent) text-white' : i === index ? 'bg-white text-ink ring-4 ring-(--accent)/40' : 'bg-white/15 text-white/50',
                  )}
                >
                  {i < index ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={cx('mt-2 hidden text-[10px] font-semibold leading-tight sm:block', i <= index ? 'text-white' : 'text-white/45')}>
                  {t(`status.${s}` as DictKey)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="mt-4 space-y-4">
        {/* Quote approval */}
        {status === 'QUOTE_SENT' && (
          <section className="rounded-3xl bg-warn-soft p-5 ring-1 ring-warn/20">
            <p className="text-[17px] font-bold">{t('booking.quote')}</p>
            <p className="mt-1 text-[14px] text-ink-2">{t('booking.quoteBody')}</p>
            {quote.diagnosis && (
              <div className="mt-3 rounded-2xl bg-surface p-4">
                <p className="text-[12px] font-bold uppercase tracking-wider text-muted">{t('booking.diagnosis')}</p>
                <p className="mt-1 text-[14px]">{quote.diagnosis}</p>
              </div>
            )}
            <ul className="mt-3 divide-y divide-line-2 rounded-2xl bg-surface px-4">
              {(quote.items ?? []).map((item) => (
                <li key={item.id ?? item.label} className="flex items-center justify-between gap-3 py-3 text-[14px]">
                  <span>
                    {item.label}
                    {item.grade && <span className="ml-2 rounded-full bg-line-2 px-2 py-0.5 text-[11px] font-bold uppercase text-muted">{item.grade}</span>}
                  </span>
                  <span className="font-bold">{formatINR(item.pricePaise)}</span>
                </li>
              ))}
              <li className="flex items-center justify-between py-3">
                <span className="font-bold">{t('booking.total')}</span>
                <span className="font-display text-[20px] font-extrabold">{formatINR(quote.totalPaise ?? 0)}</span>
              </li>
            </ul>
            <QuoteActions bookingId={booking.id} declineFeePaise={category?.pricing?.declineFeePaise ?? 0} />
          </section>
        )}

        {/* Partner + OTP */}
        {active && (
          <section className={`${ui.card} p-5`}>
            <p className={ui.eyebrow}>{t('booking.partner')}</p>
            {hasPartner ? (
              <div className="mt-3 flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-(--accent-soft) font-display text-[18px] font-bold text-(--accent-ink)">
                  {partner.name?.[0]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[16px] font-bold">
                    {partner.name}
                    <BadgeCheck className="h-4 w-4 text-success" />
                  </p>
                  <p className="flex items-center gap-2 text-[13px] text-muted">
                    {partner.rating ? (
                      <span className="inline-flex items-center gap-0.5 font-semibold text-ink-2">
                        <Star className="h-3.5 w-3.5 fill-current text-warn" />
                        {partner.rating.toFixed(1)}
                      </span>
                    ) : null}
                    {partner.etaMinutes ? t('booking.eta', { min: partner.etaMinutes }) : null}
                  </p>
                </div>
                {partner.maskedPhone && (
                  <a href={`tel:${partner.maskedPhone.replace(/\s/g, '')}`} className={`${ui.btnSm} ${ui.accent} h-10`}>
                    <Phone className="h-4 w-4" />
                    {t('common.call')}
                  </a>
                )}
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-3">
                <span className="relative grid h-12 w-12 place-items-center">
                  <span className="absolute inset-0 rounded-full bg-(--accent)/20 motion-safe:animate-ping-ring" />
                  <span className="h-4 w-4 rounded-full bg-(--accent)" />
                </span>
                <div>
                  <p className="text-[15px] font-bold">{t('booking.partnerPending')}</p>
                  <p className="text-[13px] text-muted">{t('booking.partnerPendingBody')}</p>
                </div>
              </div>
            )}
            {booking.serviceOtp && showsServiceOtp(flow, status) && (
              <div className="mt-4 flex items-center gap-4 rounded-2xl bg-canvas p-4">
                <KeyRound className="h-6 w-6 shrink-0 text-(--accent)" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold">{t('booking.otp')}</p>
                  <p className="text-[12px] text-muted">{t('booking.otpBody')}</p>
                </div>
                <span className="font-mono text-[26px] font-bold tracking-[0.25em]">{booking.serviceOtp}</span>
              </div>
            )}
          </section>
        )}

        {/* Details */}
        <section className={`${ui.card} divide-y divide-line-2`}>
          <Detail Icon={CalendarClock} label={t('booking.when')}>
            {scheduleText(booking, t, locale)}
          </Detail>
          <Detail Icon={MapPin} label={t('booking.where')}>
            {booking.address?.line}
            {booking.address?.landmark && <span className="block text-[13px] text-muted">{booking.address.landmark}</span>}
          </Detail>
          {(booking.deviceLabel || booking.device?.notes) && (
            <Detail Icon={Smartphone} label={t('booking.device')}>
              {booking.deviceLabel}
              {booking.device?.notes && <span className="block text-[13px] text-muted">“{booking.device.notes}”</span>}
            </Detail>
          )}
        </section>

        {/* Price */}
        <section className={`${ui.card} p-5`}>
          <p className="text-[15px] font-bold">{t('booking.price')}</p>
          <dl className="mt-3 space-y-2 text-[14px]">
            {(booking.lines ?? []).map((line) => (
              <div key={line.id ?? line.name} className="flex justify-between gap-3">
                <dt className="text-ink-2">
                  {line.name}
                  {line.quantity > 1 ? ` × ${line.quantity}` : ''}
                </dt>
                <dd className="font-semibold">{line.maxPaise > 0 ? formatRange(line.minPaise, line.maxPaise) : t('book.otherPrice')}</dd>
              </div>
            ))}
            {(pricing.visitFeePaise ?? 0) > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-2">{t('book.visitFee')}</dt>
                <dd className="font-semibold">{formatINR(pricing.visitFeePaise ?? 0)}</dd>
              </div>
            )}
            {(pricing.discountPaise ?? 0) > 0 && (
              <div className="flex justify-between text-success">
                <dt>
                  {t('book.discount')} {pricing.couponCode && <span className="font-mono text-[12px]">({pricing.couponCode})</span>}
                </dt>
                <dd className="font-bold">− {formatINR(pricing.discountPaise ?? 0)}</dd>
              </div>
            )}
            {(pricing.cancelFeePaise ?? 0) > 0 && (
              <div className="flex justify-between text-danger">
                <dt>{t('cat.cancelFee')}</dt>
                <dd className="font-bold">{formatINR(pricing.cancelFeePaise ?? 0)}</dd>
              </div>
            )}
            {(pricing.declineFeePaise ?? 0) > 0 && status !== 'QUOTE_SENT' && (
              <div className="flex justify-between text-danger">
                <dt>{t('cat.declineFee')}</dt>
                <dd className="font-bold">{formatINR(pricing.declineFeePaise ?? 0)}</dd>
              </div>
            )}
            <div className="flex items-end justify-between border-t border-line-2 pt-3">
              <dt className="font-bold">{pricing.finalPaise ? t('booking.final') : t('book.payable')}</dt>
              <dd className="font-display text-[22px] font-extrabold">
                {pricing.finalPaise
                  ? formatINR(pricing.finalPaise)
                  : pricing.estimateMaxPaise > 0
                    ? formatRange(pricing.estimateMinPaise, pricing.estimateMaxPaise)
                    : t('book.otherPrice')}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[13px] text-muted">
            {t('booking.payment')}: {t(`pay.${booking.payment.method}` as DictKey)} · {t(`paystatus.${booking.payment.status ?? 'pending'}` as DictKey)}
          </p>
        </section>

        {warranty && (
          <Link href="/account/warranties" className="flex items-center gap-3 rounded-3xl bg-success-soft p-4 text-success ring-1 ring-success/15">
            <ShieldCheck className="h-6 w-6 shrink-0" />
            <span className="flex-1 text-[15px] font-bold">{t('booking.warranty', { days: warranty.days })}</span>
          </Link>
        )}

        {(status === 'COMPLETED' || status === 'RETURNED') && (
          <section className={`${ui.card} p-5`}>
            {booking.rating?.stars ? (
              <p className="flex items-center gap-2 text-[15px] font-bold">
                <Star className="h-5 w-5 fill-current text-warn" />
                {t('booking.rated', { stars: booking.rating.stars })}
              </p>
            ) : (
              <RatingForm bookingId={booking.id} />
            )}
          </section>
        )}

        {canCancel && <CancelPanel bookingId={booking.id} feePaise={policy.feePaise} />}

        {/* Activity */}
        {events.length > 0 && (
          <section className={`${ui.card} p-5`}>
            <p className="text-[15px] font-bold">{t('booking.activity')}</p>
            <ol className="mt-4 space-y-4 border-l-2 border-line pl-5">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full bg-(--accent) ring-4 ring-surface" />
                  <p className="text-[14px] font-bold">{t(`status.${e.status}` as DictKey)}</p>
                  <p className="text-[12px] text-muted">
                    {formatDateTime(e.createdAt, locale)}
                    {e.note ? ` · ${e.note}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}

        <Link href={`/help?booking=${booking.id}`} className={`${ui.btn} ${ui.secondary} w-full`}>
          <LifeBuoy className="h-4 w-4" />
          {t('booking.help')}
        </Link>
      </div>
    </div>
  )
}

function Detail({ Icon, label, children }: { Icon: typeof MapPin; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-(--accent-soft) text-(--accent)">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-bold uppercase tracking-wider text-muted">{label}</p>
        <div className="mt-0.5 text-[14px] font-semibold">{children}</div>
      </div>
    </div>
  )
}
