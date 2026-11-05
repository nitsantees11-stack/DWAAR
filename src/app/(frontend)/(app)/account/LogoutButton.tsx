'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { LoaderCircle, LogOut } from 'lucide-react'
import { logout } from '../../actions/auth'
import { useI18n } from '@/components/I18nProvider'
import { cx, ui } from '@/components/ui'

export function LogoutButton({ className }: { className?: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await logout()
          router.replace('/login')
          router.refresh()
        })
      }
      className={cx(ui.btn, ui.secondary, 'w-full text-danger', className)}
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
      {t('account.logout')}
    </button>
  )
}
