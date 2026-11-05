import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AppHeader } from '@/components/AppHeader'
import { AppPrefs } from '@/components/AppPrefs'
import { I18nProvider } from '@/components/I18nProvider'
import { Logo } from '@/components/Logo'
import { BottomNav } from '@/components/NavLinks'
import { ui } from '@/components/ui'
import { getBusinessConfig } from '@/lib/catalog'
import { getAppContext } from '@/lib/session'

/** Every screen in this group needs a signed-in, onboarded customer (the app opens on /login). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, lang, t } = await getAppContext()
  if (!user.onboarded || !user.name) redirect('/onboarding')
  const config = await getBusinessConfig()
  const support = config.support ?? {}

  return (
    <I18nProvider lang={lang}>
      <AppPrefs
        lang={lang}
        reduceMotion={user.preferences?.reduceMotion === true}
        haptics={user.preferences?.haptics !== false}
      />
      <AppHeader user={user} zoneName={config.zone?.name ?? 'Gurugram'} />
      <main className="min-h-[70dvh] pb-28 lg:pb-16">{children}</main>
      <footer className="hidden border-t border-line bg-surface lg:block">
        <div className={`${ui.section} flex items-start justify-between gap-10 py-10`}>
          <div className="max-w-xs">
            <Logo />
            <p className="mt-3 text-[14px] text-muted">{t('app.tagline')}</p>
          </div>
          <div className="grid grid-cols-3 gap-10 text-[14px]">
            <div className="space-y-2">
              <p className={ui.eyebrow}>{t('nav.help')}</p>
              {support.phone && <a className="block font-semibold hover:text-brand" href={`tel:${support.phone.replace(/\s/g, '')}`}>{support.phone}</a>}
              {support.email && <a className="block font-semibold hover:text-brand" href={`mailto:${support.email}`}>{support.email}</a>}
              {support.hours && <p className="text-muted">{support.hours}</p>}
            </div>
            <div className="space-y-2">
              <p className={ui.eyebrow}>dwaar</p>
              <Link className="block font-semibold hover:text-brand" href="/legal/about">{t('legal.about')}</Link>
              <Link className="block font-semibold hover:text-brand" href="/offers">{t('nav.offers')}</Link>
              <Link className="block font-semibold hover:text-brand" href="/account/wallet">{t('account.wallet')}</Link>
            </div>
            <div className="space-y-2">
              <p className={ui.eyebrow}>{t('account.legal')}</p>
              <Link className="block font-semibold hover:text-brand" href="/legal/terms">{t('legal.terms')}</Link>
              <Link className="block font-semibold hover:text-brand" href="/legal/privacy">{t('legal.privacy')}</Link>
              <Link className="block font-semibold hover:text-brand" href="/legal/refunds">{t('legal.refunds')}</Link>
            </div>
          </div>
        </div>
      </footer>
      <BottomNav />
    </I18nProvider>
  )
}
