import type { CollectionAfterChangeHook, Payload, PayloadRequest } from 'payload'
import type { Booking, Partner, User } from '@/payload-types'
import { isAdminReq } from '../access'
import type { BookingStatus, DispatchLeg } from '../lib/booking-machine'
import { dispatchBooking, penalizeRelease, withdrawOpenOffers } from '../lib/partner/dispatch'
import { writeCompletionLedger } from '../lib/partner/ledger'
import { idOf, nowISO, subReq } from '../lib/partner/sys'

const TERMINAL: BookingStatus[] = ['COMPLETED', 'RETURNED', 'CANCELLED']

async function clearCurrentJob(payload: Payload, partnerId: string, bookingId: string, req: PayloadRequest) {
  const p = (await payload.findByID({ collection: 'partners', id: partnerId, overrideAccess: true, depth: 0, req: subReq(req) })) as Partner
  if (idOf(p.currentJob) !== bookingId) return
  await payload.update({ collection: 'partners', id: partnerId, overrideAccess: true, depth: 0, req: subReq(req), data: { currentJob: null } })
}

async function updatePartner(payload: Payload, partnerId: string, req: PayloadRequest, fn: (p: Partner) => Partial<Partner>) {
  const p = (await payload.findByID({ collection: 'partners', id: partnerId, overrideAccess: true, depth: 0, req: subReq(req) })) as Partner
  await payload.update({ collection: 'partners', id: partnerId, overrideAccess: true, depth: 0, req: subReq(req), data: fn(p) })
}

async function safely(payload: Payload, label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (err) {
    payload.logger.error({ err, msg: `booking effect failed: ${label}` })
  }
}

/**
 * Side effects of a booking write, in the same request (and transaction where supported):
 * the append-only event trail, warranty issue, dispatching the next leg, freeing partners whose
 * leg ended, release penalties, the completion ledger, SLA wallet credit and partner ratings.
 */
export const recordEvents: CollectionAfterChangeHook = async ({ doc: resultDoc, previousDoc, operation, req, context }) => {
  if (context.skipBookingEvents) return resultDoc
  const payload = req.payload
  // Writes made with a `select` (e.g. the Payload CLI/API) hand this hook a partial doc.
  const doc = (
    resultDoc.status === undefined || resultDoc.customer === undefined
      ? await payload.findByID({ collection: 'bookings', id: resultDoc.id, depth: 0, overrideAccess: true, req: subReq(req) })
      : resultDoc
  ) as Booking
  const prev = (previousDoc ?? {}) as Partial<Booking>
  const statusChanged = operation === 'create' || prev.status !== doc.status
  const actor: 'customer' | 'hub' | 'system' | 'partner' =
    context.actor === 'customer' ? 'customer' : context.actor === 'partner' ? 'partner' : isAdminReq(req) ? 'hub' : 'system'

  if (statusChanged) {
    await payload.create({
      collection: 'booking-events',
      overrideAccess: true,
      req: subReq(req),
      data: {
        booking: doc.id,
        status: doc.status,
        actor,
        partner: actor === 'partner' ? (context.partnerId as string) : undefined,
        note: typeof context.eventNote === 'string' ? context.eventNote.slice(0, 250) : undefined,
      },
    })
  }

  // Hub manual assign: record it as an accepted offer so history and rider pay stay uniform.
  const manual = context.manualAssign as { partnerId: string; leg: DispatchLeg; round: number } | undefined
  if (manual && !context.manualAssignDone) {
    context.manualAssignDone = true
    await safely(payload, 'manual assign', async () => {
      await withdrawOpenOffers(payload, doc.id, req)
      const at = nowISO()
      await payload.create({
        collection: 'job-offers',
        overrideAccess: true,
        req: subReq(req),
        data: {
          booking: doc.id,
          partner: manual.partnerId,
          leg: manual.leg,
          round: manual.round,
          status: 'accepted',
          manual: true,
          offeredAt: at,
          expiresAt: at,
          respondedAt: at,
          offerKey: `${doc.id}:${manual.leg}:${manual.round}:${manual.partnerId}:manual`,
          acceptLock: `${doc.id}:${manual.leg}:${manual.round}`,
        },
      })
      await updatePartner(payload, manual.partnerId, req, (p) => (idOf(p.currentJob) ? {} : { currentJob: doc.id }))
    })
  }

  if (operation === 'create') {
    if (doc.schedule?.mode === 'asap') await safely(payload, 'dispatch on create', () => dispatchBooking(payload, doc.id, req))
    return resultDoc
  }

  // A partner whose assignment went away (leg ended / released / cancelled) is free again.
  const prevAssigned = idOf(prev.assignedPartner)
  const nowAssigned = idOf(doc.assignedPartner)
  if (prevAssigned && prevAssigned !== nowAssigned) await safely(payload, 'free partner', () => clearCurrentJob(payload, prevAssigned, doc.id, req))
  if (nowAssigned && TERMINAL.includes(doc.status as BookingStatus)) {
    await safely(payload, 'free partner', () => clearCurrentJob(payload, nowAssigned, doc.id, req))
  }

  if (statusChanged) {
    const status = doc.status as BookingStatus
    if (status === 'CANCELLED') await safely(payload, 'withdraw offers', () => withdrawOpenOffers(payload, doc.id, req))
    if (status === 'BOOKED' && typeof context.releasedBy === 'string') {
      const releasedBy = context.releasedBy
      await safely(payload, 'release', async () => {
        await withdrawOpenOffers(payload, doc.id, req)
        const reason = (context.transition as { releaseReason?: string } | undefined)?.releaseReason
        await penalizeRelease(payload, releasedBy, doc, Number(context.releasedRound ?? 0), reason, req)
        await dispatchBooking(payload, doc.id, req)
      })
    }
    if (status === 'AT_HUB' || status === 'OUT_FOR_DELIVERY') {
      await safely(payload, 'dispatch next leg', () => dispatchBooking(payload, doc.id, req))
    }
    if (status === 'COMPLETED') {
      await safely(payload, 'completion ledger', () => writeCompletionLedger(payload, doc, req))
      const worker = doc.flow === 'pickup_drop' ? idOf(doc.hubPartner) : idOf(doc.assignedPartner)
      if (worker) {
        await safely(payload, 'partner stats', () =>
          updatePartner(payload, worker, req, (p) => {
            const stats = p.stats ?? {}
            const done = (stats.jobsCompleted ?? 0) + 1
            const released = stats.jobsReleased ?? 0
            return { stats: { ...stats, jobsCompleted: done }, completionRate: Math.round((done / (done + released)) * 100) }
          }),
        )
      }
    }
  }

  // SLA breach: credit the customer's dwaar Cash once.
  if (doc.slaBreached && !prev.slaBreached && (doc.slaCreditPaise ?? 0) > 0) {
    await safely(payload, 'sla credit', async () => {
      const customerId = idOf(doc.customer) as string
      const user = (await payload.findByID({ collection: 'users', id: customerId, overrideAccess: true, depth: 0, req: subReq(req) })) as User
      await payload.update({
        collection: 'users',
        id: customerId,
        overrideAccess: true,
        depth: 0,
        req: subReq(req),
        data: { walletPaise: (user.walletPaise ?? 0) + (doc.slaCreditPaise ?? 0) },
      })
    })
  }

  // Customer rated the job: roll it into the partner's average.
  if (doc.rating?.stars && !prev.rating?.stars) {
    const rated = new Set([idOf(doc.assignedPartner), idOf(doc.hubPartner)].filter((x): x is string => Boolean(x)))
    for (const pid of rated) {
      await safely(payload, 'partner rating', () =>
        updatePartner(payload, pid, req, (p) => {
          const count = (p.ratingCount ?? 0) + 1
          const avg = ((p.rating ?? 0) * (p.ratingCount ?? 0) + (doc.rating?.stars ?? 0)) / count
          return { rating: Math.round(avg * 100) / 100, ratingCount: count }
        }),
      )
    }
  }

  // Warranty starts when the job completes.
  const warrantyDays = doc.warrantyDays ?? 0
  if (statusChanged && doc.status === 'COMPLETED' && warrantyDays > 0) {
    const existing = await payload.count({ collection: 'warranties', overrideAccess: true, req: subReq(req), where: { booking: { equals: doc.id } } })
    if (existing.totalDocs === 0) {
      const start = new Date()
      const end = new Date(start.getTime() + warrantyDays * 24 * 60 * 60 * 1000)
      await payload.create({
        collection: 'warranties',
        overrideAccess: true,
        req: subReq(req),
        data: {
          booking: doc.id,
          customer: idOf(doc.customer) as string,
          title: doc.title ?? 'Repair',
          deviceLabel: doc.deviceLabel ?? '',
          days: warrantyDays,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          status: 'active',
        },
      })
    }
  }
  return resultDoc
}
