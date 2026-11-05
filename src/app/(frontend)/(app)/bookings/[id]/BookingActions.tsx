'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { LoaderCircle, Star, X } from 'lucide-react'
import { cancelBooking, rateBooking, respondToQuote } from '../../../actions/bookings'
import { haptic } from '@/components/AppPrefs'
import { useI18n } from '@/components/I18nProvider'
import { cx, ui } from '@/components/ui'
import { errorKey } from '@/lib/i18n'
import { formatINR } from '@/lib/money'

/** Hub updates arrive through Payload; refresh the server view while the job is live. */
export function LiveRefresh({ everyMs = 20_000 }: { everyMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, everyMs)
    return () => clearInterval(timer)
  }, [router, everyMs])
  return null
}

function useAction() {
  const router = useRouter()
  const { t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string; params?: Record<string, string | number> }>) {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) {
        haptic([20, 40, 20])
        return setError(t(errorKey(res.error), res.params))
      }
      haptic()
      router.refresh()
    })
  }
  return { error, pending, run }
}

export function QuoteActions({ bookingId, declineFeePaise }: { bookingId: string; declineFeePaise: number }) {
  const { t } = useI18n()
  const { error, pending, run } = useAction()
  return (
    <div className="mt-4">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={pending} onClick={() => run(() => respondToQuote({ id: bookingId, decision: 'decline' }))} className={cx(ui.btn, ui.secondary)}>
          {t('booking.decline')}
        </button>
        <button type="button" disabled={pending} onClick={() => run(() => respondToQuote({ id: bookingId, decision: 'approve' }))} className={cx(ui.btn, ui.primary)}>
          {pending && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {t('booking.approve')}
        </button>
      </div>
      {declineFeePaise > 0 && <p className="mt-2 text-[12px] text-ink-2">{t('booking.declineWarn', { fee: formatINR(declineFeePaise) })}</p>}
      {error && <p className="mt-2 text-[13px] font-semibold text-danger">{error}</p>}
    </div>
  )
}

const REASONS = ['plan_changed', 'mistake', 'time', 'elsewhere', 'other'] as const

export function CancelPanel({ bookingId, feePaise }: { bookingId: string; feePaise: number }) {
  const { t } = useI18n()
  const { error, pending, run } = useAction()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null)

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={cx(ui.btn, 'w-full text-danger ring-1 ring-danger/25 hover:bg-danger-soft')}>
        {t('booking.cancel')}
      </button>
    )
  }
  return (
    <section className="rounded-3xl bg-surface p-5 ring-1 ring-danger/25">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[16px] font-bold">{t('booking.cancelWhy')}</p>
          <p className={cx('mt-1 text-[13px] font-semibold', feePaise > 0 ? 'text-danger' : 'text-success')}>
            {feePaise > 0 ? t('booking.cancelFee', { fee: formatINR(feePaise) }) : t('booking.cancelFree')}
          </p>
        </div>
        <button type="button" aria-label={t('common.cancel')} onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-full bg-line-2">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 grid gap-2">
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={cx('rounded-2xl px-4 py-3 text-left text-[14px] font-semibold ring-1 transition', reason === r ? 'bg-danger-soft text-danger ring-danger/40' : 'ring-line')}
          >
            {t(`reason.${r}`)}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-[13px] font-semibold text-danger">{error}</p>}
      <button
        type="button"
        disabled={!reason || pending}
        onClick={() => reason && run(() => cancelBooking({ id: bookingId, reason }))}
        className={cx(ui.btn, ui.danger, 'mt-4 w-full')}
      >
        {pending && <LoaderCircle className="h-4 w-4 animate-spin" />}
        {t('booking.cancelConfirm')}
      </button>
    </section>
  )
}

export function RatingForm({ bookingId }: { bookingId: string }) {
  const { t } = useI18n()
  const { error, pending, run } = useAction()
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  return (
    <div>
      <p className="text-[16px] font-bold">{t('booking.rate')}</p>
      <div className="mt-3 flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-label={`${n}`} onClick={() => setStars(n)} className="p-1">
            <Star className={cx('h-8 w-8 transition', n <= stars ? 'fill-current text-warn' : 'text-line')} />
          </button>
        ))}
      </div>
      {stars > 0 && (
        <>
          <textarea rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('booking.ratePh')} className={cx(ui.textarea, 'mt-3')} />
          <button type="button" disabled={pending} onClick={() => run(() => rateBooking({ id: bookingId, stars, comment }))} className={cx(ui.btn, ui.primary, 'mt-3 w-full')}>
            {pending && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {t('booking.rateSend')}
          </button>
        </>
      )}
      {error && <p className="mt-2 text-[13px] font-semibold text-danger">{error}</p>}
    </div>
  )
}
