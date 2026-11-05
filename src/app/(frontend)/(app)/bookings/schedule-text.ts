import type { Booking } from '@/payload-types'
import type { TFunction } from '@/lib/i18n'
import { formatDay, formatHour, istParts } from '@/lib/time'

/** Localised schedule label rendered from the stored window (scheduleLabel is the admin copy). */
export function scheduleText(booking: Pick<Booking, 'schedule'>, t: TFunction, locale: string) {
  const { mode, startAt, endAt } = booking.schedule ?? {}
  if (mode === 'asap' || !startAt) return t('booking.asap')
  const start = new Date(startAt)
  const end = endAt ? new Date(endAt) : null
  const range = end ? `${formatHour(istParts(start).hour)}–${formatHour(istParts(end).hour)}` : formatHour(istParts(start).hour)
  return `${formatDay(start, locale)}, ${range}`
}
