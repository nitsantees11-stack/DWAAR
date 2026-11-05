import Link from 'next/link'
import { MapPin, Search, Wallet } from 'lucide-react'
import type { User } from '@/payload-types'
import { formatINR } from '@/lib/money'
import { Logo } from './Logo'
import { DesktopNav } from './NavLinks'
import { ui } from './ui'

function initials(name?: string | null) {
  if (!name) return 'D'
  const parts = name.trim().split(/\s+/)
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function AppHeader({ user, zoneName }: { user: User; zoneName: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-canvas/85 backdrop-blur-xl">
      <div className={`${ui.section} flex h-16 items-center gap-3`}>
        <Link href="/" aria-label="dwaar home" className="shrink-0">
          <Logo />
        </Link>
        <Link
          href="/account/addresses"
          className="hidden min-w-0 items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink-2 ring-1 ring-line sm:flex"
        >
          <MapPin className="h-4 w-4 shrink-0 text-brand" />
          <span className="truncate">{zoneName}</span>
        </Link>
        <div className="mx-auto">
          <DesktopNav />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/search"
            aria-label="Search"
            className="grid h-10 w-10 place-items-center rounded-full bg-surface text-ink-2 ring-1 ring-line transition hover:text-ink"
          >
            <Search className="h-[18px] w-[18px]" />
          </Link>
          <Link
            href="/account/wallet"
            className="flex h-10 items-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-bold text-ink ring-1 ring-line"
          >
            <Wallet className="h-4 w-4 text-success" />
            {formatINR(user.walletPaise ?? 0)}
          </Link>
          <Link
            href="/account"
            aria-label="Account"
            className="grid h-10 w-10 place-items-center rounded-full bg-ink font-display text-[14px] font-bold text-white"
          >
            {initials(user.name)}
          </Link>
        </div>
      </div>
    </header>
  )
}
