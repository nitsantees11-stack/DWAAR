import Link from 'next/link'
import type { ServiceCategory } from '@/payload-types'
import { themeClass } from '@/lib/theme'
import { CategoryIcon } from './CategoryIcon'
import { cx } from './ui'

/** One tab per vertical (Mobile, AC, Bike, Fridge, Car). */
export function CategoryTabs({ categories, activeId, soonLabel }: { categories: ServiceCategory[]; activeId: string; soonLabel: string }) {
  return (
    <div className="sticky top-16 z-30 border-b border-line/70 bg-canvas/90 backdrop-blur-xl">
      <div className="no-scrollbar mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-2.5 md:px-6">
        {categories.map((c) => {
          const active = c.id === activeId
          return (
            <Link
              key={c.id}
              href={`/services/${c.slug}`}
              aria-current={active ? 'page' : undefined}
              className={cx(
                themeClass(c.icon),
                'inline-flex h-10 shrink-0 items-center gap-2 rounded-full pl-1.5 pr-3.5 text-[13px] font-bold ring-1 transition',
                active ? 'bg-(--accent) text-white ring-(--accent)' : 'bg-surface text-ink-2 ring-line hover:ring-(--accent)/40',
              )}
            >
              <span className={cx('grid h-7 w-7 place-items-center rounded-full', active ? 'bg-white/20' : 'bg-(--accent-soft) text-(--accent)')}>
                <CategoryIcon icon={c.icon} className="h-4 w-4" />
              </span>
              {c.name.split(' ')[0]}
              {c.status === 'coming_soon' && (
                <span className={cx('rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide', active ? 'bg-white/20' : 'bg-line-2 text-muted')}>
                  {soonLabel}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
