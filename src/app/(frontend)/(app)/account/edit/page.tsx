import type { Metadata } from 'next'
import { PageHeader } from '@/components/PageHeader'
import { ui } from '@/components/ui'
import { getAppContext } from '@/lib/session'
import { AltWhatsapp, ProfileForm } from './ProfileForm'

export const metadata: Metadata = { title: 'Edit profile' }

export default async function EditProfilePage() {
  const { user, t } = await getAppContext()
  return (
    <div className={ui.narrow}>
      <PageHeader title={t('profile.title')} back="/account" />
      <div className={`${ui.card} p-5`}>
        <ProfileForm
          initial={{
            name: user.name ?? '',
            gender: user.gender ?? null,
            dateOfBirth: user.dateOfBirth ? user.dateOfBirth.slice(0, 10) : '',
          }}
          phone={user.username}
        />
      </div>
      <div className={`${ui.card} mt-4 p-5`}>
        <AltWhatsapp current={user.altWhatsapp ?? ''} />
      </div>
    </div>
  )
}
