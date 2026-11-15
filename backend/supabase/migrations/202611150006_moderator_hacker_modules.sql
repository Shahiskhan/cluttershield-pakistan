-- Module 2: scoped moderation, two-person indicator publication, timed analyst
-- assignments, structured findings, and role-scoped realtime team rooms.

create table private.indicator_publication_reviews (
  id uuid primary key default gen_random_uuid(),
  indicator_id uuid not null references private.indicators(id) on delete restrict,
  report_id uuid not null references private.citizen_reports(id) on delete restrict,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  reviewer_role text not null check (reviewer_role in ('moderator', 'senior_reviewer', 'platform_admin')),
  decision text not null check (decision in ('approved', 'rejected')),
  verification_source_url text not null check (char_length(verification_source_url) between 8 and 2048),
  verification_note text not null check (char_length(verification_note) between 10 and 1000),
  created_at timestamptz not null default now(),
  unique (indicator_id, reviewer_id)
);
create index indicator_publication_reviews_pending on private.indicator_publication_reviews (indicator_id, decision, created_at);

create table private.osint_findings (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references private.case_assignments(id) on delete restrict,
  case_id uuid not null references private.osint_cases(id) on delete restrict,
  analyst_id uuid not null references public.profiles(id) on delete restrict,
  summary text not null check (char_length(summary) between 10 and 2000),
  sources jsonb not null check (
    jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) between 1 and 10
  ),
  confidence smallint not null check (confidence between 0 and 100),
  limitations text not null check (char_length(limitations) between 10 and 1000),
  review_state text not null default 'submitted'
    check (review_state in ('submitted', 'accepted', 'changes_requested')),
  mentor_feedback text check (mentor_feedback is null or char_length(mentor_feedback) <= 1000),
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((reviewed_by is null) = (reviewed_at is null))
);
create index osint_findings_analyst_recent on private.osint_findings (analyst_id, created_at desc);
create index osint_findings_review_queue on private.osint_findings (review_state, created_at desc);
create unique index osint_findings_one_per_assignment on private.osint_findings (assignment_id);

create table private.team_rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null check (char_length(name) between 3 and 100),
  room_type text not null check (room_type in ('osint_guild', 'moderator_sync', 'case')),
  case_id uuid unique references private.osint_cases(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((room_type = 'case') = (case_id is not null))
);
insert into private.team_rooms (slug, name, room_type)
values ('general-osint-guild', 'General OSINT Guild', 'osint_guild'),
       ('moderator-sync', 'Moderator Sync', 'moderator_sync')
on conflict (slug) do nothing;

-- Public Realtime rows deliberately contain no sender UUID, email, report ID,
-- raw indicator, or evidence path. The actor mapping remains private.
create table public.team_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references private.team_rooms(id) on delete restrict,
  sender_role text not null check (sender_role in ('Moderator', 'Analyst', 'Mentor', 'Admin')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index team_messages_room_recent on public.team_messages (team_id, created_at desc);

create table private.team_message_actors (
  message_id uuid primary key references public.team_messages(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict
);
create index team_message_actors_actor_recent on private.team_message_actors (actor_id, message_id);

create or replace function private.contains_citizen_contact(_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select coalesce(_value, '') ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}'
    or coalesce(_value, '') ~ '(^|[^0-9])([+]?[ ]?92[ -]?|0)?3[0-9]{2}[ -]?[0-9]{7}([^0-9]|$)'
    or coalesce(_value, '') ~ '(^|[^0-9])[0-9]{5}-?[0-9]{7}-?[0-9]([^0-9]|$)'
    or coalesce(_value, '') ~* 'CS-[A-F0-9]{10}';
$$;
revoke all on function private.contains_citizen_contact(text) from public, anon, authenticated;

create or replace function public.get_own_report(_report_ref text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select jsonb_build_object(
    'report_ref', r.public_ref,
    'display_status',
      case
        when r.status in ('rejected', 'closed') then 'closed'
        when exists (
          select 1 from private.report_indicators ri
          join private.indicators i on i.id = ri.indicator_id
          where ri.report_id = r.id and i.status = 'published'
            and (i.expires_at is null or i.expires_at > now())
        ) then 'verified_public'
        when r.status = 'submitted' then 'submitted'
        when r.status in ('accepted', 'referred') and exists (
          select 1 from private.report_indicators ri
          join private.indicators i on i.id = ri.indicator_id
          where ri.report_id = r.id and i.status = 'pending_review'
        ) then 'under_review'
        when r.status in ('accepted', 'referred') then 'review_complete'
        else 'under_review'
      end,
    'created_at', r.created_at,
    'updated_at', r.updated_at
  )
  from private.citizen_reports r
  where r.public_ref = _report_ref and r.reporter_user_id = auth.uid()
  limit 1;
$$;
revoke all on function public.get_own_report(text) from public, anon;
grant execute on function public.get_own_report(text) to authenticated;

create or replace function private.can_access_team(_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select auth.uid() is not null and exists (
    select 1
    from private.team_rooms tr
    where tr.id = _team_id and (
      private.has_active_role('platform_admin')
      or (tr.room_type = 'osint_guild' and (
        private.has_active_role('analyst') or private.has_active_role('mentor')
        or private.has_active_role('senior_reviewer')
      ))
      or (tr.room_type = 'moderator_sync' and (
        private.has_active_role('moderator') or private.has_active_role('senior_reviewer')
      ))
      or (tr.room_type = 'case' and exists (
        select 1
        from private.case_assignments ca
        where ca.case_id = tr.case_id
          and (ca.analyst_id = auth.uid() or ca.mentor_id = auth.uid())
          and ca.state in ('assigned', 'in_progress', 'findings_submitted')
          and ca.expires_at > now()
      ))
    )
  );
$$;
revoke all on function private.can_access_team(uuid) from public, anon;
grant execute on function private.can_access_team(uuid) to authenticated;
-- RLS expression resolution needs schema usage; this grants no table access.
grant usage on schema private to authenticated;

alter table private.osint_cases enable row level security;
alter table private.osint_cases force row level security;
drop policy if exists osint_cases_restrict_direct_client_access on private.osint_cases;
create policy osint_cases_restrict_direct_client_access
  on private.osint_cases as restrictive for all to anon, authenticated
  using (false) with check (false);
revoke all on table private.osint_cases from public, anon, authenticated;

alter table private.case_assignments enable row level security;
alter table private.case_assignments force row level security;
drop policy if exists case_assignments_restrict_direct_client_access on private.case_assignments;
create policy case_assignments_restrict_direct_client_access
  on private.case_assignments as restrictive for all to anon, authenticated
  using (false) with check (false);
revoke all on table private.case_assignments from public, anon, authenticated;

alter table private.indicator_publication_reviews enable row level security;
alter table private.indicator_publication_reviews force row level security;
drop policy if exists indicator_publication_reviews_deny_client on private.indicator_publication_reviews;
create policy indicator_publication_reviews_deny_client
  on private.indicator_publication_reviews as restrictive for all to anon, authenticated
  using (false) with check (false);
revoke all on table private.indicator_publication_reviews from public, anon, authenticated;

alter table private.osint_findings enable row level security;
alter table private.osint_findings force row level security;
drop policy if exists osint_findings_deny_client on private.osint_findings;
create policy osint_findings_deny_client
  on private.osint_findings as restrictive for all to anon, authenticated
  using (false) with check (false);
revoke all on table private.osint_findings from public, anon, authenticated;

alter table private.team_rooms enable row level security;
alter table private.team_rooms force row level security;
drop policy if exists team_rooms_deny_client on private.team_rooms;
create policy team_rooms_deny_client
  on private.team_rooms as restrictive for all to anon, authenticated
  using (false) with check (false);
revoke all on table private.team_rooms from public, anon, authenticated;

alter table private.team_message_actors enable row level security;
alter table private.team_message_actors force row level security;
drop policy if exists team_message_actors_deny_client on private.team_message_actors;
create policy team_message_actors_deny_client
  on private.team_message_actors as restrictive for all to anon, authenticated
  using (false) with check (false);
revoke all on table private.team_message_actors from public, anon, authenticated;

alter table public.team_messages enable row level security;
alter table public.team_messages force row level security;
drop policy if exists team_messages_read_authorized_rooms on public.team_messages;
create policy team_messages_read_authorized_rooms
  on public.team_messages for select to authenticated
  using (private.can_access_team(team_id));
revoke all on table public.team_messages from public, anon, authenticated;
grant select (id, team_id, sender_role, body, created_at) on public.team_messages to authenticated;

create or replace function public.team_rooms_for_user()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, private
as $$
declare
  v_actor uuid := auth.uid();
  v_rooms jsonb;
begin
  if v_actor is null then raise exception using errcode = '28000', message = 'authentication_required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', tr.id, 'slug', tr.slug, 'name', tr.name, 'room_type', tr.room_type,
    'case_ref', c.case_ref
  ) order by tr.room_type, tr.name), '[]'::jsonb)
  into v_rooms
  from private.team_rooms tr
  left join private.osint_cases c on c.id = tr.case_id
  where private.can_access_team(tr.id);
  return v_rooms;
end;
$$;

create or replace function public.post_team_message(_team_id uuid, _body text, _correlation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_message_id uuid;
  v_message public.team_messages%rowtype;
  v_count integer;
begin
  if v_actor is null then raise exception using errcode = '28000', message = 'authentication_required'; end if;
  if _correlation_id is null or _team_id is null or _body is null
      or char_length(btrim(_body)) not between 1 and 2000
      or private.contains_citizen_contact(_body) then
    raise exception using errcode = '22023', message = 'message_invalid_or_contains_personal_data';
  end if;
  if not private.can_access_team(_team_id) then
    raise exception using errcode = '42501', message = 'team_scope_required';
  end if;

  select count(*) into v_count
  from private.team_message_actors a
  join public.team_messages m on m.id = a.message_id
  where a.actor_id = v_actor and m.created_at > now() - interval '1 minute';
  if v_count >= 30 then raise exception using errcode = 'P0001', message = 'rate_limited'; end if;

  v_role := case
    when private.has_active_role('platform_admin') then 'Admin'
    when private.has_active_role('senior_reviewer') or private.has_active_role('moderator') then 'Moderator'
    when private.has_active_role('mentor') then 'Mentor'
    when private.has_active_role('analyst') then 'Analyst'
    else null
  end;
  if v_role is null then raise exception using errcode = '42501', message = 'role_required'; end if;

  insert into public.team_messages (team_id, sender_role, body)
  values (_team_id, v_role, btrim(_body))
  returning * into v_message;
  v_message_id := v_message.id;
  insert into private.team_message_actors (message_id, actor_id) values (v_message_id, v_actor);
  insert into private.audit_events (
    actor_id, actor_role_snapshot, action, object_type, object_id,
    purpose_code, decision, correlation_id, metadata_min
  ) values (
    v_actor, v_role, 'team.message_posted', 'team_message', v_message_id,
    'team_collaboration', 'allowed', _correlation_id,
    jsonb_build_object('team_id', _team_id)
  );
  return jsonb_build_object(
    'id', v_message.id, 'team_id', v_message.team_id,
    'sender_role', v_message.sender_role, 'body', v_message.body, 'created_at', v_message.created_at
  );
end;
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

  select coalesce(jsonb_agg(q.item order by q.created_at desc), '[]'::jsonb)
  into v_items
  from (
    select jsonb_build_object(
      'id', r.id,
      'report_ref', r.public_ref,
      'category', r.category::text,
      'channel', r.channel::text,
      'status', r.status::text,
      'priority', r.priority::text,
      'risk_score',
        case
          when r.priority = 'urgent' then 90
          when r.priority = 'high' then 75
          when r.category in ('phishing_url', 'payment_fraud', 'account_takeover') then 60
          when r.category in ('impersonation', 'investment_job_scam', 'delivery_fraud') then 50
          else 35
        end,
      'narrative', r.narrative,
      'created_at', r.created_at,
      'indicator_masked', ind.display_value_masked,
      'evidence', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id, 'scan_state', e.scan_state, 'quarantine_state', e.quarantine_state,
          'can_preview', e.scan_state = 'clean' and e.quarantine_state = 'released'
        ) order by e.created_at)
        from private.evidence_objects e
        where e.report_id = r.id and e.upload_state = 'uploaded'
      ), '[]'::jsonb)
    ) as item, r.created_at
    from private.citizen_reports r
    join private.moderation_assignments ma on ma.report_id = r.id
    left join lateral (
      select i.display_value_masked
      from private.report_indicators ri
      join private.indicators i on i.id = ri.indicator_id
      where ri.report_id = r.id
      order by ri.created_at
      limit 1
    ) ind on true
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
      or char_length(_reason_code) > 64 or (_safe_note is not null and char_length(_safe_note) > 500)
      or private.contains_citizen_contact(_safe_note) then
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
    (v_report.status = 'under_review' and v_next in ('accepted', 'rejected', 'closed'))
  ) then raise exception using errcode = 'P0001', message = 'invalid_transition'; end if;
  update private.citizen_reports
  set status = v_next, updated_at = now(),
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

create or replace function public.moderator_verify_indicator(
  _report_id uuid,
  _verification_source_url text,
  _verification_note text,
  _correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_actor uuid := auth.uid();
  v_report private.citizen_reports%rowtype;
  v_indicator private.indicators%rowtype;
  v_role text := 'moderator';
begin
  if v_actor is null or not private.has_active_role('moderator') then
    raise exception using errcode = '42501', message = 'role_required';
  end if;
  if _report_id is null or _correlation_id is null
      or _verification_source_url is null or char_length(_verification_source_url) not between 8 and 2048
      or _verification_source_url !~* '^https?://[^/@[:space:]]+(/[^[:space:]]*)?$'
      or private.contains_citizen_contact(_verification_source_url)
      or _verification_note is null or char_length(btrim(_verification_note)) not between 10 and 1000
      or private.contains_citizen_contact(_verification_note) then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  if not exists (
    select 1 from private.moderation_assignments ma
    where ma.report_id = _report_id and ma.moderator_id = v_actor
      and ma.released_at is null and ma.expires_at > now()
  ) then raise exception using errcode = '42501', message = 'scope_required'; end if;

  select * into v_report from private.citizen_reports where id = _report_id for update;
  if not found or v_report.status <> 'under_review' then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;
  select i.* into v_indicator
  from private.report_indicators ri
  join private.indicators i on i.id = ri.indicator_id
  where ri.report_id = _report_id
  order by ri.created_at
  limit 1
  for update of i;
  if not found or v_indicator.status in ('rejected', 'revoked', 'expired') then
    raise exception using errcode = 'P0002', message = 'indicator_not_eligible';
  end if;

  update private.citizen_reports set status = 'accepted', updated_at = now()
  where id = _report_id;
  if v_indicator.status = 'proposed' then
    update private.indicators
    set status = 'pending_review', evidence_grade = 'limited', updated_at = now()
    where id = v_indicator.id;
  end if;
  insert into private.indicator_publication_reviews (
    indicator_id, report_id, reviewer_id, reviewer_role, decision,
    verification_source_url, verification_note
  ) values (
    v_indicator.id, _report_id, v_actor, v_role, 'approved',
    _verification_source_url, btrim(_verification_note)
  ) on conflict (indicator_id, reviewer_id) do nothing;
  insert into private.report_status_events (report_id, from_status, to_status, actor_id, reason_code, safe_note)
  values (_report_id, v_report.status, 'accepted', v_actor, 'indicator_verified', btrim(_verification_note));
  insert into private.audit_events (actor_id, actor_role_snapshot, action, object_type, object_id,
    purpose_code, decision, before_hash, after_hash, correlation_id, metadata_min)
  values (v_actor, v_role, 'indicator.verified_for_publication', 'indicator', v_indicator.id,
    'threat_review', case when v_indicator.status = 'published' then 'already_published' else 'pending_second_review' end,
    extensions.digest(v_indicator.status::text, 'sha256'), extensions.digest('pending_review', 'sha256'),
    _correlation_id, jsonb_build_object('report_ref', v_report.public_ref));

  return jsonb_build_object(
    'report_ref', v_report.public_ref,
    'indicator_status', case when v_indicator.status = 'published' then 'published' else 'pending_review' end,
    'publication_state', case when v_indicator.status = 'published' then 'already_published' else 'pending_second_review' end
  );
end;
$$;

create or replace function public.indicator_publication_queue()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_actor uuid := auth.uid();
  v_items jsonb;
begin
  if v_actor is null or not (
    private.has_active_role('senior_reviewer') or private.has_active_role('platform_admin')
  ) then raise exception using errcode = '42501', message = 'role_required'; end if;
  select coalesce(jsonb_agg(q.item order by q.created_at), '[]'::jsonb) into v_items
  from (
    select distinct on (i.id)
      jsonb_build_object(
        'indicator_id', i.id,
        'report_ref', r.public_ref,
        'category', r.category::text,
        'channel', r.channel::text,
        'indicator_masked', i.display_value_masked,
        'verification_source_url', first_review.verification_source_url,
        'verification_note', first_review.verification_note,
        'submitted_at', first_review.created_at
      ) as item,
      first_review.created_at
    from private.indicators i
    join private.report_indicators ri on ri.indicator_id = i.id
    join private.citizen_reports r on r.id = ri.report_id and r.status = 'accepted'
    join lateral (
      select pr.verification_source_url, pr.verification_note, pr.created_at
      from private.indicator_publication_reviews pr
      where pr.indicator_id = i.id and pr.decision = 'approved' and pr.reviewer_role = 'moderator'
      order by pr.created_at asc
      limit 1
    ) first_review on true
    where i.status = 'pending_review'
    order by i.id, first_review.created_at
  ) q;
  return v_items;
end;
$$;

create or replace function public.review_indicator_publication(
  _indicator_id uuid,
  _decision text,
  _confidence smallint,
  _verification_source_url text,
  _verification_note text,
  _correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_indicator private.indicators%rowtype;
  v_first_review private.indicator_publication_reviews%rowtype;
  v_role text;
  v_next_status private.indicator_status;
begin
  if v_actor is null or not (
    private.has_active_role('senior_reviewer') or private.has_active_role('platform_admin')
  ) then raise exception using errcode = '42501', message = 'role_required'; end if;
  if _indicator_id is null or _correlation_id is null or _decision is null
      or _decision not in ('approved', 'rejected')
      or _verification_source_url is null or char_length(_verification_source_url) not between 8 and 2048
      or _verification_source_url !~* '^https?://[^/@[:space:]]+(/[^[:space:]]*)?$'
      or private.contains_citizen_contact(_verification_source_url)
      or _verification_note is null or char_length(btrim(_verification_note)) not between 10 and 1000
      or private.contains_citizen_contact(_verification_note)
      or (_decision = 'approved' and (_confidence is null or _confidence not between 50 and 90)) then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  v_role := case when private.has_active_role('platform_admin') then 'platform_admin' else 'senior_reviewer' end;
  select * into v_indicator from private.indicators where id = _indicator_id for update;
  if not found or v_indicator.status <> 'pending_review' then
    raise exception using errcode = 'P0002', message = 'not_available';
  end if;
  select * into v_first_review
  from private.indicator_publication_reviews
  where indicator_id = _indicator_id and decision = 'approved' and reviewer_role = 'moderator'
  order by created_at asc
  limit 1;
  if not found then raise exception using errcode = 'P0001', message = 'first_review_required'; end if;
  if v_first_review.reviewer_id = v_actor then
    raise exception using errcode = '42501', message = 'independent_review_required';
  end if;
  if exists (select 1 from private.indicator_publication_reviews where indicator_id = _indicator_id and reviewer_id = v_actor) then
    raise exception using errcode = 'P0001', message = 'already_reviewed';
  end if;

  insert into private.indicator_publication_reviews (
    indicator_id, report_id, reviewer_id, reviewer_role, decision,
    verification_source_url, verification_note
  ) values (
    _indicator_id, v_first_review.report_id, v_actor, v_role, _decision,
    _verification_source_url, btrim(_verification_note)
  );
  if _decision = 'approved' then
    v_next_status := 'published';
    update private.indicators
    set status = v_next_status,
        confidence = _confidence,
        evidence_grade = 'corroborated',
        updated_at = now()
    where id = _indicator_id;
  else
    v_next_status := 'rejected';
    update private.indicators set status = v_next_status, updated_at = now()
    where id = _indicator_id;
  end if;
  insert into private.audit_events (actor_id, actor_role_snapshot, action, object_type, object_id,
    purpose_code, decision, before_hash, after_hash, correlation_id, metadata_min)
  values (v_actor, v_role, 'indicator.publication_reviewed', 'indicator', _indicator_id,
    'threat_review', v_next_status::text,
    extensions.digest(v_indicator.status::text, 'sha256'), extensions.digest(v_next_status::text, 'sha256'),
    _correlation_id, jsonb_build_object('first_reviewer_id', v_first_review.reviewer_id, 'feed_ready', _decision = 'approved'));
  return jsonb_build_object('indicator_id', _indicator_id, 'status', v_next_status::text);
end;
$$;

create or replace function public.authorize_moderator_evidence_preview(
  _report_id uuid,
  _evidence_id uuid,
  _correlation_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_actor uuid := auth.uid();
  v_object_key text;
  v_scan_state text;
  v_quarantine_state text;
begin
  if v_actor is null or not private.has_active_role('moderator') then
    raise exception using errcode = '42501', message = 'role_required';
  end if;
  if _report_id is null or _evidence_id is null or _correlation_id is null then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  if not exists (
    select 1 from private.moderation_assignments ma
    where ma.report_id = _report_id and ma.moderator_id = v_actor
      and ma.released_at is null and ma.expires_at > now()
  ) then raise exception using errcode = '42501', message = 'scope_required'; end if;
  select e.object_key, e.scan_state, e.quarantine_state
  into v_object_key, v_scan_state, v_quarantine_state
  from private.evidence_objects e
  where e.id = _evidence_id and e.report_id = _report_id and e.upload_state = 'uploaded';
  if not found then raise exception using errcode = 'P0002', message = 'not_found'; end if;
  if v_scan_state <> 'clean' or v_quarantine_state <> 'released' then
    raise exception using errcode = 'P0001', message = 'evidence_pending_scan';
  end if;
  insert into private.audit_events (actor_id, actor_role_snapshot, action, object_type, object_id,
    purpose_code, decision, correlation_id, metadata_min)
  values (v_actor, 'moderator', 'evidence.preview_authorized', 'evidence_object', _evidence_id,
    'triage', 'allowed', _correlation_id, jsonb_build_object('report_id', _report_id));
  return v_object_key;
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
  v_accepted integer;
begin
  if v_actor is null or not private.has_active_role('analyst') then
    raise exception using errcode = '42501', message = 'role_required';
  end if;
  select count(*) into v_accepted
  from private.osint_findings f
  where f.analyst_id = v_actor and f.review_state = 'accepted';
  return jsonb_build_object(
    'available', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'case_ref', c.case_ref, 'title', c.title_safe,
        'brief', c.sanitized_brief, 'objective', c.objective,
        'allowed_sources', c.allowed_sources, 'prohibited_actions', c.prohibited_actions,
        'deadline_at', c.deadline_at, 'state', c.state::text
      ) order by c.created_at desc)
      from private.osint_cases c
      where c.state = 'available' and (c.deadline_at is null or c.deadline_at > now())
        and (select count(*) from private.case_assignments ca
             where ca.case_id = c.id and ca.state in ('claim_requested', 'assigned', 'in_progress', 'findings_submitted')
               and (ca.expires_at is null or ca.expires_at > now())) < c.max_assignments
        and not exists (
          select 1 from private.case_assignments mine
          where mine.case_id = c.id and mine.analyst_id = v_actor
            and mine.state in ('claim_requested', 'assigned', 'in_progress', 'findings_submitted')
            and (mine.expires_at is null or mine.expires_at > now())
        )
    ), '[]'::jsonb),
    'my_claims', coalesce((
      select jsonb_agg(recent.claim order by recent.claimed_at desc)
      from (
        select jsonb_build_object(
        'assignment_id', ca.id, 'case_id', ca.case_id, 'case_ref', c.case_ref,
        'title', c.title_safe, 'state', ca.state::text,
        'claimed_at', ca.claimed_at, 'assigned_at', ca.assigned_at, 'expires_at', ca.expires_at,
        'latest_finding', (
          select jsonb_build_object(
            'id', f.id, 'review_state', f.review_state, 'mentor_feedback', f.mentor_feedback,
            'confidence', f.confidence, 'submitted_at', f.created_at
          )
          from private.osint_findings f
          where f.assignment_id = ca.id and f.analyst_id = v_actor
          order by f.created_at desc limit 1
        )
        ) as claim, ca.claimed_at
        from private.case_assignments ca
        join private.osint_cases c on c.id = ca.case_id
        where ca.analyst_id = v_actor
          and ca.state in ('claim_requested', 'assigned', 'in_progress', 'findings_submitted', 'expired')
        order by ca.claimed_at desc
        limit 30
      ) recent
    ), '[]'::jsonb),
    'profile', jsonb_build_object(
      'accepted_findings', v_accepted,
      'reputation_points', v_accepted * 10,
      'badges', coalesce((
        select jsonb_agg(b.label order by b.threshold)
        from (values ('First verified contribution', 1), ('Three verified contributions', 3), ('Five verified contributions', 5)) as b(label, threshold)
        where v_accepted >= b.threshold
      ), '[]'::jsonb)
    )
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
  v_expires_at timestamptz;
  v_count integer;
  v_existing private.case_assignments%rowtype;
begin
  if v_actor is null or not private.has_active_role('analyst') then
    raise exception using errcode = '42501', message = 'role_required';
  end if;
  if _case_id is null or _correlation_id is null
      or jsonb_typeof(coalesce(_conflict_check, '{}'::jsonb)) <> 'object'
      or coalesce(_conflict_check->>'conflicts_reviewed', 'false') <> 'true'
      or octet_length(coalesce(_conflict_check, '{}'::jsonb)::text) > 2000 then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  -- Serialize an analyst's claims so concurrent requests for separate cases
  -- cannot race past the two-active-case limit.
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text, 0));
  select * into v_case from private.osint_cases where id = _case_id for update;
  if not found or v_case.state <> 'available' or (v_case.deadline_at is not null and v_case.deadline_at <= now()) then
    raise exception using errcode = 'P0002', message = 'not_available';
  end if;

  update private.case_assignments
  set state = 'expired', released_at = coalesce(released_at, now())
  where (case_id = _case_id or analyst_id = v_actor)
    and state in ('assigned', 'in_progress', 'findings_submitted')
    and expires_at <= now()
    and released_at is null;

  select * into v_existing
  from private.case_assignments ca
  where ca.case_id = _case_id and ca.analyst_id = v_actor
    and ca.state in ('claim_requested', 'assigned', 'in_progress', 'findings_submitted')
    and (ca.expires_at is null or ca.expires_at > now())
  order by ca.claimed_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'assignment_id', v_existing.id,
      'state', v_existing.state::text,
      'expires_at', v_existing.expires_at,
      'idempotent_replay', true
    );
  end if;

  select count(*) into v_count
  from private.case_assignments ca
  where ca.case_id = _case_id
    and ca.state in ('claim_requested', 'assigned', 'in_progress', 'findings_submitted')
    and (ca.expires_at is null or ca.expires_at > now());
  if v_count >= v_case.max_assignments then
    raise exception using errcode = 'P0001', message = 'capacity_reached';
  end if;
  select count(*) into v_count
  from private.case_assignments ca
  where ca.analyst_id = v_actor
    and ca.state in ('assigned', 'in_progress', 'findings_submitted')
    and ca.expires_at > now();
  if v_count >= 2 then raise exception using errcode = 'P0001', message = 'analyst_capacity_reached'; end if;

  v_expires_at := least(now() + interval '24 hours', coalesce(v_case.deadline_at, now() + interval '24 hours'));
  insert into private.case_assignments (
    case_id, analyst_id, state, assigned_at, expires_at, conflict_check, created_by
  ) values (
    _case_id, v_actor, 'assigned', now(), v_expires_at, _conflict_check, v_actor
  ) returning id into v_assignment_id;

  insert into private.team_rooms (slug, name, room_type, case_id)
  values ('case-' || v_case.case_ref, 'Case ' || v_case.case_ref || ' discussion', 'case', _case_id)
  on conflict (case_id) do nothing;

  insert into private.audit_events (actor_id, actor_role_snapshot, action, object_type, object_id,
    purpose_code, decision, correlation_id, metadata_min)
  values (v_actor, 'analyst', 'case.claimed', 'osint_case', _case_id,
    'scoped_research', 'assigned', _correlation_id,
    jsonb_build_object('assignment_id', v_assignment_id, 'expires_at', v_expires_at));
  return jsonb_build_object('assignment_id', v_assignment_id, 'state', 'assigned', 'expires_at', v_expires_at);
end;
$$;

create or replace function public.submit_osint_finding(
  _assignment_id uuid,
  _summary text,
  _sources jsonb,
  _confidence smallint,
  _limitations text,
  _correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_actor uuid := auth.uid();
  v_assignment private.case_assignments%rowtype;
  v_existing_finding private.osint_findings%rowtype;
  v_finding_id uuid;
  v_created_at timestamptz;
begin
  if v_actor is null or not private.has_active_role('analyst') then
    raise exception using errcode = '42501', message = 'role_required';
  end if;
  if _sources is null or jsonb_typeof(_sources) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid_finding';
  end if;
  if jsonb_array_length(_sources) not between 1 and 10 then
    raise exception using errcode = '22023', message = 'invalid_finding';
  end if;
  if _assignment_id is null or _correlation_id is null
      or _summary is null or char_length(btrim(_summary)) not between 10 and 2000
      or _limitations is null or char_length(btrim(_limitations)) not between 10 and 1000
      or private.contains_citizen_contact(_summary) or private.contains_citizen_contact(_limitations)
      or _confidence is null or _confidence not between 0 and 100
      or exists (
        select 1 from jsonb_array_elements(_sources) as source_item(src)
        where jsonb_typeof(src) <> 'object'
          or case when jsonb_typeof(src) = 'object'
            then (select count(*) from jsonb_object_keys(src)) <> 2
            else true
          end
          or char_length(coalesce(src->>'url', '')) not between 8 and 2048
          or coalesce(src->>'url', '') !~* '^https?://[^/@[:space:]]+(/[^[:space:]]*)?$'
          or private.contains_citizen_contact(src->>'url')
          or not (src ? 'observed_at')
          or coalesce(src->>'observed_at', '') = ''
      ) then
    raise exception using errcode = '22023', message = 'invalid_finding';
  end if;
  begin
    if exists (
      select 1 from jsonb_array_elements(_sources) as source_item(src)
      where (src->>'observed_at')::timestamptz > now() + interval '5 minutes'
    ) then raise exception using errcode = '22023', message = 'invalid_finding'; end if;
  exception when others then
    raise exception using errcode = '22023', message = 'invalid_finding';
  end;

  select * into v_assignment
  from private.case_assignments ca
  where ca.id = _assignment_id and ca.analyst_id = v_actor
    and ca.state in ('assigned', 'in_progress', 'findings_submitted')
    and ca.expires_at > now()
  for update;
  if not found then raise exception using errcode = '42501', message = 'assignment_scope_required'; end if;
  select * into v_existing_finding
  from private.osint_findings f
  where f.assignment_id = v_assignment.id
  for update;
  if found then
    if v_existing_finding.review_state <> 'changes_requested' then
      raise exception using errcode = 'P0001', message = 'finding_already_submitted';
    end if;
    update private.osint_findings
    set summary = btrim(_summary), sources = _sources, confidence = _confidence,
        limitations = btrim(_limitations), review_state = 'submitted',
        mentor_feedback = null, reviewed_by = null, reviewed_at = null, created_at = now()
    where id = v_existing_finding.id
    returning id, created_at into v_finding_id, v_created_at;
  else
    insert into private.osint_findings (
      assignment_id, case_id, analyst_id, summary, sources, confidence, limitations
    ) values (
      v_assignment.id, v_assignment.case_id, v_actor, btrim(_summary), _sources, _confidence, btrim(_limitations)
    ) returning id, created_at into v_finding_id, v_created_at;
  end if;
  update private.case_assignments set state = 'findings_submitted'
  where id = v_assignment.id;
  insert into private.audit_events (actor_id, actor_role_snapshot, action, object_type, object_id,
    purpose_code, decision, correlation_id, metadata_min)
  values (v_actor, 'analyst', 'osint.finding_submitted', 'osint_finding', v_finding_id,
    'scoped_research', 'submitted', _correlation_id,
    jsonb_build_object('case_id', v_assignment.case_id, 'source_count', jsonb_array_length(_sources)));
  return jsonb_build_object('finding_id', v_finding_id, 'review_state', 'submitted', 'submitted_at', v_created_at);
end;
$$;

create or replace function public.mentor_finding_queue()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_actor uuid := auth.uid();
  v_items jsonb;
begin
  if v_actor is null or not (
    private.has_active_role('mentor') or private.has_active_role('senior_reviewer')
  ) then raise exception using errcode = '42501', message = 'role_required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'finding_id', f.id,
    'case_ref', c.case_ref,
    'case_title', c.title_safe,
    'analyst_label', 'Analyst contributor',
    'summary', f.summary,
    'sources', f.sources,
    'confidence', f.confidence,
    'limitations', f.limitations,
    'review_state', f.review_state,
    'submitted_at', f.created_at
  ) order by f.created_at), '[]'::jsonb)
  into v_items
  from private.osint_findings f
  join private.osint_cases c on c.id = f.case_id
  join private.case_assignments ca on ca.id = f.assignment_id
  where f.review_state = 'submitted'
    and (private.has_active_role('senior_reviewer') or ca.mentor_id = v_actor);
  return v_items;
end;
$$;

create or replace function public.review_osint_finding(
  _finding_id uuid,
  _decision text,
  _feedback text,
  _correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_actor uuid := auth.uid();
  v_finding private.osint_findings%rowtype;
  v_role text;
begin
  if v_actor is null or not (
    private.has_active_role('mentor') or private.has_active_role('senior_reviewer')
  ) then raise exception using errcode = '42501', message = 'role_required'; end if;
  if _finding_id is null or _correlation_id is null or _decision is null
      or _decision not in ('accepted', 'changes_requested')
      or _feedback is null or char_length(btrim(_feedback)) not between 10 and 1000
      or private.contains_citizen_contact(_feedback) then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  select * into v_finding from private.osint_findings where id = _finding_id for update;
  if not found or v_finding.review_state <> 'submitted' then
    raise exception using errcode = 'P0002', message = 'not_available';
  end if;
  if v_finding.analyst_id = v_actor then raise exception using errcode = '42501', message = 'independent_review_required'; end if;
  if not private.has_active_role('senior_reviewer') and not exists (
    select 1 from private.case_assignments ca
    where ca.id = v_finding.assignment_id and ca.mentor_id = v_actor
  ) then
    raise exception using errcode = '42501', message = 'mentor_scope_required';
  end if;
  v_role := case when private.has_active_role('senior_reviewer') then 'senior_reviewer' else 'mentor' end;
  update private.osint_findings
  set review_state = _decision, mentor_feedback = btrim(_feedback), reviewed_by = v_actor, reviewed_at = now()
  where id = _finding_id;
  insert into private.audit_events (actor_id, actor_role_snapshot, action, object_type, object_id,
    purpose_code, decision, correlation_id, metadata_min)
  values (v_actor, v_role, 'osint.finding_reviewed', 'osint_finding', _finding_id,
    'scoped_research', _decision, _correlation_id, '{}'::jsonb);
  return jsonb_build_object('finding_id', _finding_id, 'review_state', _decision);
end;
$$;

revoke all on function public.team_rooms_for_user() from public, anon;
revoke all on function public.post_team_message(uuid, text, uuid) from public, anon;
revoke all on function public.moderation_queue(integer) from public, anon;
revoke all on function public.moderate_report(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.moderator_verify_indicator(uuid, text, text, uuid) from public, anon;
revoke all on function public.indicator_publication_queue() from public, anon;
revoke all on function public.review_indicator_publication(uuid, text, smallint, text, text, uuid) from public, anon;
revoke all on function public.authorize_moderator_evidence_preview(uuid, uuid, uuid) from public, anon;
revoke all on function public.analyst_case_summaries() from public, anon;
revoke all on function public.request_case_claim(uuid, jsonb, uuid) from public, anon;
revoke all on function public.submit_osint_finding(uuid, text, jsonb, smallint, text, uuid) from public, anon;
revoke all on function public.mentor_finding_queue() from public, anon;
revoke all on function public.review_osint_finding(uuid, text, text, uuid) from public, anon;
grant execute on function public.team_rooms_for_user() to authenticated;
grant execute on function public.post_team_message(uuid, text, uuid) to authenticated;
grant execute on function public.moderation_queue(integer) to authenticated;
grant execute on function public.moderate_report(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.moderator_verify_indicator(uuid, text, text, uuid) to authenticated;
grant execute on function public.indicator_publication_queue() to authenticated;
grant execute on function public.review_indicator_publication(uuid, text, smallint, text, text, uuid) to authenticated;
grant execute on function public.authorize_moderator_evidence_preview(uuid, uuid, uuid) to authenticated;
grant execute on function public.analyst_case_summaries() to authenticated;
grant execute on function public.request_case_claim(uuid, jsonb, uuid) to authenticated;
grant execute on function public.submit_osint_finding(uuid, text, jsonb, smallint, text, uuid) to authenticated;
grant execute on function public.mentor_finding_queue() to authenticated;
grant execute on function public.review_osint_finding(uuid, text, text, uuid) to authenticated;

alter publication supabase_realtime add table public.team_messages;
