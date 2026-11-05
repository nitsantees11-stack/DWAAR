import type { Metadata } from 'next'
import { Clock, Mail, MessageCircle, Phone } from 'lucide-react'
import type { Booking } from '@/payload-types'
import { CategoryIcon } from '@/components/CategoryIcon'
import { PageHeader } from '@/components/PageHeader'
import { cx, ui } from '@/components/ui'
import { getBusinessConfig, getCategories } from '@/lib/catalog'
import { getMyBookings, getMyTickets, getMyWarranties } from '@/lib/customer-data'
import type { DictKey } from '@/lib/i18n'
import { getAppContext } from '@/lib/session'
import { themeClass } from '@/lib/theme'
import { formatDateTime } from '@/lib/time'
import { TicketForm } from './TicketForm'

export const metadata: Metadata = { title: 'Help' }

type Props = { searchParams: Promise<{ booking?: string; warranty?: string; topic?: string }> }

export default async function HelpPage({ searchParams }: Props) {
  const query = await searchParams
  const { user, t, locale } = await getAppContext()
  const [config, categories, bookings, warranties, tickets] = await Promise.all([
    getBusinessConfig(),
    getCategories(),
    getMyBookings(user, 30),
    getMyWarranties(user),
    getMyTickets(user),
  ])
  const support = config.support ?? {}
  const phone = support.phone?.replace(/\s/g, '')
  const presetBooking = bookings.find((b) => b.id === query.booking)?.id ?? ''
  const presetWarranty = warranties.find((w) => w.id === query.warranty)?.id ?? ''
  const presetTopic = presetWarranty ? 'warranty' : presetBooking ? 'booking' : (query.topic ?? '')

  return (
    <div className={ui.section}>
      <PageHeader title={t('help.title')} subtitle={t('help.subtitle')} />

      <div className="grid gap-3 sm:grid-cols-3">
        {phone && (
          <a href={`tel:${phone}`} className={`${ui.card} flex items-center gap-3 p-4 transition hover:ring-ink/25`}>
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-soft text-brand-ink">
              <Phone className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[14px] font-bold">{t('common.call')}</span>
              <span className="block text-[13px] text-muted">{support.phone}</span>
            </span>
          </a>
        )}
        {support.whatsapp && (
          <a href={`https://wa.me/${support.whatsapp}`} target="_blank" rel="noreferrer" className={`${ui.card} flex items-center gap-3 p-4 transition hover:ring-ink/25`}>
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-success-soft text-success">
              <MessageCircle className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[14px] font-bold">{t('common.whatsapp')}</span>
              <span className="block text-[13px] text-muted">+{support.whatsapp}</span>
            </span>
          </a>
        )}
        {support.email && (
          <a href={`mailto:${support.email}`} className={`${ui.card} flex items-center gap-3 p-4 transition hover:ring-ink/25`}>
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-line-2 text-ink-2">
              <Mail className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[14px] font-bold">{t('common.email')}</span>
              <span className="block text-[13px] text-muted">{support.email}</span>
            </span>
          </a>
        )}
      </div>
      {support.hours && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-muted">
          <Clock className="h-4 w-4" />
          {t('help.hours')}: {support.hours}
        </p>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1fr]">
        <section>
          <h2 className={ui.h2}>{t('help.ticket')}</h2>
          <div className={`${ui.card} mt-4 p-5`}>
            <TicketForm
              bookings={bookings.map((b: Booking) => ({ id: b.id, label: `${b.bookingCode} · ${b.title}` }))}
              warranties={warranties.map((w) => ({ id: w.id, label: `${w.title}${w.deviceLabel ? ` · ${w.deviceLabel}` : ''}` }))}
              preset={{ topic: presetTopic, bookingId: presetBooking, warrantyId: presetWarranty }}
            />
          </div>

          <h2 className={`${ui.h2} mt-10`}>{t('help.mine')}</h2>
          <div className="mt-4 space-y-3">
            {tickets.length === 0 ? (
              <p className="text-[14px] text-muted">{t('help.noTickets')}</p>
            ) : (
              tickets.map((ticket) => (
                <div key={ticket.id} className={`${ui.card} p-4`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[13px] font-bold">{ticket.ticketCode}</p>
                    <span
                      className={cx(
                        'rounded-full px-2.5 py-1 text-[12px] font-bold',
                        ticket.status === 'resolved' ? 'bg-success-soft text-success' : ticket.status === 'in_progress' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand-ink',
                      )}
                    >
                      {t(`ticket.${ticket.status ?? 'open'}` as DictKey)}
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] text-muted">
                    {t(`topic.${ticket.topic}` as DictKey)} · {formatDateTime(ticket.createdAt, locale)}
                  </p>
                  <p className="mt-2 text-[14px] text-ink-2">{ticket.message}</p>
                  {ticket.reply && (
                    <div className="mt-3 rounded-2xl bg-canvas p-3">
                      <p className="text-[12px] font-bold uppercase tracking-wider text-muted">{t('help.reply')}</p>
                      <p className="mt-1 text-[14px]">{ticket.reply}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className={ui.h2}>{t('help.faq')}</h2>
          <div className="mt-4 space-y-5">
            {categories
              .filter((c) => (c.faqs ?? []).length > 0)
              .map((c) => (
                <div key={c.id} className={themeClass(c.icon)}>
                  <p className="mb-2 flex items-center gap-2 text-[14px] font-bold text-(--accent-ink)">
                    <CategoryIcon icon={c.icon} className="h-4 w-4" />
                    {c.name}
                  </p>
                  <div className="divide-y divide-line overflow-hidden rounded-3xl bg-surface ring-1 ring-line/80">
                    {(c.faqs ?? []).map((f) => (
                      <details key={f.id ?? f.question} className="group">
                        <summary className="flex cursor-pointer items-center justify-between gap-4 p-4 text-[14px] font-bold">
                          {f.question}
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-line-2 leading-none transition group-open:rotate-45">+</span>
                        </summary>
                        <p className="px-4 pb-4 text-[14px] leading-relaxed text-ink-2">{f.answer}</p>
                      </details>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </section>
      </div>
    </div>
  )
}
