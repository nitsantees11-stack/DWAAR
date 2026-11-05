import type { Metadata } from 'next'
import { PageHeader } from '@/components/PageHeader'
import { ui } from '@/components/ui'
import { getAppContext } from '@/lib/session'
import { ToggleGroup } from '../SettingsControls'

export const metadata: Metadata = { title: 'Notifications' }

export default async function NotificationsPage() {
  const { user, t } = await getAppContext()
  const n = user.notifications ?? {}
  return (
    <div className={`${ui.narrow} space-y-4`}>
      <PageHeader title={t('settings.notifications')} subtitle={t('settings.notificationsBody')} back="/settings" />
      <ToggleGroup
        group="notifications"
        title="notif.booking"
        body="notif.bookingBody"
        rows={[
          { key: 'bookingPush', label: 'notif.push' },
          { key: 'bookingWhatsapp', label: 'notif.whatsapp' },
          { key: 'bookingSms', label: 'notif.sms' },
          { key: 'bookingEmail', label: 'notif.email' },
        ]}
        initial={{
          bookingPush: n.bookingPush !== false,
          bookingWhatsapp: n.bookingWhatsapp !== false,
          bookingSms: n.bookingSms !== false,
          bookingEmail: n.bookingEmail === true,
        }}
      />
      <ToggleGroup
        group="notifications"
        title="notif.offers"
        body="notif.offersBody"
        rows={[
          { key: 'offersPush', label: 'notif.push' },
          { key: 'offersWhatsapp', label: 'notif.whatsapp' },
        ]}
        initial={{ offersPush: n.offersPush !== false, offersWhatsapp: n.offersWhatsapp === true }}
      />
      <ToggleGroup
        group="notifications"
        rows={[{ key: 'reminders', label: 'notif.reminders', body: 'notif.remindersBody' }]}
        initial={{ reminders: n.reminders !== false }}
      />
    </div>
  )
}
