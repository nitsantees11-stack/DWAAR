import type { Metadata } from 'next'
import { TicketPercent } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { OfferCard } from '@/components/OfferCard'
import { PageHeader } from '@/components/PageHeader'
import { ui } from '@/components/ui'
import { getCategories, getPromotions, livePromotions } from '@/lib/catalog'
import { relId } from '@/lib/media'
import { getAppContext } from '@/lib/session'

export const metadata: Metadata = { title: 'Offers' }

export default async function OffersPage() {
  const { t, locale } = await getAppContext()
  const [promotions, categories] = await Promise.all([getPromotions(), getCategories()])
  const offers = livePromotions(promotions)
  const byId = new Map(categories.map((c) => [c.id, c]))

  return (
    <div className={ui.section}>
      <PageHeader title={t('offers.title')} subtitle={t('offers.subtitle')} />
      {offers.length === 0 ? (
        <EmptyState Icon={TicketPercent} title={t('offers.empty')} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {offers.map((p) => (
            <OfferCard key={p.id} promo={p} category={byId.get(relId(p.category) ?? '') ?? null} t={t} locale={locale} />
          ))}
        </div>
      )}
    </div>
  )
}
