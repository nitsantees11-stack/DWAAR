import { intlLocale, makeT } from '@/lib/i18n'
import { langOf, requireUser } from './app-auth'

/** Signed-in user plus their language helpers, for server components. */
export async function getAppContext() {
  const user = await requireUser()
  const lang = langOf(user)
  return { user, lang, t: makeT(lang), locale: intlLocale(lang) }
}
