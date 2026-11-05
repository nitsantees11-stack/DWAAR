'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { BadgeCheck, CircleCheck, KeyRound, Lock, LoaderCircle } from 'lucide-react'
import { removeAltWhatsapp, requestAltWhatsappOtp, updateProfile, verifyAltWhatsapp } from '../../../actions/account'
import { haptic } from '@/components/AppPrefs'
import { useI18n } from '@/components/I18nProvider'
import { OtpInput } from '@/components/OtpInput'
import { cx, ui } from '@/components/ui'
import { errorKey } from '@/lib/i18n'

type Gender = 'male' | 'female' | 'other' | 'na'

export function ProfileForm({ initial, phone }: { initial: { name: string; gender: Gender | null; dateOfBirth: string }; phone: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const [name, setName] = useState(initial.name)
  const [gender, setGender] = useState<Gender | null>(initial.gender)
  const [dob, setDob] = useState(initial.dateOfBirth)
  const [status, setStatus] = useState<{ ok: boolean; text: string; field?: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const today = new Date().toISOString().slice(0, 10)

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        setStatus(null)
        startTransition(async () => {
          const res = await updateProfile({ name: name.trim(), gender, dateOfBirth: dob || null })
          if (!res.ok) return setStatus({ ok: false, text: t(errorKey(res.error), res.params), field: res.field })
          haptic()
          setStatus({ ok: true, text: t('common.saved') })
          router.refresh()
        })
      }}
    >
      <div>
        <label className={ui.label} htmlFor="name">
          {t('profile.name')}
        </label>
        <input id="name" value={name} maxLength={60} autoComplete="name" onChange={(e) => setName(e.target.value)} className={cx(ui.input, status?.field === 'name' && 'ring-danger')} />
      </div>
      <div>
        <p className={ui.label}>{t('profile.phone')}</p>
        <div className="flex h-12 items-center gap-2 rounded-xl bg-line-2 px-4 text-[15px] font-semibold text-ink-2">
          <Lock className="h-4 w-4 text-faint" />
          +91 {phone}
        </div>
        <p className="mt-1 text-[12px] text-muted">{t('profile.phoneNote')}</p>
      </div>
      <div>
        <p className={ui.label}>{t('profile.gender')}</p>
        <div className="flex flex-wrap gap-2">
          {(['male', 'female', 'other', 'na'] as const).map((g) => (
            <button key={g} type="button" onClick={() => setGender(g)} className={cx(ui.chip, 'h-10', gender === g && ui.chipOn)}>
              {t(`gender.${g}`)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className={ui.label} htmlFor="dob">
          {t('profile.dob')} <span className="font-normal text-faint">({t('common.optional')})</span>
        </label>
        <input id="dob" type="date" max={today} min="1900-01-01" value={dob} onChange={(e) => setDob(e.target.value)} className={cx(ui.input, status?.field === 'dateOfBirth' && 'ring-danger')} />
      </div>
      {status && (
        <p className={cx('flex items-center gap-1.5 text-[13px] font-semibold', status.ok ? 'text-success' : 'text-danger')}>
          {status.ok && <CircleCheck className="h-4 w-4" />}
          {status.text}
        </p>
      )}
      <button disabled={pending || name.trim().length < 2} className={cx(ui.btn, ui.primary, 'w-full')}>
        {pending && <LoaderCircle className="h-4 w-4 animate-spin" />}
        {pending ? t('common.saving') : t('common.save')}
      </button>
    </form>
  )
}

/** Adding an alternate WhatsApp number requires proving access to it with an OTP. */
export function AltWhatsapp({ current }: { current: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const [editing, setEditing] = useState(!current)
  const [phone, setPhone] = useState('')
  const [challenge, setChallenge] = useState<{ id: string; demoCode: string | null } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const valid = /^[6-9]\d{9}$/.test(phone)

  return (
    <div>
      <p className="text-[15px] font-bold">{t('profile.alt')}</p>
      <p className="mt-0.5 text-[13px] text-muted">{t('profile.altNote')}</p>

      {current && !editing && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-canvas p-3">
          <BadgeCheck className="h-5 w-5 text-success" />
          <span className="flex-1 font-mono text-[15px] font-bold">+91 {current}</span>
          <button type="button" onClick={() => setEditing(true)} className="text-[13px] font-bold text-ink-2">
            {t('common.edit')}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await removeAltWhatsapp()
                router.refresh()
                setEditing(true)
              })
            }
            className="text-[13px] font-bold text-danger"
          >
            {t('profile.altRemove')}
          </button>
        </div>
      )}

      {editing && !challenge && (
        <div className="mt-4 flex gap-2">
          <div className="flex h-12 flex-1 items-center rounded-xl bg-surface ring-1 ring-line focus-within:ring-2 focus-within:ring-ink">
            <span className="border-r border-line px-3 text-[15px] font-bold">+91</span>
            <input inputMode="numeric" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-[15px] focus:outline-none" />
          </div>
          <button
            type="button"
            disabled={!valid || pending}
            onClick={() => {
              setError(null)
              startTransition(async () => {
                const res = await requestAltWhatsappOtp({ phone })
                if (!res.ok) return setError(t(errorKey(res.error), res.params))
                setChallenge({ id: res.challengeId, demoCode: res.demoCode })
                setCode('')
              })
            }}
            className={cx(ui.btn, ui.primary, 'shrink-0 px-4')}
          >
            {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : t('profile.altVerify')}
          </button>
        </div>
      )}

      {challenge && (
        <div className="mt-4 space-y-3">
          <p className="text-[13px] text-ink-2">{t('login.otpSentTo', { phone })}</p>
          {challenge.demoCode && (
            <p className="flex items-center gap-2 rounded-2xl bg-warn-soft p-3 text-[13px] text-warn">
              <KeyRound className="h-4 w-4 shrink-0" />
              {t('login.demoTitle')}: <span className="font-mono font-bold tracking-widest text-ink">{challenge.demoCode}</span>
            </p>
          )}
          <OtpInput
            value={code}
            onChange={setCode}
            invalid={Boolean(error)}
            label={t('login.otpTitle')}
            onComplete={(value) => {
              setError(null)
              startTransition(async () => {
                const res = await verifyAltWhatsapp({ challengeId: challenge.id, phone, code: value })
                if (!res.ok) {
                  setCode('')
                  return setError(t(errorKey(res.error), res.params))
                }
                haptic()
                setChallenge(null)
                setEditing(false)
                setPhone('')
                router.refresh()
              })
            }}
          />
          <button type="button" onClick={() => setChallenge(null)} className="text-[13px] font-bold text-muted">
            {t('login.changeNumber')}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-[13px] font-semibold text-danger">{error}</p>}
    </div>
  )
}
