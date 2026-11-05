'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { BellRing, Check, LoaderCircle } from 'lucide-react'
import { joinWaitlist } from '../../../actions/account'
import { haptic } from '@/components/AppPrefs'
import { useI18n } from '@/components/I18nProvider'
import { cx, ui } from '@/components/ui'
import { errorKey } from '@/lib/i18n'

export function WaitlistButton({ categoryId, initialJoined }: { categoryId: string; initialJoined: boolean }) {
  const { t } = useI18n()
  const router = useRouter()
  const [joined, setJoined] = useState(initialJoined)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle(join: boolean) {
    setError(null)
    startTransition(async () => {
      const res = await joinWaitlist({ categoryId, join })
      if (!res.ok) return setError(t(errorKey(res.error), res.params))
      haptic()
      setJoined(res.joined)
      router.refresh()
    })
  }

  return (
    <div>
      {joined ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex h-12 items-center gap-2 rounded-2xl bg-white px-5 text-[15px] font-bold text-ink">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-success text-white">
              <Check className="h-3.5 w-3.5" />
            </span>
            {t('cat.notified')}
          </span>
          <button type="button" disabled={pending} onClick={() => toggle(false)} className="text-[13px] font-semibold text-white/80 underline-offset-2 hover:underline">
            {t('cat.leave')}
          </button>
        </div>
      ) : (
        <button type="button" disabled={pending} onClick={() => toggle(true)} className={cx(ui.btn, ui.accent, 'h-13 px-6 text-[16px]')}>
          {pending ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <BellRing className="h-5 w-5" />}
          {t('cat.notify')}
        </button>
      )}
      {joined && <p className="mt-2 text-[13px] text-white/75">{t('cat.notifiedBody')}</p>}
      {error && <p className="mt-2 text-[13px] font-semibold text-red-200">{error}</p>}
    </div>
  )
}
