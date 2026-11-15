-- Citizen portal channel choice and privacy-safe status projection.
-- Keep this enum change in its own migration so PostgreSQL commits it before
-- any function or row uses the new enum value.
alter type private.report_channel add value if not exists 'website_social_media';

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
          select 1
          from private.report_indicators ri
          join private.indicators i on i.id = ri.indicator_id
          where ri.report_id = r.id
            and i.status = 'published'
            and (i.expires_at is null or i.expires_at > now())
        ) then 'verified_public'
        when r.status = 'submitted' then 'submitted'
        when r.status in ('accepted', 'referred') then 'review_complete'
        else 'under_review'
      end,
    'created_at', r.created_at,
    'updated_at', r.updated_at
  )
  from private.citizen_reports r
  where r.public_ref = _report_ref
    and r.reporter_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.get_own_report(text) from public, anon;
grant execute on function public.get_own_report(text) to authenticated;
