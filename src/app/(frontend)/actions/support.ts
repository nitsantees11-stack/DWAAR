'use server'

import { z } from 'zod'
import { fail, type ActionResult } from '@/lib/action-result'
import { isSupabase } from '@/lib/backend'
import { asAction, sb } from '@/lib/sb'
import { getCurrentUser } from '@/lib/app-auth'
import { getPayloadClient } from '@/lib/payload'

const ticketSchema = z.object({
  topic: z.enum(['booking', 'payment', 'warranty', 'account', 'other']),
  message: z.string().trim().min(10).max(1000),
  bookingId: z.string().max(64).optional().or(z.literal('')),
  warrantyId: z.string().max(64).optional().or(z.literal('')),
})

export async function createTicket(input: z.infer<typeof ticketSchema>): Promise<ActionResult<{ code: string }>> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  const parsed = ticketSchema.safeParse(input)
  if (!parsed.success) return fail('invalid', undefined, String(parsed.error.issues[0]?.path[0] ?? ''))
  if (isSupabase()) return asAction(await sb('/c/tickets', { body: parsed.data }), (x) => ({ code: String(x.code ?? '') }))
  const payload = await getPayloadClient()
  const { topic, message, bookingId, warrantyId } = parsed.data

  // Related records must belong to this customer; the read rules enforce ownership.
  try {
    if (bookingId) await payload.findByID({ collection: 'bookings', id: bookingId, overrideAccess: false, user, depth: 0 })
    if (warrantyId) await payload.findByID({ collection: 'warranties', id: warrantyId, overrideAccess: false, user, depth: 0 })
  } catch {
    return fail('not_found')
  }

  try {
    const ticket = await payload.create({
      collection: 'support-tickets',
      overrideAccess: false,
      user,
      data: {
        user: user.id,
        topic,
        message,
        booking: bookingId || undefined,
        warranty: warrantyId || undefined,
      },
    })
    return { ok: true, code: ticket.ticketCode ?? '' }
  } catch {
    return fail('generic')
  }
}
