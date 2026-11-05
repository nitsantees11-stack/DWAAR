import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AirVent, ArrowRight, BellRing, Check, Clock, Moon, ShieldCheck, Siren, Sparkles } from 'lucide-react'
import { CategoryIcon } from '@/components/CategoryIcon'
import { CategoryTabs } from '@/components/CategoryTabs'
import { ServiceRow } from '@/components/ServiceCard'
import { cx, ui } from '@/components/ui'
import { getCategories, getCategoryBySlug, getDeviceModels, getServices, servicesFor, getBusinessConfig, tierMultipliers } from '@/lib/catalog'
import { getMyWaitlist } from '@/lib/customer-data'
import type { DictKey } from '@/lib/i18n'
import { asMedia } from '@/lib/media'
import { formatINR } from '@/lib/money'
import { getAppContext } from '@/lib/session'
import { themeClass } from '@/lib/theme'
import { formatHour } from '@/lib/time'
import { PriceChecker } from './PriceChecker'
import { WaitlistButton } from './WaitlistButton'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const category = await getCategoryBySlug(slug)
  return category ? { title: category.name, description: category.tagline } : {}
}

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params
  const { user, t } = await getAppContext()
  const category = await getCategoryBySlug(slug)
  if (!category) notFound()

  const [categories, allServices, config, waitlist] = await Promise.all([
    getCategories(),
    getServices(),
    getBusinessConfig(),
    getMyWaitlist(user),
  ])
  const services = servicesFor(allServices, category.id)
  const media = asMedia(category.heroImage)
  const live = category.status === 'live'
  const pricing = category.pricing ?? {}
  const hours = category.serviceHours ?? {}
  const allDay = (hours.startHour ?? 0) <= 0 && (hours.endHour ?? 24) >= 24
  const models = category.icon === 'mobile' && live ? await getDeviceModels(category.id) : []
  const zone = config.zone?.name ?? 'Gurugram'

  const tabs: { id: string; key: DictKey; show: boolean }[] = [
    { id: 'services', key: 'cat.tab.services', show: live && services.length > 0 },
    { id: 'how', key: 'cat.tab.how', show: (category.howItWorks ?? []).length > 0 },
    { id: 'pricing', key: 'cat.tab.pricing', show: true },
    { id: 'faq', key: 'cat.tab.faq', show: (category.faqs ?? []).length > 0 },
  ]

  return (
    <div className={themeClass(category.icon)}>
      <CategoryTabs categories={categories} activeId={category.id} soonLabel={t('common.comingSoon')} />

      {/* Hero */}
      <section className={`${ui.section} pt-4 md:pt-6`}>
        <div className="relative overflow-hidden rounded-[32px] bg-night text-white">
          {media && (
            <Image
              src={media.url}
              alt={media.alt}
              fill
              priority
              sizes="(min-width: 1152px) 1152px, 100vw"
              className={cx('object-cover', !live && 'grayscale')}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/55 to-black/10 md:bg-gradient-to-r md:from-black/85 md:via-black/50 md:to-transparent" />
          <div className="relative flex min-h-[380px] flex-col justify-end p-5 md:min-h-[440px] md:max-w-[62%] md:p-10">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-(--accent) px-3 py-1.5 text-[12px] font-bold">
                <CategoryIcon icon={category.icon} className="h-3.5 w-3.5" />
                {live ? t(`flow.${category.flow}` as DictKey) : t('common.comingSoon')}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-semibold backdrop-blur">
                <Clock className="h-3.5 w-3.5" />
                {allDay ? t('cat.allDay') : `${formatHour(hours.startHour ?? 9)} – ${formatHour(hours.endHour ?? 21)}`}
              </span>
            </div>
            <h1 className="mt-4 font-display text-[36px] font-bold leading-[1.02] tracking-tight md:text-[56px]">
              {live ? category.name : t('cat.soonTitle', { category: category.name })}
            </h1>
            <p className="mt-3 max-w-xl text-[15px] text-white/80 md:text-[17px]">{category.tagline}</p>
            {category.promise?.value && live && (
              <p className="mt-5 flex items-baseline gap-2">
                <span className="font-display text-[44px] font-extrabold leading-none tracking-tight">{category.promise.value}</span>
                <span className="text-[14px] font-semibold text-white/80">{category.promise.label}</span>
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              {live ? (
                <>
                  <Link href={`/book/${category.slug}`} className={`${ui.btn} ${ui.accent} h-13 px-6 text-[16px]`}>
                    {t('common.bookNow')}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  {hours.allowAsap && category.flow === 'roadside' && (
                    <Link href={`/book/${category.slug}?mode=asap`} className={`${ui.btn} h-13 bg-white px-6 text-[16px] text-ink hover:bg-white/90`}>
                      <Siren className="h-4 w-4 text-(--accent)" />
                      {t('cat.sos.cta')}
                    </Link>
                  )}
                </>
              ) : (
                <WaitlistButton categoryId={category.id} initialJoined={waitlist.includes(category.id)} />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Section anchors */}
      <nav className={`${ui.section} no-scrollbar mt-5 flex gap-2 overflow-x-auto`}>
        {tabs
          .filter((tab) => tab.show)
          .map((tab) => (
            <a key={tab.id} href={`#${tab.id}`} className={cx(ui.chip, 'shrink-0 hover:ring-(--accent)/40')}>
              {t(tab.key)}
            </a>
          ))}
      </nav>

      <div className={`${ui.section} mt-6 grid gap-8 lg:grid-cols-[1fr_340px]`}>
        <div className="min-w-0 space-y-10">
          {/* Highlights */}
          {(category.highlights ?? []).length > 0 && (
            <section className="grid grid-cols-2 gap-3">
              {(category.highlights ?? []).map((h) => (
                <div key={h.id ?? h.title} className="rounded-3xl bg-(--accent-soft) p-4 ring-1 ring-(--accent)/10">
                  <Sparkles className="h-5 w-5 text-(--accent)" />
                  <p className="mt-2 text-[15px] font-bold leading-snug">{h.title}</p>
                  <p className="mt-1 text-[13px] text-ink-2">{h.body}</p>
                </div>
              ))}
            </section>
          )}

          {/* Coming soon note */}
          {!live && category.launchNote && (
            <section className={`${ui.card} p-5 md:p-6`}>
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-(--accent-soft) text-(--accent)">
                  <BellRing className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[16px] font-bold">{t('cat.waitingCount')}</p>
                  <p className="mt-1 text-[14px] text-muted">{category.launchNote}</p>
                  <p className="mt-3 text-[13px] font-semibold text-ink-2">{zone}</p>
                </div>
              </div>
              <p className="mt-4 text-[14px] text-ink-2">{category.description}</p>
            </section>
          )}

          {/* Section-specific tools */}
          {live && category.icon === 'mobile' && models.length > 0 && (
            <PriceChecker
              models={models.map((m) => ({ id: m.id, brand: m.brand, model: m.model, tier: m.tier }))}
              services={services
                .filter((s) => s.tierPriced)
                .map((s) => ({
                  id: s.id,
                  slug: s.slug,
                  name: s.name,
                  priceType: s.priceType,
                  priceFromPaise: s.priceFromPaise,
                  priceToPaise: s.priceToPaise ?? null,
                }))}
              multipliers={tierMultipliers(config)}
              categorySlug={category.slug}
            />
          )}
          {live && category.icon === 'ac' && (
            <section className="flex items-start gap-4 rounded-3xl bg-night p-5 text-white md:p-6">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-(--accent)">
                <AirVent className="h-6 w-6" />
              </span>
              <div>
                <p className="text-[17px] font-bold">{t('cat.ac.title')}</p>
                <p className="mt-1 text-[14px] text-white/70">{t('cat.ac.body')}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(category.deviceTypes ?? []).map((d) => (
                    <span key={d.value} className="rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold">
                      {d.label}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          )}
          {live && category.flow === 'roadside' && hours.allowAsap && (
            <section className="relative overflow-hidden rounded-3xl bg-(--accent) p-5 text-white md:p-6">
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
              <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15">
                  <Siren className="h-7 w-7" />
                </span>
                <div className="flex-1">
                  <p className="font-display text-[22px] font-bold">{t('cat.sos.title')}</p>
                  <p className="mt-1 text-[14px] text-white/85">{t('cat.sos.body')}</p>
                  {(pricing.nightVisitFeePaise ?? 0) > 0 && (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-white/85">
                      <Moon className="h-3.5 w-3.5" />
                      {t('cat.nightFee')}: {formatINR(pricing.nightVisitFeePaise ?? 0)}
                    </p>
                  )}
                </div>
                <Link href={`/book/${category.slug}?mode=asap`} className={`${ui.btn} bg-white text-ink hover:bg-white/90`}>
                  {t('cat.sos.cta')}
                </Link>
              </div>
            </section>
          )}

          {/* Services */}
          {live && services.length > 0 && (
            <section id="services" className="scroll-mt-36">
              <h2 className={ui.h2}>{t('cat.services')}</h2>
              <div className="mt-4 space-y-3">
                {services.map((s) => (
                  <ServiceRow key={s.id} service={s} category={category} t={t} />
                ))}
              </div>
            </section>
          )}

          {/* How it works */}
          {(category.howItWorks ?? []).length > 0 && (
            <section id="how" className="scroll-mt-36">
              <h2 className={ui.h2}>{t('cat.how')}</h2>
              <ol className="mt-4 grid gap-3 sm:grid-cols-2">
                {(category.howItWorks ?? []).map((step, i) => (
                  <li key={step.id ?? step.title} className={`${ui.card} flex gap-4 p-4`}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-(--accent) font-display text-[18px] font-bold text-white">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-[15px] font-bold">{step.title}</p>
                      <p className="mt-0.5 text-[13px] text-muted">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* FAQ */}
          {(category.faqs ?? []).length > 0 && (
            <section id="faq" className="scroll-mt-36">
              <h2 className={ui.h2}>{t('cat.faq')}</h2>
              <div className="mt-4 divide-y divide-line overflow-hidden rounded-3xl bg-surface ring-1 ring-line/80">
                {(category.faqs ?? []).map((f) => (
                  <details key={f.id ?? f.question} className="group">
                    <summary className="flex cursor-pointer items-center justify-between gap-4 p-4 text-[15px] font-bold md:p-5">
                      {f.question}
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-line-2 text-[18px] leading-none transition group-open:rotate-45">+</span>
                    </summary>
                    <p className="px-4 pb-5 text-[14px] leading-relaxed text-ink-2 md:px-5">{f.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-4 lg:sticky lg:top-36 lg:self-start">
          <section id="pricing" className={`${ui.card} scroll-mt-36 p-5`}>
            <p className="text-[15px] font-bold">{t('cat.pricing')}</p>
            <dl className="mt-3 divide-y divide-line-2 text-[14px]">
              {category.flow === 'pickup_drop' ? (
                <div className="flex justify-between py-2.5">
                  <dt className="text-ink-2">{t('cat.pickupFree')}</dt>
                  <dd className="font-bold text-success">{t('common.free')}</dd>
                </div>
              ) : (
                <div className="flex justify-between gap-3 py-2.5">
                  <dt className="text-ink-2">
                    {t('cat.visitFee')}
                    <span className="block text-[12px] text-muted">{t('cat.visitFeeNote')}</span>
                  </dt>
                  <dd className="font-bold">{formatINR(pricing.visitFeePaise ?? 0)}</dd>
                </div>
              )}
              {(pricing.nightVisitFeePaise ?? 0) > 0 && (
                <div className="flex justify-between py-2.5">
                  <dt className="text-ink-2">{t('cat.nightFee')}</dt>
                  <dd className="font-bold">{formatINR(pricing.nightVisitFeePaise ?? 0)}</dd>
                </div>
              )}
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-2">{t('cat.cancelFee')}</dt>
                <dd className="font-bold">{(pricing.cancelAfterAssignFeePaise ?? 0) > 0 ? formatINR(pricing.cancelAfterAssignFeePaise ?? 0) : t('common.free')}</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-2">{t('cat.declineFee')}</dt>
                <dd className="font-bold">{(pricing.declineFeePaise ?? 0) > 0 ? formatINR(pricing.declineFeePaise ?? 0) : t('common.free')}</dd>
              </div>
            </dl>
          </section>

          {category.warrantyNote && (
            <section className={`${ui.card} p-5`}>
              <p className="flex items-center gap-2 text-[15px] font-bold">
                <ShieldCheck className="h-5 w-5 text-success" />
                {t('cat.warranty')}
              </p>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{category.warrantyNote}</p>
            </section>
          )}

          {(category.brands ?? []).length > 0 && (
            <section className={`${ui.card} p-5`}>
              <p className="text-[15px] font-bold">{t('cat.brands')}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(category.brands ?? []).map((b) => (
                  <span key={b.id ?? b.name} className="inline-flex items-center gap-1 rounded-full bg-line-2 px-2.5 py-1 text-[12px] font-semibold">
                    <Check className="h-3 w-3 text-success" />
                    {b.name}
                  </span>
                ))}
              </div>
            </section>
          )}

          {live && (
            <p className="px-1 text-[13px] text-muted">{t(`flow.${category.flow}.body` as DictKey)}</p>
          )}
        </aside>
      </div>

      {live && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 px-4 pb-3 lg:hidden">
          <Link href={`/book/${category.slug}`} className={`${ui.btn} ${ui.accent} h-13 w-full text-[16px] shadow-float`}>
            {t('book.title', { category: category.name })}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  )
}
