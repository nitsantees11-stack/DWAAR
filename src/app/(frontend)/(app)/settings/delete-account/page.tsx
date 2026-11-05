import type { Metadata } from 'next'
import { Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { ui } from '@/components/ui'
import { getMyBookings, isBookingActive } from '@/lib/customer-data'
import { getAppContext } from '@/lib/session'
import { DeleteAccountForm } from '../SettingsControls'

export const metadata: Metadata = { title: 'Delete account' }

export default async function DeleteAccountPage() {
  const { user, t } = await getAppContext()
  const bookings = await getMyBookings(user, 100)
  const blocked = bookings.some(isBookingActive)
  return (
    <div className={ui.narrow}>
      <PageHeader title={t('delete.title')} back="/settings" />
      <div className={`${ui.card} p-5`}>
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-danger-soft text-danger">
          <Trash2 className="h-6 w-6" />
        </span>
        <p className="mt-4 text-[14px] leading-relaxed text-ink-2">{t('delete.body')}</p>
        <div className="mt-5">
          <DeleteAccountForm blocked={blocked} />
        </div>
      </div>
    </div>
  )
}
