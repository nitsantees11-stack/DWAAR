'use client'

import { Check } from 'lucide-react'
import { LANGS, translate, type Lang } from '@/lib/i18n'
import { cx } from './ui'

/** Each option is labelled in its own language so anyone can find theirs. */
export function LanguageChoice({
  value,
  onChange,
  variant = 'cards',
  disabled,
}: {
  value: Lang
  onChange: (lang: Lang) => void
  variant?: 'cards' | 'pills'
  disabled?: boolean
}) {
  if (variant === 'pills') {
    return (
      <div role="radiogroup" className="inline-flex rounded-full bg-line-2 p-1">
        {LANGS.map((lang) => (
          <button
            key={lang}
            type="button"
            role="radio"
            aria-checked={value === lang}
            disabled={disabled}
            onClick={() => onChange(lang)}
            className={cx(
              'rounded-full px-3 py-1.5 text-[13px] font-bold transition',
              value === lang ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
            )}
          >
            {translate(lang, `lang.${lang}`)}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div role="radiogroup" className="grid gap-2">
      {LANGS.map((lang) => {
        const on = value === lang
        return (
          <button
            key={lang}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(lang)}
            className={cx(
              'flex items-center gap-4 rounded-2xl bg-surface p-4 text-left ring-1 transition disabled:opacity-60',
              on ? 'ring-2 ring-ink' : 'ring-line hover:ring-ink/30',
            )}
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-line-2 font-display text-[16px] font-bold">
              {lang === 'hi' ? 'अ' : lang === 'en' ? 'Aa' : 'Hi'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold">{translate(lang, `lang.${lang}`)}</span>
              <span className="block truncate text-[13px] text-muted">{translate(lang, `lang.${lang}.sample`)}</span>
            </span>
            <span className={cx('grid h-6 w-6 place-items-center rounded-full', on ? 'bg-ink text-white' : 'ring-1 ring-line')}>
              {on && <Check className="h-3.5 w-3.5" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}
