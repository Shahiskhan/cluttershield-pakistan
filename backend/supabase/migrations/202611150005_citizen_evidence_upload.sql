-- Evidence is uploaded through an authenticated Edge Function into a private
-- quarantine bucket. Browser roles receive no table or object access.
create table private.evidence_objects (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references private.citizen_reports(id) on delete restrict,
  object_key text not null unique,
  claimed_content_type text not null check (claimed_content_type in (
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
  )),
  observed_content_type text check (observed_content_type is null or observed_content_type in (
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
  )),
  byte_size bigint not null check (byte_size between 1 and 5242880),
  sha256 bytea check (sha256 is null or octet_length(sha256) = 32),
  upload_state text not null default 'authorized'
    check (upload_state in ('authorized', 'uploaded', 'rejected')),
  quarantine_state text not null default 'quarantined'
    check (quarantine_state in ('quarantined', 'released', 'rejected')),
  scan_state text not null default 'pending'
    check (scan_state in ('pending', 'clean', 'malicious', 'error')),
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  upload_expires_at timestamptz not null,
  uploaded_at timestamptz,
  retained_until timestamptz not null default (now() + interval '30 days'),
  check ((upload_state = 'uploaded') = (uploaded_at is not null)),
  check (upload_expires_at > created_at),
  check (retained_until > created_at)
);

create index evidence_objects_report_state on private.evidence_objects (report_id, upload_state, created_at desc);
create index evidence_objects_retention on private.evidence_objects (retained_until)
  where upload_state = 'uploaded';

alter table private.evidence_objects enable row level security;
alter table private.evidence_objects force row level security;
drop policy if exists evidence_objects_no_client_access on private.evidence_objects;
create policy evidence_objects_no_client_access
  on private.evidence_objects as restrictive for all to anon, authenticated
  using (false) with check (false);
revoke all on table private.evidence_objects from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence-private',
  'evidence-private',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Restrictive policies prevent another permissive storage policy from
-- accidentally exposing this bucket to browser roles.
drop policy if exists evidence_private_objects_restrict_client on storage.objects;
create policy evidence_private_objects_restrict_client
  on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id <> 'evidence-private')
  with check (bucket_id <> 'evidence-private');

drop policy if exists evidence_private_bucket_restrict_client on storage.buckets;
create policy evidence_private_bucket_restrict_client
  on storage.buckets as restrictive for all to anon, authenticated
  using (id <> 'evidence-private')
  with check (id <> 'evidence-private');

create or replace function public.authorize_evidence_upload(
  _report_ref text,
  _file_name text,
  _content_type text,
  _byte_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_actor uuid := auth.uid();
  v_report private.citizen_reports%rowtype;
  v_evidence_id uuid := gen_random_uuid();
  v_object_key text := 'objects/' || gen_random_uuid()::text;
  v_expires_at timestamptz := now() + interval '5 minutes';
  v_count integer;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if not private.has_active_role('citizen') then
    raise exception using errcode = '42501', message = 'role_required';
  end if;
  if _report_ref is null or _report_ref !~ '^CS-[A-F0-9]{10}$'
      or _file_name is null or char_length(_file_name) not between 1 and 120
      or position('/' in _file_name) > 0
      or position(chr(92) in _file_name) > 0
      or _file_name ~ '[[:cntrl:]]'
      or _content_type is null
      or _content_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
      or _byte_size is null or _byte_size not between 1 and 5242880 then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;

  select * into v_report
  from private.citizen_reports
  where public_ref = upper(_report_ref)
    and reporter_user_id = v_actor
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'not_found';
  end if;
  if v_report.status in ('rejected', 'closed') then
    raise exception using errcode = '22023', message = 'evidence_not_allowed';
  end if;

  select count(*) into v_count
  from private.evidence_objects e
  where e.uploaded_by = v_actor
    and e.created_at > now() - interval '10 minutes';
  if v_count >= 15 then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;

  select count(*) into v_count
  from private.evidence_objects e
  where e.report_id = v_report.id
    and (e.upload_state = 'uploaded'
      or (e.upload_state = 'authorized' and e.upload_expires_at > now()));
  if v_count >= 3 then
    raise exception using errcode = 'P0001', message = 'evidence_limit_reached';
  end if;

  insert into private.evidence_objects (
    id, report_id, object_key, claimed_content_type, byte_size,
    uploaded_by, upload_expires_at, retained_until
  ) values (
    v_evidence_id, v_report.id, v_object_key, _content_type, _byte_size,
    v_actor, v_expires_at, now() + interval '30 days'
  );

  insert into private.audit_events (
    actor_id, actor_role_snapshot, action, object_type, object_id,
    purpose_code, decision, metadata_min
  ) values (
    v_actor, 'citizen', 'evidence.upload_authorized', 'evidence_object', v_evidence_id,
    'case_review', 'quarantined',
    jsonb_build_object('content_type', _content_type, 'byte_size', _byte_size)
  );

  return jsonb_build_object(
    'evidence_id', v_evidence_id,
    'object_key', v_object_key,
    'user_id', v_actor,
    'content_type', _content_type,
    'byte_size', _byte_size,
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.verify_evidence_upload_ticket(
  _evidence_id uuid,
  _object_key text,
  _content_type text,
  _byte_size bigint,
  _expires_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select auth.uid() is not null
    and private.has_active_role('citizen')
    and exists (
    select 1
    from private.evidence_objects e
    join private.citizen_reports r on r.id = e.report_id
    where e.id = _evidence_id
      and e.object_key = _object_key
      and e.claimed_content_type = _content_type
      and e.byte_size = _byte_size
      and e.upload_expires_at = _expires_at
      and e.upload_expires_at > now()
      and e.upload_state = 'authorized'
      and e.uploaded_by = auth.uid()
      and r.reporter_user_id = auth.uid()
      and r.status not in ('rejected', 'closed')
  );
$$;

create or replace function public.complete_evidence_upload(
  _evidence_id uuid,
  _object_key text,
  _actual_size bigint,
  _sha256 bytea,
  _observed_content_type text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_actor uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'role_required';
  end if;
  if _actual_size is null or _actual_size not between 1 and 5242880
      or _sha256 is null or octet_length(_sha256) <> 32
      or _observed_content_type is null
      or _observed_content_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;

  update private.evidence_objects e
  set upload_state = 'uploaded',
      sha256 = _sha256,
      observed_content_type = _observed_content_type,
      uploaded_at = now()
  where e.id = _evidence_id
    and e.object_key = _object_key
    and e.byte_size = _actual_size
    and e.claimed_content_type = _observed_content_type
    and e.upload_state = 'authorized'
    and e.upload_expires_at > now()
  returning e.uploaded_by into v_actor;
  if v_actor is null then
    raise exception using errcode = 'P0002', message = 'upload_not_authorized';
  end if;

  insert into private.audit_events (
    actor_id, actor_role_snapshot, action, object_type, object_id,
    purpose_code, decision, metadata_min
  ) values (
    v_actor, 'citizen', 'evidence.uploaded', 'evidence_object', _evidence_id,
    'case_review', 'quarantined',
    jsonb_build_object('content_type', _observed_content_type, 'byte_size', _actual_size)
  );
  return true;
end;
$$;

revoke all on function public.authorize_evidence_upload(text, text, text, bigint) from public, anon;
revoke all on function public.verify_evidence_upload_ticket(uuid, text, text, bigint, timestamptz) from public, anon;
revoke all on function public.complete_evidence_upload(uuid, text, bigint, bytea, text) from public, anon, authenticated;
grant execute on function public.authorize_evidence_upload(text, text, text, bigint) to authenticated;
grant execute on function public.verify_evidence_upload_ticket(uuid, text, text, bigint, timestamptz) to authenticated;
grant execute on function public.complete_evidence_upload(uuid, text, bigint, bytea, text) to service_role;
