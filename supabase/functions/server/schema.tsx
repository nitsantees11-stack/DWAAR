/**
 * dwaar database schema: the single source for the SQL file (supabase/sql/dwaar-schema.sql) and
 * for the column mapping in db.tsx. Documents keep their Payload shape in code (camelCase fields,
 * groups as objects); in Postgres each top-level field is a snake_case column and groups/arrays
 * of objects are jsonb.
 *
 * Column tuple: [field, sql type, column name override?]
 */
export type ColumnSpec = [field: string, type: string, column?: string]
export interface TableSpec {
  table: string
  columns: ColumnSpec[]
  /** Single-column unique constraints, by field. */
  unique?: string[]
  /** Extra constraints (multi-column unique etc.), raw SQL. */
  constraints?: string[]
  /** Fields that get a btree (or gin for arrays) index. */
  index?: string[]
  comment: string
}

const STATUS = (values: string[]) => `check (%c in (${values.map((v) => `'${v}'`).join(', ')}))`

export const SCHEMA: Record<string, TableSpec> = {
  media: {
    table: 'dw_media',
    comment: 'Public images (category heroes, partner photos). Files live in the public storage bucket.',
    columns: [
      ['alt', "text not null default ''"],
      ['filename', 'text'],
      ['mimeType', 'text'],
      ['filesize', 'bigint'],
      ['width', 'integer'],
      ['height', 'integer'],
      ['focalX', 'double precision'],
      ['focalY', 'double precision'],
      ['url', 'text'],
      ['storagePath', 'text'],
    ],
  },
  'service-categories': {
    table: 'dw_service_categories',
    comment: 'Catalog verticals (mobile, AC, bike...). A new vertical is a new row.',
    columns: [
      ['name', 'text not null'],
      ['slug', 'text not null'],
      ['status', `text not null default 'live' ${STATUS(['live', 'coming_soon'])}`],
      ['flow', `text not null ${STATUS(['pickup_drop', 'doorstep', 'roadside'])}`],
      ['icon', 'text not null'],
      ['order', 'integer not null default 0', 'sort_order'],
      ['tagline', "text not null default ''"],
      ['description', "text not null default ''"],
      ['heroImage', 'uuid references dw_media(id) on delete set null'],
      ['promise', 'jsonb'],
      ['requireProblemVideo', 'boolean not null default false'],
      ['pricing', 'jsonb'],
      ['serviceHours', 'jsonb'],
      ['deviceTypes', "jsonb not null default '[]'"],
      ['brands', "jsonb not null default '[]'"],
      ['highlights', "jsonb not null default '[]'"],
      ['howItWorks', "jsonb not null default '[]'"],
      ['faqs', "jsonb not null default '[]'"],
      ['warrantyNote', 'text'],
      ['launchNote', 'text'],
    ],
    unique: ['slug'],
  },
  services: {
    table: 'dw_services',
    comment: 'Bookable line items inside a category.',
    columns: [
      ['name', 'text not null'],
      ['slug', 'text not null'],
      ['category', 'uuid not null references dw_service_categories(id) on delete cascade'],
      ['active', 'boolean not null default true'],
      ['popular', 'boolean not null default false'],
      ['order', 'integer not null default 0', 'sort_order'],
      ['description', "text not null default ''"],
      ['priceType', `text not null default 'fixed' ${STATUS(['fixed', 'range'])}`],
      ['priceFromPaise', 'integer not null check (price_from_paise >= 0)'],
      ['priceToPaise', 'integer'],
      ['tierPriced', 'boolean not null default false'],
      ['durationLabel', 'text'],
      ['ninetyMinPromise', 'boolean not null default false'],
      ['isOtherProblem', 'boolean not null default false'],
      ['warrantyDays', 'integer not null default 0'],
      ['allowQuantity', 'boolean not null default false'],
      ['includes', "jsonb not null default '[]'"],
    ],
    unique: ['slug'],
    index: ['category'],
  },
  'device-models': {
    table: 'dw_device_models',
    comment: 'Phone/device models with their price tier.',
    columns: [
      ['category', 'uuid not null references dw_service_categories(id) on delete cascade'],
      ['brand', 'text not null'],
      ['model', 'text not null'],
      ['deviceType', 'text'],
      ['tier', `text not null default 'mid' ${STATUS(['budget', 'mid', 'premium', 'flagship'])}`],
    ],
    index: ['category'],
  },
  promotions: {
    table: 'dw_promotions',
    comment: 'Offers / coupon codes.',
    columns: [
      ['title', 'text not null'],
      ['subtitle', "text not null default ''"],
      ['code', 'text not null'],
      ['active', 'boolean not null default true'],
      ['discountType', `text not null default 'percent' ${STATUS(['percent', 'flat'])}`],
      ['discountValue', 'integer not null check (discount_value >= 1)'],
      ['maxDiscountPaise', 'integer'],
      ['minOrderPaise', 'integer not null default 0'],
      ['category', 'uuid references dw_service_categories(id) on delete set null'],
      ['firstBookingOnly', 'boolean not null default false'],
      ['validUntil', 'timestamptz'],
    ],
    unique: ['code'],
  },
  'skill-tests': {
    table: 'dw_skill_tests',
    comment: 'Per-category partner skill test. correctIndex never leaves the server.',
    columns: [
      ['title', 'text not null'],
      ['category', 'uuid not null references dw_service_categories(id) on delete cascade'],
      ['questions', "jsonb not null default '[]'"],
    ],
    unique: ['category'],
  },
  users: {
    table: 'dw_users',
    comment: 'Customers. username = 10-digit phone. Also mirrored in Supabase Auth with the same id.',
    columns: [
      ['username', 'text not null'],
      ['name', 'text'],
      ['gender', 'text'],
      ['dateOfBirth', 'timestamptz'],
      ['altWhatsapp', 'text'],
      ['language', "text not null default 'hinglish'"],
      ['notifications', 'jsonb'],
      ['privacy', 'jsonb'],
      ['preferences', 'jsonb'],
      ['onboarded', 'boolean not null default false'],
      ['walletPaise', 'integer not null default 0 check (wallet_paise >= 0)'],
      ['referralCode', 'text'],
      ['accountStatus', `text not null default 'active' ${STATUS(['active', 'deleted'])}`],
    ],
    unique: ['username'],
    index: ['referralCode'],
  },
  addresses: {
    table: 'dw_addresses',
    comment: 'Customer addresses.',
    columns: [
      ['owner', 'uuid not null references dw_users(id) on delete cascade'],
      ['label', `text not null default 'home' ${STATUS(['home', 'work', 'other'])}`],
      ['contactName', 'text not null'],
      ['contactPhone', 'text not null'],
      ['flat', 'text not null'],
      ['area', 'text not null'],
      ['landmark', 'text'],
      ['city', 'text not null'],
      ['pincode', 'text not null'],
      ['line', 'text'],
      ['lat', 'double precision'],
      ['lng', 'double precision'],
      ['isDefault', 'boolean not null default false'],
    ],
    index: ['owner'],
  },
  'waitlist-entries': {
    table: 'dw_waitlist_entries',
    comment: 'Customers waiting for a coming-soon category.',
    columns: [
      ['category', 'uuid not null references dw_service_categories(id) on delete cascade'],
      ['user', 'uuid not null references dw_users(id) on delete cascade', 'user_id'],
    ],
    constraints: ['unique (category, user_id)'],
    index: ['user'],
  },
  partners: {
    table: 'dw_partners',
    comment: 'Technicians, mechanics, riders, hub technicians. username = phone, or ext-<hash> for Partner app logins.',
    columns: [
      ['username', 'text not null'],
      ['name', 'text'],
      ['photo', 'uuid references dw_media(id) on delete set null'],
      ['dateOfBirth', 'timestamptz'],
      ['languages', "text[] not null default '{}'"],
      ['role', 'text check (role is null or role in (\'technician\', \'mechanic\', \'rider\', \'hub_technician\'))'],
      ['categories', "uuid[] not null default '{}'"],
      ['zoneName', 'text'],
      ['serviceRadiusKm', 'double precision'],
      ['homeLat', 'double precision'],
      ['homeLng', 'double precision'],
      ['vehicle', 'jsonb'],
      ['preferences', 'jsonb'],
      [
        'verificationStatus',
        `text not null default 'draft' ${STATUS(['draft', 'pending_verification', 'submitted', 'under_review', 'needs_changes', 'approved', 'rejected', 'suspended'])}`,
      ],
      ['accountStatus', `text not null default 'active' ${STATUS(['active', 'suspended', 'deleted'])}`],
      ['rejectionReason', 'text'],
      ['skillTestScore', 'integer'],
      ['trainingCompletedAt', 'timestamptz'],
      ['agreementAcceptedAt', 'timestamptz'],
      ['submittedAt', 'timestamptz'],
      ['externalUserId', 'text'],
      ['externalEmail', 'text'],
      ['isOnline', 'boolean not null default false'],
      ['lastSeenAt', 'timestamptz'],
      ['lastLat', 'double precision'],
      ['lastLng', 'double precision'],
      // No foreign key: partners and bookings point at each other.
      ['currentJob', 'uuid'],
      ['rating', 'double precision not null default 0'],
      ['ratingCount', 'integer not null default 0'],
      ['acceptanceRate', 'integer not null default 100'],
      ['completionRate', 'integer not null default 100'],
      ['reliabilityScore', 'integer not null default 100'],
      ['stats', 'jsonb'],
      ['bank', 'jsonb'],
    ],
    unique: ['username', 'externalUserId'],
    index: ['role', 'categories', 'verificationStatus'],
  },
  'partner-documents': {
    table: 'dw_partner_documents',
    comment: 'Private KYC files (private storage bucket). Review: set status approved / rejected.',
    columns: [
      ['owner', 'uuid not null references dw_partners(id) on delete cascade'],
      ['type', 'text not null'],
      ['status', `text not null default 'pending' ${STATUS(['pending', 'approved', 'rejected'])}`],
      ['rejectionReason', 'text'],
      ['expiresAt', 'timestamptz'],
      ['superseded', 'boolean not null default false'],
      ['filename', 'text'],
      ['mimeType', 'text'],
      ['filesize', 'bigint'],
      ['storagePath', 'text'],
    ],
    index: ['owner'],
  },
  bookings: {
    table: 'dw_bookings',
    comment: 'Bookings. Status changes only through the function (state machine); see booking-events for history.',
    columns: [
      ['bookingCode', 'text not null'],
      [
        'status',
        `text not null default 'BOOKED' ${STATUS(['BOOKED', 'PARTNER_ASSIGNED', 'ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'AT_HUB', 'QUOTE_SENT', 'APPROVED', 'DECLINED', 'IN_PROGRESS', 'OUT_FOR_DELIVERY', 'COMPLETED', 'RETURNED', 'CANCELLED'])}`,
      ],
      ['title', 'text not null'],
      ['deviceLabel', 'text'],
      ['customer', 'uuid not null references dw_users(id) on delete restrict'],
      ['category', 'uuid not null references dw_service_categories(id) on delete restrict'],
      ['flow', `text not null ${STATUS(['pickup_drop', 'doorstep', 'roadside'])}`],
      ['statusChangedAt', 'timestamptz'],
      ['completedAt', 'timestamptz'],
      ['lines', "jsonb not null default '[]'"],
      ['device', 'jsonb'],
      ['problem', 'jsonb'],
      ['address', 'jsonb'],
      ['schedule', 'jsonb'],
      ['scheduleLabel', 'text'],
      ['altWhatsapp', 'text'],
      ['pricing', 'jsonb'],
      ['quote', 'jsonb'],
      ['payment', 'jsonb'],
      ['partner', 'jsonb'],
      ['serviceOtp', 'text'],
      ['warrantyDays', 'integer not null default 0'],
      ['cancellation', 'jsonb'],
      ['rating', 'jsonb'],
      ['trustAccepted', 'boolean not null default false'],
      ['assignedPartner', 'uuid references dw_partners(id) on delete set null'],
      ['riderPartner', 'uuid references dw_partners(id) on delete set null'],
      ['hubPartner', 'uuid references dw_partners(id) on delete set null'],
      ['needsManualAssignment', 'boolean not null default false'],
      ['promisedBy', 'timestamptz'],
      ['arrivedAt', 'timestamptz'],
      ['startedAt', 'timestamptz'],
      ['slaBreached', 'boolean not null default false'],
      ['slaCreditPaise', 'integer'],
      ['deliveryOtp', 'text'],
      ['otpAttempts', 'jsonb'],
      ['dispatch', 'jsonb'],
      ['pickupChecklist', 'jsonb'],
      ['partsUsed', "jsonb not null default '[]'"],
      ['paymentCollection', 'jsonb'],
      ['noShow', 'jsonb'],
      ['customerRatingByPartner', 'jsonb'],
      ['idemKey', 'text'],
    ],
    unique: ['bookingCode'],
    index: ['customer', 'status', 'assignedPartner', 'riderPartner', 'hubPartner', 'idemKey'],
  },
  'booking-events': {
    table: 'dw_booking_events',
    comment: 'Append-only booking history.',
    columns: [
      ['booking', 'uuid not null references dw_bookings(id) on delete cascade'],
      ['status', 'text not null'],
      ['actor', `text not null ${STATUS(['customer', 'hub', 'system', 'partner'])}`],
      ['partner', 'uuid'],
      ['note', 'text'],
    ],
    index: ['booking'],
  },
  warranties: {
    table: 'dw_warranties',
    comment: 'Issued when a booking completes.',
    columns: [
      ['booking', 'uuid not null references dw_bookings(id) on delete cascade'],
      ['customer', 'uuid not null references dw_users(id) on delete cascade'],
      ['title', 'text not null'],
      ['deviceLabel', 'text'],
      ['days', 'integer not null check (days >= 1)'],
      ['startsAt', 'timestamptz not null'],
      ['endsAt', 'timestamptz not null'],
      ['status', `text not null default 'active' ${STATUS(['active', 'claimed', 'expired', 'void'])}`],
      ['claimsUsed', 'integer not null default 0'],
    ],
    index: ['customer', 'booking'],
  },
  'support-tickets': {
    table: 'dw_support_tickets',
    comment: 'Customer support tickets. Reply by editing reply/status.',
    columns: [
      ['ticketCode', 'text'],
      ['user', 'uuid not null references dw_users(id) on delete cascade', 'user_id'],
      ['booking', 'uuid references dw_bookings(id) on delete set null'],
      ['warranty', 'uuid references dw_warranties(id) on delete set null'],
      ['topic', `text not null ${STATUS(['booking', 'payment', 'warranty', 'account', 'other'])}`],
      ['message', 'text not null'],
      ['status', `text not null default 'open' ${STATUS(['open', 'in_progress', 'resolved'])}`],
      ['reply', 'text'],
    ],
    index: ['user'],
  },
  'problem-videos': {
    table: 'dw_problem_videos',
    comment: 'Problem videos customers record before booking (private storage bucket).',
    columns: [
      ['owner', 'uuid not null references dw_users(id) on delete cascade'],
      ['booking', 'uuid references dw_bookings(id) on delete set null'],
      ['durationSec', 'integer'],
      ['filename', 'text'],
      ['mimeType', 'text'],
      ['filesize', 'bigint'],
      ['storagePath', 'text'],
    ],
    index: ['owner', 'booking'],
  },
  'job-offers': {
    table: 'dw_job_offers',
    comment: 'One row per offered leg. accept_lock is unique: the first accept wins.',
    columns: [
      ['booking', 'uuid not null references dw_bookings(id) on delete cascade'],
      ['partner', 'uuid not null references dw_partners(id) on delete cascade'],
      ['status', `text not null default 'offered' ${STATUS(['offered', 'accepted', 'declined', 'expired', 'withdrawn'])}`],
      ['offeredAt', 'timestamptz not null'],
      ['expiresAt', 'timestamptz not null'],
      ['respondedAt', 'timestamptz'],
      ['declineReason', 'text'],
      ['distanceKm', 'double precision'],
      ['estimatedEarningPaise', 'integer'],
      ['rank', 'integer'],
      ['leg', `text not null default 'visit' ${STATUS(['visit', 'pickup', 'hub', 'delivery'])}`],
      ['round', 'integer not null default 0'],
      ['offerKey', 'text not null'],
      ['acceptLock', 'text'],
      ['manual', 'boolean not null default false'],
    ],
    unique: ['offerKey', 'acceptLock'],
    index: ['booking', 'partner', 'status'],
  },
  'job-media': {
    table: 'dw_job_media',
    comment: 'Private job evidence: pickup photos, bills, quote videos (private storage bucket).',
    columns: [
      ['booking', 'uuid not null references dw_bookings(id) on delete cascade'],
      ['partner', 'uuid not null references dw_partners(id) on delete cascade'],
      ['kind', 'text not null'],
      ['filename', 'text'],
      ['mimeType', 'text'],
      ['filesize', 'bigint'],
      ['storagePath', 'text'],
    ],
    index: ['booking'],
  },
  'partner-locations': {
    table: 'dw_partner_locations',
    comment: 'GPS breadcrumbs, kept 24 hours.',
    columns: [
      ['partner', 'uuid not null references dw_partners(id) on delete cascade'],
      ['booking', 'uuid references dw_bookings(id) on delete set null'],
      ['lat', 'double precision not null'],
      ['lng', 'double precision not null'],
      ['accuracy', 'double precision'],
      ['heading', 'double precision'],
      ['speed', 'double precision'],
      ['recordedAt', 'timestamptz not null'],
    ],
    index: ['partner', 'recordedAt'],
  },
  payouts: {
    table: 'dw_payouts',
    comment: 'Partner payouts. Set status to paid (with reference) or failed; failed refunds automatically.',
    columns: [
      ['partner', 'uuid not null references dw_partners(id) on delete cascade'],
      ['amountPaise', 'integer not null check (amount_paise >= 1)'],
      ['status', `text not null default 'requested' ${STATUS(['requested', 'processing', 'paid', 'failed'])}`],
      ['reference', 'text'],
      ['periodStart', 'timestamptz'],
      ['periodEnd', 'timestamptz'],
    ],
    index: ['partner'],
  },
  'earnings-ledger': {
    table: 'dw_earnings_ledger',
    comment: 'Append-only partner money ledger (paise; credits positive, cash/payouts negative).',
    columns: [
      ['partner', 'uuid not null references dw_partners(id) on delete cascade'],
      ['booking', 'uuid references dw_bookings(id) on delete set null'],
      ['type', `text not null ${STATUS(['job_earning', 'visit_share', 'parts_reimbursement', 'incentive', 'penalty', 'cod_collected', 'cod_deposited', 'payout', 'adjustment'])}`],
      ['amountPaise', 'integer not null'],
      ['note', 'text'],
      ['payout', 'uuid references dw_payouts(id) on delete set null'],
      ['entryKey', 'text not null'],
    ],
    unique: ['entryKey'],
    index: ['partner'],
  },
  'partner-tickets': {
    table: 'dw_partner_tickets',
    comment: 'Partner support + SOS (urgent = true).',
    columns: [
      ['partner', 'uuid not null references dw_partners(id) on delete cascade'],
      ['booking', 'uuid references dw_bookings(id) on delete set null'],
      ['topic', `text not null ${STATUS(['safety', 'payment', 'app', 'customer', 'other'])}`],
      ['message', 'text not null'],
      ['status', `text not null default 'open' ${STATUS(['open', 'in_progress', 'resolved'])}`],
      ['urgent', 'boolean not null default false'],
      ['sos', 'jsonb'],
      ['reply', 'text'],
    ],
    index: ['partner'],
  },
}

/** Tables in dependency order (foreign keys point backwards only). */
export const TABLE_ORDER = [
  'media',
  'service-categories',
  'services',
  'device-models',
  'promotions',
  'skill-tests',
  'users',
  'addresses',
  'waitlist-entries',
  'partners',
  'partner-documents',
  'bookings',
  'booking-events',
  'warranties',
  'support-tickets',
  'problem-videos',
  'job-offers',
  'job-media',
  'partner-locations',
  'payouts',
  'earnings-ledger',
  'partner-tickets',
]

export const snake = (s: string) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
export const columnOf = (spec: ColumnSpec) => spec[2] ?? snake(spec[0])

/** Builds the full SQL script. Safe to run more than once. */
export function buildSql() {
  const out: string[] = []
  out.push(`-- dwaar backend schema for Supabase (generated from supabase/functions/server/schema.tsx).
-- Run it in Supabase Dashboard -> SQL Editor -> New query -> Run. Safe to run again.
-- All tables have Row Level Security ON with no policies: only the dwaar edge function (service
-- role) can read or write. The browser never talks to these tables directly.


create or replace function dw_touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Short-lived server data: sessions, OTP challenges, rate limits, idempotency keys, locks.
create table if not exists dw_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table dw_kv enable row level security;

-- Globals (business-config).
create table if not exists dw_globals (
  slug text primary key,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table dw_globals enable row level security;
`)
  for (const name of TABLE_ORDER) {
    const t = SCHEMA[name]
    const cols = [
      'id uuid primary key default gen_random_uuid()',
      ...t.columns.map((c) => `${columnOf(c)} ${c[1].replaceAll('%c', columnOf(c))}`),
      'created_at timestamptz not null default now()',
      'updated_at timestamptz not null default now()',
    ]
    for (const f of t.unique ?? []) {
      const c = t.columns.find((x) => x[0] === f)!
      cols.push(`constraint ${t.table}_${columnOf(c)}_key unique (${columnOf(c)})`)
    }
    for (const extra of t.constraints ?? []) cols.push(extra)
    out.push(`-- ${name}: ${t.comment}`)
    out.push(`create table if not exists ${t.table} (\n  ${cols.join(',\n  ')}\n);`)
    // Columns added in later versions of this file.
    for (const c of t.columns) {
      const type = c[1].replaceAll('%c', columnOf(c)).replace(/\bnot null\b(?! default)/, '').replace(/\breferences\b.*$/, '').trim()
      out.push(`alter table ${t.table} add column if not exists ${columnOf(c)} ${type};`)
    }
    out.push(`alter table ${t.table} enable row level security;`)
    out.push(`drop trigger if exists ${t.table}_touch on ${t.table};`)
    out.push(`create trigger ${t.table}_touch before update on ${t.table} for each row execute function dw_touch_updated_at();`)
    for (const f of t.index ?? []) {
      const c = t.columns.find((x) => x[0] === f)!
      const using = c[1].includes('[]') ? ' using gin' : ''
      out.push(`create index if not exists ${t.table}_${columnOf(c)}_idx on ${t.table}${using} (${columnOf(c)});`)
    }
    out.push(`comment on table ${t.table} is '${t.comment.replace(/'/g, "''")}';`)
    out.push('')
  }
  out.push(`-- Storage buckets: private (KYC, job media, problem videos) and public (catalog images).
insert into storage.buckets (id, name, public) values ('make-4d6fa028-private', 'make-4d6fa028-private', false)
  on conflict (id) do update set public = false;
insert into storage.buckets (id, name, public) values ('make-4d6fa028-public', 'make-4d6fa028-public', true)
  on conflict (id) do update set public = true;
`)
  return out.join('\n')
}

/**
 * Payload stores unset checkboxes/numbers as null. For NOT NULL columns with a default, a null
 * (or missing) value becomes that default so imported and app-written rows always fit.
 */
export function coerceNull(type: string, value: unknown) {
  if (value !== null && value !== undefined) return value
  if (!/\bnot null\b/.test(type)) return null
  const m = /\bdefault\s+('(?:[^']|'')*'|true|false|-?\d+(?:\.\d+)?)/.exec(type)
  if (!m) return null
  const d = m[1]
  if (d === 'true') return true
  if (d === 'false') return false
  if (/^-?\d/.test(d)) return Number(d)
  const text = d.slice(1, -1).replace(/''/g, "'")
  if (/^jsonb\b/.test(type)) return JSON.parse(text)
  if (/\[\]/.test(type)) return []
  return text
}
