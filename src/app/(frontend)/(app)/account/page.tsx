import Link from 'next/link'
import type { Metadata } from 'next'
import { FileText, Gift, Info, LifeBuoy, MapPin, Pencil, Settings, ShieldCheck } from 'lucide-react'
import { MenuList } from '@/components/MenuList'
import { ui } from '@/components/ui'
import { getMyAddresses, getMyBookings, getMyWarranties } from '@/lib/customer-data'
import { formatINR } from '@/lib/money'
import { getAppContext } from '@/lib/session'
import { formatDate } from '@/lib/time'
import { LogoutButton } from './LogoutButton'

export const metadata: Metadata = { title: 'Account' }

export default async function AccountPage() {
  const { user, t, locale } = await getAppContext()
  const [bookings, warranties, addresses] = await Promise.all([getMyBookings(user, 100), getMyWarranties(user), getMyAddresses(user)])
  const activeWarranties = warranties.filter((w) => w.status === 'active' && new Date(w.endsAt) > new Date())
  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0]

  return (
    <div className={ui.narrow}>
      <section className="mt-6 overflow-hidden rounded-[30px] bg-night p-5 text-white md:p-6">
        <div className="flex items-center gap-4">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-brand font-display text-[24px] font-bold">
            {(user.name ?? 'D').slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[24px] font-bold leading-tight">{user.name}</h1>
            <p className="text-[14px] text-white/70">+91 {user.username}</p>
            <p className="text-[12px] text-white/50">{t('account.since', { date: formatDate(user.createdAt, locale) })}</p>
          </div>
          <Link href="/account/edit" aria-label={t('account.edit')} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 ring-1 ring-white/15">
            <Pencil className="h-4 w-4" />
          </Link>
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
          {[
            { label: t('account.stats.bookings'), value: String(bookings.length), href: '/bookings' },
            { label: t('account.stats.warranties'), value: String(activeWarranties.length), href: '/account/warranties' },
            { label: t('account.stats.cash'), value: formatINR(user.walletPaise ?? 0), href: '/account/wallet' },
          ].map((s) => (
            <Link key={s.label} href={s.href} className="rounded-2xl bg-white/8 p-3 ring-1 ring-white/10 transition hover:bg-white/12">
              <dd className="font-display text-[20px] font-bold">{s.value}</dd>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-white/60">{s.label}</dt>
            </Link>
          ))}
        </dl>
      </section>

      <p className={`${ui.eyebrow} mb-2 mt-8 px-1`}>{t('account.section.mine')}</p>
      <MenuList
        items={[
          { href: '/account/edit', label: t('account.edit'), body: user.altWhatsapp ? `WhatsApp +91 ${user.altWhatsapp}` : undefined, Icon: Pencil },
          { href: '/account/addresses', label: t('account.addresses'), body: defaultAddress?.line ?? t('address.empty'), Icon: MapPin, badge: addresses.length ? String(addresses.length) : undefined },
          { href: '/account/warranties', label: t('account.warranties'), Icon: ShieldCheck, badge: activeWarranties.length ? String(activeWarranties.length) : undefined },
          { href: '/account/wallet', label: t('account.wallet'), body: user.referralCode ?? undefined, Icon: Gift },
        ]}
      />

      <p className={`${ui.eyebrow} mb-2 mt-8 px-1`}>{t('account.section.app')}</p>
      <MenuList
        items={[
          { href: '/settings', label: t('account.settings'), body: `${t('settings.language')} · ${t('settings.notifications')} · ${t('settings.privacy')}`, Icon: Settings },
          { href: '/help', label: t('account.help'), Icon: LifeBuoy },
          { href: '/legal/terms', label: t('account.legal'), Icon: FileText },
          { href: '/legal/about', label: t('legal.about'), Icon: Info },
        ]}
      />

      <LogoutButton className="mt-8" />
      <p className="mt-6 text-center text-[12px] text-faint">{t('settings.version')}</p>
    </div>
  )
}
