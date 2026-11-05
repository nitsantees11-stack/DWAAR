import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import {
  ArrowRight,
  BadgeCheck,
  ChevronRight,
  Gift,
  IndianRupee,
  MapPin,
  Navigation,
  Search,
  ShieldCheck,
  Timer,
  Video,
} from 'lucide-react'
import type { ServiceCategory } from '@/payload-types'
import { CategoryIcon } from '@/components/CategoryIcon'
import { OfferCard } from '@/components/OfferCard'
import { Radar } from '@/components/Radar'
import { ServiceRailCard } from '@/components/ServiceCard'
import { StatusPill } from '@/components/StatusPill'
import { cx, ui } from '@/components/ui'
import { timelineIndex, timelineSteps, type BookingFlow, type BookingStatus } from '@/lib/booking-machine'
import { getBusinessConfig, getCategories, getPromotions, getServices, livePromotions, servicesFor } from '@/lib/catalog'
import { getMyBookings, getMyWaitlist, isBookingActive } from '@/lib/customer-data'
import type { DictKey } from '@/lib/i18n'
import { asMedia, relId } from '@/lib/media'
import { formatINR } from '@/lib/money'
import { getAppContext } from '@/lib/session'
import { themeClass } from '@/lib/theme'

export const metadata: Metadata = { title: 'Home' }

export default async function HomePage() {
  const { user, t, locale } = await getAppContext()
  const [categories, services, promotions, config, bookings, waitlist] = await Promise.all([
    getCategories(),
    getServices(),
    getPromotions(),
    getBusinessConfig(),
    getMyBookings(user, 20),
    getMyWaitlist(user),
  ])

  const live = categories.filter((c) => c.status === 'live')
  const soon = categories.filter((c) => c.status === 'coming_soon')
  const active = bookings.filter(isBookingActive).slice(0, 2)
  const zone = config.zone ?? {}
  const rewards = config.rewards ?? {}
  const firstName = user.name?.split(' ')[0]

  // Personalised offers: drop ones the customer can't use and lead with sections they book.
  const personalised = user.privacy?.personalisedOffers !== false
  const bookedCategories = new Set(bookings.map((b) => relId(b.category)))
  let offers = livePromotions(promotions)
  if (personalised) {
    const hasBooked = bookings.some((b) => b.status !== 'CANCELLED')
    offers = offers
      .filter((p) => !(p.firstBookingOnly && hasBooked))
      .sort((a, b) => Number(bookedCategories.has(relId(b.category))) - Number(bookedCategories.has(relId(a.category))))
  }
  const categoryById = new Map(categories.map((c) => [c.id, c]))

  const promises: { Icon: typeof Video; title: DictKey; body: DictKey }[] = [
    { Icon: IndianRupee, title: 'promise.price.title', body: 'promise.price.body' },
    { Icon: Video, title: 'promise.video.title', body: 'promise.video.body' },
    { Icon: Navigation, title: 'promise.track.title', body: 'promise.track.body' },
    { Icon: ShieldCheck, title: 'promise.warranty.title', body: 'promise.warranty.body' },
    { Icon: BadgeCheck, title: 'promise.verified.title', body: 'promise.verified.body' },
    { Icon: Timer, title: 'promise.sla.title', body: 'promise.sla.body' },
  ]

  return (
    <div className="theme-brand">
      {/* Hero */}
      <section className={`${ui.section} pt-4 md:pt-6`}>
        <div className="relative overflow-hidden rounded-[32px] bg-night text-white">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/25 blur-3xl" />
          <div className="relative grid items-center gap-6 p-5 md:grid-cols-[1.25fr_1fr] md:p-10">
            <div className="motion-safe:animate-rise">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white/85 ring-1 ring-white/10">
                <MapPin className="h-3.5 w-3.5 text-brand" />
                {t('home.zone', { zone: zone.name ?? 'Gurugram', km: zone.radiusKm ?? 5 })}
              </span>
              <p className="mt-5 text-[15px] font-semibold text-white/70">
                {firstName ? t('home.greeting', { name: firstName }) : t('home.greetingNoName')}
              </p>
              <h1 className="mt-1 font-display text-[32px] font-bold leading-[1.02] tracking-tight md:text-[52px]">
                {t('home.question')}
              </h1>
              <form action="/search" className="mt-6 flex items-center gap-2 rounded-2xl bg-white p-1.5 pl-4 text-ink shadow-float">
                <Search className="h-5 w-5 shrink-0 text-faint" />
                <input
                  name="q"
                  placeholder={t('home.search')}
                  className="h-11 min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-faint focus:outline-none"
                />
                <button className={`${ui.btnSm} ${ui.brand} h-11 rounded-xl px-4`} aria-label={t('search.title')}>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
              <div className="no-scrollbar -mx-1 mt-4 flex gap-2 overflow-x-auto px-1">
                {live.map((c) => (
                  <Link
                    key={c.id}
                    href={`/services/${c.slug}`}
                    className={cx(themeClass(c.icon), 'inline-flex shrink-0 items-center gap-2 rounded-full bg-white/10 py-1.5 pl-1.5 pr-3.5 text-[13px] font-semibold ring-1 ring-white/10 transition hover:bg-white/15')}
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-(--accent)">
                      <CategoryIcon icon={c.icon} className="h-4 w-4" />
                    </span>
                    {c.name}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-5 md:flex-col md:items-center md:text-center">
              <Radar count={zone.onlinePartners ?? 0} className="w-32 shrink-0 md:w-64" />
              <div>
                <p className="inline-flex items-center gap-2 font-display text-[20px] font-bold md:text-[24px]">
                  <span className="h-2.5 w-2.5 rounded-full bg-success motion-safe:animate-blink" />
                  {t('home.partnersOnline', { count: zone.onlinePartners ?? 0 })}
                </p>
                <p className="mt-1 max-w-xs text-[13px] text-white/65">{t('home.radarBody')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Ongoing bookings */}
      {active.length > 0 && (
        <section className={`${ui.section} mt-6 space-y-3`}>
          {active.map((b) => {
            const category = b.category as ServiceCategory
            const flow = b.flow as BookingFlow
            const steps = timelineSteps[flow]
            const index = timelineIndex(flow, b.status as BookingStatus)
            return (
              <Link
                key={b.id}
                href={`/bookings/${b.id}`}
                className={cx(themeClass(category?.icon), 'block rounded-3xl bg-surface p-4 ring-1 ring-(--accent)/25 shadow-card transition hover:ring-(--accent)/50 md:p-5')}
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-(--accent-soft) text-(--accent)">
                    <CategoryIcon icon={category?.icon} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={ui.eyebrow}>{t('home.ongoing')}</p>
                    <p className="truncate text-[16px] font-bold">{b.title}</p>
                  </div>
                  <StatusPill status={b.status} t={t} className="hidden sm:inline-flex" />
                  <span className="inline-flex items-center gap-1 text-[13px] font-bold text-(--accent-ink)">
                    {t('home.track')}
                    <ChevronRight className="h-4 w-4" />
                  </span>
                </div>
                <div className="mt-4 flex gap-1">
                  {steps.map((s, i) => (
                    <span key={s} className={cx('h-1.5 flex-1 rounded-full', i <= index ? 'bg-(--accent)' : 'bg-line')} />
                  ))}
                </div>
              </Link>
            )
          })}
        </section>
      )}

      {/* Category tiles */}
      <section className={`${ui.section} mt-8`}>
        <h2 className={ui.h2}>{t('home.categories')}</h2>
        <div className="mt-4 grid grid-cols-5 gap-2 md:gap-4">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/services/${c.slug}`}
              className={cx(themeClass(c.icon), 'group flex flex-col items-center gap-2 text-center')}
            >
              <span className="relative grid aspect-square w-full place-items-center rounded-[22px] bg-(--accent-soft) text-(--accent) ring-1 ring-(--accent)/10 transition group-hover:-translate-y-0.5 group-hover:ring-(--accent)/40 md:rounded-[28px]">
                <CategoryIcon icon={c.icon} className="h-7 w-7 md:h-10 md:w-10" strokeWidth={1.8} />
                {c.status === 'coming_soon' && (
                  <span className="absolute -top-1.5 rounded-full bg-ink px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white md:text-[10px]">
                    {t('common.comingSoon')}
                  </span>
                )}
              </span>
              <span className="line-clamp-2 text-[11px] font-bold leading-tight text-ink-2 md:text-[14px]">
                {c.name.split(' ')[0]}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Offers */}
      {offers.length > 0 && (
        <section className="mt-10">
          <div className={`${ui.section} flex items-end justify-between`}>
            <h2 className={ui.h2}>{t('home.offers')}</h2>
            <Link href="/offers" className="text-[14px] font-bold text-brand-ink">
              {t('common.viewAll')}
            </Link>
          </div>
          <div className="no-scrollbar mx-auto mt-4 flex max-w-6xl snap-x gap-3 overflow-x-auto px-4 pb-2 md:px-6">
            {offers.map((p) => (
              <OfferCard
                key={p.id}
                promo={p}
                category={categoryById.get(relId(p.category) ?? '') ?? null}
                t={t}
                locale={locale}
                className="w-[340px] shrink-0 snap-start"
              />
            ))}
          </div>
        </section>
      )}

      {/* Section spotlights */}
      <section className={`${ui.section} mt-10 space-y-6`}>
        {live.map((c) => {
          const media = asMedia(c.heroImage)
          const popular = servicesFor(services, c.id).sort((a, b) => Number(Boolean(b.popular)) - Number(Boolean(a.popular)))
          return (
            <article key={c.id} className={cx(themeClass(c.icon), 'overflow-hidden rounded-[30px] bg-surface ring-1 ring-line/80 shadow-card')}>
              <div className="grid md:grid-cols-[1fr_1.15fr]">
                <div className="relative aspect-[16/10] bg-(--accent-soft) md:aspect-auto md:min-h-[280px]">
                  {media && (
                    <Image src={media.url} alt={media.alt} fill sizes="(min-width: 768px) 45vw, 100vw" className="object-cover" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/0 to-black/0" />
                  <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-bold text-ink backdrop-blur">
                    <CategoryIcon icon={c.icon} className="h-3.5 w-3.5 text-(--accent)" />
                    {t(`flow.${c.flow}` as DictKey)}
                  </span>
                </div>
                <div className="flex flex-col p-5 md:p-8">
                  <h3 className={ui.h2}>{c.name}</h3>
                  <p className="mt-1.5 text-[15px] text-muted">{c.tagline}</p>
                  {c.promise?.value && (
                    <p className="mt-5 flex items-baseline gap-2">
                      <span className="font-display text-[40px] font-extrabold leading-none tracking-tight text-(--accent)">{c.promise.value}</span>
                      <span className="text-[14px] font-semibold text-ink-2">{c.promise.label}</span>
                    </p>
                  )}
                  <div className="mt-6 flex flex-wrap gap-2 md:mt-auto md:pt-6">
                    <Link href={`/book/${c.slug}`} className={`${ui.btn} ${ui.accent}`}>
                      {t('common.bookNow')}
                    </Link>
                    <Link href={`/services/${c.slug}`} className={`${ui.btn} ${ui.secondary}`}>
                      {t('cat.services')}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>
              {popular.length > 0 && (
                <div className="border-t border-line-2 bg-canvas/60 pt-4">
                  <p className="px-5 text-[13px] font-bold text-ink-2 md:px-8">{t('home.popularIn', { category: c.name })}</p>
                  <div className="no-scrollbar mt-3 flex snap-x gap-3 overflow-x-auto px-5 pb-5 md:px-8">
                    {popular.slice(0, 8).map((s) => (
                      <ServiceRailCard key={s.id} service={s} category={c} t={t} />
                    ))}
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </section>

      {/* Promise */}
      <section className={`${ui.section} mt-12`}>
        <h2 className={ui.h2}>{t('home.promise')}</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
          {promises.map(({ Icon, title, body }) => (
            <div key={title} className={`${ui.card} p-4 md:p-5`}>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand-ink">
                <Icon className="h-5 w-5" />
              </span>
              <p className="mt-3 text-[15px] font-bold">{t(title, { amount: formatINR(rewards.slaCreditPaise ?? 10000) })}</p>
              <p className="mt-1 text-[13px] text-muted">{t(body)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Coming soon */}
      {soon.length > 0 && (
        <section className={`${ui.section} mt-12`}>
          <h2 className={ui.h2}>{t('home.comingSoon')}</h2>
          <p className="mt-1 text-[14px] text-muted">{t('home.comingSoonBody')}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {soon.map((c) => {
              const media = asMedia(c.heroImage)
              const joined = waitlist.includes(c.id)
              return (
                <Link
                  key={c.id}
                  href={`/services/${c.slug}`}
                  className={cx(themeClass(c.icon), 'group relative flex min-h-[180px] overflow-hidden rounded-[28px] bg-night text-white')}
                >
                  {media && (
                    <Image src={media.url} alt={media.alt} fill sizes="(min-width: 768px) 50vw, 100vw" className="object-cover opacity-55 grayscale transition duration-500 group-hover:scale-[1.03] group-hover:grayscale-0" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-black/10" />
                  <div className="relative flex flex-col justify-end p-5">
                    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-(--accent) px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider">
                      <CategoryIcon icon={c.icon} className="h-3.5 w-3.5" />
                      {t('common.comingSoon')}
                    </span>
                    <p className="mt-3 font-display text-[24px] font-bold leading-tight">{c.name}</p>
                    <p className="mt-1 max-w-sm text-[13px] text-white/75">{c.tagline}</p>
                    <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-bold">
                      {joined ? t('cat.notified') : t('cat.notify')}
                      <ChevronRight className="h-4 w-4" />
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Refer */}
      <section className={`${ui.section} mt-12`}>
        <Link href="/account/wallet" className="flex items-center gap-4 rounded-[28px] bg-brand p-5 text-white shadow-float md:p-7">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15">
            <Gift className="h-7 w-7" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[20px] font-bold leading-tight md:text-[24px]">
              {t('home.referTitle', { amount: formatINR(rewards.referralRewardPaise ?? 10000) })}
            </p>
            <p className="mt-1 text-[13px] text-white/85">{t('home.referBody')}</p>
          </div>
          <ChevronRight className="h-6 w-6 shrink-0" />
        </Link>
      </section>
    </div>
  )
}
