'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Search, Smartphone } from 'lucide-react'
import { useI18n } from '@/components/I18nProvider'
import { cx, ui } from '@/components/ui'
import { formatRange } from '@/lib/money'
import { lineRange, type DeviceTier, type TierMultipliers } from '@/lib/pricing'

type Model = { id: string; brand: string; model: string; tier: DeviceTier }
type PricedService = {
  id: string
  slug: string
  name: string
  priceType: 'fixed' | 'range'
  priceFromPaise: number
  priceToPaise: number | null
}

/** Mobile-only: pick a phone, see every tier-priced repair estimated for that model. */
export function PriceChecker({
  models,
  services,
  multipliers,
  categorySlug,
}: {
  models: Model[]
  services: PricedService[]
  multipliers: TierMultipliers
  categorySlug: string
}) {
  const { t } = useI18n()
  const brands = useMemo(() => [...new Set(models.map((m) => m.brand))], [models])
  const [brand, setBrand] = useState(brands[0] ?? '')
  const [query, setQuery] = useState('')
  const [modelId, setModelId] = useState<string | null>(null)
  const selected = models.find((m) => m.id === modelId) ?? null
  const list = models.filter(
    (m) => m.brand === brand && (!query || m.model.toLowerCase().includes(query.toLowerCase())),
  )

  return (
    <section className="overflow-hidden rounded-3xl bg-surface ring-1 ring-(--accent)/25 shadow-card">
      <div className="bg-(--accent) p-5 text-white">
        <p className="flex items-center gap-2 font-display text-[20px] font-bold">
          <Smartphone className="h-5 w-5" />
          {t('cat.checker.title')}
        </p>
        <p className="mt-1 text-[14px] text-white/80">{t('cat.checker.body')}</p>
      </div>
      <div className="p-5">
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {brands.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => {
                setBrand(b)
                setModelId(null)
                setQuery('')
              }}
              className={cx(ui.chip, 'shrink-0', b === brand && ui.chipOn)}
            >
              {b}
            </button>
          ))}
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('book.modelSearch')}
            className={cx(ui.input, 'h-11 pl-10')}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {list.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setModelId(m.id)}
              className={cx(
                'rounded-xl px-3 py-2 text-[13px] font-semibold ring-1 transition',
                m.id === modelId ? 'bg-(--accent-soft) text-(--accent-ink) ring-(--accent)' : 'bg-surface ring-line hover:ring-(--accent)/40',
              )}
            >
              {m.model}
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-2xl bg-canvas p-4">
          {selected ? (
            <>
              <p className="text-[13px] font-bold text-ink-2">
                {t('cat.checker.for', { model: `${selected.brand} ${selected.model}` })} ·{' '}
                <span className="text-(--accent-ink)">{t(`tier.${selected.tier}`)}</span>
              </p>
              <ul className="mt-3 divide-y divide-line">
                {services.map((s) => {
                  const r = lineRange({ ...s, tierPriced: true, quantity: 1 }, selected.tier, multipliers)
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="text-[14px] font-semibold">{s.name}</span>
                      <span className="flex items-center gap-3">
                        <span className="font-display text-[15px] font-bold">{formatRange(r.min, r.max)}</span>
                        <Link
                          href={`/book/${categorySlug}?service=${s.slug}&model=${selected.id}`}
                          className="rounded-lg bg-ink px-2.5 py-1 text-[12px] font-bold text-white hover:bg-(--accent)"
                        >
                          {t('common.book')}
                        </Link>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <p className="text-[14px] text-muted">{t('cat.checker.pick')}</p>
          )}
        </div>
      </div>
    </section>
  )
}
