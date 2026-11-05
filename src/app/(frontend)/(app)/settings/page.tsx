import type { Metadata } from 'next'
import { Bell, FileText, Languages, Lock, SlidersHorizontal, Trash2 } from 'lucide-react'
import { MenuList } from '@/components/MenuList'
import { PageHeader } from '@/components/PageHeader'
import { ui } from '@/components/ui'
import { translate } from '@/lib/i18n'
import { getAppContext } from '@/lib/session'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const { t, lang } = await getAppContext()
  return (
    <div className={ui.narrow}>
      <PageHeader title={t('settings.title')} back="/account" />
      <MenuList
        items={[
          { href: '/settings/language', label: t('settings.language'), body: t('settings.languageBody'), Icon: Languages, badge: translate(lang, `lang.${lang}`) },
          { href: '/settings/notifications', label: t('settings.notifications'), body: t('settings.notificationsBody'), Icon: Bell },
          { href: '/settings/privacy', label: t('settings.privacy'), body: t('settings.privacyBody'), Icon: Lock },
          { href: '/settings/preferences', label: t('settings.preferences'), body: t('settings.preferencesBody'), Icon: SlidersHorizontal },
        ]}
      />
      <MenuList
        className="mt-4"
        items={[
          { href: '/legal/terms', label: t('legal.terms'), Icon: FileText },
          { href: '/legal/privacy', label: t('legal.privacy'), Icon: FileText },
          { href: '/legal/refunds', label: t('legal.refunds'), Icon: FileText },
        ]}
      />
      <MenuList
        className="mt-4"
        items={[{ href: '/settings/delete-account', label: t('settings.delete'), body: t('settings.deleteBody'), Icon: Trash2, tone: 'danger' }]}
      />
      <p className="mt-6 text-center text-[12px] text-faint">{t('settings.version')}</p>
    </div>
  )
}
