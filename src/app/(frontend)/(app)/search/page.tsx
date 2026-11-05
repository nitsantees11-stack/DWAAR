import Link from 'next/link'
import type { Metadata } from 'next'
import { Search } from 'lucide-react'
import { CategoryIcon } from '@/components/CategoryIcon'
import { ServiceRow } from '@/components/ServiceCard'
import { cx, ui } from '@/components/ui'
import { getCategories, getServices } from '@/lib/catalog'
import { relId } from '@/lib/media'
import { getAppContext } from '@/lib/session'
import { themeClass } from '@/lib/theme'

export const metadata: Metadata = { title: 'Search' }

const POPULAR = ['Screen', 'Battery', 'AC Jet', 'Gas', 'Puncture', 'Jump-start', 'Charging']

function normalise(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\u0900-\u097f ]/g, ' ')
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams
  const { t } = await getAppContext()
  const [categories, services] = await Promise.all([getCategories(), getServices()])
  const query = q.trim().slice(0, 60)
  const terms = normalise(query).split(/\s+/).filter(Boolean)
  const byId = new Map(categories.map((c) => [c.id, c]))

  const matches = terms.length
    ? services
        .filter((s) => !s.isOtherProblem)
        .map((s) => {
          const category = byId.get(relId(s.category) ?? '')
          const haystack = normalise(`${s.name} ${s.description} ${category?.name ?? ''} ${(s.includes ?? []).map((i) => i.item).join(' ')}`)
          const score = terms.reduce((acc, term) => acc + (normalise(s.name).includes(term) ? 3 : haystack.includes(term) ? 1 : 0), 0)
          return { s, category, score, all: terms.every((term) => haystack.includes(term)) }
        })
        .filter((m) => m.all && m.category?.status === 'live')
        .sort((a, b) => b.score - a.score)
    : []
  const matchedCategories = terms.length
    ? categories.filter((c) => terms.some((term) => normalise(`${c.name} ${c.tagline}`).includes(term)))
    : []

  return (
    <div className={ui.narrow}>
      <form action="/search" className="sticky top-16 z-20 -mx-4 bg-canvas/90 px-4 pb-3 pt-6 backdrop-blur-xl md:-mx-6 md:px-6">
        <div className="flex items-center gap-2 rounded-2xl bg-surface p-1.5 pl-4 ring-1 ring-line focus-within:ring-2 focus-within:ring-ink">
          <Search className="h-5 w-5 shrink-0 text-faint" />
          <input name="q" defaultValue={query} autoFocus placeholder={t('search.ph')} className="h-11 min-w-0 flex-1 bg-transparent text-[16px] focus:outline-none" />
          <button className={`${ui.btnSm} ${ui.primary} h-11 rounded-xl px-4`}>{t('search.title')}</button>
        </div>
      </form>

      {!query && (
        <section className="mt-4">
          <p className={ui.eyebrow}>{t('search.popular')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {POPULAR.map((p) => (
              <Link key={p} href={`/search?q=${encodeURIComponent(p)}`} className={cx(ui.chip, 'hover:ring-ink/30')}>
                {p}
              </Link>
            ))}
          </div>
          <div className="mt-8 grid grid-cols-2 gap-3">
            {categories.map((c) => (
              <Link key={c.id} href={`/services/${c.slug}`} className={cx(themeClass(c.icon), 'flex items-center gap-3 rounded-3xl bg-surface p-4 ring-1 ring-line/80 shadow-card')}>
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-(--accent-soft) text-(--accent)">
                  <CategoryIcon icon={c.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-bold">{c.name}</span>
                  {c.status === 'coming_soon' && <span className="text-[12px] text-muted">{t('common.comingSoon')}</span>}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {query && (
        <section className="mt-2">
          <p className="text-[14px] font-semibold text-muted">
            {matches.length > 0 ? t('search.results', { q: query, count: matches.length }) : ''}
          </p>
          {matchedCategories.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {matchedCategories.map((c) => (
                <Link key={c.id} href={`/services/${c.slug}`} className={cx(themeClass(c.icon), 'inline-flex items-center gap-2 rounded-full bg-(--accent-soft) py-1.5 pl-1.5 pr-3 text-[13px] font-bold text-(--accent-ink)')}>
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-(--accent) text-white">
                    <CategoryIcon icon={c.icon} className="h-3.5 w-3.5" />
                  </span>
                  {c.name}
                </Link>
              ))}
            </div>
          )}
          {matches.length === 0 ? (
            <div className={`${ui.card} mt-4 p-8 text-center`}>
              <p className="text-[16px] font-bold">{t('search.empty', { q: query })}</p>
              <p className="mt-1 text-[14px] text-muted">{t('search.emptyBody')}</p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {matches.map(({ s, category }) =>
                category ? (
                  <div key={s.id} className={themeClass(category.icon)}>
                    <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[12px] font-bold text-(--accent-ink)">
                      <CategoryIcon icon={category.icon} className="h-3.5 w-3.5" />
                      {category.name}
                    </p>
                    <ServiceRow service={s} category={category} t={t} />
                  </div>
                ) : null,
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
