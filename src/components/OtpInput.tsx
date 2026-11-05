'use client'

import { useRef } from 'react'
import { cx } from './ui'

/** One real input (so paste and SMS autofill work) drawn as six boxes. */
export function OtpInput({
  value,
  onChange,
  onComplete,
  invalid,
  autoFocus,
  label,
}: {
  value: string
  onChange: (v: string) => void
  onComplete?: (v: string) => void
  invalid?: boolean
  autoFocus?: boolean
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, '').slice(0, 6)
          onChange(next)
          if (next.length === 6) onComplete?.(next)
        }}
        className="peer absolute inset-0 h-full w-full cursor-text opacity-0"
      />
      <div className="pointer-events-none grid grid-cols-6 gap-2">
        {Array.from({ length: 6 }, (_, i) => {
          const char = value[i]
          const isCaret = i === Math.min(value.length, 5)
          return (
            <span
              key={i}
              className={cx(
                'grid h-14 place-items-center rounded-2xl bg-surface font-mono text-[24px] font-bold ring-1 transition',
                invalid ? 'ring-danger' : char ? 'ring-ink' : 'ring-line',
                isCaret && 'peer-focus:ring-2 peer-focus:ring-brand',
              )}
            >
              {char ?? ''}
            </span>
          )
        })}
      </div>
    </div>
  )
}
