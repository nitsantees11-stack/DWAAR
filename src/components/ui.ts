export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

/** Shared Tailwind recipes for the dwaar design system. */
export const ui = {
  btn: 'inline-flex select-none items-center justify-center gap-2 rounded-2xl px-5 h-12 text-[15px] font-semibold transition duration-150 active:scale-[.98] disabled:pointer-events-none disabled:opacity-45',
  btnSm: 'inline-flex select-none items-center justify-center gap-1.5 rounded-xl px-3.5 h-9 text-[13px] font-semibold transition duration-150 active:scale-[.97] disabled:pointer-events-none disabled:opacity-45',
  primary: 'bg-ink text-white hover:bg-ink-2',
  accent: 'bg-(--accent) text-white hover:bg-(--accent-ink)',
  brand: 'bg-brand text-white hover:bg-brand-ink',
  secondary: 'bg-surface text-ink ring-1 ring-line hover:ring-ink/25',
  soft: 'bg-(--accent-soft) text-(--accent-ink) hover:brightness-[.97]',
  ghost: 'text-ink-2 hover:bg-line-2',
  danger: 'bg-danger text-white hover:brightness-95',
  input:
    'h-12 w-full rounded-xl bg-surface px-4 text-[15px] text-ink ring-1 ring-line placeholder:text-faint transition focus:outline-none focus:ring-2 focus:ring-ink',
  textarea:
    'w-full rounded-xl bg-surface px-4 py-3 text-[15px] text-ink ring-1 ring-line placeholder:text-faint transition focus:outline-none focus:ring-2 focus:ring-ink',
  label: 'mb-1.5 block text-[13px] font-semibold text-ink-2',
  card: 'rounded-3xl bg-surface ring-1 ring-line/80 shadow-card',
  section: 'mx-auto w-full max-w-6xl px-4 md:px-6',
  narrow: 'mx-auto w-full max-w-2xl px-4 md:px-6',
  eyebrow: 'text-[12px] font-bold uppercase tracking-[0.14em] text-muted',
  h1: 'font-display text-[30px] leading-[1.05] font-bold tracking-tight md:text-[44px]',
  h2: 'font-display text-[22px] leading-tight font-bold tracking-tight md:text-[26px]',
  h3: 'text-[16px] font-bold tracking-tight',
  chip: 'inline-flex items-center gap-1.5 rounded-full px-3 h-8 text-[13px] font-semibold ring-1 ring-line bg-surface transition',
  // `!` suffix: must beat chip's bg-surface/ring-line, which Tailwind emits later in the stylesheet.
  chipOn: 'bg-ink! text-white! ring-ink!',
}
