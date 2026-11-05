import type { Metadata } from 'next'
import { Gift, Timer, Wallet } from 'lucide-react'
import { CopyButton } from '@/components/CopyButton'
import { PageHeader } from '@/components/PageHeader'
import { ui } from '@/components/ui'
import { getBusinessConfig } from '@/lib/catalog'
import { formatINR } from '@/lib/money'
import { getAppContext } from '@/lib/session'
import { ShareButton } from './ShareButton'

export const metadata: Metadata = { title: 'dwaar Cash' }

export default async function WalletPage() {
  const { user, t } = await getAppContext()
  const config = await getBusinessConfig()
  const rewards = config.rewards ?? {}
  const code = user.referralCode ?? ''

  return (
    <div className={ui.narrow}>
      <PageHeader title={t('wallet.title')} back="/account" />
      <section className="relative overflow-hidden rounded-[30px] bg-night p-6 text-white">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-success/30 blur-3xl" />
        <p className="relative flex items-center gap-2 text-[13px] font-semibold text-white/70">
          <Wallet className="h-4 w-4" />
          {t('wallet.balance')}
        </p>
        <p className="relative mt-2 font-display text-[48px] font-extrabold leading-none">{formatINR(user.walletPaise ?? 0)}</p>
        <p className="relative mt-3 text-[13px] text-white/65">{t('wallet.balanceNote')}</p>
      </section>

      <section className={`${ui.card} mt-4 p-5`}>
        <p className="text-[15px] font-bold">{t('wallet.earn')}</p>
        <ul className="mt-3 space-y-3">
          <li className="flex items-center gap-3 text-[14px]">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand-ink">
              <Gift className="h-4 w-4" />
            </span>
            {t('wallet.earnRefer', { amount: formatINR(rewards.referralRewardPaise ?? 10000) })}
          </li>
          <li className="flex items-center gap-3 text-[14px]">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-success-soft text-success">
              <Timer className="h-4 w-4" />
            </span>
            {t('wallet.earnSla', { amount: formatINR(rewards.slaCreditPaise ?? 10000) })}
          </li>
        </ul>
      </section>

      {code && (
        <section className="mt-4 rounded-3xl bg-brand p-5 text-white shadow-float">
          <p className="font-display text-[22px] font-bold">{t('wallet.refer')}</p>
          <p className="mt-1 text-[14px] text-white/85">{t('home.referBody')}</p>
          <p className="mt-5 text-[12px] font-bold uppercase tracking-wider text-white/70">{t('wallet.code')}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-2xl border-2 border-dashed border-white/50 px-4 py-2 font-mono text-[22px] font-bold tracking-[0.2em]">{code}</span>
            <CopyButton value={code} className="bg-white text-ink ring-0" />
            <ShareButton text={t('wallet.shareText', { code })} label={t('common.share')} />
          </div>
        </section>
      )}
    </div>
  )
}
