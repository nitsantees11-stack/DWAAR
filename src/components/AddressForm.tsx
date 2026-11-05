'use client'

import { useState, useTransition } from 'react'
import { Briefcase, House, LoaderCircle, LocateFixed, MapPin } from 'lucide-react'
import { saveAddress, type AddressInput } from '@/app/(frontend)/actions/account'
import type { Address } from '@/payload-types'
import { errorKey } from '@/lib/i18n'
import { haptic } from './AppPrefs'
import { useI18n } from './I18nProvider'
import { cx, ui } from './ui'

type Label = 'home' | 'work' | 'other'

export function AddressForm({
  initial,
  defaultContact,
  allowLocation,
  onSaved,
  onCancel,
}: {
  initial?: Address | null
  defaultContact: { name: string; phone: string }
  allowLocation: boolean
  onSaved: (saved: { id: string; line: string; label: Label; landmark: string; contactName: string; isDefault: boolean }) => void
  onCancel?: () => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<Omit<AddressInput, 'id'>>({
    label: (initial?.label as Label) ?? 'home',
    contactName: initial?.contactName ?? defaultContact.name,
    contactPhone: initial?.contactPhone ?? defaultContact.phone,
    flat: initial?.flat ?? '',
    area: initial?.area ?? '',
    landmark: initial?.landmark ?? '',
    city: initial?.city ?? 'Gurugram',
    pincode: initial?.pincode ?? '',
    lat: initial?.lat ?? null,
    lng: initial?.lng ?? null,
    isDefault: initial?.isDefault ?? false,
  })
  const [error, setError] = useState<{ text: string; field?: string } | null>(null)
  const [locating, setLocating] = useState(false)
  const [pending, startTransition] = useTransition()
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  const fields: { key: 'contactName' | 'contactPhone' | 'flat' | 'area' | 'landmark' | 'city' | 'pincode'; label: Parameters<typeof t>[0]; mode?: 'numeric'; max: number; span?: boolean; optional?: boolean }[] = [
    { key: 'flat', label: 'address.flat', max: 80, span: true },
    { key: 'area', label: 'address.area', max: 120, span: true },
    { key: 'landmark', label: 'address.landmark', max: 120, span: true, optional: true },
    { key: 'city', label: 'address.city', max: 60 },
    { key: 'pincode', label: 'address.pincode', max: 6, mode: 'numeric' },
    { key: 'contactName', label: 'address.contactName', max: 60 },
    { key: 'contactPhone', label: 'address.contactPhone', max: 10, mode: 'numeric' },
  ]

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
          const res = await saveAddress({ ...form, id: initial?.id })
          if (!res.ok) return setError({ text: t(errorKey(res.error), res.params), field: res.field })
          haptic()
          onSaved({ id: res.id, line: res.line, label: form.label, landmark: form.landmark ?? '', contactName: form.contactName, isDefault: Boolean(form.isDefault) })
        })
      }}
    >
      <div className="flex gap-2">
        {([
          ['home', House],
          ['work', Briefcase],
          ['other', MapPin],
        ] as const).map(([value, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => set('label', value)}
            className={cx(ui.chip, 'h-10', form.label === value && ui.chipOn)}
          >
            <Icon className="h-4 w-4" />
            {t(`address.label.${value}`)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {fields.map((f) => (
          <div key={f.key} className={f.span ? 'col-span-2' : ''}>
            <label className={ui.label} htmlFor={`addr-${f.key}`}>
              {t(f.label)} {f.optional && <span className="font-normal text-faint">({t('common.optional')})</span>}
            </label>
            <input
              id={`addr-${f.key}`}
              value={(form[f.key] as string) ?? ''}
              maxLength={f.max}
              inputMode={f.mode}
              onChange={(e) => set(f.key, f.mode ? e.target.value.replace(/\D/g, '') : e.target.value)}
              className={cx(ui.input, error?.field === f.key && 'ring-danger')}
            />
          </div>
        ))}
      </div>

      {allowLocation ? (
        <button
          type="button"
          disabled={locating}
          onClick={() => {
            if (!navigator.geolocation) return
            setLocating(true)
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                setForm((f) => ({ ...f, lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) }))
                setLocating(false)
              },
              () => setLocating(false),
              { enableHighAccuracy: true, timeout: 10_000 },
            )
          }}
          className={cx(ui.btnSm, ui.secondary, 'h-10')}
        >
          {locating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4 text-brand" />}
          {locating ? t('address.locating') : form.lat != null ? t('address.located') : t('address.useLocation')}
        </button>
      ) : (
        <p className="text-[12px] text-muted">{t('address.locationOff')}</p>
      )}

      <label className="flex items-center gap-2.5 text-[14px] font-semibold">
        <input
          type="checkbox"
          checked={Boolean(form.isDefault)}
          onChange={(e) => set('isDefault', e.target.checked)}
          className="h-5 w-5 accent-ink"
        />
        {t('address.makeDefault')}
      </label>

      {error && <p className="text-[13px] font-semibold text-danger">{error.text}</p>}
      <div className="flex gap-2">
        <button disabled={pending} className={cx(ui.btn, ui.primary, 'flex-1')}>
          {pending && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {t('address.save')}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={cx(ui.btn, ui.secondary)}>
            {t('common.cancel')}
          </button>
        )}
      </div>
    </form>
  )
}
