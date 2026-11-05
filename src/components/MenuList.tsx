import Link from 'next/link'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cx } from './ui'

export type MenuItem = { href: string; label: string; body?: string; Icon: LucideIcon; tone?: 'danger'; badge?: string }

export function MenuList({ items, className }: { items: MenuItem[]; className?: string }) {
  return (
    <ul className={cx('divide-y divide-line-2 overflow-hidden rounded-3xl bg-surface ring-1 ring-line/80 shadow-card', className)}>
      {items.map(({ href, label, body, Icon, tone, badge }) => (
        <li key={href}>
          <Link href={href} className="flex items-center gap-3.5 px-4 py-3.5 transition hover:bg-canvas">
            <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-line-2 text-ink-2')}>
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cx('block text-[15px] font-bold', tone === 'danger' && 'text-danger')}>{label}</span>
              {body && <span className="block truncate text-[13px] text-muted">{body}</span>}
            </span>
            {badge && <span className="rounded-full bg-line-2 px-2 py-0.5 text-[12px] font-bold text-ink-2">{badge}</span>}
            <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
