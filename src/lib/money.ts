const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/** All money is stored as integer paise; display rounds to whole rupees. */
export function formatINR(paise: number) {
  return `₹${inr.format(Math.round(paise / 100))}`
}

export function formatRange(minPaise: number, maxPaise: number) {
  if (maxPaise <= minPaise) return formatINR(minPaise)
  return `${formatINR(minPaise)} – ${formatINR(maxPaise)}`
}

/** Round to the nearest ₹50 so estimates read like real price tags. */
export function roundPaise(paise: number) {
  return Math.round(paise / 5000) * 5000
}
