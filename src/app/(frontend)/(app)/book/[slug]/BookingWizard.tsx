'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Clock,
  CreditCard,
  Banknote,
  LoaderCircle,
  MapPin,
  Minus,
  Moon,
  Plus,
  Search,
  ShieldCheck,
  Smartphone,
  TicketPercent,
  Timer,
  Video,
  Zap,
} from 'lucide-react'
import { createBooking, previewCoupon } from '../../../actions/bookings'
import { ProblemVideo, type ProblemVideoValue } from './ProblemVideo'
import { AddressForm } from '@/components/AddressForm'
import { haptic } from '@/components/AppPrefs'
import { CategoryIcon } from '@/components/CategoryIcon'
import { useI18n } from '@/components/I18nProvider'
import { cx, ui } from '@/components/ui'
import type { ActionFailure } from '@/lib/action-result'
import type { BookingFlow } from '@/lib/booking-machine'
import { errorKey, intlLocale, type DictKey } from '@/lib/i18n'
import { formatINR, formatRange } from '@/lib/money'
import { lineRange, priceBooking, type DeviceTier, type TierMultipliers } from '@/lib/pricing'
import { buildSlots, slotRangeLabel } from '@/lib/slots'
import { formatDay, isNightIST, isWithinHoursIST } from '@/lib/time'

type WizardService = {
  id: string
  name: string
  description: string
  priceType: 'fixed' | 'range'
  priceFromPaise: number
  priceToPaise: number | null
  tierPriced: boolean
  allowQuantity: boolean
  durationLabel: string | null
  warrantyDays: number
  popular: boolean
  ninetyMinPromise: boolean
  isOtherProblem: boolean
}
type WizardModel = { id: string; brand: string; model: string; tier: DeviceTier; deviceType: string | null }
type WizardAddress = { id: string; label: string; line: string; landmark: string; contactName: string; isDefault: boolean }
type Payment = 'upi' | 'card' | 'cod'

const STEPS: DictKey[] = ['book.step.services', 'book.step.device', 'book.step.address', 'book.step.schedule', 'book.step.review']

export function BookingWizard({
  nowISO,
  category,
  services,
  models,
  addresses: initialAddresses,
  multipliers,
  user,
  preset,
}: {
  nowISO: string
  category: {
    slug: string
    name: string
    icon: string
    flow: string
    deviceTypes: { value: string; label: string }[]
    brands: string[]
    visitFeePaise: number
    nightVisitFeePaise: number
    startHour: number
    endHour: number
    allowAsap: boolean
    requireProblemVideo: boolean
    promise: { value: string; label: string } | null
  }
  services: WizardService[]
  models: WizardModel[]
  addresses: WizardAddress[]
  multipliers: TierMultipliers
  user: { name: string; phone: string; altWhatsapp: string; defaultPayment: Payment; allowLocation: boolean }
  preset: { serviceId: string | null; modelId: string | null; asap: boolean; coupon: string }
}) {
  const { t, lang } = useI18n()
  const locale = intlLocale(lang)
  const router = useRouter()
  const flow = category.flow as BookingFlow
  const presetModel = models.find((m) => m.id === preset.modelId) ?? null

  const [step, setStep] = useState(0)
  const [now, setNow] = useState(() => new Date(nowISO))
  const [selected, setSelected] = useState<Record<string, number>>(() => (preset.serviceId ? { [preset.serviceId]: 1 } : {}))
  const [deviceType, setDeviceType] = useState<string>(presetModel?.deviceType ?? (category.deviceTypes.length === 1 ? category.deviceTypes[0].value : ''))
  const [brand, setBrand] = useState<string>(presetModel?.brand ?? '')
  const [modelId, setModelId] = useState<string | null>(presetModel?.id ?? null)
  const [otherModel, setOtherModel] = useState(false)
  const [modelText, setModelText] = useState('')
  const [modelQuery, setModelQuery] = useState('')
  const [notes, setNotes] = useState('')
  const [otherText, setOtherText] = useState('')
  const [video, setVideo] = useState<ProblemVideoValue | null>(null)
  const [videoBusy, setVideoBusy] = useState(false)
  const [addresses, setAddresses] = useState(initialAddresses)
  const [addressId, setAddressId] = useState<string | null>(initialAddresses.find((a) => a.isDefault)?.id ?? initialAddresses[0]?.id ?? null)
  const [addingAddress, setAddingAddress] = useState(initialAddresses.length === 0)
  const [asap, setAsap] = useState(false)
  const [dayIndex, setDayIndex] = useState(0)
  const [slotStart, setSlotStart] = useState<string | null>(null)
  const [couponInput, setCouponInput] = useState(preset.coupon)
  const [coupon, setCoupon] = useState<{ code: string; discountPaise: number } | null>(null)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [autoCouponTried, setAutoCouponTried] = useState(false)
  const [payment, setPayment] = useState<Payment>(user.defaultPayment)
  const [altWhatsapp, setAltWhatsapp] = useState(user.altWhatsapp)
  const [trust, setTrust] = useState(false)
  const [error, setError] = useState<ActionFailure | null>(null)
  const [idemKey] = useState(() => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`))
  const [pending, startTransition] = useTransition()
  const [couponPending, startCoupon] = useTransition()

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const asapAvailable = category.allowAsap && isWithinHoursIST(now, category.startHour, category.endHour)
  useEffect(() => {
    if (preset.asap && asapAvailable) setAsap(true)
  }, [preset.asap, asapAvailable])

  const slotDays = useMemo(() => buildSlots(now, category.startHour, category.endHour), [now, category.startHour, category.endHour])
  const chosenSlot = slotDays.flat().find((s) => s.startISO === slotStart) ?? null
  const scheduleStart = asap ? now : chosenSlot ? new Date(chosenSlot.startISO) : null

  // Device
  const selectedModel = models.find((m) => m.id === modelId) ?? null
  const tier: DeviceTier = selectedModel?.tier ?? 'mid'
  const typeModels = models.filter((m) => !deviceType || !m.deviceType || m.deviceType === deviceType)
  const brandOptions = useMemo(() => {
    const fromModels = typeModels.map((m) => m.brand)
    return [...new Set([...fromModels, ...category.brands])]
  }, [typeModels, category.brands])
  const brandModels = typeModels.filter((m) => m.brand === brand && (!modelQuery || m.model.toLowerCase().includes(modelQuery.toLowerCase())))

  // Pricing preview (the server recomputes on submit)
  const lines = services
    .filter((s) => selected[s.id])
    .map((s) => ({ service: s, quantity: s.allowQuantity ? selected[s.id] : 1 }))
  const otherSelected = lines.some(({ service }) => service.isOtherProblem)
  // The category promise (e.g. "90 min") holds only if every chosen problem is a 90-minute repair.
  const slowLines = lines.filter(({ service }) => !service.ninetyMinPromise).map(({ service }) => service.name)
  const promiseOk = Boolean(category.promise) && lines.length > 0 && slowLines.length === 0
  const night = scheduleStart ? isNightIST(scheduleStart) && category.nightVisitFeePaise > 0 : false
  const visitFeePaise = night ? category.nightVisitFeePaise : category.visitFeePaise
  const quote = priceBooking({
    flow,
    lines: lines.map(({ service, quantity }) => ({ ...service, quantity })),
    tier,
    multipliers,
    visitFeePaise,
    coupon: null,
  })
  const discount = coupon?.discountPaise ?? 0
  const payableMin = Math.max(0, quote.subtotalMinPaise - discount)
  const payableMax = Math.max(0, quote.subtotalMaxPaise - discount)

  const draft = {
    categorySlug: category.slug,
    lines: lines.map(({ service, quantity }) => ({ serviceId: service.id, quantity })),
    device: {
      type: deviceType || undefined,
      brand: brand || undefined,
      modelId: !otherModel && modelId ? modelId : undefined,
      modelText: otherModel ? modelText || undefined : undefined,
      notes: notes || undefined,
    },
    schedule: asap ? ({ mode: 'asap' } as const) : ({ mode: 'scheduled', startAt: slotStart ?? '' } as const),
    problem: {
      description: otherSelected ? otherText.trim() || undefined : undefined,
      videoId: video?.id,
    },
  }

  const problemReady = (!category.requireProblemVideo || Boolean(video)) && (!otherSelected || otherText.trim().length >= 10) && !videoBusy
  const canContinue = [
    lines.length > 0 && problemReady,
    (category.deviceTypes.length === 0 || Boolean(deviceType)) && (brandOptions.length === 0 || Boolean(brand)),
    Boolean(addressId) && !addingAddress,
    asap || Boolean(chosenSlot),
    trust && !pending,
  ][step]

  function goTo(next: number) {
    setError(null)
    if (next < step && coupon) setCoupon(null)
    setStep(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function applyCoupon(code = couponInput) {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return
    setCouponError(null)
    startCoupon(async () => {
      const res = await previewCoupon({ ...draft, couponCode: trimmed })
      if (!res.ok) {
        setCoupon(null)
        return setCouponError(t(errorKey(res.error), res.params))
      }
      haptic()
      setCoupon({ code: res.code, discountPaise: res.discountPaise })
    })
  }

  useEffect(() => {
    if (step === 4 && !autoCouponTried && couponInput && !coupon) {
      setAutoCouponTried(true)
      applyCoupon(couponInput)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  function confirm() {
    if (!addressId) return
    setError(null)
    startTransition(async () => {
      const res = await createBooking({
        ...draft,
        couponCode: coupon?.code,
        addressId,
        paymentMethod: payment,
        altWhatsapp: /^[6-9]\d{9}$/.test(altWhatsapp) ? altWhatsapp : '',
        trustAccepted: true,
        idemKey,
      })
      if (!res.ok) {
        haptic([20, 40, 20])
        setError(res)
        if (res.error === 'slot') setStep(3)
        if (res.error === 'address') setStep(2)
        if (res.error === 'services') setStep(0)
        if (res.error === 'problem_text') setStep(0)
        if (res.error === 'problem_video') {
          setVideo(null)
          setStep(0)
        }
        if (res.error === 'device') setStep(1)
        if (res.error.startsWith('coupon')) setCoupon(null)
        return
      }
      haptic([15, 30, 15])
      router.push(`/bookings/${res.id}?created=1`)
    })
  }

  const dayLabels: DictKey[] = ['day.today', 'day.tomorrow', 'day.dayAfter']

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-40 pt-5 md:px-6">
      {/* Header + progress */}
      <div className="flex items-center gap-3">
        {step === 0 ? (
          <Link href={`/services/${category.slug}`} aria-label={t('common.back')} className="grid h-10 w-10 place-items-center rounded-full bg-surface ring-1 ring-line">
            <ArrowLeft className="h-[18px] w-[18px]" />
          </Link>
        ) : (
          <button type="button" onClick={() => goTo(step - 1)} aria-label={t('common.back')} className="grid h-10 w-10 place-items-center rounded-full bg-surface ring-1 ring-line">
            <ArrowLeft className="h-[18px] w-[18px]" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className={ui.eyebrow}>
            {step + 1}/{STEPS.length} · {t(STEPS[step])}
          </p>
          <p className="truncate text-[17px] font-bold">{t('book.title', { category: category.name })}</p>
        </div>
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-(--accent-soft) text-(--accent)">
          <CategoryIcon icon={category.icon} className="h-5 w-5" />
        </span>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-1.5">
        {STEPS.map((key, i) => (
          <button
            key={key}
            type="button"
            disabled={i > step}
            onClick={() => i < step && goTo(i)}
            className="group text-left disabled:cursor-default"
          >
            <span className={cx('block h-1.5 rounded-full transition', i <= step ? 'bg-(--accent)' : 'bg-line')} />
            <span className={cx('mt-1.5 hidden text-[11px] font-bold sm:block', i === step ? 'text-ink' : 'text-faint')}>{t(key)}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-5 flex items-start gap-2 rounded-2xl bg-danger-soft p-3 text-[14px] font-semibold text-danger">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {t(errorKey(error.error), error.params)}
        </div>
      )}

      <div className="mt-6 motion-safe:animate-rise" key={step}>
        {/* 1. Services */}
        {step === 0 && (
          <section>
            <h1 className={ui.h2}>{t('book.servicesTitle')}</h1>
            <p className="mt-1 text-[14px] text-muted">{t('book.servicesHint')}</p>
            <div className="mt-5 space-y-3">
              {services.map((s) => {
                const qty = selected[s.id] ?? 0
                const on = qty > 0
                const r = lineRange({ ...s, quantity: 1 }, tier, multipliers)
                return (
                  <div key={s.id} className={cx('rounded-3xl bg-surface p-4 ring-1 transition', on ? 'ring-2 ring-(--accent)' : 'ring-line hover:ring-ink/20')}>
                    <button
                      type="button"
                      onClick={() => setSelected((cur) => {
                        const next = { ...cur }
                        if (next[s.id]) delete next[s.id]
                        else next[s.id] = 1
                        return next
                      })}
                      className="flex w-full items-start gap-3 text-left"
                    >
                      <span className={cx('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg ring-1 transition', on ? 'bg-(--accent) text-white ring-(--accent)' : 'ring-line')}>
                        {on && <Check className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[16px] font-bold">{s.name}</span>
                          {s.popular && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand-ink">{t('common.popular')}</span>}
                        </span>
                        <span className="mt-1 block text-[13px] text-muted">{s.description}</span>
                        <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] font-semibold text-ink-2">
                          {category.promise && s.ninetyMinPromise && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-(--accent-soft) px-2 py-0.5 text-(--accent-ink)">
                              <Timer className="h-3.5 w-3.5" />
                              {t('book.promiseBadge', { value: category.promise.value })}
                            </span>
                          )}
                          {s.durationLabel && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              {s.durationLabel}
                            </span>
                          )}
                          {s.warrantyDays > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <ShieldCheck className="h-3.5 w-3.5 text-success" />
                              {t('common.warrantyDays', { days: s.warrantyDays })}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className={cx('shrink-0 text-right font-display font-bold', s.isOtherProblem ? 'text-[13px] text-ink-2' : 'text-[15px]')}>
                        {s.isOtherProblem ? t('book.otherPrice') : formatRange(r.min, r.max)}
                      </span>
                    </button>
                    {on && s.isOtherProblem && (
                      <div className="mt-3">
                        <label className={ui.label} htmlFor={`other-${s.id}`}>
                          {t('book.otherTitle')}
                        </label>
                        <textarea
                          id={`other-${s.id}`}
                          rows={3}
                          maxLength={500}
                          value={otherText}
                          onChange={(e) => setOtherText(e.target.value)}
                          placeholder={t('book.otherPh')}
                          className={ui.textarea}
                        />
                        <p className={cx('mt-1 text-[12px]', otherText.trim().length >= 10 ? 'text-muted' : 'text-warn')}>{t('book.otherHint')}</p>
                      </div>
                    )}
                    {on && s.allowQuantity && (
                      <div className="mt-3 flex items-center justify-between rounded-2xl bg-canvas px-3 py-2">
                        <span className="text-[13px] font-bold">{t('book.qty')}</span>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            aria-label="-"
                            onClick={() => setSelected((cur) => ({ ...cur, [s.id]: Math.max(1, (cur[s.id] ?? 1) - 1) }))}
                            className="grid h-8 w-8 place-items-center rounded-full bg-surface ring-1 ring-line"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="w-5 text-center font-display text-[17px] font-bold">{qty}</span>
                          <button
                            type="button"
                            aria-label="+"
                            onClick={() => setSelected((cur) => ({ ...cur, [s.id]: Math.min(5, (cur[s.id] ?? 1) + 1) }))}
                            className="grid h-8 w-8 place-items-center rounded-full bg-surface ring-1 ring-line"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {category.promise && lines.length > 0 && (
              <p
                className={cx(
                  'mt-4 flex items-start gap-2 rounded-2xl p-3 text-[13px] font-semibold',
                  promiseOk ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn',
                )}
              >
                <Timer className="mt-0.5 h-4 w-4 shrink-0" />
                {promiseOk
                  ? t('book.promiseYes', { value: category.promise.value })
                  : t('book.promiseNo', { value: category.promise.value, names: slowLines.join(', ') })}
              </p>
            )}
            {category.requireProblemVideo && (
              <div className="mt-4">
                <ProblemVideo value={video} onChange={setVideo} onBusy={setVideoBusy} required />
                {lines.length > 0 && !video && !videoBusy && <p className="mt-2 px-1 text-[12px] font-semibold text-muted">{t('book.videoNeeded')}</p>}
              </div>
            )}
          </section>
        )}

        {/* 2. Device */}
        {step === 1 && (
          <section className="space-y-6">
            <div>
              <h1 className={ui.h2}>{t('book.deviceTitle')}</h1>
              <p className="mt-1 text-[14px] text-muted">{t('book.deviceHint')}</p>
            </div>
            {category.deviceTypes.length > 0 && (
              <div>
                <p className={ui.label}>{t('book.type')}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {category.deviceTypes.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => {
                        setDeviceType(d.value)
                        setModelId(null)
                      }}
                      className={cx('flex h-14 items-center gap-2 rounded-2xl bg-surface px-4 text-[14px] font-bold ring-1 transition', deviceType === d.value ? 'ring-2 ring-(--accent)' : 'ring-line')}
                    >
                      <CategoryIcon icon={category.icon} className="h-4 w-4 text-(--accent)" />
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {brandOptions.length > 0 && (
              <div>
                <p className={ui.label}>{t('book.brand')}</p>
                <div className="flex flex-wrap gap-2">
                  {brandOptions.map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => {
                        setBrand(b)
                        setModelId(null)
                        setModelQuery('')
                      }}
                      className={cx(ui.chip, 'h-10', brand === b && ui.chipOn)}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {brand && typeModels.some((m) => m.brand === brand) && (
              <div>
                <p className={ui.label}>{t('book.model')}</p>
                {!otherModel && (
                  <>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                      <input value={modelQuery} onChange={(e) => setModelQuery(e.target.value)} placeholder={t('book.modelSearch')} className={cx(ui.input, 'pl-10')} />
                    </div>
                    <div className="mt-2 grid max-h-72 gap-1.5 overflow-y-auto sm:grid-cols-2">
                      {brandModels.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setModelId(m.id)}
                          className={cx('flex items-center justify-between gap-2 rounded-xl bg-surface px-3.5 py-3 text-left text-[14px] font-semibold ring-1 transition', modelId === m.id ? 'ring-2 ring-(--accent)' : 'ring-line')}
                        >
                          <span className="flex items-center gap-2">
                            <Smartphone className="h-4 w-4 text-faint" />
                            {m.model}
                          </span>
                          <span className="text-[11px] font-bold uppercase tracking-wide text-muted">{t(`tier.${m.tier}`)}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <label className="mt-3 flex items-center gap-2.5 text-[14px] font-semibold">
                  <input
                    type="checkbox"
                    checked={otherModel}
                    onChange={(e) => {
                      setOtherModel(e.target.checked)
                      if (e.target.checked) setModelId(null)
                    }}
                    className="h-5 w-5 accent-ink"
                  />
                  {t('book.modelOther')}
                </label>
                {otherModel && (
                  <input value={modelText} maxLength={60} onChange={(e) => setModelText(e.target.value)} placeholder={t('book.modelText')} className={cx(ui.input, 'mt-2')} />
                )}
              </div>
            )}
            <div>
              <label className={ui.label} htmlFor="notes">
                {t('book.notes')} <span className="font-normal text-faint">({t('common.optional')})</span>
              </label>
              <textarea id="notes" rows={3} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('book.notesPh')} className={ui.textarea} />
            </div>
          </section>
        )}

        {/* 3. Address */}
        {step === 2 && (
          <section>
            <h1 className={ui.h2}>{t('book.addressTitle')}</h1>
            <p className="mt-1 text-[14px] text-muted">{t('book.addressHint')}</p>
            <div className="mt-5 space-y-2">
              {addresses.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAddressId(a.id)}
                  className={cx('flex w-full items-start gap-3 rounded-3xl bg-surface p-4 text-left ring-1 transition', addressId === a.id ? 'ring-2 ring-(--accent)' : 'ring-line')}
                >
                  <span className={cx('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ring-2', addressId === a.id ? 'ring-(--accent)' : 'ring-line')}>
                    {addressId === a.id && <span className="h-2.5 w-2.5 rounded-full bg-(--accent)" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[15px] font-bold">
                      {t(`address.label.${a.label}` as DictKey)}
                      {a.isDefault && <span className="rounded-full bg-line-2 px-2 py-0.5 text-[11px] font-semibold text-muted">{t('common.default')}</span>}
                    </span>
                    <span className="mt-0.5 block text-[14px] text-ink-2">{a.line}</span>
                    {a.landmark && <span className="block text-[13px] text-muted">{a.landmark}</span>}
                    <span className="mt-1 block text-[12px] text-muted">{a.contactName}</span>
                  </span>
                </button>
              ))}
            </div>
            {addingAddress ? (
              <div className={`${ui.card} mt-4 p-5`}>
                <p className="mb-4 text-[16px] font-bold">{t('address.new')}</p>
                <AddressForm
                  defaultContact={{ name: user.name, phone: user.phone }}
                  allowLocation={user.allowLocation}
                  onCancel={addresses.length > 0 ? () => setAddingAddress(false) : undefined}
                  onSaved={(saved) => {
                    setAddingAddress(false)
                    setAddressId(saved.id)
                    setAddresses((cur) => [
                      ...cur.map((a) => (saved.isDefault ? { ...a, isDefault: false } : a)).filter((a) => a.id !== saved.id),
                      { ...saved, isDefault: saved.isDefault || cur.length === 0 },
                    ])
                  }}
                />
              </div>
            ) : (
              <button type="button" onClick={() => setAddingAddress(true)} className={cx(ui.btn, ui.secondary, 'mt-4 w-full')}>
                <Plus className="h-4 w-4" />
                {t('book.newAddress')}
              </button>
            )}
          </section>
        )}

        {/* 4. Schedule */}
        {step === 3 && (
          <section>
            <h1 className={ui.h2}>{t('book.scheduleTitle')}</h1>
            {asapAvailable && (
              <button
                type="button"
                onClick={() => {
                  setAsap(true)
                  setSlotStart(null)
                }}
                className={cx('mt-5 flex w-full items-center gap-4 rounded-3xl p-4 text-left ring-1 transition', asap ? 'bg-(--accent) text-white ring-(--accent)' : 'bg-surface ring-line')}
              >
                <span className={cx('grid h-12 w-12 shrink-0 place-items-center rounded-2xl', asap ? 'bg-white/20' : 'bg-(--accent-soft) text-(--accent)')}>
                  <Zap className="h-6 w-6" />
                </span>
                <span className="flex-1">
                  <span className="block text-[17px] font-bold">{t('book.asap')}</span>
                  <span className={cx('block text-[13px]', asap ? 'text-white/85' : 'text-muted')}>{t('book.asapBody')}</span>
                </span>
                {asap && <Check className="h-5 w-5" />}
              </button>
            )}
            <p className={`${ui.label} mt-6`}>{asapAvailable ? t('book.slotTitle') : t('book.scheduleTitle')}</p>
            <div className="grid grid-cols-3 gap-2">
              {slotDays.map((slots, i) => {
                const date = slots[0] ? new Date(slots[0].startISO) : new Date(now.getTime() + i * 86_400_000)
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setDayIndex(i)}
                    className={cx('rounded-2xl px-3 py-2.5 text-left ring-1 transition', dayIndex === i ? 'bg-ink text-white ring-ink' : 'bg-surface ring-line')}
                  >
                    <span className="block text-[14px] font-bold">{t(dayLabels[i])}</span>
                    <span className={cx('block text-[12px]', dayIndex === i ? 'text-white/70' : 'text-muted')}>{formatDay(date, locale)}</span>
                  </button>
                )
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(slotDays[dayIndex] ?? []).map((slot) => {
                const on = !asap && slotStart === slot.startISO
                const isNight = isNightIST(new Date(slot.startISO)) && category.nightVisitFeePaise > 0
                return (
                  <button
                    key={slot.startISO}
                    type="button"
                    onClick={() => {
                      setSlotStart(slot.startISO)
                      setAsap(false)
                    }}
                    className={cx('flex h-12 items-center justify-center gap-1.5 rounded-2xl text-[14px] font-bold ring-1 transition', on ? 'bg-(--accent-soft) text-(--accent-ink) ring-2 ring-(--accent)' : 'bg-surface ring-line hover:ring-ink/20')}
                  >
                    {isNight && <Moon className="h-3.5 w-3.5" />}
                    {slotRangeLabel(slot)}
                  </button>
                )
              })}
            </div>
            {(slotDays[dayIndex] ?? []).length === 0 && <p className="mt-3 text-[14px] text-muted">{t('book.noSlots')}</p>}
            {night && flow !== 'pickup_drop' && (
              <p className="mt-4 flex items-center gap-2 rounded-2xl bg-warn-soft p-3 text-[13px] font-semibold text-warn">
                <Moon className="h-4 w-4" />
                {t('book.nightFee', { fee: formatINR(category.nightVisitFeePaise) })}
              </p>
            )}
          </section>
        )}

        {/* 5. Review */}
        {step === 4 && (
          <section className="space-y-4">
            <h1 className={ui.h2}>{t('book.reviewTitle')}</h1>
            <div className={`${ui.card} divide-y divide-line-2`}>
              <ReviewRow label={t('book.lines')} onEdit={() => goTo(0)} edit={t('common.edit')}>
                {lines.map(({ service, quantity }) => (
                  <span key={service.id} className="block">
                    {service.name}
                    {quantity > 1 ? ` × ${quantity}` : ''}
                  </span>
                ))}
                {category.promise && (
                  <span className={cx('mt-1.5 flex items-center gap-1.5 text-[12px] font-bold', promiseOk ? 'text-success' : 'text-warn')}>
                    <Timer className="h-3.5 w-3.5" />
                    {promiseOk ? t('book.promiseBadge', { value: category.promise.value }) : t('book.otherPrice')}
                  </span>
                )}
              </ReviewRow>
              {(video || (otherSelected && otherText.trim())) && (
                <ReviewRow label={t('book.problemReview')} onEdit={() => goTo(0)} edit={t('common.edit')}>
                  {otherSelected && otherText.trim() && <span className="block whitespace-pre-line font-normal text-ink-2">{otherText.trim()}</span>}
                  {video && (
                    <span className="mt-1 inline-flex items-center gap-1.5 text-success">
                      <Video className="h-4 w-4" />
                      {t('book.videoAttached', { sec: video.durationSec })}
                    </span>
                  )}
                </ReviewRow>
              )}
              <ReviewRow label={t('booking.device')} onEdit={() => goTo(1)} edit={t('common.edit')}>
                {[category.deviceTypes.find((d) => d.value === deviceType)?.label, brand, otherModel ? modelText : selectedModel?.model].filter(Boolean).join(' · ') || '—'}
              </ReviewRow>
              <ReviewRow label={t('booking.where')} onEdit={() => goTo(2)} edit={t('common.edit')}>
                <span className="inline-flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-(--accent)" />
                  {addresses.find((a) => a.id === addressId)?.line}
                </span>
              </ReviewRow>
              <ReviewRow label={t('booking.when')} onEdit={() => goTo(3)} edit={t('common.edit')}>
                {asap ? t('booking.asap') : chosenSlot ? `${formatDay(new Date(chosenSlot.startISO), locale)}, ${slotRangeLabel(chosenSlot)}` : '—'}
              </ReviewRow>
            </div>

            <div className={`${ui.card} p-5`}>
              <p className="flex items-center gap-2 text-[15px] font-bold">
                <TicketPercent className="h-5 w-5 text-brand" />
                {t('book.coupon')}
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  value={couponInput}
                  onChange={(e) => {
                    setCouponInput(e.target.value.toUpperCase())
                    setCoupon(null)
                    setCouponError(null)
                  }}
                  placeholder="FIRST100"
                  maxLength={30}
                  className={cx(ui.input, 'font-mono font-bold uppercase tracking-wider')}
                />
                <button type="button" disabled={!couponInput.trim() || couponPending} onClick={() => applyCoupon()} className={cx(ui.btn, ui.primary, 'shrink-0')}>
                  {couponPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : t('book.apply')}
                </button>
              </div>
              {coupon && (
                <p className="mt-2 flex items-center gap-1.5 text-[13px] font-bold text-success">
                  <Check className="h-4 w-4" />
                  {t('book.couponOk', { code: coupon.code, amount: formatINR(coupon.discountPaise) })}
                </p>
              )}
              {couponError && <p className="mt-2 text-[13px] font-semibold text-danger">{couponError}</p>}
            </div>

            <div className={`${ui.card} p-5`}>
              <dl className="space-y-2 text-[14px]">
                <div className="flex justify-between">
                  <dt className="text-ink-2">{t('book.estimate')}</dt>
                  <dd className="font-semibold">{quote.linesMaxPaise > 0 ? formatRange(quote.linesMinPaise, quote.linesMaxPaise) : t('book.otherPrice')}</dd>
                </div>
                {flow !== 'pickup_drop' && (
                  <div className="flex justify-between">
                    <dt className="text-ink-2">
                      {t('book.visitFee')}
                      <span className="block text-[12px] text-muted">{t('cat.visitFeeNote')}</span>
                    </dt>
                    <dd className="font-semibold">{formatINR(visitFeePaise)}</dd>
                  </div>
                )}
                {flow === 'pickup_drop' && (
                  <div className="flex justify-between">
                    <dt className="text-ink-2">{t('cat.pickupFree')}</dt>
                    <dd className="font-bold text-success">{t('common.free')}</dd>
                  </div>
                )}
                {discount > 0 && (
                  <div className="flex justify-between text-success">
                    <dt>{t('book.discount')}</dt>
                    <dd className="font-bold">− {formatINR(discount)}</dd>
                  </div>
                )}
                <div className="flex items-end justify-between border-t border-line-2 pt-3">
                  <dt className="font-bold">{t('book.payable')}</dt>
                  <dd className="font-display text-[22px] font-extrabold">{payableMax > 0 ? formatRange(payableMin, payableMax) : t('book.otherPrice')}</dd>
                </div>
              </dl>
              <p className="mt-2 text-[12px] text-muted">{t('book.payableNote')}</p>
            </div>

            <div className={`${ui.card} p-5`}>
              <p className="text-[15px] font-bold">{t('book.payment')}</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {([
                  ['upi', Smartphone, 'pay.upi'],
                  ['card', CreditCard, 'pay.card'],
                  ['cod', Banknote, 'pay.cod'],
                ] as const).map(([value, Icon, key]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPayment(value)}
                    className={cx('flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center text-[12px] font-bold ring-1 transition', payment === value ? 'bg-ink text-white ring-ink' : 'bg-surface ring-line')}
                  >
                    <Icon className="h-5 w-5" />
                    {t(key)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-muted">{t('book.payNote')}</p>

              <label className={`${ui.label} mt-5`} htmlFor="alt">
                {t('book.altWhatsapp')} <span className="font-normal text-faint">({t('common.optional')})</span>
              </label>
              <input id="alt" inputMode="numeric" maxLength={10} value={altWhatsapp} onChange={(e) => setAltWhatsapp(e.target.value.replace(/\D/g, ''))} className={ui.input} />
              <p className="mt-1 text-[12px] text-muted">{t('book.altWhatsappHint')}</p>
            </div>

            <label className="flex items-start gap-3 rounded-3xl bg-(--accent-soft) p-4 text-[13px] font-semibold text-ink-2">
              <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-ink" />
              {t('book.trust')}
            </label>
          </section>
        )}
      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-2xl items-center gap-4 px-4 py-3 md:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-muted">
              {lines.length > 0 ? t('book.selectedCount', { n: lines.length }) : t('book.estimateBar')}
            </p>
            <p className="truncate font-display text-[20px] font-extrabold">
              {lines.length === 0 ? '—' : payableMax > 0 ? formatRange(payableMin, payableMax) : t('book.otherPrice')}
            </p>
          </div>
          {step < 4 ? (
            <button type="button" disabled={!canContinue} onClick={() => goTo(step + 1)} className={cx(ui.btn, ui.accent, 'h-13 min-w-40 px-6')}>
              {t('book.next')}
            </button>
          ) : (
            <button type="button" disabled={!canContinue} onClick={confirm} className={cx(ui.btn, ui.accent, 'h-13 min-w-40 px-6')}>
              {pending && <LoaderCircle className="h-5 w-5 animate-spin" />}
              {pending ? t('book.confirming') : t('book.confirm')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ReviewRow({ label, edit, onEdit, children }: { label: string; edit: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-bold uppercase tracking-wider text-muted">{label}</p>
        <div className="mt-1 text-[14px] font-semibold">{children}</div>
      </div>
      <button type="button" onClick={onEdit} className="text-[13px] font-bold text-(--accent-ink)">
        {edit}
      </button>
    </div>
  )
}
