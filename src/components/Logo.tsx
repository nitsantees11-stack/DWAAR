import { cx } from './ui'

/** dwaar = door. The mark is a doorway arch with a step. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cx('h-8 w-8', className)}>
      <rect width="32" height="32" rx="10" className="fill-ink" />
      <path d="M10 25V14.5a6 6 0 0 1 12 0V25" fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-brand" />
      <circle cx="19" cy="19.5" r="1.4" className="fill-white" />
      <path d="M7.5 25.5h17" strokeWidth="2.4" strokeLinecap="round" className="stroke-white" />
    </svg>
  )
}

export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className={cx('font-display text-[22px] font-extrabold tracking-tight', inverted ? 'text-white' : 'text-ink')}>
        dwaar
      </span>
    </span>
  )
}
