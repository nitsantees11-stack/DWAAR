-- dwaar backend schema for Supabase (generated from supabase/functions/server/schema.tsx).
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

-- media: Public images (category heroes, partner photos). Files live in the public storage bucket.
create table if not exists dw_media (
  id uuid primary key default gen_random_uuid(),
  alt text not null default '',
  filename text,
  mime_type text,
  filesize bigint,
  width integer,
  height integer,
  focal_x double precision,
  focal_y double precision,
  url text,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table dw_media add column if not exists alt text not null default '';
alter table dw_media add column if not exists filename text;
alter table dw_media add column if not exists mime_type text;
alter table dw_media add column if not exists filesize bigint;
alter table dw_media add column if not exists width integer;
alter table dw_media add column if not exists height integer;
alter table dw_media add column if not exists focal_x double precision;
alter table dw_media add column if not exists focal_y double precision;
alter table dw_media add column if not exists url text;
alter table dw_media add column if not exists storage_path text;
alter table dw_media enable row level security;
drop trigger if exists dw_media_touch on dw_media;
create trigger dw_media_touch before update on dw_media for each row execute function dw_touch_updated_at();
comment on table dw_media is 'Public images (category heroes, partner photos). Files live in the public storage bucket.';

-- service-categories: Catalog verticals (mobile, AC, bike...). A new vertical is a new row.
create table if not exists dw_service_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  status text not null default 'live' check (status in ('live', 'coming_soon')),
  flow text not null check (flow in ('pickup_drop', 'doorstep', 'roadside')),
  icon text not null,
  sort_order integer not null default 0,
  tagline text not null default '',
  description text not null default '',
  hero_image uuid references dw_media(id) on delete set null,
  promise jsonb,
  require_problem_video boolean not null default false,
  pricing jsonb,
  service_hours jsonb,
  device_types jsonb not null default '[]',
  brands jsonb not null default '[]',
  highlights jsonb not null default '[]',
  how_it_works jsonb not null default '[]',
  faqs jsonb not null default '[]',
  warranty_note text,
  launch_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dw_service_categories_slug_key unique (slug)
);
alter table dw_service_categories add column if not exists name text;
alter table dw_service_categories add column if not exists slug text;
alter table dw_service_categories add column if not exists status text not null default 'live' check (status in ('live', 'coming_soon'));
alter table dw_service_categories add column if not exists flow text  check (flow in ('pickup_drop', 'doorstep', 'roadside'));
alter table dw_service_categories add column if not exists icon text;
alter table dw_service_categories add column if not exists sort_order integer not null default 0;
alter table dw_service_categories add column if not exists tagline text not null default '';
alter table dw_service_categories add column if not exists description text not null default '';
alter table dw_service_categories add column if not exists hero_image uuid;
alter table dw_service_categories add column if not exists promise jsonb;
alter table dw_service_categories add column if not exists require_problem_video boolean not null default false;
alter table dw_service_categories add column if not exists pricing jsonb;
alter table dw_service_categories add column if not exists service_hours jsonb;
alter table dw_service_categories add column if not exists device_types jsonb not null default '[]';
alter table dw_service_categories add column if not exists brands jsonb not null default '[]';
alter table dw_service_categories add column if not exists highlights jsonb not null default '[]';
alter table dw_service_categories add column if not exists how_it_works jsonb not null default '[]';
alter table dw_service_categories add column if not exists faqs jsonb not null default '[]';
alter table dw_service_categories add column if not exists warranty_note text;
alter table dw_service_categories add column if not exists launch_note text;
alter table dw_service_categories enable row level security;
drop trigger if exists dw_service_categories_touch on dw_service_categories;
create trigger dw_service_categories_touch before update on dw_service_categories for each row execute function dw_touch_updated_at();
comment on table dw_service_categories is 'Catalog verticals (mobile, AC, bike...). A new vertical is a new row.';

-- services: Bookable line items inside a category.
create table if not exists dw_services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  category uuid not null references dw_service_categories(id) on delete cascade,
  active boolean not null default true,
  popular boolean not null default false,
  sort_order integer not null default 0,
  description text not null default '',
  price_type text not null default 'fixed' check (price_type in ('fixed', 'range')),
  price_from_paise integer not null check (price_from_paise >= 0),
  price_to_paise integer,
  tier_priced boolean not null default false,
  duration_label text,
  ninety_min_promise boolean not null default false,
  is_other_problem boolean not null default false,
  warranty_days integer not null default 0,
  allow_quantity boolean not null default false,
  includes jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dw_services_slug_key unique (slug)
);
alter table dw_services add column if not exists name text;
alter table dw_services add column if not exists slug text;
alter table dw_services add column if not exists category uuid;
alter table dw_services add column if not exists active boolean not null default true;
alter table dw_services add column if not exists popular boolean not null default false;
alter table dw_services add column if not exists sort_order integer not null default 0;
alter table dw_services add column if not exists description text not null default '';
alter table dw_services add column if not exists price_type text not null default 'fixed' check (price_type in ('fixed', 'range'));
alter table dw_services add column if not exists price_from_paise integer  check (price_from_paise >= 0);
alter table dw_services add column if not exists price_to_paise integer;
alter table dw_services add column if not exists tier_priced boolean not null default false;
alter table dw_services add column if not exists duration_label text;
alter table dw_services add column if not exists ninety_min_promise boolean not null default false;
alter table dw_services add column if not exists is_other_problem boolean not null default false;
alter table dw_services add column if not exists warranty_days integer not null default 0;
alter table dw_services add column if not exists allow_quantity boolean not null default false;
alter table dw_services add column if not exists includes jsonb not null default '[]';
alter table dw_services enable row level security;
drop trigger if exists dw_services_touch on dw_services;
create trigger dw_services_touch before update on dw_services for each row execute function dw_touch_updated_at();
create index if not exists dw_services_category_idx on dw_services (category);
comment on table dw_services is 'Bookable line items inside a category.';

-- device-models: Phone/device models with their price tier.
create table if not exists dw_device_models (
  id uuid primary key default gen_random_uuid(),
  category uuid not null references dw_service_categories(id) on delete cascade,
  brand text not null,
  model text not null,
  device_type text,
  tier text not null default 'mid' check (tier in ('budget', 'mid', 'premium', 'flagship')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table dw_device_models add column if not exists category uuid;
alter table dw_device_models add column if not exists brand text;
alter table dw_device_models add column if not exists model text;
alter table dw_device_models add column if not exists device_type text;
alter table dw_device_models add column if not exists tier text not null default 'mid' check (tier in ('budget', 'mid', 'premium', 'flagship'));
alter table dw_device_models enable row level security;
drop trigger if exists dw_device_models_touch on dw_device_models;
create trigger dw_device_models_touch before update on dw_device_models for each row execute function dw_touch_updated_at();
create index if not exists dw_device_models_category_idx on dw_device_models (category);
comment on table dw_device_models is 'Phone/device models with their price tier.';

-- promotions: Offers / coupon codes.
create table if not exists dw_promotions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text not null default '',
  code text not null,
  active boolean not null default true,
  discount_type text not null default 'percent' check (discount_type in ('percent', 'flat')),
  discount_value integer not null check (discount_value >= 1),
  max_discount_paise integer,
  min_order_paise integer not null default 0,
  category uuid references dw_service_categories(id) on delete set null,
  first_booking_only boolean not null default false,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dw_promotions_code_key unique (code)
);
alter table dw_promotions add column if not exists title text;
alter table dw_promotions add column if not exists subtitle text not null default '';
alter table dw_promotions add column if not exists code text;
alter table dw_promotions add column if not exists active boolean not null default true;
alter table dw_promotions add column if not exists discount_type text not null default 'percent' check (discount_type in ('percent', 'flat'));
alter table dw_promotions add column if not exists discount_value integer  check (discount_value >= 1);
alter table dw_promotions add column if not exists max_discount_paise integer;
alter table dw_promotions add column if not exists min_order_paise integer not null default 0;
alter table dw_promotions add column if not exists category uuid;
alter table dw_promotions add column if not exists first_booking_only boolean not null default false;
alter table dw_promotions add column if not exists valid_until timestamptz;
alter table dw_promotions enable row level security;
drop trigger if exists dw_promotions_touch on dw_promotions;
create trigger dw_promotions_touch before update on dw_promotions for each row execute function dw_touch_updated_at();
comment on table dw_promotions is 'Offers / coupon codes.';

-- skill-tests: Per-category partner skill test. correctIndex never leaves the server.
create table if not exists dw_skill_tests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category uuid not null references dw_service_categories(id) on delete cascade,
  questions jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dw_skill_tests_category_key unique (category)
);
alter table dw_skill_tests add column if not exists title text;
alter table dw_skill_tests add column if not exists category uuid;
alter table dw_skill_tests add column if not exists questions jsonb not null default '[]';
alter table dw_skill_tests enable row level security;
drop trigger if exists dw_skill_tests_touch on dw_skill_tests;
create trigger dw_skill_tests_touch before update on dw_skill_tests for each row execute function dw_touch_updated_at();
comment on table dw_skill_tests is 'Per-category partner skill test. correctIndex never leaves the server.';

-- users: Customers. username = 10-digit phone. Also mirrored in Supabase Auth with the same id.
create table if not exists dw_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  name text,
  gender text,
  date_of_birth timestamptz,
  alt_whatsapp text,
  language text not null default 'hinglish',
  notifications jsonb,
  privacy jsonb,
  preferences jsonb,
  onboarded boolean not null default false,
  wallet_paise integer not null default 0 check (wallet_paise >= 0),
  referral_code text,
  account_status text not null default 'active' check (account_status in ('active', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dw_users_username_key unique (username)
);
alter table dw_users add column if not exists username text;
alter table dw_users add column if not exists name text;
alter table dw_users add column if not exists gender text;
alter table dw_users add column if not exists date_of_birth timestamptz;
alter table dw_users add column if not exists alt_whatsapp text;
alter table dw_users add column if not exists language text not null default 'hinglish';
alter table dw_users add column if not exists notifications jsonb;
alter table dw_users add column if not exists privacy jsonb;
alter table dw_users add column if not exists preferences jsonb;
alter table dw_users add column if not exists onboarded boolean not null default false;
alter table dw_users add column if not exists wallet_paise integer not null default 0 check (wallet_paise >= 0);
alter table dw_users add column if not exists referral_code text;
alter table dw_users add column if not exists account_status text not null default 'active' check (account_status in ('active', 'deleted'));
alter table dw_users enable row level security;
drop trigger if exists dw_users_touch on dw_users;
create trigger dw_users_touch before update on dw_users for each row execute function dw_touch_updated_at();
create index if not exists dw_users_referral_code_idx on dw_users (referral_code);
comment on table dw_users is 'Customers. username = 10-digit phone. Also mirrored in Supabase Auth with the same id.';

-- addresses: Customer addresses.
create table if not exists dw_addresses (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references dw_users(id) on delete cascade,
  label text not null default 'home' check (label in ('home', 'work', 'other')),
  contact_name text not null,
  contact_phone text not null,
  flat text not null,
  area text not null,
  landmark text,
  city text not null,
  pincode text not null,
  line text,
  lat double precision,
  lng double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table dw_addresses add column if not exists owner uuid;
alter table dw_addresses add column if not exists label text not null default 'home' check (label in ('home', 'work', 'other'));
alter table dw_addresses add column if not exists contact_name text;
alter table dw_addresses add column if not exists contact_phone text;
alter table dw_addresses add column if not exists flat text;
alter table dw_addresses add column if not exists area text;
alter table dw_addresses add column if not exists landmark text;
alter table dw_addresses add column if not exists city text;
alter table dw_addresses add column if not exists pincode text;
alter table dw_addresses add column if not exists line text;
alter table dw_addresses add column if not exists lat double precision;
alter table dw_addresses add column if not exists lng double precision;
alter table dw_addresses add column if not exists is_default boolean not null default false;
alter table dw_addresses enable row level security;
drop trigger if exists dw_addresses_touch on dw_addresses;
create trigger dw_addresses_touch before update on dw_addresses for each row execute function dw_touch_updated_at();
create index if not exists dw_addresses_owner_idx on dw_addresses (owner);
comment on table dw_addresses is 'Customer addresses.';

-- waitlist-entries: Customers waiting for a coming-soon category.
create table if not exists dw_waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  category uuid not null references dw_service_categories(id) on delete cascade,
  user_id uuid not null references dw_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category, user_id)
);
alter table dw_waitlist_entries add column if not exists category uuid;
alter table dw_waitlist_entries add column if not exists user_id uuid;
alter table dw_waitlist_entries enable row level security;
drop trigger if exists dw_waitlist_entries_touch on dw_waitlist_entries;
create trigger dw_waitlist_entries_touch before update on dw_waitlist_entries for each row execute function dw_touch_updated_at();
create index if not exists dw_waitlist_entries_user_id_idx on dw_waitlist_entries (user_id);
comment on table dw_waitlist_entries is 'Customers waiting for a coming-soon category.';

-- partners: Technicians, mechanics, riders, hub technicians. username = phone, or ext-<hash> for Partner app logins.
create table if not exists dw_partners (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  name text,
  photo uuid references dw_media(id) on delete set null,
  date_of_birth timestamptz,
  languages text[] not null default '{}',
  role text check (role is null or role in ('technician', 'mechanic', 'rider', 'hub_technician')),
  categories uuid[] not null default '{}',
  zone_name text,
  service_radius_km double precision,
  home_lat double precision,
  home_lng double precision,
  vehicle jsonb,
  preferences jsonb,
  verification_status text not null default 'draft' check (verification_status in ('draft', 'pending_verification', 'submitted', 'under_review', 'needs_changes', 'approved', 'rejected', 'suspended')),
  account_status text not null default 'active' check (account_status in ('active', 'suspended', 'deleted')),
  rejection_reason text,
  skill_test_score integer,
  training_completed_at timestamptz,
  agreement_accepted_at timestamptz,
  submitted_at timestamptz,
  external_user_id text,
  external_email text,
  is_online boolean not null default false,
  last_seen_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  current_job uuid,
  rating double precision not null default 0,
  rating_count integer not null default 0,
  acceptance_rate integer not null default 100,
  completion_rate integer not null default 100,
  reliability_score integer not null default 100,
  stats jsonb,
  bank jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dw_partners_username_key unique (username),
  constraint dw_partners_external_user_id_key unique (external_user_id)
);
alter table dw_partners add column if not exists username text;
alter table dw_partners add column if not exists name text;
alter table dw_partners add column if not exists photo uuid;
alter table dw_partners add column if not exists date_of_birth timestamptz;
alter table dw_partners add column if not exists languages text[] not null default '{}';
alter table dw_partners add column if not exists role text check (role is null or role in ('technician', 'mechanic', 'rider', 'hub_technician'));
alter table dw_partners add column if not exists categories uuid[] not null default '{}';
alter table dw_partners add column if not exists zone_name text;
alter table dw_partners add column if not exists service_radius_km double precision;
alter table dw_partners add column if not exists home_lat double precision;
alter table dw_partners add column if not exists home_lng double precision;
alter table dw_partners add column if not exists vehicle jsonb;
alter table dw_partners add column if not exists preferences jsonb;
alter table dw_partners add column if not exists verification_status text not null default 'draft' check (verification_status in ('draft', 'pending_verification', 'submitted', 'under_review', 'needs_changes', 'approved', 'rejected', 'suspended'));
alter table dw_partners add column if not exists account_status text not null default 'active' check (account_status in ('active', 'suspended', 'deleted'));
alter table dw_partners add column if not exists rejection_reason text;
alter table dw_partners add column if not exists skill_test_score integer;
alter table dw_partners add column if not exists training_completed_at timestamptz;
alter table dw_partners add column if not exists agreement_accepted_at timestamptz;
alter table dw_partners add column if not exists submitted_at timestamptz;
alter table dw_partners add column if not exists external_user_id text;
alter table dw_partners add column if not exists external_email text;
alter table dw_partners add column if not exists is_online boolean not null default false;
alter table dw_partners add column if not exists last_seen_at timestamptz;
alter table dw_partners add column if not exists last_lat double precision;
alter table dw_partners add column if not exists last_lng double precision;
alter table dw_partners add column if not exists current_job uuid;
alter table dw_partners add column if not exists rating double precision not null default 0;
alter table dw_partners add column if not exists rating_count integer not null default 0;
alter table dw_partners add column if not exists acceptance_rate integer not null default 100;
alter table dw_partners add column if not exists completion_rate integer not null default 100;
alter table dw_partners add column if not exists reliability_score integer not null default 100;
alter table dw_partners add column if not exists stats jsonb;
alter table dw_partners add column if not exists bank jsonb;
alter table dw_partners enable row level security;
drop trigger if exists dw_partners_touch on dw_partners;
create trigger dw_partners_touch before update on dw_partners for each row execute function dw_touch_updated_at();
create index if not exists dw_partners_role_idx on dw_partners (role);
create index if not exists dw_partners_categories_idx on dw_partners using gin (categories);
create index if not exists dw_partners_verification_status_idx on dw_partners (verification_status);
comment on table dw_partners is 'Technicians, mechanics, riders, hub technicians. username = phone, or ext-<hash> for Partner app logins.';

-- partner-documents: Private KYC files (private storage bucket). Review: set status approved / rejected.
create table if not exists dw_partner_documents (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references dw_partners(id) on delete cascade,
  type text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  expires_at timestamptz,
  superseded boolean not null default false,
  filename text,
  mime_type text,
  filesize bigint,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table dw_partner_documents add column if not exists owner uuid;
alter table dw_partner_documents add column if not exists type text;
alter table dw_partner_documents add column if not exists status text not null default 'pending' check (status in ('pending', 'approved', 'rejected'));
alter table dw_partner_documents add column if not exists rejection_reason text;
alter table dw_partner_documents add column if not exists expires_at timestamptz;
alter table dw_partner_documents add column if not exists superseded boolean not null default false;
alter table dw_partner_documents add column if not exists filename text;
alter table dw_partner_documents add column if not exists mime_type text;
alter table dw_partner_documents add column if not exists filesize bigint;
alter table dw_partner_documents add column if not exists storage_path text;
alter table dw_partner_documents enable row level security;
drop trigger if exists dw_partner_documents_touch on dw_partner_documents;
create trigger dw_partner_documents_touch before update on dw_partner_documents for each row execute function dw_touch_updated_at();
create index if not exists dw_partner_documents_owner_idx on dw_partner_documents (owner);
comment on table dw_partner_documents is 'Private KYC files (private storage bucket). Review: set status approved / rejected.';

-- bookings: Bookings. Status changes only through the function (state machine); see booking-events for history.
create table if not exists dw_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_code text not null,
  status text not null default 'BOOKED' check (status in ('BOOKED', 'PARTNER_ASSIGNED', 'ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'AT_HUB', 'QUOTE_SENT', 'APPROVED', 'DECLINED', 'IN_PROGRESS', 'OUT_FOR_DELIVERY', 'COMPLETED', 'RETURNED', 'CANCELLED')),
  title text not null,
  device_label text,
  customer uuid not null references dw_users(id) on delete restrict,
  category uuid not null references dw_service_categories(id) on delete restrict,
  flow text not null check (flow in ('pickup_drop', 'doorstep', 'roadside')),
  status_changed_at timestamptz,
  completed_at timestamptz,
  lines jsonb not null default '[]',
  device jsonb,
  problem jsonb,
  address jsonb,
  schedule jsonb,
  schedule_label text,
  alt_whatsapp text,
  pricing jsonb,
  quote jsonb,
  payment jsonb,
  partner jsonb,
  service_otp text,
  warranty_days integer not null default 0,
  cancellation jsonb,
  rating jsonb,
  trust_accepted boolean not null default false,
  assigned_partner uuid references dw_partners(id) on delete set null,
  rider_partner uuid references dw_partners(id) on delete set null,
  hub_partner uuid references dw_partners(id) on delete set null,
  needs_manual_assignment boolean not null default false,
  promised_by timestamptz,
  arrived_at timestamptz,
  started_at timestamptz,
  sla_breached boolean not null default false,
  sla_credit_paise integer,
  delivery_otp text,
  otp_attempts jsonb,
  dispatch jsonb,
  pickup_checklist jsonb,
  parts_used jsonb not null default '[]',
  payment_collection jsonb,
  no_show jsonb,
  customer_rating_by_partner jsonb,
  idem_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dw_bookings_booking_code_key unique (booking_code)
);
alter table dw_bookings add column if not exists booking_code text;
alter table dw_bookings add column if not exists status text not null default 'BOOKED' check (status in ('BOOKED', 'PARTNER_ASSIGNED', 'ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'AT_HUB', 'QUOTE_SENT', 'APPROVED', 'DECLINED', 'IN_PROGRESS', 'OUT_FOR_DELIVERY', 'COMPLETED', 'RETURNED', 'CANCELLED'));
alter table dw_bookings add column if not exists title text;
alter table dw_bookings add column if not exists device_label text;
alter table dw_bookings add column if not exists customer uuid;
alter table dw_bookings add column if not exists category uuid;
alter table dw_bookings add column if not exists flow text  check (flow in ('pickup_drop', 'doorstep', 'roadside'));
alter table dw_bookings add column if not exists status_changed_at timestamptz;
alter table dw_bookings add column if not exists completed_at timestamptz;
alter table dw_bookings add column if not exists lines jsonb not null default '[]';
alter table dw_bookings add column if not exists device jsonb;
alter table dw_bookings add column if not exists problem jsonb;
alter table dw_bookings add column if not exists address jsonb;
alter table dw_bookings add column if not exists schedule jsonb;
alter table dw_bookings add column if not exists schedule_label text;
alter table dw_bookings add column if not exists alt_whatsapp text;
alter table dw_bookings add column if not exists pricing jsonb;
alter table dw_bookings add column if not exists quote jsonb;
alter table dw_bookings add column if not exists payment jsonb;
alter table dw_bookings add column if not exists partner jsonb;
alter table dw_bookings add column if not exists service_otp text;
alter table dw_bookings add column if not exists warranty_days integer not null default 0;
alter table dw_bookings add column if not exists cancellation jsonb;
alter table dw_bookings add column if not exists rating jsonb;
alter table dw_bookings add column if not exists trust_accepted boolean not null default false;
alter table dw_bookings add column if not exists assigned_partner uuid;
alter table dw_bookings add column if not exists rider_partner uuid;
alter table dw_bookings add column if not exists hub_partner uuid;
alter table dw_bookings add column if not exists needs_manual_assignment boolean not null default false;
alter table dw_bookings add column if not exists promised_by timestamptz;
alter table dw_bookings add column if not exists arrived_at timestamptz;
alter table dw_bookings add column if not exists started_at timestamptz;
alter table dw_bookings add column if not exists sla_breached boolean not null default false;
alter table dw_bookings add column if not exists sla_credit_paise integer;
alter table dw_bookings add column if not exists delivery_otp text;
alter table dw_bookings add column if not exists otp_attempts jsonb;
alter table dw_bookings add column if not exists dispatch jsonb;
alter table dw_bookings add column if not exists pickup_checklist jsonb;
alter table dw_bookings add column if not exists parts_used jsonb not null default '[]';
alter table dw_bookings add column if not exists payment_collection jsonb;
alter table dw_bookings add column if not exists no_show jsonb;
alter table dw_bookings add column if not exists customer_rating_by_partner jsonb;
alter table dw_bookings add column if not exists idem_key text;
alter table dw_bookings enable row level security;
drop trigger if exists dw_bookings_touch on dw_bookings;
create trigger dw_bookings_touch before update on dw_bookings for each row execute function dw_touch_updated_at();
create index if not exists dw_bookings_customer_idx on dw_bookings (customer);
create index if not exists dw_bookings_status_idx on dw_bookings (status);
create index if not exists dw_bookings_assigned_partner_idx on dw_bookings (assigned_partner);
create index if not exists dw_bookings_rider_partner_idx on dw_bookings (rider_partner);
create index if not exists dw_bookings_hub_partner_idx on dw_bookings (hub_partner);
create index if not exists dw_bookings_idem_key_idx on dw_bookings (idem_key);
comment on table dw_bookings is 'Bookings. Status changes only through the function (state machine); see booking-events for history.';

-- booking-events: Append-only booking history.
create table if not exists dw_booking_events (
  id uuid primary key default gen_random_uuid(),
  booking uuid not null references dw_bookings(id) on delete cascade,
  status text not null,
  actor text not null check (actor in ('customer', 'hub', 'system', 'partner')),
  partner uuid,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table dw_booking_events add column if not exists booking uuid;
alter table dw_booking_events add column if not exists status text;
alter table dw_booking_events add column if not exists actor text  check (actor in ('customer', 'hub', 'system', 'partner'));
alter table dw_booking_events add column if not exists partner uuid;
alter table dw_booking_events add column if not exists note text;
alter table dw_booking_events enable row level security;
drop trigger if exists dw_booking_events_touch on dw_booking_events;
create trigger dw_booking_events_touch before update on dw_booking_events for each row execute function dw_touch_updated_at();
create index if not exists dw_booking_events_booking_idx on dw_booking_events (booking);
comment on table dw_booking_events is 'Append-only booking history.';

-- warranties: Issued when a booking completes.
create table if not exists dw_warranties (
  id uuid primary key default gen_random_uuid(),
  booking uuid not null references dw_bookings(id) on delete cascade,
  customer uuid not null references dw_users(id) on delete cascade,
  title text not null,
  device_label text,
  days integer not null check (days >= 1),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'claimed', 'expired', 'void')),
  claims_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table dw_warranties add column if not exists booking uuid;
alter table dw_warranties add column if not exists customer uuid;
alter table dw_warranties add column if not exists title text;
alter table dw_warranties add column if not exists device_label text;
alter table dw_warranties add column if not exists days integer  check (days >= 1);
alter table dw_warranties add column if not exists starts_at timestamptz;
alter table dw_warranties add column if not exists ends_at timestamptz;
alter table dw_warranties add column if not exists status text not null default 'active' check (status in ('active', 'claimed', 'expired', 'void'));
alter table dw_warranties add column if not exists claims_used integer not null default 0;
alter table dw_warranties enable row level security;
drop trigger if exists dw_warranties_touch on dw_warranties;
create trigger dw_warranties_touch before update on dw_warranties for each row execute function dw_touch_updated_at();
create index if not exists dw_warranties_customer_idx on dw_warranties (customer);
create index if not exists dw_warranties_booking_idx on dw_warranties (booking);
comment on table dw_warranties is 'Issued when a booking completes.';

-- support-tickets: Customer support tickets. Reply by editing reply/status.
create table if not exists dw_support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text,
  user_id uuid not null references dw_users(id) on delete cascade,
  booking uuid references dw_bookings(id) on delete set null,
  warranty uuid references dw_warranties(id) on delete set null,
  topic text not null check (topic in ('booking', 'payment', 'warranty', 'account', 'other')),
  message text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  reply text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table dw_support_tickets add column if not exists ticket_code text;
alter table dw_support_tickets add column if not exists user_id uuid;
alter table dw_support_tickets add column if not exists booking uuid;
alter table dw_support_tickets add column if not exists warranty uuid;
alter table dw_support_tickets add column if not exists topic text  check (topic in ('booking', 'payment', 'warranty', 'account', 'other'));
alter table dw_support_tickets add column if not exists message text;
alter table dw_support_tickets add column if not exists status text not null default 'open' check (status in ('open', 'in_progress', 'resolved'));
alter table dw_support_tickets add column if not exists reply text;
alter table dw_support_tickets enable row level security;
drop trigger if exists dw_support_tickets_touch on dw_support_tickets;
create trigger dw_support_tickets_touch before update on dw_support_tickets for each row execute function dw_touch_updated_at();
create index if not exists dw_support_tickets_user_id_idx on dw_support_tickets (user_id);
comment on table dw_support_tickets is 'Customer support tickets. Reply by editing reply/status.';

-- problem-videos: Problem videos customers record before booking (private storage bucket).
create table if not exists dw_problem_videos (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references dw_users(id) on delete cascade,
  booking uuid references dw_bookings(id) on delete set null,
  duration_sec integer,
  filename text,
  mime_type text,
  filesize bigint,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table dw_problem_videos add column if not exists owner uuid;
alter table dw_problem_videos add column if not exists booking uuid;
alter table dw_problem_videos add column if not exists duration_sec integer;
alter table dw_problem_videos add column if not exists filename text;
alter table dw_problem_videos add column if not exists mime_type text;
alter table dw_problem_videos add column if not exists filesize bigint;
alter table dw_problem_videos add column if not exists storage_path text;
alter table dw_problem_videos enable row level security;
drop trigger if exists dw_problem_videos_touch on dw_problem_videos;
create trigger dw_problem_videos_touch before update on dw_problem_videos for each row execute function dw_touch_updated_at();
create index if not exists dw_problem_videos_owner_idx on dw_problem_videos (owner);
create index if not exists dw_problem_videos_booking_idx on dw_problem_videos (booking);
comment on table dw_problem_videos is 'Problem videos customers record before booking (private storage bucket).';

-- job-offers: One row per offered leg. accept_lock is unique: the first accept wins.
create table if not exists dw_job_offers (
  id uuid primary key default gen_random_uuid(),
  booking uuid not null references dw_bookings(id) on delete cascade,
  partner uuid not null references dw_partners(id) on delete cascade,
  status text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'expired', 'withdrawn')),
  offered_at timestamptz not null,
  expires_at timestamptz not null,
  responded_at timestamptz,
  decline_reason text,
  distance_km double precision,
  estimated_earning_paise integer,
  rank integer,
  leg text not null default 'visit' check (leg in ('visit', 'pickup', 'hub', 'delivery')),
  round integer not null default 0,
  offer_key text not null,
  accept_lock text,
  manual boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dw_job_offers_offer_key_key unique (offer_key),
  constraint dw_job_offers_accept_lock_key unique (accept_lock)
);
alter table dw_job_offers add column if not exists booking uuid;
alter table dw_job_offers add column if not exists partner uuid;
alter table dw_job_offers add column if not exists status text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'expired', 'withdrawn'));
alter table dw_job_offers add column if not exists offered_at timestamptz;
alter table dw_job_offers add column if not exists expires_at timestamptz;
alter table dw_job_offers add column if not exists responded_at timestamptz;
alter table dw_job_offers add column if not exists decline_reason text;
alter table dw_job_offers add column if not exists distance_km double precision;
alter table dw_job_offers add column if not exists estimated_earning_paise integer;
alter table dw_job_offers add column if not exists rank integer;
alter table dw_job_offers add column if not exists leg text not null default 'visit' check (leg in ('visit', 'pickup', 'hub', 'delivery'));
alter table dw_job_offers add column if not exists round integer not null default 0;
alter table dw_job_offers add column if not exists offer_key text;
alter table dw_job_offers add column if not exists accept_lock text;
alter table dw_job_offers add column if not exists manual boolean not null default false;
alter table dw_job_offers enable row level security;
drop trigger if exists dw_job_offers_touch on dw_job_offers;
create trigger dw_job_offers_touch before update on dw_job_offers for each row execute function dw_touch_updated_at();
create index if not exists dw_job_offers_booking_idx on dw_job_offers (booking);
create index if not exists dw_job_offers_partner_idx on dw_job_offers (partner);
create index if not exists dw_job_offers_status_idx on dw_job_offers (status);
comment on table dw_job_offers is 'One row per offered leg. accept_lock is unique: the first accept wins.';

-- job-media: Private job evidence: pickup photos, bills, quote videos (private storage bucket).
create table if not exists dw_job_media (
  id uuid primary key default gen_random_uuid(),
  booking uuid not null references dw_bookings(id) on delete cascade,
  partner uuid not null references dw_partners(id) on delete cascade,
  kind text not null,
  filename text,
  mime_type text,
  filesize bigint,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table dw_job_media add column if not exists booking uuid;
alter table dw_job_media add column if not exists partner uuid;
alter table dw_job_media add column if not exists kind text;
alter table dw_job_media add column if not exists filename text;
alter table dw_job_media add column if not exists mime_type text;
alter table dw_job_media add column if not exists filesize bigint;
alter table dw_job_media add column if not exists storage_path text;
alter table dw_job_media enable row level security;
drop trigger if exists dw_job_media_touch on dw_job_media;
create trigger dw_job_media_touch before update on dw_job_media for each row execute function dw_touch_updated_at();
create index if not exists dw_job_media_booking_idx on dw_job_media (booking);
comment on table dw_job_media is 'Private job evidence: pickup photos, bills, quote videos (private storage bucket).';

-- partner-locations: GPS breadcrumbs, kept 24 hours.
create table if not exists dw_partner_locations (
  id uuid primary key default gen_random_uuid(),
  partner uuid not null references dw_partners(id) on delete cascade,
  booking uuid references dw_bookings(id) on delete set null,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  heading double precision,
  speed double precision,
  recorded_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table dw_partner_locations add column if not exists partner uuid;
alter table dw_partner_locations add column if not exists booking uuid;
alter table dw_partner_locations add column if not exists lat double precision;
alter table dw_partner_locations add column if not exists lng double precision;
alter table dw_partner_locations add column if not exists accuracy double precision;
alter table dw_partner_locations add column if not exists heading double precision;
alter table dw_partner_locations add column if not exists speed double precision;
alter table dw_partner_locations add column if not exists recorded_at timestamptz;
alter table dw_partner_locations enable row level security;
drop trigger if exists dw_partner_locations_touch on dw_partner_locations;
create trigger dw_partner_locations_touch before update on dw_partner_locations for each row execute function dw_touch_updated_at();
create index if not exists dw_partner_locations_partner_idx on dw_partner_locations (partner);
create index if not exists dw_partner_locations_recorded_at_idx on dw_partner_locations (recorded_at);
comment on table dw_partner_locations is 'GPS breadcrumbs, kept 24 hours.';

-- payouts: Partner payouts. Set status to paid (with reference) or failed; failed refunds automatically.
create table if not exists dw_payouts (
  id uuid primary key default gen_random_uuid(),
  partner uuid not null references dw_partners(id) on delete cascade,
  amount_paise integer not null check (amount_paise >= 1),
  status text not null default 'requested' check (status in ('requested', 'processing', 'paid', 'failed')),
  reference text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table dw_payouts add column if not exists partner uuid;
alter table dw_payouts add column if not exists amount_paise integer  check (amount_paise >= 1);
alter table dw_payouts add column if not exists status text not null default 'requested' check (status in ('requested', 'processing', 'paid', 'failed'));
alter table dw_payouts add column if not exists reference text;
alter table dw_payouts add column if not exists period_start timestamptz;
alter table dw_payouts add column if not exists period_end timestamptz;
alter table dw_payouts enable row level security;
drop trigger if exists dw_payouts_touch on dw_payouts;
create trigger dw_payouts_touch before update on dw_payouts for each row execute function dw_touch_updated_at();
create index if not exists dw_payouts_partner_idx on dw_payouts (partner);
comment on table dw_payouts is 'Partner payouts. Set status to paid (with reference) or failed; failed refunds automatically.';

-- earnings-ledger: Append-only partner money ledger (paise; credits positive, cash/payouts negative).
create table if not exists dw_earnings_ledger (
  id uuid primary key default gen_random_uuid(),
  partner uuid not null references dw_partners(id) on delete cascade,
  booking uuid references dw_bookings(id) on delete set null,
  type text not null check (type in ('job_earning', 'visit_share', 'parts_reimbursement', 'incentive', 'penalty', 'cod_collected', 'cod_deposited', 'payout', 'adjustment')),
  amount_paise integer not null,
  note text,
  payout uuid references dw_payouts(id) on delete set null,
  entry_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dw_earnings_ledger_entry_key_key unique (entry_key)
);
alter table dw_earnings_ledger add column if not exists partner uuid;
alter table dw_earnings_ledger add column if not exists booking uuid;
alter table dw_earnings_ledger add column if not exists type text  check (type in ('job_earning', 'visit_share', 'parts_reimbursement', 'incentive', 'penalty', 'cod_collected', 'cod_deposited', 'payout', 'adjustment'));
alter table dw_earnings_ledger add column if not exists amount_paise integer;
alter table dw_earnings_ledger add column if not exists note text;
alter table dw_earnings_ledger add column if not exists payout uuid;
alter table dw_earnings_ledger add column if not exists entry_key text;
alter table dw_earnings_ledger enable row level security;
drop trigger if exists dw_earnings_ledger_touch on dw_earnings_ledger;
create trigger dw_earnings_ledger_touch before update on dw_earnings_ledger for each row execute function dw_touch_updated_at();
create index if not exists dw_earnings_ledger_partner_idx on dw_earnings_ledger (partner);
comment on table dw_earnings_ledger is 'Append-only partner money ledger (paise; credits positive, cash/payouts negative).';

-- partner-tickets: Partner support + SOS (urgent = true).
create table if not exists dw_partner_tickets (
  id uuid primary key default gen_random_uuid(),
  partner uuid not null references dw_partners(id) on delete cascade,
  booking uuid references dw_bookings(id) on delete set null,
  topic text not null check (topic in ('safety', 'payment', 'app', 'customer', 'other')),
  message text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  urgent boolean not null default false,
  sos jsonb,
  reply text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table dw_partner_tickets add column if not exists partner uuid;
alter table dw_partner_tickets add column if not exists booking uuid;
alter table dw_partner_tickets add column if not exists topic text  check (topic in ('safety', 'payment', 'app', 'customer', 'other'));
alter table dw_partner_tickets add column if not exists message text;
alter table dw_partner_tickets add column if not exists status text not null default 'open' check (status in ('open', 'in_progress', 'resolved'));
alter table dw_partner_tickets add column if not exists urgent boolean not null default false;
alter table dw_partner_tickets add column if not exists sos jsonb;
alter table dw_partner_tickets add column if not exists reply text;
alter table dw_partner_tickets enable row level security;
drop trigger if exists dw_partner_tickets_touch on dw_partner_tickets;
create trigger dw_partner_tickets_touch before update on dw_partner_tickets for each row execute function dw_touch_updated_at();
create index if not exists dw_partner_tickets_partner_idx on dw_partner_tickets (partner);
comment on table dw_partner_tickets is 'Partner support + SOS (urgent = true).';

-- Storage buckets: private (KYC, job media, problem videos) and public (catalog images).
insert into storage.buckets (id, name, public) values ('make-4d6fa028-private', 'make-4d6fa028-private', false)
  on conflict (id) do update set public = false;
insert into storage.buckets (id, name, public) values ('make-4d6fa028-public', 'make-4d6fa028-public', true)
  on conflict (id) do update set public = true;
