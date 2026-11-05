import { formatHour, fromIST, istParts } from './time'

export interface Slot {
  startISO: string
  endISO: string
  startHour: number
  endHour: number
}

export const SLOT_HOURS = 2
export const SLOT_DAYS = 3
/** A slot must start at least this far in the future to be bookable. */
export const SLOT_LEAD_MS = 60 * 60 * 1000

/**
 * Bookable 2-hour windows for today and the next two days, in IST, inside the
 * category's service hours. Shared by the booking UI and the server validator so a
 * slot is only accepted if the server would have offered it too.
 */
export function buildSlots(now: Date, startHour: number, endHour: number): Slot[][] {
  const base = istParts(now)
  const days: Slot[][] = []
  const firstHour = Math.max(0, Math.min(23, startHour))
  const lastHour = Math.max(firstHour + 1, Math.min(24, endHour))
  for (let offset = 0; offset < SLOT_DAYS; offset++) {
    const slots: Slot[] = []
    for (let h = firstHour; h + SLOT_HOURS <= lastHour; h += SLOT_HOURS) {
      const start = fromIST(base.year, base.month, base.day + offset, h)
      if (start.getTime() - now.getTime() < SLOT_LEAD_MS) continue
      const end = fromIST(base.year, base.month, base.day + offset, h + SLOT_HOURS)
      slots.push({ startISO: start.toISOString(), endISO: end.toISOString(), startHour: h, endHour: h + SLOT_HOURS })
    }
    days.push(slots)
  }
  return days
}

export function slotRangeLabel(slot: Pick<Slot, 'startHour' | 'endHour'>) {
  return `${formatHour(slot.startHour)}–${formatHour(slot.endHour)}`
}
