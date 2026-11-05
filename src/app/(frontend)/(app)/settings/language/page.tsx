import type { Metadata } from 'next'
import { PageHeader } from '@/components/PageHeader'
import { ui } from '@/components/ui'
import { getAppContext } from '@/lib/session'
import { LanguageSetting } from '../SettingsControls'

export const metadata: Metadata = { title: 'Language' }

export default async function LanguagePage() {
  const { t, lang } = await getAppContext()
  return (
    <div className={ui.narrow}>
      <PageHeader title={t('settings.language')} subtitle={t('settings.languageBody')} back="/settings" />
      <LanguageSetting initial={lang} />
    </div>
  )
}
