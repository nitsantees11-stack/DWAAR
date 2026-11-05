/** Operating rules for the partner side. Business-tunable money lives in business-config. */
export const OFFER_TTL_MS = 30 * 1000
export const MAX_OFFER_ATTEMPTS = 5
export const MANUAL_ASSIGN_AFTER_MS = 10 * 60 * 1000
export const SCHEDULED_DISPATCH_LEAD_MS = 60 * 60 * 1000
export const ONLINE_FRESH_MS = 2 * 60 * 1000
export const GEOFENCE_M = 300
export const NO_SHOW_WAIT_MS = 10 * 60 * 1000
export const MAX_BOOKING_OTP_ATTEMPTS = 5
export const LOCATION_MIN_INTERVAL_MS = 5 * 1000
export const LOCATION_RETENTION_MS = 24 * 60 * 60 * 1000
export const SKILL_PASS_PERCENT = 70
export const DEFAULT_SERVICE_RADIUS_KM = 5

/** Dispatch ranking weights (sum to 1). */
export const RANK_WEIGHTS = { distance: 0.6, rating: 0.25, acceptance: 0.15 } as const

/** Reliability score drop and penalty for releasing an accepted job. */
export const RELEASE_RELIABILITY_DROP = 5

export const PARTNER_VERIFICATION_STATUSES = [
  'draft',
  'pending_verification',
  'submitted',
  'under_review',
  'needs_changes',
  'approved',
  'rejected',
  'suspended',
] as const

/**
 * Statuses in which the partner may still fill in and submit their onboarding. Partners created
 * from the Partner app's own login (X-Dwaar-User-* headers) start in `pending_verification`.
 */
export const ONBOARDING_EDITABLE_STATUSES: readonly string[] = ['draft', 'pending_verification', 'needs_changes']

export const PARTNER_DOCUMENT_TYPES = [
  'aadhaar_front',
  'aadhaar_back',
  'pan',
  'driving_licence',
  'vehicle_rc',
  'selfie',
  'police_verification',
  'skill_certificate',
  'bank_proof',
] as const
export type PartnerDocumentType = (typeof PARTNER_DOCUMENT_TYPES)[number]

/** Documents every partner must upload before submitting, by role. */
export function requiredDocuments(role: string | null | undefined): PartnerDocumentType[] {
  const base: PartnerDocumentType[] = ['aadhaar_front', 'aadhaar_back', 'pan', 'selfie', 'bank_proof']
  if (role === 'rider' || role === 'mechanic') return [...base, 'driving_licence', 'vehicle_rc']
  return base
}

/** Roles that ride on public roads and need a valid driving licence to stay online. */
export function needsDrivingLicence(role: string | null | undefined) {
  return role === 'rider' || role === 'mechanic'
}

export const JOB_MEDIA_KINDS = [
  'before',
  'after',
  'pickup_photo',
  'delivery_photo',
  'quote_video',
  'part_bill',
  'signature',
] as const

export const LEDGER_TYPES = [
  'job_earning',
  'visit_share',
  'parts_reimbursement',
  'incentive',
  'penalty',
  'cod_collected',
  'cod_deposited',
  'payout',
  'adjustment',
] as const
export type LedgerType = (typeof LEDGER_TYPES)[number]

/** Mask a 10-digit phone for display: 98XXXXXX21. */
export function maskPhone(phone: string | null | undefined) {
  if (!phone) return null
  const d = phone.replace(/\D/g, '').slice(-10)
  if (d.length < 4) return null
  return `${d.slice(0, 2)}XXXXXX${d.slice(-2)}`
}

export function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || null
}
