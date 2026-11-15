-- Narrow RPCs are the only browser-facing path to private report/review records.
-- They derive the actor from auth.uid(); clients cannot set actor, status or confidence.

create or replace function private.has_active_role(_role private.app_role)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select exists (
    select 1
    from private.role_assignments ra
    where ra.user_id = auth.uid()
      and ra.role = _role
      and ra.revoked_at is null
      and ra.starts_at <= now()
      and (ra.expires_at is null or ra.expires_at > now())
  );
$$;
revoke all on function private.has_active_role(private.app_role) from public, anon, authenticated;

create or replace function public.get_my_roles()
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select coalesce(array_agg(distinct ra.role::text order by ra.role::text), array[]::text[])
  from private.role_assignments ra
  where ra.user_id = auth.uid()
    and ra.revoked_at is null
    and ra.starts_at <= now()
    and (ra.expires_at is null or ra.expires_at > now());
$$;

create or replace function public.submit_citizen_report(
  _submission_key uuid,
  _category text,
  _channel text,
  _incident_at timestamptz,
  _incident_timezone text,
  _narrative text,
  _indicator_type text,
  _indicator_ciphertext bytea,
  _indicator_hash bytea,
  _hash_key_version text,
  _indicator_masked text,
  _notice_version text,
  _correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_actor uuid := auth.uid();
  v_report_id uuid;
  v_report_ref text;
  v_indicator_id uuid;
  v_status private.report_status;
  v_category private.report_category;
  v_channel private.report_channel;
  v_type private.indicator_type;
  v_existing private.citizen_reports%rowtype;
begin
  if v_actor is null then raise exception using errcode = '28000', message = 'authentication_required'; end if;
  if not private.has_active_role('citizen') then raise exception using errcode = '42501', message = 'role_required'; end if;
  if _submission_key is null or _correlation_id is null then raise exception using errcode = '22023', message = 'invalid_request'; end if;
  if _narrative is null or char_length(btrim(_narrative)) < 10 or char_length(_narrative) > 5000 then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  if _incident_timezone is not null and char_length(_incident_timezone) > 64 then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  if _notice_version is distinct from 'citizen-notice-1.0' then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  if _indicator_ciphertext is null or octet_length(_indicator_ciphertext) < 28
      or _indicator_hash is null or octet_length(_indicator_hash) <> 32
      or _hash_key_version is null or char_length(_hash_key_version) > 24
      or _indicator_masked is null or char_length(_indicator_masked) > 256 then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;

  begin
    v_category := _category::private.report_category;
    v_channel := _channel::private.report_channel;
    v_type := _indicator_type::private.indicator_type;
  exception when others then
    raise exception using errcode = '22023', message = 'invalid_request';
  end;
  if v_type not in ('domain', 'url', 'phone_number') then
    raise exception using errcode = '22023', message = 'unsupported_indicator_type';
  end if;

  select * into v_existing
  from private.citizen_reports
  where reporter_user_id = v_actor and submission_key = _submission_key;
  if found then
    return jsonb_build_object('report_ref', v_existing.public_ref, 'status', v_existing.status::text,
      'received_at', v_existing.created_at, 'idempotent_replay', true);
  end if;

  if (select count(*) from private.citizen_reports
      where reporter_user_id = v_actor and created_at > now() - interval '10 minutes') >= 5 then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;

  v_report_id := gen_random_uuid();
  v_report_ref := 'CS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into private.citizen_reports (
    id, public_ref, submission_key, reporter_user_id, category, channel,
    incident_at, incident_timezone, narrative
  ) values (
    v_report_id, v_report_ref, _submission_key, v_actor, v_category, v_channel,
    _incident_at, nullif(_incident_timezone, ''), btrim(_narrative)
  );

  insert into private.report_status_events (report_id, from_status, to_status, actor_id, reason_code)
  values (v_report_id, null, 'submitted', v_actor, 'citizen_submission');

  insert into private.consent_records (user_id, report_id, consent_type, notice_version, choice, purpose_code)
  values (v_actor, v_report_id, 'privacy_notice', _notice_version, true, 'case_review'),
         (v_actor, v_report_id, 'privacy_notice', _notice_version, true, 'threat_intelligence');

  insert into private.indicators (
    type, canonical_value_ciphertext, canonical_hash, hash_key_version,
    display_value_masked, risk_category, confidence, status
  ) values (
    v_type, _indicator_ciphertext, _indicator_hash, _hash_key_version,
    btrim(_indicator_masked), 'other', 0, 'proposed'
  ) on conflict (type, canonical_hash, hash_key_version) do nothing;

  select id into v_indicator_id from private.indicators
  where type = v_type and canonical_hash = _indicator_hash and hash_key_version = _hash_key_version;
  insert into private.report_indicators (report_id, indicator_id)
  values (v_report_id, v_indicator_id) on conflict (report_id, indicator_id) do nothing;

  insert into private.audit_events (
    actor_id, actor_role_snapshot, action, object_type, object_id,
    purpose_code, decision, correlation_id, metadata_min
  ) values (
    v_actor, 'citizen', 'report.created', 'citizen_report', v_report_id,
    'case_review', 'submitted', _correlation_id, jsonb_build_object('channel', v_channel::text)
  );

  select status into v_status from private.citizen_reports where id = v_report_id;
  return jsonb_build_object('report_ref', v_report_ref, 'status', v_status::text,
    'received_at', now(), 'idempotent_replay', false);
end;
$$;

create or replace function public.get_own_report(_report_ref text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select jsonb_build_object(
    'report_ref', r.public_ref,
    'status', r.status::text,
    'category', r.category::text,
    'created_at', r.created_at,
    'updated_at', r.updated_at
  )
  from private.citizen_reports r
  where r.public_ref = _report_ref and r.reporter_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.moderation_queue(_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_actor uuid := auth.uid();
  v_items jsonb;
begin
  if v_actor is null or not private.has_active_role('moderator') then
    raise exception using errcode = '42501', message = 'role_required';
  end if;
  insert into private.audit_events (actor_id, actor_role_snapshot, action, object_type,
    object_id, purpose_code, decision, metadata_min)
  select v_actor, 'moderator', 'report.read_for_triage', 'citizen_report', r.id,
    'triage', 'allowed', '{}'::jsonb
  from private.citizen_reports r
  join private.moderation_assignments ma on ma.report_id = r.id
  where ma.moderator_id = v_actor and ma.released_at is null and ma.expires_at > now()
    and r.status in ('submitted', 'triage', 'needs_information', 'under_review')
  order by r.created_at desc
  limit greatest(1, least(coalesce(_limit, 25), 50));
  select coalesce(jsonb_agg(item order by created_at desc), '[]'::jsonb) into v_items
  from (
    select jsonb_build_object(
      'id', r.id,
      'report_ref', r.public_ref,
      'category', r.category::text,
      'channel', r.channel::text,
      'status', r.status::text,
      'priority', r.priority::text,
      'narrative', r.narrative,
      'created_at', r.created_at,
      'indicator_masked', i.display_value_masked
    ) as item, r.created_at
    from private.citizen_reports r
    join private.moderation_assignments ma on ma.report_id = r.id
    left join private.report_indicators ri on ri.report_id = r.id
    left join private.indicators i on i.id = ri.indicator_id
    where ma.moderator_id = v_actor and ma.released_at is null and ma.expires_at > now()
      and r.status in ('submitted', 'triage', 'needs_information', 'under_review')
    order by r.created_at desc
    limit greatest(1, least(coalesce(_limit, 25), 50))
  ) q;

  return v_items;
end;
$$;

create or replace function public.moderate_report(
  _report_id uuid,
  _to_status text,
  _reason_code text,
  _safe_note text,
  _correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_report private.citizen_reports%rowtype;
  v_next private.report_status;
begin
  if v_actor is null or not private.has_active_role('moderator') then
    raise exception using errcode = '42501', message = 'role_required';
  end if;
  if _report_id is null or _correlation_id is null or _reason_code is null
      or char_length(_reason_code) > 64 or (_safe_note is not null and char_length(_safe_note) > 500) then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  if not exists (
    select 1 from private.moderation_assignments ma
    where ma.report_id = _report_id and ma.moderator_id = v_actor
      and ma.released_at is null and ma.expires_at > now()
  ) then raise exception using errcode = '42501', message = 'scope_required'; end if;

  begin v_next := _to_status::private.report_status;
  exception when others then raise exception using errcode = '22023', message = 'invalid_request'; end;
  select * into v_report from private.citizen_reports where id = _report_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'not_found'; end if;

  if not (
    (v_report.status = 'submitted' and v_next in ('triage', 'rejected', 'unverified_lead')) or
    (v_report.status = 'triage' and v_next in ('needs_information', 'rejected', 'unverified_lead', 'under_review')) or
    (v_report.status = 'needs_information' and v_next in ('triage', 'rejected', 'unverified_lead')) or
    (v_report.status = 'unverified_lead' and v_next in ('under_review', 'closed')) or
    (v_report.status = 'under_review' and v_next in ('accepted', 'closed'))
  ) then raise exception using errcode = 'P0001', message = 'invalid_transition'; end if;

  update private.citizen_reports set status = v_next, updated_at = now(),
    closed_at = case when v_next in ('rejected', 'closed') then now() else closed_at end
  where id = _report_id;
  insert into private.report_status_events (report_id, from_status, to_status, actor_id, reason_code, safe_note)
  values (_report_id, v_report.status, v_next, v_actor, _reason_code, nullif(btrim(_safe_note), ''));
  insert into private.audit_events (actor_id, actor_role_snapshot, action, object_type, object_id,
    purpose_code, decision, before_hash, after_hash, correlation_id, metadata_min)
  values (v_actor, 'moderator', 'report.status_changed', 'citizen_report', _report_id,
    'triage', v_next::text, extensions.digest(v_report.status::text, 'sha256'), extensions.digest(v_next::text, 'sha256'),
    _correlation_id, jsonb_build_object('reason_code', _reason_code));
  return jsonb_build_object('report_ref', v_report.public_ref, 'status', v_next::text, 'updated_at', now());
end;
$$;

create or replace function public.analyst_case_summaries()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not private.has_active_role('analyst') then
    raise exception using errcode = '42501', message = 'role_required';
  end if;
  return jsonb_build_object(
    'available', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'case_ref', c.case_ref,
        'title', c.title_safe, 'brief', c.sanitized_brief, 'objective', c.objective,
        'allowed_sources', c.allowed_sources, 'prohibited_actions', c.prohibited_actions,
        'deadline_at', c.deadline_at, 'state', c.state::text)
        order by c.created_at desc)
      from private.osint_cases c where c.state = 'available' and (c.deadline_at is null or c.deadline_at > now())
    ), '[]'::jsonb),
    'my_claims', coalesce((
      select jsonb_agg(jsonb_build_object('case_id', ca.case_id, 'case_ref', c.case_ref,
        'title', c.title_safe, 'state', ca.state::text, 'claimed_at', ca.claimed_at)
        order by ca.claimed_at desc)
      from private.case_assignments ca join private.osint_cases c on c.id = ca.case_id
      where ca.analyst_id = v_actor and ca.state in ('claim_requested', 'assigned', 'in_progress', 'findings_submitted')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.request_case_claim(_case_id uuid, _conflict_check jsonb, _correlation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_actor uuid := auth.uid();
  v_case private.osint_cases%rowtype;
  v_assignment_id uuid;
  v_count integer;
begin
  if v_actor is null or not private.has_active_role('analyst') then
    raise exception using errcode = '42501', message = 'role_required';
  end if;
  if _case_id is null or _correlation_id is null or jsonb_typeof(coalesce(_conflict_check, '{}'::jsonb)) <> 'object'
      or octet_length(coalesce(_conflict_check, '{}'::jsonb)::text) > 2000 then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  select * into v_case from private.osint_cases where id = _case_id for update;
  if not found or v_case.state <> 'available' or (v_case.deadline_at is not null and v_case.deadline_at <= now()) then
    raise exception using errcode = 'P0002', message = 'not_available';
  end if;
  select count(*) into v_count from private.case_assignments ca
    where ca.case_id = _case_id and ca.state in ('claim_requested', 'assigned', 'in_progress', 'findings_submitted');
  if v_count >= v_case.max_assignments then raise exception using errcode = 'P0001', message = 'capacity_reached'; end if;

  insert into private.case_assignments (case_id, analyst_id, state, conflict_check, created_by)
  values (_case_id, v_actor, 'claim_requested', coalesce(_conflict_check, '{}'::jsonb), v_actor)
  returning id into v_assignment_id;
  insert into private.audit_events (actor_id, actor_role_snapshot, action, object_type, object_id,
    purpose_code, decision, correlation_id, metadata_min)
  values (v_actor, 'analyst', 'case.claim_requested', 'osint_case', _case_id,
    'scoped_research', 'pending_review', _correlation_id, jsonb_build_object('assignment_id', v_assignment_id));
  return jsonb_build_object('assignment_id', v_assignment_id, 'state', 'claim_requested');
end;
$$;

revoke all on function public.get_my_roles() from public, anon;
revoke all on function public.submit_citizen_report(uuid, text, text, timestamptz, text, text, text, bytea, bytea, text, text, text, uuid) from public, anon;
revoke all on function public.get_own_report(text) from public, anon;
revoke all on function public.moderation_queue(integer) from public, anon;
revoke all on function public.moderate_report(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.analyst_case_summaries() from public, anon;
revoke all on function public.request_case_claim(uuid, jsonb, uuid) from public, anon;
grant execute on function public.get_my_roles() to authenticated;
grant execute on function public.submit_citizen_report(uuid, text, text, timestamptz, text, text, text, bytea, bytea, text, text, text, uuid) to authenticated;
grant execute on function public.get_own_report(text) to authenticated;
grant execute on function public.moderation_queue(integer) to authenticated;
grant execute on function public.moderate_report(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.analyst_case_summaries() to authenticated;
grant execute on function public.request_case_claim(uuid, jsonb, uuid) to authenticated;
