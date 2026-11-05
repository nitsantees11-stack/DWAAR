import type { Metadata } from 'next'
import { PageHeader } from '@/components/PageHeader'
import { ui } from '@/components/ui'
import { getAppContext } from '@/lib/session'
import { PaymentPreference, ToggleGroup } from '../SettingsControls'

export const metadata: Metadata = { title: 'App preferences' }

export default async function PreferencesPage() {
  const { user, t } = await getAppContext()
  const p = user.preferences ?? {}
  return (
    <div className={`${ui.narrow} space-y-4`}>
      <PageHeader title={t('settings.preferences')} subtitle={t('settings.preferencesBody')} back="/settings" />
      <PaymentPreference initial={p.defaultPayment ?? 'upi'} />
      <ToggleGroup
        group="preferences"
        rows={[
          { key: 'reduceMotion', label: 'prefs.motion', body: 'prefs.motionBody' },
          { key: 'haptics', label: 'prefs.haptics', body: 'prefs.hapticsBody' },
        ]}
        initial={{ reduceMotion: p.reduceMotion === true, haptics: p.haptics !== false }}
      />
    </div>
  )
}
