import { createClient } from 'jsr:@supabase/supabase-js@2.49.8'
import { DomainError, newId, raw } from './db.tsx'

/**
 * Phone OTP + sessions for customers and partners.
 *
 * - OTP codes are HMAC-hashed, live 5 minutes, allow 5 tries, 30 s resend and 6 per hour.
 * - A correct code gives an opaque session token (customers 30 days, partners 7 days). Only its
 *   SHA-256 is stored, under dw:sess:<hash>. Logout deletes it.
 * - Every account is also mirrored as a Supabase Auth user (same id), so customers and partners
 *   are visible under Authentication in the Supabase dashboard.
 * - No SMS gateway is configured yet, so the code is returned to the caller (demo mode), exactly
 *   as the Payload app did.
 */
export const OTP_TTL_MS = 5 * 60 * 1000
export const OTP_RESEND_MS = 30 * 1000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_MAX_PER_HOUR = 6
export const CUSTOMER_SESSION_MS = 30 * 24 * 60 * 60 * 1000
export const PARTNER_SESSION_MS = 7 * 24 * 60 * 60 * 1000

export type OtpPurpose = 'login' | 'alt_whatsapp' | 'partner_login'
export type SessionKind = 'user' | 'partner'

/** Indian mobile numbers: 10 digits starting 6–9. Accepts +91 / 0 prefixes and spaces. */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null
  let digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

const enc = new TextEncoder()
let hmacKey: Promise<CryptoKey> | null = null
function key() {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret) throw new Error('missing env SUPABASE_SERVICE_ROLE_KEY')
  hmacKey ??= crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hmacKey
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function hmacHex(message: string) {
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', await key(), enc.encode(message))))
}
export async function sha256Hex(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))))
}

function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Uniform random integer in [min, max). */
export function randomInt(min: number, max: number) {
  const range = max - min
  const limit = Math.floor(4_294_967_296 / range) * range
  const buf = new Uint32Array(1)
  do crypto.getRandomValues(buf)
  while (buf[0] >= limit)
  return min + (buf[0] % range)
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function randomCode(length: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

/* ---------------------------------------------------------------------- OTP */

type Challenge = { phone: string; purpose: OtpPurpose; codeHash: string; attempts: number; expiresAt: number; owner?: string | null }
type RateState = { sent: number[]; challenges: string[] }
const otpKey = (id: string) => `dw:otp:${id}`
const rateKey = (purpose: string, phone: string) => `dw:otprate:${purpose}:${phone}`
const otpHash = (purpose: string, phone: string, code: string) => hmacHex(`otp:${purpose}:${phone}:${code}`)

export async function issueOtp(phone: string, purpose: OtpPurpose, owner?: string) {
  const now = Date.now()
  const rk = rateKey(purpose, phone)
  const rate = ((await raw.get(rk)) as RateState | undefined) ?? { sent: [], challenges: [] }
  const sent = rate.sent.filter((t) => now - t < 60 * 60 * 1000)
  const last = sent[sent.length - 1]
  if (last && now - last < OTP_RESEND_MS) throw new DomainError('otp_wait', 429, { params: { s: Math.ceil((OTP_RESEND_MS - (now - last)) / 1000) } })
  if (sent.length >= OTP_MAX_PER_HOUR) throw new DomainError('otp_limit', 429)
  // A new code replaces every older one for this phone and purpose.
  if (rate.challenges.length) await raw.mdel(rate.challenges.map(otpKey))
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const challengeId = newId()
  const challenge: Challenge = { phone, purpose, codeHash: await otpHash(purpose, phone, code), attempts: 0, expiresAt: now + OTP_TTL_MS, owner: owner ?? null }
  await raw.set(otpKey(challengeId), challenge)
  await raw.set(rk, { sent: [...sent, now], challenges: [challengeId] })
  return { challengeId, resendInSec: OTP_RESEND_MS / 1000, expiresInSec: OTP_TTL_MS / 1000, demoCode: code as string | null }
}

/** Checks a challenge and consumes it on success. Wrong codes burn an attempt. */
export async function checkOtp(challengeId: unknown, phone: string, purpose: OtpPurpose, code: unknown, owner?: string) {
  if (typeof challengeId !== 'string' || !/^[0-9a-f-]{36}$/.test(challengeId)) throw new DomainError('otp_expired', 400, { field: 'code' })
  const k = otpKey(challengeId)
  const challenge = (await raw.get(k)) as Challenge | undefined
  if (!challenge || challenge.phone !== phone || challenge.purpose !== purpose) throw new DomainError('otp_expired', 400, { field: 'code' })
  if ((challenge.owner ?? undefined) !== owner) throw new DomainError('otp_expired', 400, { field: 'code' })
  if (challenge.expiresAt < Date.now()) {
    await raw.del(k)
    throw new DomainError('otp_expired', 400, { field: 'code' })
  }
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw new DomainError('otp_locked', 423, { field: 'code' })
  const given = typeof code === 'string' ? code.trim() : ''
  const ok = /^\d{6}$/.test(given) && sameHex(challenge.codeHash, await otpHash(purpose, phone, given))
  if (!ok) {
    const attempts = challenge.attempts + 1
    await raw.set(k, { ...challenge, attempts })
    const left = OTP_MAX_ATTEMPTS - attempts
    if (left > 0) throw new DomainError('otp_wrong', 400, { field: 'code', params: { left } })
    throw new DomainError('otp_locked', 423, { field: 'code' })
  }
  // Consumed before anything is issued, so a code can never be replayed.
  await raw.del(k)
}

/* ----------------------------------------------------------------- sessions */

type Session = { kind: SessionKind; id: string; exp: number }
const sessKey = async (token: string) => `dw:sess:${await sha256Hex(token)}`

export async function createSession(kind: SessionKind, id: string) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const exp = Date.now() + (kind === 'user' ? CUSTOMER_SESSION_MS : PARTNER_SESSION_MS)
  await raw.set(await sessKey(token), { kind, id, exp } satisfies Session)
  return { token, exp: new Date(exp).toISOString() }
}

export async function readSession(token: string | null | undefined, kind: SessionKind): Promise<Session | null> {
  if (!token || token.length < 20 || token.length > 200) return null
  const k = await sessKey(token)
  const s = (await raw.get(k)) as Session | undefined
  if (!s || s.kind !== kind) return null
  if (s.exp <= Date.now()) {
    await raw.del(k)
    return null
  }
  return s
}

export async function endSession(token: string) {
  await raw.del(await sessKey(token))
}

/* ------------------------------------------------------- Supabase Auth mirror */

const adminClient = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

/**
 * Makes sure an Auth user with this id exists. Identity only: sessions are ours. Best effort,
 * a failure here never blocks a login (it is retried on the next one).
 */
export async function mirrorAuthUser(kind: SessionKind, id: string, phone: string) {
  const flag = `dw:authmirror:${id}`
  if (await raw.get(flag)) return
  try {
    const role = kind === 'user' ? 'customer' : 'partner'
    const { error } = await adminClient().auth.admin.createUser({
      id,
      email: `${phone}@${kind === 'user' ? 'phone' : 'partner'}.dwaar.in`,
      email_confirm: true,
      user_metadata: { phone },
      app_metadata: { role, phone },
    } as Parameters<ReturnType<typeof adminClient>['auth']['admin']['createUser']>[0])
    if (!error || /already|exists|registered/i.test(error.message)) await raw.set(flag, true)
    else console.error('auth mirror failed', error.message)
  } catch (err) {
    console.error('auth mirror failed', err)
  }
}
