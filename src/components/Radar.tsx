import { cx } from './ui'

const DELAYS = ['[animation-delay:0s]', '[animation-delay:.5s]', '[animation-delay:1s]', '[animation-delay:.25s]', '[animation-delay:.75s]', '[animation-delay:1.25s]']

/** Partners around the customer, laid out on a golden-angle spiral so it looks organic but stays deterministic. */
export function Radar({ count, className }: { count: number; className?: string }) {
  const dots = Array.from({ length: Math.max(0, Math.min(count, 16)) }, (_, i) => {
    const angle = i * 2.399963
    const radius = 26 + ((i * 37) % 62)
    return { x: 100 + Math.cos(angle) * radius, y: 100 + Math.sin(angle) * radius }
  })
  return (
    <div className={cx('relative aspect-square', className)} aria-hidden>
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id="radar-fill" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ff5a1f" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#ff5a1f" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="radar-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff5a1f" stopOpacity="0" />
            <stop offset="100%" stopColor="#ff5a1f" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="96" fill="url(#radar-fill)" />
        {[96, 70, 44].map((r) => (
          <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="#ffffff" strokeOpacity="0.12" strokeDasharray="2 4" />
        ))}
        <g className="origin-center motion-safe:animate-sweep">
          <path d="M100 100 L196 100 A96 96 0 0 0 167.9 32.1 Z" fill="url(#radar-sweep)" />
        </g>
        {dots.map((d, i) => (
          <g key={i}>
            <circle cx={d.x} cy={d.y} r="7" className="fill-brand/20" />
            <circle cx={d.x} cy={d.y} r="3.2" className={cx('fill-brand motion-safe:animate-blink', DELAYS[i % DELAYS.length])} />
          </g>
        ))}
      </svg>
      <span className="absolute inset-[38%] rounded-full bg-brand/25 motion-safe:animate-ping-ring" />
      <span className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white shadow-float">
        <span className="h-3 w-3 rounded-full bg-brand ring-4 ring-brand/25" />
      </span>
    </div>
  )
}
