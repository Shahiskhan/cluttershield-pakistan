-- Deny browser access by default. Only the minimal profile projection is directly
-- queryable; sensitive workflows use the narrowly scoped RPCs above.

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table private.role_assignments enable row level security;
alter table private.role_assignments force row level security;
alter table private.citizen_reports enable row level security;
alter table private.citizen_reports force row level security;
alter table private.report_status_events enable row level security;
alter table private.report_status_events force row level security;
alter table private.indicators enable row level security;
alter table private.indicators force row level security;
alter table private.report_indicators enable row level security;
alter table private.report_indicators force row level security;
alter table private.consent_records enable row level security;
alter table private.consent_records force row level security;
alter table private.moderation_assignments enable row level security;
alter table private.moderation_assignments force row level security;
alter table private.osint_cases enable row level security;
alter table private.osint_cases force row level security;
alter table private.case_assignments enable row level security;
alter table private.case_assignments force row level security;
alter table private.audit_events enable row level security;
alter table private.audit_events force row level security;
alter table private.evidence_objects enable row level security;
alter table private.evidence_objects force row level security;

drop policy if exists profile_read_self on public.profiles;
create policy profile_read_self on public.profiles
  for select to authenticated using (id = (select auth.uid()));
drop policy if exists profile_update_self on public.profiles;
create policy profile_update_self on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists role_assignments_deny_client on private.role_assignments;
create policy role_assignments_deny_client on private.role_assignments
  for all to anon, authenticated using (false) with check (false);
drop policy if exists citizen_reports_deny_client on private.citizen_reports;
create policy citizen_reports_deny_client on private.citizen_reports
  for all to anon, authenticated using (false) with check (false);
drop policy if exists report_status_events_deny_client on private.report_status_events;
create policy report_status_events_deny_client on private.report_status_events
  for all to anon, authenticated using (false) with check (false);
drop policy if exists indicators_deny_client on private.indicators;
create policy indicators_deny_client on private.indicators
  for all to anon, authenticated using (false) with check (false);
drop policy if exists report_indicators_deny_client on private.report_indicators;
create policy report_indicators_deny_client on private.report_indicators
  for all to anon, authenticated using (false) with check (false);
drop policy if exists consent_records_deny_client on private.consent_records;
create policy consent_records_deny_client on private.consent_records
  for all to anon, authenticated using (false) with check (false);
drop policy if exists moderation_assignments_deny_client on private.moderation_assignments;
create policy moderation_assignments_deny_client on private.moderation_assignments
  for all to anon, authenticated using (false) with check (false);
drop policy if exists osint_cases_deny_client on private.osint_cases;
create policy osint_cases_deny_client on private.osint_cases
  for all to anon, authenticated using (false) with check (false);
drop policy if exists case_assignments_deny_client on private.case_assignments;
create policy case_assignments_deny_client on private.case_assignments
  for all to anon, authenticated using (false) with check (false);
drop policy if exists audit_events_deny_client on private.audit_events;
create policy audit_events_deny_client on private.audit_events
  for all to anon, authenticated using (false) with check (false);
drop policy if exists evidence_objects_no_client_access on private.evidence_objects;
create policy evidence_objects_no_client_access on private.evidence_objects
  as restrictive for all to anon, authenticated using (false) with check (false);

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

alter table private.osint_cases enable row level security;
alter table private.osint_cases force row level security;
drop policy if exists osint_cases_restrict_direct_client_access on private.osint_cases;
create policy osint_cases_restrict_direct_client_access on private.osint_cases
  as restrictive for all to anon, authenticated using (false) with check (false);
alter table private.case_assignments enable row level security;
alter table private.case_assignments force row level security;
drop policy if exists case_assignments_restrict_direct_client_access on private.case_assignments;
create policy case_assignments_restrict_direct_client_access on private.case_assignments
  as restrictive for all to anon, authenticated using (false) with check (false);

alter table private.indicator_publication_reviews enable row level security;
alter table private.indicator_publication_reviews force row level security;
drop policy if exists indicator_publication_reviews_deny_client on private.indicator_publication_reviews;
create policy indicator_publication_reviews_deny_client on private.indicator_publication_reviews
  as restrictive for all to anon, authenticated using (false) with check (false);
alter table private.osint_findings enable row level security;
alter table private.osint_findings force row level security;
drop policy if exists osint_findings_deny_client on private.osint_findings;
create policy osint_findings_deny_client on private.osint_findings
  as restrictive for all to anon, authenticated using (false) with check (false);
alter table private.team_rooms enable row level security;
alter table private.team_rooms force row level security;
drop policy if exists team_rooms_deny_client on private.team_rooms;
create policy team_rooms_deny_client on private.team_rooms
  as restrictive for all to anon, authenticated using (false) with check (false);
alter table private.team_message_actors enable row level security;
alter table private.team_message_actors force row level security;
drop policy if exists team_message_actors_deny_client on private.team_message_actors;
create policy team_message_actors_deny_client on private.team_message_actors
  as restrictive for all to anon, authenticated using (false) with check (false);

create or replace function private.can_access_team(_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $$
  select auth.uid() is not null and exists (
    select 1 from private.team_rooms tr
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
        select 1 from private.case_assignments ca
        where ca.case_id = tr.case_id
          and (ca.analyst_id = auth.uid() or ca.mentor_id = auth.uid())
          and ca.state in ('assigned', 'in_progress', 'findings_submitted')
          and ca.expires_at > now()
      ))
    )
  );
$$;
revoke all on function private.can_access_team(uuid) from public, anon, authenticated;

alter table public.team_messages enable row level security;
alter table public.team_messages force row level security;
drop policy if exists team_messages_read_authorized_rooms on public.team_messages;
create policy team_messages_read_authorized_rooms on public.team_messages
  for select to authenticated using (private.can_access_team(team_id));

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on table private.evidence_objects from public, anon, authenticated;
revoke all on table private.indicator_publication_reviews from public, anon, authenticated;
revoke all on table private.osint_findings from public, anon, authenticated;
revoke all on table private.team_rooms from public, anon, authenticated;
revoke all on table private.team_message_actors from public, anon, authenticated;
revoke all on table public.team_messages from public, anon, authenticated;
grant select (id, team_id, sender_role, body, created_at) on public.team_messages to authenticated;
revoke all on table public.profiles from public, anon, authenticated;
grant execute on function private.can_access_team(uuid) to authenticated;
grant usage on schema private to authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, locale, region_code) on table public.profiles to authenticated;

