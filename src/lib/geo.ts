/** Great-circle distance in kilometres. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** City riding speed used for ETAs (km/h), plus a fixed start-up buffer in minutes. */
const CITY_KMH = 20
const ETA_BUFFER_MIN = 5

export function etaMinutesFor(km: number) {
  return Math.max(5, Math.ceil((km / CITY_KMH) * 60) + ETA_BUFFER_MIN)
}
