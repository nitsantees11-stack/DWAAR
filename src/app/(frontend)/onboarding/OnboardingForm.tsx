'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { LoaderCircle } from 'lucide-react'
import { completeOnboarding } from '../actions/auth'
import { haptic } from '@/components/AppPrefs'
import { LanguageChoice } from '@/components/LanguageChoice'
import { Logo } from '@/components/Logo'
import { cx, ui } from '@/components/ui'
import { errorKey, makeT, type Lang } from '@/lib/i18n'

export function OnboardingForm({ initialLang, initialName, phone }: { initialLang: Lang; initialName: string; phone: string }) {
  const router = useRouter()
  const [lang, setLang] = useState<Lang>(initialLang)
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const t = makeT(lang)
  const valid = name.trim().length >= 2

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-6">
      <Logo />
      <form
        className="flex flex-1 flex-col justify-center py-10"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          setError(null)
          startTransition(async () => {
            const res = await completeOnboarding({ name: name.trim(), language: lang })
            if (!res.ok) return setError(t(errorKey(res.error), res.params))
            haptic()
            router.replace('/')
            router.refresh()
          })
        }}
      >
        <p className={ui.eyebrow}>{t('onboarding.step')}</p>
        <h1 className="mt-2 font-display text-[34px] font-bold leading-tight tracking-tight">{t('onboarding.title')}</h1>
        <p className="mt-2 text-[15px] text-muted">{t('onboarding.subtitle')}</p>

        <label htmlFor="name" className={`${ui.label} mt-8`}>
          {t('onboarding.name')}
        </label>
        <input
          id="name"
          autoFocus
          autoComplete="name"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={cx(ui.input, 'h-14 text-[17px]')}
        />
        <p className="mt-2 text-[12px] text-muted">+91 {phone}</p>

        <p className={`${ui.label} mt-8`}>{t('onboarding.language')}</p>
        <LanguageChoice value={lang} onChange={setLang} />

        {error && <p className="mt-4 text-[13px] font-semibold text-danger">{error}</p>}
        <button disabled={!valid || pending} className={cx(ui.btn, ui.brand, 'mt-8 h-14 w-full text-[16px]')}>
          {pending && <LoaderCircle className="h-5 w-5 animate-spin" />}
          {t('onboarding.start')}
        </button>
      </form>
    </div>
  )
}
