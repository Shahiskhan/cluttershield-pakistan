-- ClutterShield Pakistan starter schema. Private records are intentionally not
-- exposed through PostgREST. Use narrow, caller-checked RPCs for supported flows.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create extension if not exists pgcrypto with schema extensions;

create type private.app_role as enum (
  'citizen', 'moderator', 'analyst', 'mentor', 'senior_reviewer',
  'institution_liaison', 'platform_admin', 'auditor', 'security_admin'
);
create type private.report_category as enum (
  'phishing_url', 'payment_fraud', 'impersonation', 'account_takeover',
  'marketplace_fraud', 'investment_job_scam', 'delivery_fraud', 'other'
);
create type private.report_channel as enum (
  'sms', 'whatsapp', 'social_media', 'phone_call', 'email', 'website',
  'marketplace', 'other'
);
create type private.report_status as enum (
  'submitted', 'triage', 'needs_information', 'rejected', 'unverified_lead',
  'under_review', 'accepted', 'closed', 'referred'
);
create type private.report_priority as enum ('normal', 'high', 'urgent');
create type private.indicator_type as enum (
  'domain', 'url', 'phone_number', 'social_profile', 'wallet_account', 'crypto_address'
);
create type private.indicator_scope as enum ('exact', 'host', 'path');
create type private.risk_category as enum (
  'phishing_impersonation', 'payment_fraud', 'account_takeover',
  'delivery_fraud', 'investment_job_scam', 'other'
);
create type private.indicator_status as enum (
  'proposed', 'pending_review', 'approved_limited', 'published', 'suspended',
  'challenged', 'revoked', 'expired', 'rejected'
);
create type private.case_state as enum (
  'draft', 'sanitized', 'available', 'claim_requested', 'assigned', 'in_progress',
  'findings_submitted', 'mentor_review', 'changes_requested', 'accepted',
  'declined', 'rejected', 'case_closed'
);
create type private.assignment_state as enum (
  'claim_requested', 'assigned', 'in_progress', 'findings_submitted',
  'declined', 'released', 'expired'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  locale text not null default 'en' check (locale in ('en', 'ur')),
  region_code text check (region_code is null or char_length(region_code) <= 16),
  account_state text not null default 'active' check (account_state in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role private.app_role not null,
  scope_type text not null default 'global' check (scope_type in ('global', 'case', 'institution')),
  scope_id uuid,
  granted_by uuid references public.profiles(id),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  reason_code text not null,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > starts_at),
  check ((scope_type = 'global' and scope_id is null) or (scope_type <> 'global' and scope_id is not null))
);
create index role_assignments_active_lookup on private.role_assignments (user_id, role, starts_at, expires_at)
  where revoked_at is null;

create table private.citizen_reports (
  id uuid primary key default gen_random_uuid(),
  public_ref text not null unique,
  submission_key uuid not null,
  reporter_user_id uuid references public.profiles(id) on delete set null,
  category private.report_category not null,
  channel private.report_channel not null,
  incident_at timestamptz,
  incident_timezone text check (incident_timezone is null or char_length(incident_timezone) <= 64),
  narrative text not null check (char_length(narrative) between 10 and 5000),
  estimated_loss numeric(18,2) check (estimated_loss is null or estimated_loss >= 0),
  currency char(3),
  status private.report_status not null default 'submitted',
  priority private.report_priority not null default 'normal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (reporter_user_id, submission_key)
);
create index citizen_reports_triage on private.citizen_reports (status, created_at desc);
create index citizen_reports_owner on private.citizen_reports (reporter_user_id, created_at desc);

create table private.report_status_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references private.citizen_reports(id) on delete restrict,
  from_status private.report_status,
  to_status private.report_status not null,
  actor_id uuid references public.profiles(id),
  reason_code text not null,
  safe_note text check (safe_note is null or char_length(safe_note) <= 500),
  created_at timestamptz not null default now()
);

create table private.indicators (
  id uuid primary key default gen_random_uuid(),
  type private.indicator_type not null,
  canonical_value_ciphertext bytea not null,
  canonical_hash bytea not null check (octet_length(canonical_hash) = 32),
  hash_key_version text not null,
  display_value_masked text not null check (char_length(display_value_masked) <= 256),
  scope private.indicator_scope not null default 'exact',
  risk_category private.risk_category not null default 'other',
  confidence smallint not null default 0 check (confidence between 0 and 100),
  evidence_grade text check (evidence_grade is null or evidence_grade in ('unverified', 'limited', 'corroborated', 'authoritative')),
  status private.indicator_status not null default 'proposed',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  normalization_version text not null default 'v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (type, canonical_hash, hash_key_version)
);

create table private.report_indicators (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references private.citizen_reports(id) on delete restrict,
  indicator_id uuid not null references private.indicators(id) on delete restrict,
  relation text not null default 'reported_in',
  observed_at timestamptz not null default now(),
  source_note text check (source_note is null or char_length(source_note) <= 500),
  created_at timestamptz not null default now(),
  unique (report_id, indicator_id)
);

create table private.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  report_id uuid references private.citizen_reports(id) on delete restrict,
  consent_type text not null,
  notice_version text not null,
  choice boolean not null,
  purpose_code text not null,
  recorded_at timestamptz not null default now(),
  withdrawn_at timestamptz
);

create table private.moderation_assignments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references private.citizen_reports(id) on delete restrict,
  moderator_id uuid not null references public.profiles(id) on delete restrict,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  check (expires_at > assigned_at)
);
create unique index moderation_assignment_one_active on private.moderation_assignments (report_id)
  where released_at is null;
create index moderation_assignment_actor on private.moderation_assignments (moderator_id, expires_at)
  where released_at is null;

create table private.osint_cases (
  id uuid primary key default gen_random_uuid(),
  case_ref text not null unique,
  title_safe text not null check (char_length(title_safe) between 3 and 160),
  sanitized_brief text not null check (char_length(sanitized_brief) between 10 and 5000),
  objective text not null check (char_length(objective) between 10 and 1000),
  scope_json jsonb not null default '{}'::jsonb check (jsonb_typeof(scope_json) = 'object'),
  allowed_sources text[] not null default '{}',
  prohibited_actions text[] not null default array['intrusion', 'credential_access', 'suspect_contact', 'doxxing'],
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  state private.case_state not null default 'draft',
  max_assignments smallint not null default 1 check (max_assignments between 1 and 10),
  deadline_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table private.case_assignments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references private.osint_cases(id) on delete restrict,
  analyst_id uuid not null references public.profiles(id) on delete restrict,
  mentor_id uuid references public.profiles(id) on delete restrict,
  state private.assignment_state not null default 'claim_requested',
  claimed_at timestamptz not null default now(),
  assigned_at timestamptz,
  expires_at timestamptz,
  released_at timestamptz,
  conflict_check jsonb not null default '{}'::jsonb check (jsonb_typeof(conflict_check) = 'object'),
  created_by uuid not null references public.profiles(id),
  check (expires_at is null or assigned_at is not null)
);
create unique index case_assignment_one_open_per_analyst on private.case_assignments (case_id, analyst_id)
  where state in ('claim_requested', 'assigned', 'in_progress', 'findings_submitted');
create index case_assignments_actor_state on private.case_assignments (analyst_id, state, expires_at);

create table private.audit_events (
  id bigint generated always as identity primary key,
  event_id uuid not null unique default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  actor_role_snapshot text,
  action text not null,
  object_type text not null,
  object_id uuid,
  purpose_code text not null,
  decision text,
  before_hash bytea,
  after_hash bytea,
  created_at timestamptz not null default now(),
  correlation_id uuid,
  metadata_min jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata_min) = 'object')
);
create index audit_events_object on private.audit_events (object_type, object_id, created_at desc);
create index audit_events_actor on private.audit_events (actor_id, created_at desc);

create or replace function private.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, private
as $$
begin
  raise exception 'append-only record';
end;
$$;
revoke all on function private.reject_append_only_mutation() from public, anon, authenticated;

create trigger audit_events_append_only
before update or delete on private.audit_events
for each row execute function private.reject_append_only_mutation();
create trigger report_status_events_append_only
before update or delete on private.report_status_events
for each row execute function private.reject_append_only_mutation();

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, private
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.set_updated_at() from public, anon, authenticated;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  insert into private.role_assignments (user_id, role, reason_code)
  values (new.id, 'citizen', 'account_registration');
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();
