import type { Metadata } from 'next'
import { PageHeader } from '@/components/PageHeader'
import { ui } from '@/components/ui'
import { getAppContext } from '@/lib/session'
import { ToggleGroup } from '../SettingsControls'

export const metadata: Metadata = { title: 'Privacy' }

export default async function PrivacyPage() {
  const { user, t } = await getAppContext()
  const p = user.privacy ?? {}
  return (
    <div className={ui.narrow}>
      <PageHeader title={t('settings.privacy')} subtitle={t('settings.privacyBody')} back="/settings" />
      <ToggleGroup
        group="privacy"
        rows={[
          { key: 'shareLiveLocation', label: 'privacy.location', body: 'privacy.locationBody' },
          { key: 'personalisedOffers', label: 'privacy.offers', body: 'privacy.offersBody' },
          { key: 'usageAnalytics', label: 'privacy.analytics', body: 'privacy.analyticsBody' },
        ]}
        initial={{
          shareLiveLocation: p.shareLiveLocation !== false,
          personalisedOffers: p.personalisedOffers !== false,
          usageAnalytics: p.usageAnalytics !== false,
        }}
      />
    </div>
  )
}
