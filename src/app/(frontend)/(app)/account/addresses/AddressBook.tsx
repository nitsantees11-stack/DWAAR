'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { LocateFixed, MapPin, Plus } from 'lucide-react'
import type { Address } from '@/payload-types'
import { deleteAddress, setDefaultAddress } from '../../../actions/account'
import { AddressForm } from '@/components/AddressForm'
import { useI18n } from '@/components/I18nProvider'
import { cx, ui } from '@/components/ui'
import type { DictKey } from '@/lib/i18n'

export function AddressBook({
  addresses,
  defaultContact,
  allowLocation,
}: {
  addresses: Address[]
  defaultContact: { name: string; phone: string }
  allowLocation: boolean
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [editing, setEditing] = useState<string | 'new' | null>(addresses.length === 0 ? 'new' : null)
  const [pending, startTransition] = useTransition()
  const done = () => {
    setEditing(null)
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {addresses.map((a) =>
        editing === a.id ? (
          <div key={a.id} className={`${ui.card} p-5`}>
            <p className="mb-4 text-[16px] font-bold">{t('address.editTitle')}</p>
            <AddressForm initial={a} defaultContact={defaultContact} allowLocation={allowLocation} onSaved={done} onCancel={() => setEditing(null)} />
          </div>
        ) : (
          <div key={a.id} className={cx(ui.card, 'p-4', a.isDefault && 'ring-2 ring-ink')}>
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink">
                <MapPin className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
                  {t(`address.label.${a.label}` as DictKey)}
                  {a.isDefault && <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-bold text-white">{t('common.default')}</span>}
                  {a.lat != null && <LocateFixed className="h-3.5 w-3.5 text-success" aria-label={t('address.located')} />}
                </p>
                <p className="mt-0.5 text-[14px] text-ink-2">{a.line}</p>
                {a.landmark && <p className="text-[13px] text-muted">{a.landmark}</p>}
                <p className="mt-1 text-[12px] text-muted">
                  {a.contactName} · +91 {a.contactPhone}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-line-2 pt-3">
              <button type="button" onClick={() => setEditing(a.id)} className={cx(ui.btnSm, ui.secondary)}>
                {t('common.edit')}
              </button>
              {!a.isDefault && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => startTransition(async () => { await setDefaultAddress({ id: a.id }); router.refresh() })}
                  className={cx(ui.btnSm, ui.secondary)}
                >
                  {t('address.makeDefault')}
                </button>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(async () => { await deleteAddress({ id: a.id }); router.refresh() })}
                className={cx(ui.btnSm, 'ml-auto text-danger hover:bg-danger-soft')}
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        ),
      )}
      {editing === 'new' ? (
        <div className={`${ui.card} p-5`}>
          <p className="mb-4 text-[16px] font-bold">{t('address.new')}</p>
          <AddressForm defaultContact={defaultContact} allowLocation={allowLocation} onSaved={done} onCancel={addresses.length ? () => setEditing(null) : undefined} />
        </div>
      ) : (
        <button type="button" onClick={() => setEditing('new')} className={cx(ui.btn, ui.secondary, 'w-full')}>
          <Plus className="h-4 w-4" />
          {t('book.newAddress')}
        </button>
      )}
    </div>
  )
}
