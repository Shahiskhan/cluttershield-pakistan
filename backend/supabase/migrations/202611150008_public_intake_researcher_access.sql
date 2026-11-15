-- Public complaint intake, reference-only status lookup, admin triage, and
-- vetted researcher onboarding. Anonymous requests enter only through the
-- Edge Function, which holds the service key and HMACs the caller network key.

create table private.anonymous_report_rate_events (
  id bigint generated always as identity primary key,
  requester_hash bytea not null check (octet_length(requester_hash)=32),
  created_at timestamptz not null default now()
);
create index anonymous_report_rate_events_recent on private.anonymous_report_rate_events(requester_hash, created_at desc);
alter table private.anonymous_report_rate_events enable row level security;
alter table private.anonymous_report_rate_events force row level security;
create policy anonymous_report_rate_events_deny_client on private.anonymous_report_rate_events
  as restrictive for all to anon, authenticated using (false) with check (false);
revoke all on table private.anonymous_report_rate_events from public, anon, authenticated;
create unique index citizen_reports_anon_idempotency on private.citizen_reports(submission_key) where reporter_user_id is null;

create table private.analyst_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_user_id uuid not null unique references public.profiles(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 100),
  affiliation text check (affiliation is null or char_length(affiliation)<=120),
  portfolio_url text check (portfolio_url is null or char_length(portfolio_url)<=2048),
  motivation text not null check (char_length(btrim(motivation)) between 40 and 2000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_id uuid references public.profiles(id) on delete restrict,
  reviewer_note text check (reviewer_note is null or char_length(reviewer_note)<=1000),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check ((status='pending')=(reviewed_at is null)),
  check ((reviewer_id is null)=(reviewed_at is null))
);
alter table private.analyst_applications enable row level security;
alter table private.analyst_applications force row level security;
create policy analyst_applications_deny_client on private.analyst_applications
  as restrictive for all to anon, authenticated using (false) with check (false);
revoke all on table private.analyst_applications from public, anon, authenticated;

-- Analyst accounts begin as ordinary citizens. A separate application review
-- is required before the analyst role is granted.
create or replace function public.submit_analyst_application(
  _full_name text, _affiliation text, _portfolio_url text, _motivation text, _correlation_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare v_actor uuid:=auth.uid(); v_row private.analyst_applications%rowtype;
begin
  if v_actor is null or not private.has_active_role('citizen') then raise exception using errcode='42501',message='role_required'; end if;
  if _correlation_id is null or _full_name is null or char_length(btrim(_full_name)) not between 2 and 100
    or _motivation is null or char_length(btrim(_motivation)) not between 40 and 2000
    or private.contains_citizen_contact(_motivation)
    or (_affiliation is not null and char_length(_affiliation)>120)
    or (_portfolio_url is not null and (char_length(_portfolio_url)>2048 or _portfolio_url !~* '^https?://[^/@[:space:]]+(/[^[:space:]]*)?$')) then
    raise exception using errcode='22023',message='invalid_application';
  end if;
  if private.has_active_role('analyst') then raise exception using errcode='P0001',message='already_analyst'; end if;
  insert into private.analyst_applications(applicant_user_id,full_name,affiliation,portfolio_url,motivation)
  values(v_actor,btrim(_full_name),nullif(btrim(_affiliation),''),nullif(btrim(_portfolio_url),''),btrim(_motivation))
  on conflict(applicant_user_id) do update set full_name=excluded.full_name,affiliation=excluded.affiliation,
    portfolio_url=excluded.portfolio_url,motivation=excluded.motivation,status='pending',reviewer_id=null,
    reviewer_note=null,submitted_at=now(),reviewed_at=null
  where private.analyst_applications.status='rejected'
  returning * into v_row;
  if not found then
    select * into v_row from private.analyst_applications where applicant_user_id=v_actor;
  end if;
  insert into private.audit_events(actor_id,actor_role_snapshot,action,object_type,object_id,purpose_code,decision,correlation_id,metadata_min)
  values(v_actor,'citizen','analyst.application_submitted','analyst_application',v_row.id,'role_onboarding','pending',_correlation_id,'{}'::jsonb);
  return jsonb_build_object('application_id',v_row.id,'status',v_row.status,'submitted_at',v_row.submitted_at);
end; $$;

create or replace function public.my_analyst_application()
returns jsonb language sql stable security definer set search_path=pg_catalog,private as $$
  select jsonb_build_object('status',a.status,'submitted_at',a.submitted_at,'reviewed_at',a.reviewed_at,'reviewer_note',a.reviewer_note)
  from private.analyst_applications a where a.applicant_user_id=auth.uid();
$$;

create or replace function public.admin_analyst_application_queue()
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare v_items jsonb;
begin
  if auth.uid() is null or not private.has_active_role('platform_admin') then raise exception using errcode='42501',message='role_required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,'affiliation',affiliation,
    'portfolio_url',portfolio_url,'motivation',motivation,'status',status,'submitted_at',submitted_at) order by submitted_at),'[]'::jsonb)
  into v_items from private.analyst_applications where status='pending';
  return v_items;
end; $$;

create or replace function public.review_analyst_application(_application_id uuid,_decision text,_reviewer_note text,_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare v_actor uuid:=auth.uid(); v_app private.analyst_applications%rowtype;
begin
  if v_actor is null or not private.has_active_role('platform_admin') then raise exception using errcode='42501',message='role_required'; end if;
  if _application_id is null or _correlation_id is null or _decision not in ('approved','rejected')
    or (_reviewer_note is not null and (char_length(_reviewer_note)>1000 or private.contains_citizen_contact(_reviewer_note))) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  select * into v_app from private.analyst_applications where id=_application_id and status='pending' for update;
  if not found then raise exception using errcode='P0002',message='not_available'; end if;
  update private.analyst_applications set status=_decision,reviewer_id=v_actor,reviewer_note=nullif(btrim(_reviewer_note),''),reviewed_at=now() where id=_application_id;
  if _decision='approved' and not exists(select 1 from private.role_assignments ra where ra.user_id=v_app.applicant_user_id
    and ra.role='analyst' and ra.revoked_at is null and ra.starts_at<=now() and (ra.expires_at is null or ra.expires_at>now())) then
    insert into private.role_assignments(user_id,role,scope_type,scope_id,granted_by,reason_code)
    values(v_app.applicant_user_id,'analyst','global',null,v_actor,'analyst_application_approved');
  end if;
  insert into private.audit_events(actor_id,actor_role_snapshot,action,object_type,object_id,purpose_code,decision,correlation_id,metadata_min)
  values(v_actor,'platform_admin','analyst.application_reviewed','analyst_application',_application_id,'role_onboarding',_decision,_correlation_id,
    jsonb_build_object('applicant_user_id',v_app.applicant_user_id));
  return jsonb_build_object('application_id',_application_id,'status',_decision);
end; $$;

-- Private intake RPC. Its only caller is the submit-report Edge Function using
-- the server-only service key. An HMAC of the gateway client address is stored,
-- never a raw IP address.
drop function public.submit_citizen_report(uuid,text,text,timestamptz,text,text,text,bytea,bytea,text,text,text,uuid);
create or replace function public.submit_citizen_report(
  _reporter_user_id uuid,_requester_hash bytea,_submission_key uuid,_category text,_channel text,
  _incident_at timestamptz,_incident_timezone text,_narrative text,_indicator_type text,
  _indicator_ciphertext bytea,_indicator_hash bytea,_hash_key_version text,_indicator_masked text,
  _notice_version text,_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare v_report_id uuid; v_report_ref text; v_indicator_id uuid; v_category private.report_category;
  v_channel private.report_channel; v_type private.indicator_type; v_existing private.citizen_reports%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='edge_only'; end if;
  if _reporter_user_id is not null and not exists(select 1 from private.role_assignments ra where ra.user_id=_reporter_user_id
    and ra.role='citizen' and ra.revoked_at is null and ra.starts_at<=now() and (ra.expires_at is null or ra.expires_at>now())) then
    raise exception using errcode='42501',message='role_required';
  end if;
  if _reporter_user_id is null and (_requester_hash is null or octet_length(_requester_hash)<>32) then raise exception using errcode='22023',message='invalid_request'; end if;
  if _submission_key is null or _correlation_id is null or _narrative is null or char_length(btrim(_narrative))<10 or char_length(_narrative)>5000
    or (_incident_timezone is not null and char_length(_incident_timezone)>64) or _notice_version is distinct from 'citizen-notice-1.0'
    or _indicator_ciphertext is null or octet_length(_indicator_ciphertext)<28 or _indicator_hash is null or octet_length(_indicator_hash)<>32
    or _hash_key_version is null or char_length(_hash_key_version)>24 or _indicator_masked is null or char_length(_indicator_masked)>256 then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  begin v_category:=_category::private.report_category; v_channel:=_channel::private.report_channel; v_type:=_indicator_type::private.indicator_type;
  exception when others then raise exception using errcode='22023',message='invalid_request'; end;
  if v_type not in ('domain','url','phone_number') then raise exception using errcode='22023',message='unsupported_indicator_type'; end if;
  perform pg_advisory_xact_lock(hashtextextended(_submission_key::text,0));
  select * into v_existing from private.citizen_reports where submission_key=_submission_key
    and reporter_user_id is not distinct from _reporter_user_id;
  if found then return jsonb_build_object('report_ref',v_existing.public_ref,'status',v_existing.status::text,'received_at',v_existing.created_at,'idempotent_replay',true); end if;
  if _reporter_user_id is null then
    perform pg_advisory_xact_lock(hashtextextended(encode(_requester_hash,'hex'),0));
    if (select count(*) from private.anonymous_report_rate_events e where e.requester_hash=_requester_hash and e.created_at>now()-interval '15 minutes')>=5 then
      raise exception using errcode='P0001',message='rate_limited';
    end if;
    insert into private.anonymous_report_rate_events(requester_hash) values(_requester_hash);
  elsif (select count(*) from private.citizen_reports where reporter_user_id=_reporter_user_id and created_at>now()-interval '10 minutes')>=5 then
    raise exception using errcode='P0001',message='rate_limited';
  end if;
  v_report_id:=gen_random_uuid();
  v_report_ref:='CS-'||upper(encode(gen_random_bytes(16),'hex'));
  insert into private.citizen_reports(id,public_ref,submission_key,reporter_user_id,category,channel,incident_at,incident_timezone,narrative)
  values(v_report_id,v_report_ref,_submission_key,_reporter_user_id,v_category,v_channel,_incident_at,nullif(_incident_timezone,''),btrim(_narrative));
  insert into private.report_status_events(report_id,from_status,to_status,actor_id,reason_code)
  values(v_report_id,null,'submitted',_reporter_user_id,case when _reporter_user_id is null then 'anonymous_submission' else 'citizen_submission' end);
  insert into private.consent_records(user_id,report_id,consent_type,notice_version,choice,purpose_code)
  values(_reporter_user_id,v_report_id,'privacy_notice',_notice_version,true,'case_review'),
    (_reporter_user_id,v_report_id,'privacy_notice',_notice_version,true,'threat_intelligence');
  insert into private.indicators(type,canonical_value_ciphertext,canonical_hash,hash_key_version,display_value_masked,risk_category,confidence,status)
  values(v_type,_indicator_ciphertext,_indicator_hash,_hash_key_version,btrim(_indicator_masked),'other',0,'proposed')
  on conflict(type,canonical_hash,hash_key_version) do nothing;
  select id into v_indicator_id from private.indicators where type=v_type and canonical_hash=_indicator_hash and hash_key_version=_hash_key_version;
  insert into private.report_indicators(report_id,indicator_id) values(v_report_id,v_indicator_id) on conflict(report_id,indicator_id) do nothing;
  insert into private.audit_events(actor_id,actor_role_snapshot,action,object_type,object_id,purpose_code,decision,correlation_id,metadata_min)
  values(_reporter_user_id,case when _reporter_user_id is null then 'public' else 'citizen' end,'report.created','citizen_report',v_report_id,
    'case_review','submitted',_correlation_id,jsonb_build_object('channel',v_channel::text,'intake','public_portal'));
  return jsonb_build_object('report_ref',v_report_ref,'status','submitted','received_at',now(),'idempotent_replay',false);
end; $$;

create or replace function public.get_report_status(_report_ref text)
returns jsonb language sql stable security definer set search_path=pg_catalog,private as $$
  select jsonb_build_object('report_ref',r.public_ref,'display_status',
    case when r.status in ('rejected','closed') then 'closed'
      when exists(select 1 from private.report_indicators ri join private.indicators i on i.id=ri.indicator_id
        where ri.report_id=r.id and i.status='published' and (i.expires_at is null or i.expires_at>now())) then 'verified_public'
      when r.status='submitted' then 'submitted'
      when r.status in ('accepted','referred') and exists(select 1 from private.report_indicators ri join private.indicators i on i.id=ri.indicator_id where ri.report_id=r.id and i.status='pending_review') then 'under_review'
      when r.status in ('accepted','referred') then 'review_complete' else 'under_review' end,
    'created_at',r.created_at,'updated_at',r.updated_at)
  from private.citizen_reports r
  where _report_ref ~ '^CS-[A-F0-9]{32}$' and r.public_ref=upper(_report_ref)
    and (r.reporter_user_id is null or r.reporter_user_id=auth.uid()) limit 1;
$$;
revoke all on function public.get_report_status(text) from public;
grant execute on function public.get_report_status(text) to anon,authenticated;

alter table private.osint_cases add column if not exists source_report_id uuid references private.citizen_reports(id) on delete restrict;
create unique index if not exists osint_cases_one_per_report on private.osint_cases(source_report_id) where source_report_id is not null;

create or replace function public.platform_admin_report_queue(_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare v_actor uuid:=auth.uid(); v_items jsonb;
begin
  if v_actor is null or not private.has_active_role('platform_admin') then raise exception using errcode='42501',message='role_required'; end if;
  select coalesce(jsonb_agg(q.item order by q.created_at desc),'[]'::jsonb) into v_items from (
    select jsonb_build_object('id',r.id,'report_ref',r.public_ref,'category',r.category::text,'channel',r.channel::text,
      'status',r.status::text,'priority',r.priority::text,'risk_score',case when r.priority='urgent' then 90 when r.priority='high' then 75 else 50 end,
      'narrative',r.narrative,'created_at',r.created_at,'indicator_masked',ind.display_value_masked,
      'evidence',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'scan_state',e.scan_state,'quarantine_state',e.quarantine_state,
        'can_preview',e.scan_state='clean' and e.quarantine_state='released') order by e.created_at)
        from private.evidence_objects e where e.report_id=r.id and e.upload_state='uploaded'),'[]'::jsonb),
      'osint_case_exists',exists(select 1 from private.osint_cases c where c.source_report_id=r.id)) as item,r.created_at
    from private.citizen_reports r left join lateral (
      select i.display_value_masked from private.report_indicators ri join private.indicators i on i.id=ri.indicator_id
      where ri.report_id=r.id order by ri.created_at limit 1
    ) ind on true
    where r.status in ('submitted','triage','needs_information','under_review')
      or (r.status='accepted' and not exists(select 1 from private.osint_cases c where c.source_report_id=r.id))
    order by r.created_at desc limit greatest(1,least(coalesce(_limit,50),100))
  ) q;
  insert into private.audit_events(actor_id,actor_role_snapshot,action,object_type,purpose_code,decision,metadata_min)
  values(v_actor,'platform_admin','report.read_for_admin_triage','citizen_report','triage','allowed',jsonb_build_object('item_count',jsonb_array_length(v_items)));
  return v_items;
end; $$;

create or replace function public.admin_moderate_report(_report_id uuid,_to_status text,_reason_code text,_safe_note text,_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare v_actor uuid:=auth.uid(); v_report private.citizen_reports%rowtype; v_next private.report_status;
begin
  if v_actor is null or not private.has_active_role('platform_admin') then raise exception using errcode='42501',message='role_required'; end if;
  if _report_id is null or _correlation_id is null or _reason_code is null or char_length(_reason_code)>64
    or (_safe_note is not null and (char_length(_safe_note)>500 or private.contains_citizen_contact(_safe_note))) then raise exception using errcode='22023',message='invalid_request'; end if;
  begin v_next:=_to_status::private.report_status; exception when others then raise exception using errcode='22023',message='invalid_request'; end;
  select * into v_report from private.citizen_reports where id=_report_id for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if not ((v_report.status='submitted' and v_next in ('triage','rejected','unverified_lead')) or
    (v_report.status='triage' and v_next in ('needs_information','rejected','unverified_lead','under_review')) or
    (v_report.status='needs_information' and v_next in ('triage','rejected','unverified_lead')) or
    (v_report.status='under_review' and v_next in ('accepted','rejected','closed'))) then
    raise exception using errcode='P0001',message='invalid_transition';
  end if;
  update private.citizen_reports set status=v_next,updated_at=now(),closed_at=case when v_next in ('rejected','closed') then now() else closed_at end where id=_report_id;
  insert into private.report_status_events(report_id,from_status,to_status,actor_id,reason_code,safe_note)
  values(_report_id,v_report.status,v_next,v_actor,_reason_code,nullif(btrim(_safe_note),''));
  insert into private.audit_events(actor_id,actor_role_snapshot,action,object_type,object_id,purpose_code,decision,before_hash,after_hash,correlation_id,metadata_min)
  values(v_actor,'platform_admin','report.status_changed','citizen_report',_report_id,'triage',v_next::text,
    extensions.digest(v_report.status::text,'sha256'),extensions.digest(v_next::text,'sha256'),_correlation_id,jsonb_build_object('reason_code',_reason_code));
  return jsonb_build_object('report_ref',v_report.public_ref,'status',v_next::text,'updated_at',now());
end; $$;

create or replace function public.admin_verify_indicator(_report_id uuid,_verification_source_url text,_verification_note text,_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare v_actor uuid:=auth.uid(); v_report private.citizen_reports%rowtype; v_indicator private.indicators%rowtype; v_has_first_review boolean;
begin
  if v_actor is null or not private.has_active_role('platform_admin') then raise exception using errcode='42501',message='role_required'; end if;
  if _report_id is null or _correlation_id is null or _verification_source_url is null or char_length(_verification_source_url) not between 8 and 2048
    or _verification_source_url !~* '^https?://[^/@[:space:]]+(/[^[:space:]]*)?$' or private.contains_citizen_contact(_verification_source_url)
    or _verification_note is null or char_length(btrim(_verification_note)) not between 10 and 1000 or private.contains_citizen_contact(_verification_note) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  select * into v_report from private.citizen_reports where id=_report_id for update;
  if not found or v_report.status<>'under_review' then raise exception using errcode='P0001',message='invalid_transition'; end if;
  select i.* into v_indicator from private.report_indicators ri join private.indicators i on i.id=ri.indicator_id
    where ri.report_id=_report_id order by ri.created_at limit 1 for update of i;
  if not found or v_indicator.status not in ('proposed','pending_review','published') then raise exception using errcode='P0002',message='indicator_not_eligible'; end if;
  if v_indicator.status='published' then
    update private.citizen_reports set status='accepted',updated_at=now() where id=_report_id;
    insert into private.report_status_events(report_id,from_status,to_status,actor_id,reason_code,safe_note)
    values(_report_id,v_report.status,'accepted',v_actor,'indicator_already_public','Related indicator is already published.');
    insert into private.audit_events(actor_id,actor_role_snapshot,action,object_type,object_id,purpose_code,decision,correlation_id,metadata_min)
    values(v_actor,'platform_admin','report.verified_existing_public_indicator','citizen_report',_report_id,'threat_review','already_published',_correlation_id,
      jsonb_build_object('report_ref',v_report.public_ref));
    return jsonb_build_object('report_ref',v_report.public_ref,'indicator_status','published','publication_state','already_published');
  end if;
  update private.citizen_reports set status='accepted',updated_at=now() where id=_report_id;
  if v_indicator.status='proposed' then update private.indicators set status='pending_review',evidence_grade='limited',updated_at=now() where id=v_indicator.id; end if;
  select exists(select 1 from private.indicator_publication_reviews pr where pr.indicator_id=v_indicator.id
    and pr.decision='approved' and pr.reviewer_role in ('moderator','platform_admin')) into v_has_first_review;
  if not v_has_first_review then
    insert into private.indicator_publication_reviews(indicator_id,report_id,reviewer_id,reviewer_role,decision,verification_source_url,verification_note)
    values(v_indicator.id,_report_id,v_actor,'platform_admin','approved',_verification_source_url,btrim(_verification_note));
  end if;
  insert into private.report_status_events(report_id,from_status,to_status,actor_id,reason_code,safe_note)
  values(_report_id,v_report.status,'accepted',v_actor,'indicator_verified','Source-backed verification recorded; publication still requires independent review.');
  insert into private.audit_events(actor_id,actor_role_snapshot,action,object_type,object_id,purpose_code,decision,correlation_id,metadata_min)
  values(v_actor,'platform_admin','indicator.verified_for_publication','indicator',v_indicator.id,'threat_review',
    case when v_has_first_review then 'first_review_already_recorded' else 'pending_second_review' end,_correlation_id,jsonb_build_object('report_ref',v_report.public_ref));
  return jsonb_build_object('report_ref',v_report.public_ref,'indicator_status','pending_review','publication_state','pending_second_review');
end; $$;

create or replace function public.admin_create_osint_case(_report_id uuid,_title text,_brief text,_objective text,_allowed_sources text[],_deadline_at timestamptz,_max_assignments smallint,_correlation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare v_actor uuid:=auth.uid(); v_report private.citizen_reports%rowtype; v_case_id uuid; v_case_ref text;
begin
  if v_actor is null or not private.has_active_role('platform_admin') then raise exception using errcode='42501',message='role_required'; end if;
  if _report_id is null or _correlation_id is null or _title is null or char_length(btrim(_title)) not between 3 and 160
    or _brief is null or char_length(btrim(_brief)) not between 10 and 5000 or _objective is null or char_length(btrim(_objective)) not between 10 and 1000
    or private.contains_citizen_contact(_title||' '||_brief||' '||_objective) or _allowed_sources is null or cardinality(_allowed_sources) not between 1 and 10
    or exists(select 1 from unnest(_allowed_sources) as src(value) where char_length(src.value) not between 2 and 120
      or src.value !~* '^([a-z0-9-]+\.)+[a-z]{2,}$' or private.contains_citizen_contact(src.value))
    or _max_assignments not between 1 and 10 or (_deadline_at is not null and _deadline_at<=now()) then
    raise exception using errcode='22023',message='invalid_case';
  end if;
  select * into v_report from private.citizen_reports where id=_report_id and status='accepted' for update;
  if not found or not exists(select 1 from private.report_indicators ri join private.indicators i on i.id=ri.indicator_id
    where ri.report_id=_report_id and i.status in ('pending_review','published')) then raise exception using errcode='P0002',message='report_not_verified'; end if;
  if exists(select 1 from private.osint_cases c where c.source_report_id=_report_id) then raise exception using errcode='P0001',message='case_already_exists'; end if;
  v_case_id:=gen_random_uuid(); v_case_ref:='OS-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  insert into private.osint_cases(id,case_ref,title_safe,sanitized_brief,objective,allowed_sources,prohibited_actions,state,max_assignments,deadline_at,created_by,source_report_id)
  values(v_case_id,v_case_ref,btrim(_title),btrim(_brief),btrim(_objective),_allowed_sources,
    array['intrusion','credential_access','suspect_contact','doxxing','private_record_collection'],'available',_max_assignments,_deadline_at,v_actor,_report_id);
  insert into private.audit_events(actor_id,actor_role_snapshot,action,object_type,object_id,purpose_code,decision,correlation_id,metadata_min)
  values(v_actor,'platform_admin','osint.case_created_from_verified_report','osint_case',v_case_id,'scoped_research','available',_correlation_id,
    jsonb_build_object('report_ref',v_report.public_ref));
  return jsonb_build_object('case_id',v_case_id,'case_ref',v_case_ref,'state','available');
end; $$;

-- Anonymous report references are high-entropy capabilities. They can authorize
-- a single short-lived evidence upload without granting direct Storage access.
alter table private.evidence_objects alter column uploaded_by drop not null;
alter table private.evidence_objects add column if not exists anonymous_requester_hash bytea
  check (anonymous_requester_hash is null or octet_length(anonymous_requester_hash)=32);
do $$ begin
  if not exists(select 1 from pg_catalog.pg_constraint where conname='evidence_objects_upload_actor_check'
    and conrelid='private.evidence_objects'::regclass) then
    alter table private.evidence_objects add constraint evidence_objects_upload_actor_check
      check ((uploaded_by is not null and anonymous_requester_hash is null)
        or (uploaded_by is null and anonymous_requester_hash is not null));
  end if;
end $$;
create index if not exists evidence_objects_anonymous_rate
  on private.evidence_objects(anonymous_requester_hash,created_at desc) where anonymous_requester_hash is not null;

create or replace function public.authorize_evidence_upload(_report_ref text,_file_name text,_content_type text,_byte_size bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare v_actor uuid:=auth.uid(); v_report private.citizen_reports%rowtype; v_evidence_id uuid:=gen_random_uuid();
  v_object_key text:='objects/'||gen_random_uuid()::text; v_expires_at timestamptz:=now()+interval '5 minutes'; v_count integer;
begin
  if v_actor is null or not private.has_active_role('citizen') then raise exception using errcode='42501',message='role_required'; end if;
  if _report_ref is null or _report_ref !~ '^CS-([A-F0-9]{10}|[A-F0-9]{32})$'
    or _file_name is null or char_length(_file_name) not between 1 and 120 or _file_name ~ '[[:cntrl:]]'
    or position('/' in _file_name)>0 or position(chr(92) in _file_name)>0
    or _content_type is null or _content_type not in ('image/jpeg','image/png','image/webp','application/pdf')
    or _byte_size is null or _byte_size not between 1 and 5242880 then raise exception using errcode='22023',message='invalid_request'; end if;
  select * into v_report from private.citizen_reports where public_ref=upper(_report_ref) and reporter_user_id=v_actor for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_report.status in ('rejected','closed') then raise exception using errcode='22023',message='evidence_not_allowed'; end if;
  select count(*) into v_count from private.evidence_objects e where e.uploaded_by=v_actor and e.created_at>now()-interval '10 minutes';
  if v_count>=15 then raise exception using errcode='P0001',message='rate_limited'; end if;
  select count(*) into v_count from private.evidence_objects e where e.report_id=v_report.id
    and (e.upload_state='uploaded' or (e.upload_state='authorized' and e.upload_expires_at>now()));
  if v_count>=3 then raise exception using errcode='P0001',message='evidence_limit_reached'; end if;
  insert into private.evidence_objects(id,report_id,object_key,claimed_content_type,byte_size,uploaded_by,anonymous_requester_hash,upload_expires_at,retained_until)
  values(v_evidence_id,v_report.id,v_object_key,_content_type,_byte_size,v_actor,null,v_expires_at,now()+interval '30 days');
  insert into private.audit_events(actor_id,actor_role_snapshot,action,object_type,object_id,purpose_code,decision,metadata_min)
  values(v_actor,'citizen','evidence.upload_authorized','evidence_object',v_evidence_id,'case_review','quarantined',
    jsonb_build_object('content_type',_content_type,'byte_size',_byte_size));
  return jsonb_build_object('evidence_id',v_evidence_id,'object_key',v_object_key,'user_id',v_actor,
    'content_type',_content_type,'byte_size',_byte_size,'expires_at',v_expires_at);
end; $$;

create or replace function public.authorize_anonymous_evidence_upload(
  _report_ref text,_requester_hash bytea,_file_name text,_content_type text,_byte_size bigint
) returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare v_report private.citizen_reports%rowtype; v_evidence_id uuid:=gen_random_uuid();
  v_object_key text:='objects/'||gen_random_uuid()::text; v_expires_at timestamptz:=now()+interval '5 minutes'; v_count integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='edge_only'; end if;
  if _report_ref is null or _report_ref !~ '^CS-[A-F0-9]{32}$' or _requester_hash is null or octet_length(_requester_hash)<>32
    or _file_name is null or char_length(_file_name) not between 1 and 120 or _file_name ~ '[[:cntrl:]]'
    or position('/' in _file_name)>0 or position(chr(92) in _file_name)>0
    or _content_type is null or _content_type not in ('image/jpeg','image/png','image/webp','application/pdf')
    or _byte_size is null or _byte_size not between 1 and 5242880 then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(encode(_requester_hash,'hex'),1));
  select count(*) into v_count from private.evidence_objects e
    where e.anonymous_requester_hash=_requester_hash and e.created_at>now()-interval '15 minutes';
  if v_count>=15 then raise exception using errcode='P0001',message='rate_limited'; end if;
  select * into v_report from private.citizen_reports r
    where r.public_ref=upper(_report_ref) and r.reporter_user_id is null for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_report.status in ('rejected','closed') then raise exception using errcode='22023',message='evidence_not_allowed'; end if;
  select count(*) into v_count from private.evidence_objects e where e.report_id=v_report.id
    and (e.upload_state='uploaded' or (e.upload_state='authorized' and e.upload_expires_at>now()));
  if v_count>=3 then raise exception using errcode='P0001',message='evidence_limit_reached'; end if;
  insert into private.evidence_objects(id,report_id,object_key,claimed_content_type,byte_size,uploaded_by,
    anonymous_requester_hash,upload_expires_at,retained_until)
  values(v_evidence_id,v_report.id,v_object_key,_content_type,_byte_size,null,_requester_hash,v_expires_at,now()+interval '30 days');
  insert into private.audit_events(actor_id,actor_role_snapshot,action,object_type,object_id,purpose_code,decision,metadata_min)
  values(null,'public','evidence.upload_authorized','evidence_object',v_evidence_id,'case_review','quarantined',
    jsonb_build_object('content_type',_content_type,'byte_size',_byte_size));
  return jsonb_build_object('evidence_id',v_evidence_id,'object_key',v_object_key,'user_id',null,
    'content_type',_content_type,'byte_size',_byte_size,'expires_at',v_expires_at);
end; $$;

create or replace function public.verify_anonymous_evidence_upload_ticket(
  _evidence_id uuid,_object_key text,_content_type text,_byte_size bigint,_expires_at timestamptz,_report_ref text
) returns boolean language plpgsql stable security definer set search_path=pg_catalog,private as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='edge_only'; end if;
  return exists(select 1 from private.evidence_objects e join private.citizen_reports r on r.id=e.report_id
    where e.id=_evidence_id and e.object_key=_object_key and e.claimed_content_type=_content_type and e.byte_size=_byte_size
      and e.upload_expires_at=_expires_at and e.upload_expires_at>now() and e.upload_state='authorized'
      and e.uploaded_by is null and e.anonymous_requester_hash is not null and r.reporter_user_id is null
      and r.public_ref=upper(_report_ref) and r.status not in ('rejected','closed'));
end; $$;

create or replace function public.complete_evidence_upload(
  _evidence_id uuid,_object_key text,_actual_size bigint,_sha256 bytea,_observed_content_type text
) returns boolean language plpgsql security definer set search_path=pg_catalog,private as $$
declare v_actor uuid; v_object_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='role_required'; end if;
  if _actual_size is null or _actual_size not between 1 and 5242880 or _sha256 is null or octet_length(_sha256)<>32
    or _observed_content_type is null or _observed_content_type not in ('image/jpeg','image/png','image/webp','application/pdf') then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  update private.evidence_objects e set upload_state='uploaded',sha256=_sha256,
    observed_content_type=_observed_content_type,uploaded_at=now()
  where e.id=_evidence_id and e.object_key=_object_key and e.byte_size=_actual_size
    and e.claimed_content_type=_observed_content_type and e.upload_state='authorized' and e.upload_expires_at>now()
  returning e.uploaded_by,e.id into v_actor,v_object_id;
  if v_object_id is null then raise exception using errcode='P0002',message='upload_not_authorized'; end if;
  insert into private.audit_events(actor_id,actor_role_snapshot,action,object_type,object_id,purpose_code,decision,metadata_min)
  values(v_actor,case when v_actor is null then 'public' else 'citizen' end,'evidence.uploaded','evidence_object',_evidence_id,
    'case_review','quarantined',jsonb_build_object('content_type',_observed_content_type,'byte_size',_actual_size));
  return true;
end; $$;

create or replace function public.admin_authorize_evidence_preview(_report_id uuid,_evidence_id uuid,_correlation_id uuid)
returns text language plpgsql security definer set search_path=pg_catalog,private as $$
declare v_actor uuid:=auth.uid(); v_object_key text; v_scan_state text; v_quarantine_state text;
begin
  if v_actor is null or not private.has_active_role('platform_admin') then raise exception using errcode='42501',message='role_required'; end if;
  if _report_id is null or _evidence_id is null or _correlation_id is null then raise exception using errcode='22023',message='invalid_request'; end if;
  select e.object_key,e.scan_state,e.quarantine_state into v_object_key,v_scan_state,v_quarantine_state
  from private.evidence_objects e where e.id=_evidence_id and e.report_id=_report_id and e.upload_state='uploaded';
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if v_scan_state<>'clean' or v_quarantine_state<>'released' then raise exception using errcode='P0001',message='evidence_pending_scan'; end if;
  insert into private.audit_events(actor_id,actor_role_snapshot,action,object_type,object_id,purpose_code,decision,correlation_id,metadata_min)
  values(v_actor,'platform_admin','evidence.preview_authorized','evidence_object',_evidence_id,'triage','allowed',_correlation_id,
    jsonb_build_object('report_id',_report_id));
  return v_object_key;
end; $$;

-- Admin verification is a valid first-person review. Keep the two-reviewer
-- publication rule, and let the independent queue recognize this reviewer role.
create or replace function public.indicator_publication_queue()
returns jsonb language plpgsql security definer set search_path=pg_catalog,private as $$
declare v_actor uuid:=auth.uid(); v_items jsonb;
begin
  if v_actor is null or not (private.has_active_role('senior_reviewer') or private.has_active_role('platform_admin')) then
    raise exception using errcode='42501',message='role_required';
  end if;
  select coalesce(jsonb_agg(q.item order by q.created_at),'[]'::jsonb) into v_items from (
    select distinct on (i.id) jsonb_build_object('indicator_id',i.id,'report_ref',r.public_ref,
      'category',r.category::text,'channel',r.channel::text,'indicator_masked',i.display_value_masked,
      'verification_source_url',first_review.verification_source_url,'verification_note',first_review.verification_note,
      'submitted_at',first_review.created_at) as item,first_review.created_at
    from private.indicators i join private.report_indicators ri on ri.indicator_id=i.id
    join private.citizen_reports r on r.id=ri.report_id and r.status='accepted'
    join lateral (select pr.verification_source_url,pr.verification_note,pr.created_at
      from private.indicator_publication_reviews pr where pr.indicator_id=i.id and pr.decision='approved'
        and pr.reviewer_role in ('moderator','platform_admin') order by pr.created_at asc limit 1) first_review on true
    where i.status='pending_review' order by i.id,first_review.created_at
  ) q;
  return v_items;
end; $$;

create or replace function public.review_indicator_publication(
  _indicator_id uuid,_decision text,_confidence smallint,_verification_source_url text,_verification_note text,_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare v_actor uuid:=auth.uid(); v_indicator private.indicators%rowtype; v_first_review private.indicator_publication_reviews%rowtype;
  v_role text; v_next_status private.indicator_status;
begin
  if v_actor is null or not (private.has_active_role('senior_reviewer') or private.has_active_role('platform_admin')) then
    raise exception using errcode='42501',message='role_required';
  end if;
  if _indicator_id is null or _correlation_id is null or _decision not in ('approved','rejected')
    or _verification_source_url is null or char_length(_verification_source_url) not between 8 and 2048
    or _verification_source_url !~* '^https?://[^/@[:space:]]+(/[^[:space:]]*)?$'
    or private.contains_citizen_contact(_verification_source_url)
    or _verification_note is null or char_length(btrim(_verification_note)) not between 10 and 1000
    or private.contains_citizen_contact(_verification_note)
    or (_decision='approved' and (_confidence is null or _confidence not between 50 and 90)) then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  v_role:=case when private.has_active_role('platform_admin') then 'platform_admin' else 'senior_reviewer' end;
  select * into v_indicator from private.indicators where id=_indicator_id for update;
  if not found or v_indicator.status<>'pending_review' then raise exception using errcode='P0002',message='not_available'; end if;
  select * into v_first_review from private.indicator_publication_reviews
  where indicator_id=_indicator_id and decision='approved' and reviewer_role in ('moderator','platform_admin')
  order by created_at asc limit 1;
  if not found then raise exception using errcode='P0001',message='first_review_required'; end if;
  if v_first_review.reviewer_id=v_actor then raise exception using errcode='42501',message='independent_review_required'; end if;
  if exists(select 1 from private.indicator_publication_reviews where indicator_id=_indicator_id and reviewer_id=v_actor) then
    raise exception using errcode='P0001',message='already_reviewed';
  end if;
  insert into private.indicator_publication_reviews(indicator_id,report_id,reviewer_id,reviewer_role,decision,verification_source_url,verification_note)
  values(_indicator_id,v_first_review.report_id,v_actor,v_role,_decision,_verification_source_url,btrim(_verification_note));
  if _decision='approved' then
    v_next_status:='published';
    update private.indicators set status=v_next_status,confidence=_confidence,evidence_grade='corroborated',updated_at=now() where id=_indicator_id;
  else
    v_next_status:='rejected'; update private.indicators set status=v_next_status,updated_at=now() where id=_indicator_id;
  end if;
  insert into private.audit_events(actor_id,actor_role_snapshot,action,object_type,object_id,purpose_code,decision,before_hash,after_hash,correlation_id,metadata_min)
  values(v_actor,v_role,'indicator.publication_reviewed','indicator',_indicator_id,'threat_review',v_next_status::text,
    extensions.digest(v_indicator.status::text,'sha256'),extensions.digest(v_next_status::text,'sha256'),_correlation_id,
    jsonb_build_object('first_reviewer_id',v_first_review.reviewer_id,'feed_ready',_decision='approved'));
  return jsonb_build_object('indicator_id',_indicator_id,'status',v_next_status::text);
end; $$;

revoke all on function public.submit_citizen_report(uuid,bytea,uuid,text,text,timestamptz,text,text,text,bytea,bytea,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.submit_analyst_application(text,text,text,text,uuid) from public,anon;
revoke all on function public.my_analyst_application() from public,anon;
revoke all on function public.admin_analyst_application_queue() from public,anon;
revoke all on function public.review_analyst_application(uuid,text,text,uuid) from public,anon;
revoke all on function public.platform_admin_report_queue(integer) from public,anon;
revoke all on function public.admin_moderate_report(uuid,text,text,text,uuid) from public,anon;
revoke all on function public.admin_verify_indicator(uuid,text,text,uuid) from public,anon;
revoke all on function public.admin_create_osint_case(uuid,text,text,text,text[],timestamptz,smallint,uuid) from public,anon;
revoke all on function public.authorize_anonymous_evidence_upload(text,bytea,text,text,bigint) from public,anon,authenticated;
revoke all on function public.verify_anonymous_evidence_upload_ticket(uuid,text,text,bigint,timestamptz,text) from public,anon,authenticated;
revoke all on function public.admin_authorize_evidence_preview(uuid,uuid,uuid) from public,anon;
revoke all on function public.indicator_publication_queue() from public,anon;
revoke all on function public.review_indicator_publication(uuid,text,smallint,text,text,uuid) from public,anon;
grant execute on function public.submit_citizen_report(uuid,bytea,uuid,text,text,timestamptz,text,text,text,bytea,bytea,text,text,text,uuid) to service_role;
grant execute on function public.submit_analyst_application(text,text,text,text,uuid) to authenticated;
grant execute on function public.my_analyst_application() to authenticated;
grant execute on function public.admin_analyst_application_queue() to authenticated;
grant execute on function public.review_analyst_application(uuid,text,text,uuid) to authenticated;
grant execute on function public.platform_admin_report_queue(integer) to authenticated;
grant execute on function public.admin_moderate_report(uuid,text,text,text,uuid) to authenticated;
grant execute on function public.admin_verify_indicator(uuid,text,text,uuid) to authenticated;
grant execute on function public.admin_create_osint_case(uuid,text,text,text,text[],timestamptz,smallint,uuid) to authenticated;
grant execute on function public.authorize_anonymous_evidence_upload(text,bytea,text,text,bigint) to service_role;
grant execute on function public.verify_anonymous_evidence_upload_ticket(uuid,text,text,bigint,timestamptz,text) to service_role;
grant execute on function public.authorize_evidence_upload(text,text,text,bigint) to authenticated;
grant execute on function public.admin_authorize_evidence_preview(uuid,uuid,uuid) to authenticated;
grant execute on function public.indicator_publication_queue() to authenticated;
grant execute on function public.review_indicator_publication(uuid,text,smallint,text,text,uuid) to authenticated;
