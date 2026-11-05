import type { Metadata } from 'next'
import { PageHeader } from '@/components/PageHeader'
import { ui } from '@/components/ui'
import { getMyAddresses } from '@/lib/customer-data'
import { getAppContext } from '@/lib/session'
import { AddressBook } from './AddressBook'

export const metadata: Metadata = { title: 'Saved addresses' }

export default async function AddressesPage() {
  const { user, t } = await getAppContext()
  const addresses = await getMyAddresses(user)
  return (
    <div className={ui.narrow}>
      <PageHeader title={t('address.title')} back="/account" />
      <AddressBook
        addresses={addresses}
        defaultContact={{ name: user.name ?? '', phone: user.username }}
        allowLocation={user.privacy?.shareLiveLocation !== false}
      />
    </div>
  )
}
