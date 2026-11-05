import type { BookingStatus } from '@/lib/booking-machine'
import type { TFunction } from '@/lib/i18n'
import { cx } from './ui'

export function statusTone(status: string) {
  switch (status) {
    case 'QUOTE_SENT':
      return 'bg-warn-soft text-warn'
    case 'COMPLETED':
      return 'bg-success-soft text-success'
    case 'CANCELLED':
    case 'DECLINED':
    case 'RETURNED':
      return 'bg-line-2 text-muted'
    default:
      return 'bg-brand-soft text-brand-ink'
  }
}

export function StatusPill({ status, t, className }: { status: BookingStatus | string; t: TFunction; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold', statusTone(status), className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {t(`status.${status}` as Parameters<TFunction>[0])}
    </span>
  )
}
