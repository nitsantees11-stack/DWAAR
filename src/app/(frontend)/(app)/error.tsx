'use client'

import { useRouter } from 'next/navigation'
import { CircleAlert } from 'lucide-react'
import { logout } from '../actions/auth'
import { useI18n } from '@/components/I18nProvider'
import { ui } from '@/components/ui'

export default function SignedInError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  const router = useRouter()
  const { t } = useI18n()
  return (
    <div className={`${ui.narrow} py-16`}>
      <div className={`${ui.card} p-8 text-center`}>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-danger-soft text-danger">
          <CircleAlert className="h-6 w-6" />
        </span>
        <h1 className={`${ui.h2} mt-4`}>{t('error.title')}</h1>
        <p className="mt-2 text-muted">{t('error.body')}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" className={`${ui.btn} ${ui.primary}`} onClick={() => unstable_retry()}>
            {t('common.retry')}
          </button>
          <button
            type="button"
            className={`${ui.btn} ${ui.secondary}`}
            onClick={async () => {
              await logout()
              router.replace('/login')
              router.refresh()
              unstable_retry()
            }}
          >
            {t('account.logout')}
          </button>
        </div>
      </div>
    </div>
  )
}
