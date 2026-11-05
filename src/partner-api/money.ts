import { z } from 'zod'
import type { BusinessConfig, Payout } from '@/payload-types'
import { appendLedger, partnerBalances } from '../lib/partner/ledger'
import { fail, route } from './http'

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

function nextPayoutDate(day: string | null | undefined) {
  const target = DAYS.indexOf(day ?? 'mon')
  const d = new Date()
  const diff = (target - d.getUTCDay() + 7) % 7 || 7
  d.setUTCDate(d.getUTCDate() + diff)
  d.setUTCHours(4, 30, 0, 0) // 10:00 IST
  return d.toISOString()
}

const isoDate = z.iso.datetime({ offset: true }).or(z.iso.date())

export const moneyEndpoints = [
  route('get', 'earnings', {}, async ({ req, partner, query }) => {
    const from = query.get('from')
    const to = query.get('to')
    if ((from && !isoDate.safeParse(from).success) || (to && !isoDate.safeParse(to).success)) throw fail(400, 'invalid_range', 'from')
    const range = [
      ...(from ? [{ createdAt: { greater_than_equal: new Date(from).toISOString() } }] : []),
      ...(to ? [{ createdAt: { less_than_equal: new Date(to).toISOString() } }] : []),
    ]
    const { docs } = await req.payload.find({
      collection: 'earnings-ledger',
      overrideAccess: true,
      depth: 0,
      pagination: false,
      select: { type: true, amountPaise: true, booking: true },
      where: { and: [{ partner: { equals: partner.id } }, ...range] },
    })
    const byType: Record<string, number> = {}
    const jobs = new Set<string>()
    for (const e of docs) {
      byType[e.type] = (byType[e.type] ?? 0) + (e.amountPaise ?? 0)
      if (e.type === 'job_earning' && e.booking) jobs.add(String(typeof e.booking === 'object' ? e.booking.id : e.booking))
    }
    const config = (await req.payload.findGlobal({ slug: 'business-config', overrideAccess: true, depth: 0 })) as BusinessConfig
    return {
      body: {
        from: from ? new Date(from).toISOString() : null,
        to: to ? new Date(to).toISOString() : null,
        jobsCount: jobs.size,
        byTypePaise: byType,
        periodEarningsPaise: ['job_earning', 'visit_share', 'parts_reimbursement', 'incentive', 'penalty', 'adjustment'].reduce((s, t) => s + (byType[t] ?? 0), 0),
        balances: await partnerBalances(req.payload, partner.id),
        payoutDay: config.partnerPay?.payoutDay ?? 'mon',
        nextPayoutAt: nextPayoutDate(config.partnerPay?.payoutDay),
      },
    }
  }),

  route('get', 'ledger', {}, async ({ req, partner, query }) => {
    const page = Math.max(1, Number(query.get('page') ?? 1) || 1)
    const limit = Math.min(100, Math.max(1, Number(query.get('limit') ?? 30) || 30))
    const res = await req.payload.find({
      collection: 'earnings-ledger',
      overrideAccess: false,
      user: { ...partner, collection: 'partners' },
      context: { partnerApi: true },
      depth: 0,
      page,
      limit,
      sort: '-createdAt',
    })
    return {
      body: {
        entries: res.docs.map((e) => ({
          id: e.id,
          type: e.type,
          amountPaise: e.amountPaise,
          note: e.note ?? null,
          bookingId: e.booking ? String(typeof e.booking === 'object' ? e.booking.id : e.booking) : null,
          createdAt: e.createdAt,
        })),
        page: res.page,
        totalPages: res.totalPages,
        totalEntries: res.totalDocs,
      },
    }
  }),

  route('get', 'payouts', {}, async ({ req, partner }) => {
    const res = await req.payload.find({
      collection: 'payouts',
      overrideAccess: false,
      user: { ...partner, collection: 'partners' },
      context: { partnerApi: true },
      depth: 0,
      limit: 50,
      sort: '-createdAt',
    })
    return {
      body: {
        payouts: (res.docs as Payout[]).map((p) => ({
          id: p.id,
          amountPaise: p.amountPaise,
          status: p.status,
          reference: p.reference ?? null,
          periodStart: p.periodStart ?? null,
          periodEnd: p.periodEnd ?? null,
          createdAt: p.createdAt,
        })),
        balances: await partnerBalances(req.payload, partner.id),
      },
    }
  }),

  route('post', 'payouts/request', { body: z.object({ idempotencyKey: z.string() }) }, async ({ req, partner }) => {
    if (partner.verificationStatus !== 'approved') throw fail(403, 'not_approved')
    if (!partner.bank?.upiId && !(partner.bank?.accountLast4 && partner.bank?.ifsc)) throw fail(409, 'bank_missing', 'bank')
    const { docs: recent } = await req.payload.find({
      collection: 'payouts',
      overrideAccess: true,
      depth: 0,
      limit: 1,
      sort: '-createdAt',
      where: { partner: { equals: partner.id } },
    })
    const last = recent[0] as Payout | undefined
    if (last && (last.status === 'requested' || last.status === 'processing')) throw fail(409, 'payout_pending')
    if (last && last.status !== 'failed' && Date.now() - new Date(last.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000) {
      throw fail(409, 'payout_weekly_limit', undefined, { nextAt: new Date(new Date(last.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() })
    }
    const balances = await partnerBalances(req.payload, partner.id)
    if (balances.payablePaise <= 0) throw fail(409, 'nothing_to_pay', undefined, { cashInHandPaise: balances.cashInHandPaise })
    const now = new Date().toISOString()
    const payout = (await req.payload.create({
      collection: 'payouts',
      overrideAccess: true,
      data: { partner: partner.id, amountPaise: balances.payablePaise, status: 'requested', periodStart: last?.periodEnd ?? partner.createdAt, periodEnd: now },
    })) as Payout
    // Reserve the amount in the ledger right away so it cannot be requested twice.
    await appendLedger(req.payload, { partner: partner.id, type: 'payout', amountPaise: -payout.amountPaise, note: 'Payout requested', entryKey: `payout:${payout.id}`, payout: payout.id })
    return { status: 201, body: { payout: { id: payout.id, amountPaise: payout.amountPaise, status: payout.status, periodStart: payout.periodStart, periodEnd: payout.periodEnd } } }
  }),
]
