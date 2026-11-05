import { logoutOperation } from 'payload'
import { z } from 'zod'
import type { Partner } from '@/payload-types'
import { derivedPassword, normalizePhone } from '../lib/otp'
import { checkOtp, issueOtp } from '../lib/otp-flow'
import { fail, route } from './http'
import { partnerDTO } from './dto'

/** Partner passwords are derived on a separate namespace from customer ones. */
const partnerPassword = (secret: string, phone: string) => derivedPassword(secret, `partner:${phone}`)

function otpError(code: string, params?: Record<string, string | number>) {
  const status = code === 'otp_wait' || code === 'otp_limit' ? 429 : code === 'otp_locked' ? 423 : 400
  return fail(status, code, 'code', params)
}

export const authEndpoints = [
  route('post', 'auth/otp/request', { auth: false, body: z.object({ phone: z.string().max(20), idempotencyKey: z.string() }) }, async ({ body }) => {
    const phone = normalizePhone(body.phone)
    if (!phone) throw fail(400, 'invalid_phone', 'phone')
    const res = await issueOtp(phone, 'partner_login')
    if (!res.ok) throw otpError(res.error, res.params)
    return { body: { challengeId: res.challengeId, resendInSec: res.resendInSec, expiresInSec: 300, demoCode: res.demoCode } }
  }),

  route(
    'post',
    'auth/otp/verify',
    {
      auth: false,
      body: z.object({ challengeId: z.string().min(1).max(64), phone: z.string().max(20), code: z.string().max(10), idempotencyKey: z.string() }),
    },
    async ({ req, body }) => {
      const phone = normalizePhone(body.phone)
      if (!phone) throw fail(400, 'invalid_phone', 'phone')
      const checked = await checkOtp(body.challengeId, phone, 'partner_login', body.code.trim())
      if (!checked.ok) throw otpError(checked.error, checked.params)

      const payload = req.payload
      const password = partnerPassword(payload.secret, phone)
      // Identity sync runs before the partner is authenticated: the one place that bypasses access.
      const existing = await payload.find({ collection: 'partners', overrideAccess: true, depth: 0, limit: 1, where: { username: { equals: phone } } })
      let partner = existing.docs[0] as Partner | undefined
      if (partner?.accountStatus === 'deleted') throw fail(403, 'account_deleted')
      if (!partner) {
        partner = (await payload.create({
          collection: 'partners',
          overrideAccess: true,
          data: { username: phone, password, verificationStatus: 'draft', accountStatus: 'active' },
        })) as Partner
      }
      let result
      try {
        result = await payload.login({ collection: 'partners', overrideAccess: true, data: { username: phone, password } })
      } catch {
        await payload.update({ collection: 'partners', id: partner.id, overrideAccess: true, data: { password } })
        result = await payload.login({ collection: 'partners', overrideAccess: true, data: { username: phone, password } })
      }
      if (!result.token) throw fail(500, 'server_error')
      const fresh = (await payload.findByID({ collection: 'partners', id: partner.id, overrideAccess: true, depth: 1 })) as Partner
      return {
        body: {
          token: result.token,
          exp: result.exp ? new Date(result.exp * 1000).toISOString() : null,
          partner: partnerDTO(fresh),
        },
      }
    },
  ),

  route('post', 'auth/logout', { body: z.object({ idempotencyKey: z.string() }) }, async ({ req, partner, token }) => {
    // Removes this token's session, so it stops working immediately. Partners signed in through
    // the Partner app's headers have no session here; their app ends its own login.
    if (!token) return { body: { loggedOut: true } }
    const authed = await req.payload.auth({ headers: new Headers({ Authorization: `JWT ${token}` }) })
    req.user = authed.user as typeof req.user
    if (req.user && partner) await logoutOperation({ collection: req.payload.collections.partners, req })
    return { body: { loggedOut: true } }
  }),
]
