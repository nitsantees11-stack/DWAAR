'use server'

import { z } from 'zod'
import { fail, type ActionResult } from '@/lib/action-result'
import { isSupabase } from '@/lib/backend'
import { asAction, sb } from '@/lib/sb'
import { appAuth, getCurrentUser, setLangCookie } from '@/lib/app-auth'
import { isLang, type Lang } from '@/lib/i18n'
import { derivedPassword, normalizePhone, randomCode } from '@/lib/otp'
import { checkOtp, issueOtp } from '@/lib/otp-flow'
import { getPayloadClient } from '@/lib/payload'

export async function requestLoginOtp(input: { phone: string }) {
  const phone = normalizePhone(input?.phone)
  if (!phone) return fail('phone', undefined, 'phone')
  if (isSupabase()) {
    const r = await sb('/c/auth/otp/start', { body: { phone }, auth: false })
    return asAction(r, (x) => ({ challengeId: String(x.challengeId), demoCode: (x.demoCode as string | null) ?? null, resendInSec: Number(x.resendInSec ?? 30) }))
  }
  try {
    return await issueOtp(phone, 'login')
  } catch {
    return fail('generic')
  }
}

const verifySchema = z.object({
  challengeId: z.string().min(1).max(64),
  phone: z.string().max(20),
  code: z.string().max(10),
  lang: z.string().optional(),
})

export async function verifyLoginOtp(
  input: z.infer<typeof verifySchema>,
): Promise<ActionResult<{ needsOnboarding: boolean; lang: Lang }>> {
  const parsed = verifySchema.safeParse(input)
  if (!parsed.success) return fail('invalid')
  const phone = normalizePhone(parsed.data.phone)
  if (!phone) return fail('phone')

  if (isSupabase()) {
    const r = await sb<{ token: string; lang: string; needsOnboarding: boolean }>('/c/auth/otp/verify', {
      body: { challengeId: parsed.data.challengeId, phone, code: parsed.data.code.trim(), lang: parsed.data.lang },
      auth: false,
    })
    if (!r.ok) return asAction(r, () => ({ needsOnboarding: false, lang: 'hinglish' as Lang }))
    const lang: Lang = isLang(r.lang) ? (r.lang as Lang) : 'hinglish'
    await appAuth.setSession(String(r.token))
    await setLangCookie(lang)
    return { ok: true, needsOnboarding: Boolean(r.needsOnboarding), lang }
  }

  try {
    const checked = await checkOtp(parsed.data.challengeId, phone, 'login', parsed.data.code.trim())
    if (!checked.ok) return checked

    const payload = await getPayloadClient()
    const password = derivedPassword(payload.secret, phone)
    // Identity sync runs before any app user exists, so it is the one place that bypasses access.
    const existing = await payload.find({
      collection: 'users',
      overrideAccess: true,
      depth: 0,
      limit: 1,
      where: { username: { equals: phone } },
    })
    let user = existing.docs[0]
    if (user?.accountStatus === 'deleted') return fail('account_deleted')
    if (!user) {
      const chosen = isLang(parsed.data.lang) ? parsed.data.lang : 'hinglish'
      user = await payload.create({
        collection: 'users',
        overrideAccess: true,
        data: {
          username: phone,
          password,
          language: chosen,
          onboarded: false,
          referralCode: `DW${randomCode(6)}`,
        },
      })
    }

    let token: string | undefined
    try {
      token = (await payload.login({ collection: 'users', overrideAccess: true, data: { username: phone, password } })).token
    } catch {
      // The derived password changes only if the platform secret rotates: re-key once, then retry.
      await payload.update({ collection: 'users', id: user.id, overrideAccess: true, data: { password } })
      token = (await payload.login({ collection: 'users', overrideAccess: true, data: { username: phone, password } })).token
    }
    if (!token) return fail('generic')

    await appAuth.setSession(token)
    const lang = isLang(user.language) ? user.language : 'hinglish'
    await setLangCookie(lang)
    return { ok: true, needsOnboarding: !user.onboarded || !user.name, lang }
  } catch {
    return fail('generic')
  }
}

const onboardingSchema = z.object({
  name: z.string().trim().min(2).max(60),
  language: z.enum(['hinglish', 'en', 'hi']),
})

export async function completeOnboarding(input: z.infer<typeof onboardingSchema>): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return fail('auth')
  const parsed = onboardingSchema.safeParse(input)
  if (!parsed.success) return fail('name', undefined, 'name')
  if (isSupabase()) {
    const r = await sb('/c/onboarding', { body: parsed.data })
    if (r.ok) await setLangCookie(parsed.data.language)
    return asAction(r, () => ({}))
  }
  const payload = await getPayloadClient()
  await payload.update({
    collection: 'users',
    id: user.id,
    overrideAccess: false,
    user,
    data: { name: parsed.data.name, language: parsed.data.language, onboarded: true },
  })
  await setLangCookie(parsed.data.language)
  return { ok: true }
}

export async function logout(): Promise<ActionResult> {
  if (isSupabase()) await sb('/c/auth/logout', { method: 'POST', body: {} })
  await appAuth.clearSession()
  return { ok: true }
}
