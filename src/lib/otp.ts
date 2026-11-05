import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export const OTP_TTL_MS = 5 * 60 * 1000
export const OTP_RESEND_MS = 30 * 1000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_MAX_PER_HOUR = 6

/** Indian mobile numbers: 10 digits starting 6–9. Accepts +91 / 0 prefixes and spaces. */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null
  let digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

export function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashOtp(secret: string, phone: string, purpose: string, code: string) {
  return createHmac('sha256', secret).update(`otp:${purpose}:${phone}:${code}`).digest('hex')
}

export function otpMatches(expectedHex: string, actualHex: string) {
  const a = Buffer.from(expectedHex, 'hex')
  const b = Buffer.from(actualHex, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Payload's local strategy needs a password. Phone users never see or type one: it is
 * derived server-side from the Payload secret, and only issued after OTP verification.
 */
export function derivedPassword(secret: string, phone: string) {
  return createHmac('sha256', secret).update(`dwaar-login:${phone}`).digest('base64url')
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function randomCode(length: number) {
  const bytes = randomBytes(length)
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

/**
 * Where an OTP would be sent. No SMS provider is configured yet, so the code is returned
 * to the caller and shown in-app (demo mode). Swap this for a gateway call in production.
 */
export async function deliverOtp(_phone: string, code: string): Promise<{ demoCode: string | null }> {
  return { demoCode: code }
}
