'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardList, House, LifeBuoy, TicketPercent, User } from 'lucide-react'
import type { DictKey } from '@/lib/i18n'
import { useI18n } from './I18nProvider'
import { cx } from './ui'

const TABS: { href: string; key: DictKey; Icon: typeof House; match: (p: string) => boolean }[] = [
  { href: '/', key: 'nav.home', Icon: House, match: (p) => p === '/' || p.startsWith('/services') || p.startsWith('/search') },
  { href: '/bookings', key: 'nav.bookings', Icon: ClipboardList, match: (p) => p.startsWith('/bookings') },
  { href: '/offers', key: 'nav.offers', Icon: TicketPercent, match: (p) => p.startsWith('/offers') },
  { href: '/help', key: 'nav.help', Icon: LifeBuoy, match: (p) => p.startsWith('/help') },
  { href: '/account', key: 'nav.account', Icon: User, match: (p) => p.startsWith('/account') || p.startsWith('/settings') },
]

export function DesktopNav() {
  const pathname = usePathname()
  const { t } = useI18n()
  return (
    <nav className="hidden items-center gap-1 lg:flex">
      {TABS.slice(0, 4).map(({ href, key, match }) => (
        <Link
          key={href}
          href={href}
          className={cx(
            'rounded-full px-3.5 py-2 text-[14px] font-semibold transition',
            match(pathname) ? 'bg-ink text-white' : 'text-ink-2 hover:bg-line-2',
          )}
        >
          {t(key)}
        </Link>
      ))}
    </nav>
  )
}

export function BottomNav() {
  const pathname = usePathname()
  const { t } = useI18n()
  if (pathname.startsWith('/book/')) return null
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {TABS.map(({ href, key, Icon, match }) => {
          const active = match(pathname)
          return (
            <li key={href}>
              <Link
                href={href}
                className={cx(
                  'flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition',
                  active ? 'text-ink' : 'text-faint hover:text-ink-2',
                )}
              >
                <span className={cx('grid h-7 w-12 place-items-center rounded-full transition', active && 'bg-brand-soft text-brand-ink')}>
                  <Icon className="h-[19px] w-[19px]" strokeWidth={active ? 2.4 : 2} />
                </span>
                {t(key)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
