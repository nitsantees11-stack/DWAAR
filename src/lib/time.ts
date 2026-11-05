/** India has a fixed +05:30 offset (no DST), so IST math can be done with plain offsets. */
const IST_OFFSET_MS = 330 * 60 * 1000
export const IST_TZ = 'Asia/Kolkata'

export function istParts(date: Date) {
  const d = new Date(date.getTime() + IST_OFFSET_MS)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  }
}

export function fromIST(year: number, month: number, day: number, hour: number, minute = 0) {
  return new Date(Date.UTC(year, month, day, hour, minute) - IST_OFFSET_MS)
}

export function isNightIST(date: Date) {
  const { hour } = istParts(date)
  return hour >= 22 || hour < 6
}

export function isWithinHoursIST(date: Date, startHour: number, endHour: number) {
  if (startHour <= 0 && endHour >= 24) return true
  const { hour } = istParts(date)
  return hour >= startHour && hour < endHour
}

/** 0 = today, 1 = tomorrow … relative to `now`, in IST calendar days. */
export function istDayOffset(date: Date, now: Date) {
  const a = istParts(date)
  const b = istParts(now)
  const da = Date.UTC(a.year, a.month, a.day)
  const db = Date.UTC(b.year, b.month, b.day)
  return Math.round((da - db) / 86_400_000)
}

export function formatHour(hour: number) {
  const h = ((hour % 24) + 24) % 24
  const suffix = h < 12 ? 'am' : 'pm'
  const twelve = h % 12 === 0 ? 12 : h % 12
  return `${twelve}${suffix}`
}

export function formatClock(date: Date, locale = 'en-IN') {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: IST_TZ }).format(date)
}

export function formatDay(date: Date, locale = 'en-IN') {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: IST_TZ }).format(date)
}

export function formatDate(value: string | Date, locale = 'en-IN') {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST_TZ }).format(date)
}

export function formatDateTime(value: string | Date, locale = 'en-IN') {
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: IST_TZ,
  }).format(date)
}
