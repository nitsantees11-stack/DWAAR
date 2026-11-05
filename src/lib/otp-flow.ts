import { fail, type ActionResult } from './action-result'
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_HOUR,
  OTP_RESEND_MS,
  OTP_TTL_MS,
  deliverOtp,
  generateOtp,
  hashOtp,
  otpMatches,
} from './otp'
import { getPayloadClient } from './payload'

export type OtpPurpose = 'login' | 'alt_whatsapp' | 'partner_login'

/**
 * Issues a hashed, short-lived OTP challenge. OTP challenges are system records (admin-only
 * access), so trusted server code is the only writer and runs with overrideAccess.
 */
export async function issueOtp(
  phone: string,
  purpose: OtpPurpose,
  ownerId?: string,
): Promise<ActionResult<{ challengeId: string; demoCode: string | null; resendInSec: number }>> {
  const payload = await getPayloadClient()
  const now = Date.now()
  const recent = await payload.find({
    collection: 'otp-challenges',
    overrideAccess: true,
    depth: 0,
    limit: OTP_MAX_PER_HOUR,
    sort: '-createdAt',
    where: {
      and: [
        { phone: { equals: phone } },
        { purpose: { equals: purpose } },
        { createdAt: { greater_than: new Date(now - 60 * 60 * 1000).toISOString() } },
      ],
    },
  })
  const last = recent.docs[0]
  if (last) {
    const wait = OTP_RESEND_MS - (now - new Date(last.createdAt).getTime())
    if (wait > 0) return fail('otp_wait', { s: Math.ceil(wait / 1000) })
  }
  if (recent.totalDocs >= OTP_MAX_PER_HOUR) return fail('otp_limit')

  const code = generateOtp()
  const challenge = await payload.create({
    collection: 'otp-challenges',
    overrideAccess: true,
    data: {
      phone,
      purpose,
      codeHash: hashOtp(payload.secret, phone, purpose, code),
      attempts: 0,
      consumed: false,
      expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
      owner: ownerId,
    },
  })
  const { demoCode } = await deliverOtp(phone, code)
  return { ok: true, challengeId: challenge.id, demoCode, resendInSec: OTP_RESEND_MS / 1000 }
}

/** Checks a challenge and consumes it on success. Wrong codes burn an attempt. */
export async function checkOtp(
  challengeId: string,
  phone: string,
  purpose: OtpPurpose,
  code: string,
  ownerId?: string,
): Promise<ActionResult> {
  const payload = await getPayloadClient()
  const { docs } = await payload.find({
    collection: 'otp-challenges',
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: { id: { equals: challengeId } },
  })
  const challenge = docs[0]
  const owner = typeof challenge?.owner === 'object' ? challenge?.owner?.id : challenge?.owner
  if (!challenge || challenge.phone !== phone || challenge.purpose !== purpose || challenge.consumed) {
    return fail('otp_expired')
  }
  if (ownerId && owner !== ownerId) return fail('otp_expired')
  if (new Date(challenge.expiresAt).getTime() < Date.now()) return fail('otp_expired')
  const attempts = challenge.attempts ?? 0
  if (attempts >= OTP_MAX_ATTEMPTS) return fail('otp_locked')

  const matches = /^\d{6}$/.test(code) && otpMatches(challenge.codeHash, hashOtp(payload.secret, phone, purpose, code))
  if (!matches) {
    await payload.update({
      collection: 'otp-challenges',
      id: challenge.id,
      overrideAccess: true,
      data: { attempts: attempts + 1 },
    })
    const left = OTP_MAX_ATTEMPTS - attempts - 1
    return left > 0 ? fail('otp_wrong', { left }) : fail('otp_locked')
  }
  await payload.update({
    collection: 'otp-challenges',
    id: challenge.id,
    overrideAccess: true,
    data: { consumed: true },
  })
  return { ok: true }
}
