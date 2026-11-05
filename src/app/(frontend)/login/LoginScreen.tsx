'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { ArrowLeft, BadgeCheck, IndianRupee, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react'
import { requestLoginOtp, verifyLoginOtp } from '../actions/auth'
import { haptic } from '@/components/AppPrefs'
import { CategoryIcon } from '@/components/CategoryIcon'
import { I18nProvider } from '@/components/I18nProvider'
import { LanguageChoice } from '@/components/LanguageChoice'
import { Logo } from '@/components/Logo'
import { OtpInput } from '@/components/OtpInput'
import { cx, ui } from '@/components/ui'
import type { ActionFailure } from '@/lib/action-result'
import { DEFAULT_LANG, LANG_COOKIE, errorKey, isLang, makeT, type Lang } from '@/lib/i18n'
import { themeClass } from '@/lib/theme'

type Tile = { id: string; name: string; icon: string; promise: string; image: { url: string; alt: string } | null }

function readLangCookie(): Lang {
  const match = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]+)`))
  const value = match?.[1]
  return isLang(value) ? value : DEFAULT_LANG
}

function writeLangCookie(lang: Lang) {
  const secure = location.protocol === 'https:' ? '; Secure; SameSite=None; Partitioned' : '; SameSite=Lax'
  document.cookie = `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000${secure}`
}

function safeNext() {
  const next = new URLSearchParams(window.location.search).get('next')
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

export function LoginScreen({ tiles }: { tiles: Tile[] }) {
  const router = useRouter()
  const [lang, setLang] = useState<Lang>(DEFAULT_LANG)
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [demoCode, setDemoCode] = useState<string | null>(null)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<ActionFailure | null>(null)
  const [pending, startTransition] = useTransition()
  const t = makeT(lang)

  useEffect(() => setLang(readLangCookie()), [])
  useEffect(() => {
    if (step !== 'otp') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [step])

  const digits = phone.replace(/\D/g, '').slice(0, 10)
  const phoneValid = /^[6-9]\d{9}$/.test(digits)
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000))

  function sendOtp() {
    setError(null)
    startTransition(async () => {
      const res = await requestLoginOtp({ phone: digits })
      if (!res.ok) return setError(res)
      setChallengeId(res.challengeId)
      setDemoCode(res.demoCode)
      setResendAt(Date.now() + res.resendInSec * 1000)
      setNow(Date.now())
      setCode('')
      setStep('otp')
    })
  }

  function verify(value = code) {
    if (value.length !== 6) return
    setError(null)
    startTransition(async () => {
      const res = await verifyLoginOtp({ challengeId, phone: digits, code: value, lang })
      if (!res.ok) {
        haptic([20, 40, 20])
        setCode('')
        return setError(res)
      }
      haptic()
      router.replace(res.needsOnboarding ? '/onboarding' : safeNext())
      router.refresh()
    })
  }

  const errorText = error ? t(errorKey(error.error), error.params) : null

  return (
    <I18nProvider lang={lang}>
      <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
        {/* Brand panel */}
        <section className="relative hidden overflow-hidden bg-night p-10 text-white lg:flex lg:flex-col">
          <div className="pointer-events-none absolute -left-32 top-1/3 h-96 w-96 rounded-full bg-brand/25 blur-3xl" />
          <Logo inverted />
          <div className="relative mt-auto">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-semibold ring-1 ring-white/10">
              <span className="h-2 w-2 rounded-full bg-success motion-safe:animate-blink" />
              {t('login.badge')}
            </span>
            <h1 className="mt-5 max-w-xl font-display text-[64px] font-bold leading-[0.98] tracking-tight">{t('login.title')}</h1>
            <p className="mt-4 max-w-md text-[17px] text-white/70">{t('login.subtitle')}</p>
            <div className="mt-10 grid grid-cols-3 gap-3">
              {tiles.map((tile, i) => (
                <div
                  key={tile.id}
                  className={cx(themeClass(tile.icon), 'relative aspect-[3/4] overflow-hidden rounded-t-full rounded-b-[28px] bg-night-2', i === 1 && 'translate-y-6')}
                >
                  {tile.image && <Image src={tile.image.url} alt={tile.image.alt} fill sizes="220px" className="object-cover" />}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-(--accent)">
                      <CategoryIcon icon={tile.icon} className="h-4 w-4" />
                    </span>
                    <p className="mt-2 text-[14px] font-bold leading-tight">{tile.name}</p>
                    <p className="text-[12px] text-white/70">{tile.promise}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Form */}
        <section className="flex flex-col px-5 pb-8 pt-5 md:px-10">
          <div className="flex items-center justify-between">
            <span className="lg:invisible">
              <Logo />
            </span>
            <LanguageChoice
              variant="pills"
              value={lang}
              onChange={(l) => {
                setLang(l)
                writeLangCookie(l)
              }}
            />
          </div>

          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
            <div className="lg:hidden">
              <h1 className="font-display text-[38px] font-bold leading-[1.02] tracking-tight">{t('login.title')}</h1>
              <p className="mt-3 text-[15px] text-muted">{t('login.subtitle')}</p>
              <div className="no-scrollbar -mx-5 mt-6 flex gap-2 overflow-x-auto px-5">
                {tiles.map((tile) => (
                  <span
                    key={tile.id}
                    className={cx(themeClass(tile.icon), 'inline-flex shrink-0 items-center gap-2 rounded-full bg-(--accent-soft) py-1.5 pl-1.5 pr-3 text-[13px] font-bold text-(--accent-ink)')}
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-(--accent) text-white">
                      <CategoryIcon icon={tile.icon} className="h-3.5 w-3.5" />
                    </span>
                    {tile.name}
                  </span>
                ))}
              </div>
            </div>

            <div className={cx(ui.card, 'mt-8 p-5 md:p-7 lg:mt-0')}>
              {step === 'phone' ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (phoneValid) sendOtp()
                  }}
                >
                  <h2 className="text-[20px] font-bold">{t('login.phoneTitle')}</h2>
                  <p className="mt-1 text-[14px] text-muted">{t('login.phoneHint')}</p>
                  <label className={`${ui.label} mt-6`} htmlFor="phone">
                    {t('login.phoneLabel')}
                  </label>
                  <div className={cx('flex h-14 items-center rounded-2xl bg-surface ring-1 transition focus-within:ring-2 focus-within:ring-ink', error ? 'ring-danger' : 'ring-line')}>
                    <span className="flex h-full items-center gap-1.5 border-r border-line px-4 text-[16px] font-bold">+91</span>
                    <input
                      id="phone"
                      autoFocus
                      inputMode="numeric"
                      autoComplete="tel-national"
                      placeholder="98765 43210"
                      value={digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits}
                      onChange={(e) => setPhone(e.target.value)}
                      className="h-full min-w-0 flex-1 bg-transparent px-4 font-mono text-[18px] font-semibold tracking-wide placeholder:font-sans placeholder:font-normal placeholder:text-faint focus:outline-none"
                    />
                  </div>
                  {errorText && <p className="mt-2 text-[13px] font-semibold text-danger">{errorText}</p>}
                  <button disabled={!phoneValid || pending} className={cx(ui.btn, ui.brand, 'mt-5 h-14 w-full text-[16px]')}>
                    {pending ? <LoaderCircle className="h-5 w-5 animate-spin" /> : null}
                    {pending ? t('login.sending') : t('login.sendOtp')}
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    verify()
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setStep('phone')
                      setError(null)
                    }}
                    className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-muted hover:text-ink"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    {t('login.changeNumber')}
                  </button>
                  <h2 className="text-[20px] font-bold">{t('login.otpTitle')}</h2>
                  <p className="mt-1 text-[14px] text-muted">{t('login.otpSentTo', { phone: `${digits.slice(0, 5)} ${digits.slice(5)}` })}</p>
                  {demoCode && (
                    <div className="mt-4 flex items-center gap-3 rounded-2xl bg-warn-soft p-3 text-[13px] text-warn">
                      <KeyRound className="h-5 w-5 shrink-0" />
                      <p>
                        <span className="font-bold">{t('login.demoTitle')}:</span> {t('login.demoBody')}{' '}
                        <span className="font-mono text-[15px] font-bold tracking-widest text-ink">{demoCode}</span>
                      </p>
                    </div>
                  )}
                  <div className="mt-5">
                    <OtpInput value={code} onChange={setCode} onComplete={verify} invalid={Boolean(error)} autoFocus label={t('login.otpTitle')} />
                  </div>
                  {errorText && <p className="mt-2 text-[13px] font-semibold text-danger">{errorText}</p>}
                  <button disabled={code.length !== 6 || pending} className={cx(ui.btn, ui.brand, 'mt-5 h-14 w-full text-[16px]')}>
                    {pending ? <LoaderCircle className="h-5 w-5 animate-spin" /> : null}
                    {pending ? t('login.verifying') : t('login.verify')}
                  </button>
                  <div className="mt-4 text-center text-[13px]">
                    {resendIn > 0 ? (
                      <span className="text-muted">{t('login.resendIn', { s: resendIn })}</span>
                    ) : (
                      <button type="button" disabled={pending} onClick={sendOtp} className="font-bold text-brand-ink hover:underline">
                        {t('login.resend')}
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>

            <ul className="mt-6 space-y-2.5 text-[14px] text-ink-2">
              {[
                { Icon: BadgeCheck, key: 'login.trust1' as const },
                { Icon: IndianRupee, key: 'login.trust2' as const },
                { Icon: ShieldCheck, key: 'login.trust3' as const },
              ].map(({ Icon, key }) => (
                <li key={key} className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-success-soft text-success">
                    <Icon className="h-4 w-4" />
                  </span>
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-center text-[12px] text-muted">
            {t('login.agree')}{' '}
            <Link href="/legal/terms" className="font-semibold text-ink underline-offset-2 hover:underline">
              {t('legal.terms')}
            </Link>{' '}
            {t('login.and')}{' '}
            <Link href="/legal/privacy" className="font-semibold text-ink underline-offset-2 hover:underline">
              {t('legal.privacy')}
            </Link>
          </p>
        </section>
      </div>
    </I18nProvider>
  )
}
