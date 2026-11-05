import { en } from './en'
import { hi } from './hi'
import { hinglish, type DictKey } from './hinglish'

export type { DictKey }
export const LANGS = ['hinglish', 'en', 'hi'] as const
export type Lang = (typeof LANGS)[number]
export const DEFAULT_LANG: Lang = 'hinglish'

/** Mirrors the user's saved language so pre-login screens can render in it too. */
export const LANG_COOKIE = 'dwaar-lang'

const dictionaries: Record<Lang, Record<DictKey, string>> = { hinglish, en, hi }

export type TParams = Record<string, string | number>
export type TFunction = (key: DictKey, params?: TParams) => string

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value)
}

export function translate(lang: Lang, key: DictKey, params?: TParams) {
  const template = dictionaries[lang]?.[key] ?? hinglish[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] === undefined ? `{${name}}` : String(params[name]),
  )
}

export function makeT(lang: Lang): TFunction {
  return (key, params) => translate(lang, key, params)
}

/** BCP-47 tag for `<html lang>` and Intl formatting. */
export function intlLocale(lang: Lang) {
  return lang === 'hi' ? 'hi-IN' : 'en-IN'
}

/** Server action error codes map to `err.<code>` dictionary keys. */
export function errorKey(code: string): DictKey {
  const key = `err.${code}` as DictKey
  return key in hinglish ? key : 'err.generic'
}
