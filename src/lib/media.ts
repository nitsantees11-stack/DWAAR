import type { Media } from '@/payload-types'

/** Narrows a populated upload relationship to a renderable media doc. */
export function asMedia(value: unknown): (Media & { url: string }) | null {
  if (!value || typeof value !== 'object') return null
  const media = value as Media
  return typeof media.url === 'string' && media.url ? (media as Media & { url: string }) : null
}

export function relId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) return String((value as { id: unknown }).id)
  return null
}
