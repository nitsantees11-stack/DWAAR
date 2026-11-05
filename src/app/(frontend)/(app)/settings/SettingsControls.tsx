'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { CircleCheck, LoaderCircle } from 'lucide-react'
import { deleteAccount, updateLanguage, updateSettings, type SettingsGroup } from '../../actions/account'
import { haptic } from '@/components/AppPrefs'
import { useI18n } from '@/components/I18nProvider'
import { LanguageChoice } from '@/components/LanguageChoice'
import { Toggle } from '@/components/Toggle'
import { cx, ui } from '@/components/ui'
import { errorKey, type DictKey, type Lang } from '@/lib/i18n'

export function LanguageSetting({ initial }: { initial: Lang }) {
  const router = useRouter()
  const { t } = useI18n()
  const [lang, setLang] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  return (
    <div>
      <LanguageChoice
        value={lang}
        disabled={pending}
        onChange={(next) => {
          const previous = lang
          setLang(next)
          setError(null)
          startTransition(async () => {
            const res = await updateLanguage({ language: next })
            if (!res.ok) {
              setLang(previous)
              return setError(t(errorKey(res.error)))
            }
            haptic()
            router.refresh()
          })
        }}
      />
      {pending && <LoaderCircle className="mt-3 h-4 w-4 animate-spin text-muted" />}
      {error && <p className="mt-3 text-[13px] font-semibold text-danger">{error}</p>}
      <p className="mt-4 text-[13px] text-muted">{t('lang.note')}</p>
    </div>
  )
}

type ToggleRow = { key: string; label: DictKey; body?: DictKey }

/** Each switch saves immediately and rolls back if the server rejects it. */
export function ToggleGroup({
  group,
  title,
  body,
  rows,
  initial,
}: {
  group: SettingsGroup
  title?: DictKey
  body?: DictKey
  rows: ToggleRow[]
  initial: Record<string, boolean>
}) {
  const router = useRouter()
  const { t } = useI18n()
  const [values, setValues] = useState(initial)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  return (
    <section className={`${ui.card} p-5`}>
      {title && <p className="text-[15px] font-bold">{t(title)}</p>}
      {body && <p className="mt-0.5 text-[13px] text-muted">{t(body)}</p>}
      <ul className={cx('divide-y divide-line-2', title && 'mt-3')}>
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">{t(row.label)}</p>
              {row.body && <p className="text-[12px] text-muted">{t(row.body)}</p>}
            </div>
            {savedKey === row.key && <CircleCheck className="h-4 w-4 text-success" aria-label={t('common.saved')} />}
            <Toggle
              label={t(row.label)}
              checked={Boolean(values[row.key])}
              onChange={(next) => {
                setValues((v) => ({ ...v, [row.key]: next }))
                setError(null)
                startTransition(async () => {
                  const res = await updateSettings({ group, values: { [row.key]: next } })
                  if (!res.ok) {
                    setValues((v) => ({ ...v, [row.key]: !next }))
                    return setError(t(errorKey(res.error)))
                  }
                  haptic(8)
                  setSavedKey(row.key)
                  setTimeout(() => setSavedKey((k) => (k === row.key ? null : k)), 1500)
                  router.refresh()
                })
              }}
            />
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-[13px] font-semibold text-danger">{error}</p>}
    </section>
  )
}

export function PaymentPreference({ initial }: { initial: 'upi' | 'card' | 'cod' }) {
  const router = useRouter()
  const { t } = useI18n()
  const [value, setValue] = useState(initial)
  const [pending, startTransition] = useTransition()
  return (
    <section className={`${ui.card} p-5`}>
      <p className="text-[15px] font-bold">{t('prefs.payment')}</p>
      <p className="mt-0.5 text-[13px] text-muted">{t('prefs.paymentBody')}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(['upi', 'card', 'cod'] as const).map((method) => (
          <button
            key={method}
            type="button"
            disabled={pending}
            onClick={() => {
              setValue(method)
              startTransition(async () => {
                const res = await updateSettings({ group: 'preferences', values: { defaultPayment: method } })
                if (!res.ok) return setValue(initial)
                haptic(8)
                router.refresh()
              })
            }}
            className={cx('rounded-2xl px-2 py-3 text-[13px] font-bold ring-1 transition', value === method ? 'bg-ink text-white ring-ink' : 'bg-surface ring-line')}
          >
            {t(`pay.${method}`)}
          </button>
        ))}
      </div>
    </section>
  )
}

export function DeleteAccountForm({ blocked }: { blocked: boolean }) {
  const router = useRouter()
  const { t } = useI18n()
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
          const res = await deleteAccount({ confirm })
          if (!res.ok) return setError(t(errorKey(res.error)))
          router.replace('/login')
          router.refresh()
        })
      }}
    >
      {blocked && <p className="rounded-2xl bg-warn-soft p-3 text-[13px] font-semibold text-warn">{t('delete.blocked')}</p>}
      <div>
        <label className={ui.label} htmlFor="confirm">
          {t('delete.type')}
        </label>
        <input id="confirm" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={cx(ui.input, 'font-mono uppercase')} />
      </div>
      {error && <p className="text-[13px] font-semibold text-danger">{error}</p>}
      <button disabled={blocked || confirm !== 'DELETE' || pending} className={cx(ui.btn, ui.danger, 'w-full')}>
        {pending && <LoaderCircle className="h-4 w-4 animate-spin" />}
        {t('delete.confirm')}
      </button>
    </form>
  )
}
