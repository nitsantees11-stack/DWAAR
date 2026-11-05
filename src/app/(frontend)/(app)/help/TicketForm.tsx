'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { CircleCheck, LoaderCircle } from 'lucide-react'
import { createTicket } from '../../actions/support'
import { haptic } from '@/components/AppPrefs'
import { useI18n } from '@/components/I18nProvider'
import { cx, ui } from '@/components/ui'
import { errorKey } from '@/lib/i18n'

const TOPICS = ['booking', 'payment', 'warranty', 'account', 'other'] as const
type Topic = (typeof TOPICS)[number]

export function TicketForm({
  bookings,
  warranties,
  preset,
}: {
  bookings: { id: string; label: string }[]
  warranties: { id: string; label: string }[]
  preset: { topic: string; bookingId: string; warrantyId: string }
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [topic, setTopic] = useState<Topic>((TOPICS as readonly string[]).includes(preset.topic) ? (preset.topic as Topic) : 'booking')
  const [bookingId, setBookingId] = useState(preset.bookingId)
  const [warrantyId, setWarrantyId] = useState(preset.warrantyId)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        setSent(null)
        startTransition(async () => {
          const res = await createTicket({
            topic,
            message,
            bookingId: topic === 'warranty' ? '' : bookingId,
            warrantyId: topic === 'warranty' ? warrantyId : '',
          })
          if (!res.ok) return setError(t(errorKey(res.error), res.params))
          haptic()
          setSent(res.code)
          setMessage('')
          router.refresh()
        })
      }}
    >
      <div>
        <p className={ui.label}>{t('help.topic')}</p>
        <div className="flex flex-wrap gap-2">
          {TOPICS.map((value) => (
            <button key={value} type="button" onClick={() => setTopic(value)} className={cx(ui.chip, 'h-9', topic === value && ui.chipOn)}>
              {t(`topic.${value}`)}
            </button>
          ))}
        </div>
      </div>
      {topic === 'warranty' ? (
        warranties.length > 0 && (
          <div>
            <label className={ui.label} htmlFor="warranty">
              {t('warranty.title')}
            </label>
            <select id="warranty" value={warrantyId} onChange={(e) => setWarrantyId(e.target.value)} className={ui.input}>
              <option value="">{t('help.none')}</option>
              {warranties.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
        )
      ) : (
        bookings.length > 0 && (
          <div>
            <label className={ui.label} htmlFor="booking">
              {t('help.related')}
            </label>
            <select id="booking" value={bookingId} onChange={(e) => setBookingId(e.target.value)} className={ui.input}>
              <option value="">{t('help.none')}</option>
              {bookings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        )
      )}
      <div>
        <label className={ui.label} htmlFor="message">
          {t('help.message')}
        </label>
        <textarea id="message" rows={4} minLength={10} maxLength={1000} required value={message} onChange={(e) => setMessage(e.target.value)} className={ui.textarea} />
        <p className="mt-1 text-right text-[11px] text-faint">{message.length}/1000</p>
      </div>
      {error && <p className="text-[13px] font-semibold text-danger">{error}</p>}
      {sent && (
        <p className="flex items-center gap-2 rounded-2xl bg-success-soft p-3 text-[13px] font-bold text-success">
          <CircleCheck className="h-4 w-4" />
          {t('help.sent', { code: sent })}
        </p>
      )}
      <button disabled={pending || message.trim().length < 10} className={cx(ui.btn, ui.primary, 'w-full')}>
        {pending && <LoaderCircle className="h-4 w-4 animate-spin" />}
        {t('help.submit')}
      </button>
    </form>
  )
}
