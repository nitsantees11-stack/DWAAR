import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import type { User } from '@/payload-types'
import { DEFAULT_LANG, LANG_COOKIE, isLang, type Lang } from '@/lib/i18n'
import { isSupabase } from './backend'
import { getPayloadClient } from './payload'
import { SB_SESSION_COOKIE, sb } from './sb'

export const APP_SESSION_COOKIE = 'app-session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30

/**
 * SameSite=None + Partitioned lets the session survive inside the Make preview iframe
 * while still being a normal first-party cookie on the published site.
 */
export const CROSS_SITE_COOKIE = {
  secure: true,
  sameSite: 'none' as const,
  partitioned: true,
  path: '/',
}

/**
 * App-user auth for the published app. Payload backend: the dedicated `app-session` cookie,
 * validated against the given collection, so a CMS admin session can never leak in. Supabase
 * backend: the `dwaar-session` cookie, resolved by the function's /c/me.
 */
export function createAppAuth(collection: 'users') {
  const getUser = cache(async (): Promise<User | null> => {
    if (isSupabase()) {
      const session = (await cookies()).get(SB_SESSION_COOKIE)?.value
      if (!session) return null
      const res = await sb<{ user: User }>('/c/me', { session })
      return res.ok ? (res as { user: User }).user : null
    }
    const token = (await cookies()).get(APP_SESSION_COOKIE)?.value
    if (!token) return null
    try {
      const payload = await getPayloadClient()
      const authHeaders = new Headers({ Authorization: `JWT ${token}` })
      const { user } = await payload.auth({ headers: authHeaders })
      if (!user || user.collection !== collection) return null
      const appUser = user as unknown as User
      if (appUser.accountStatus === 'deleted') return null
      return appUser
    } catch {
      return null
    }
  })

  return {
    getUser,
    async setSession(token: string) {
      const store = await cookies()
      store.set(isSupabase() ? SB_SESSION_COOKIE : APP_SESSION_COOKIE, token, {
        ...CROSS_SITE_COOKIE,
        httpOnly: true,
        maxAge: SESSION_MAX_AGE,
      })
    },
    async clearSession() {
      const store = await cookies()
      store.set(APP_SESSION_COOKIE, '', { ...CROSS_SITE_COOKIE, httpOnly: true, maxAge: 0 })
      store.set(SB_SESSION_COOKIE, '', { ...CROSS_SITE_COOKIE, httpOnly: true, maxAge: 0 })
    },
  }
}

export const appAuth = createAppAuth('users')
export const getCurrentUser = appAuth.getUser

/** Gate for signed-in screens. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

export async function setLangCookie(lang: Lang) {
  const store = await cookies()
  store.set(LANG_COOKIE, lang, { ...CROSS_SITE_COOKIE, maxAge: 60 * 60 * 24 * 365 })
}

export function langOf(user: Pick<User, 'language'> | null | undefined): Lang {
  return isLang(user?.language) ? user.language : DEFAULT_LANG
}
