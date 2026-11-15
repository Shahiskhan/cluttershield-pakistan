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

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, locale, region_code) on table public.profiles to authenticated;

