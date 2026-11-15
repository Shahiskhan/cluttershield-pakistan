-- Signed public feed snapshots. Private signing material is deliberately never
-- stored in Postgres; only public verification keys and signed snapshots live here.

create table private.feed_signing_keys (
  key_id text primary key check (key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  public_key bytea not null check (octet_length(public_key) = 32),
  state text not null default 'active' check (state in ('active', 'retired', 'revoked')),
  not_before timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check ((state = 'revoked') = (revoked_at is not null))
);

create table private.feed_releases (
  id uuid primary key default gen_random_uuid(),
  feed_version bigint generated always as identity unique,
  state text not null default 'preparing'
    check (state in ('preparing', 'published', 'revoked', 'rolled_back', 'failed')),
  key_id text not null references private.feed_signing_keys(key_id) on delete restrict,
  generated_at timestamptz not null,
  valid_until timestamptz not null,
  payload_sha256 text check (payload_sha256 is null or payload_sha256 ~ '^[a-f0-9]{64}$'),
  signature text,
  snapshot jsonb,
  item_count integer not null default 0 check (item_count between 0 and 50000),
  rollback_from_version bigint,
  created_by uuid references public.profiles(id) on delete restrict,
  correlation_id uuid not null,
  published_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (valid_until > generated_at and valid_until <= generated_at + interval '24 hours'),
  check ((state = 'published') = (published_at is not null)),
  check ((state = 'revoked') = (revoked_at is not null)),
  check ((payload_sha256 is null) = (signature is null)),
  check ((state = 'published') = (snapshot is not null))
);
create unique index feed_releases_single_preparing on private.feed_releases ((true)) where state = 'preparing';
create index feed_releases_current_lookup on private.feed_releases (feed_version desc) where state = 'published';

create table private.feed_release_items (
  release_id uuid not null references private.feed_releases(id) on delete restrict,
  indicator_id uuid not null references private.indicators(id) on delete restrict,
  type text not null check (type in ('domain', 'url', 'phone')),
  scope text not null check (scope in ('exact', 'host', 'path')),
  match_value text not null check (char_length(match_value) between 1 and 2048),
  risk_category text not null,
  confidence_band text not null check (confidence_band in ('low', 'medium', 'high')),
  last_reviewed_at timestamptz not null,
  advisory text not null check (char_length(advisory) between 1 and 500),
  primary key (release_id, indicator_id),
  unique (release_id, type, scope, match_value)
);
create index feed_release_items_indicator on private.feed_release_items (indicator_id, release_id);

create table private.feed_control (
  singleton boolean primary key default true check (singleton),
  current_release_id uuid references private.feed_releases(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete restrict
);
insert into private.feed_control(singleton) values (true) on conflict (singleton) do nothing;

alter table private.feed_signing_keys enable row level security;
alter table private.feed_signing_keys force row level security;
alter table private.feed_releases enable row level security;
alter table private.feed_releases force row level security;
alter table private.feed_release_items enable row level security;
alter table private.feed_release_items force row level security;
alter table private.feed_control enable row level security;
alter table private.feed_control force row level security;
create policy feed_signing_keys_deny_client on private.feed_signing_keys as restrictive for all to anon, authenticated using (false) with check (false);
create policy feed_releases_deny_client on private.feed_releases as restrictive for all to anon, authenticated using (false) with check (false);
create policy feed_release_items_deny_client on private.feed_release_items as restrictive for all to anon, authenticated using (false) with check (false);
create policy feed_control_deny_client on private.feed_control as restrictive for all to anon, authenticated using (false) with check (false);
revoke all on table private.feed_signing_keys, private.feed_releases, private.feed_release_items, private.feed_control from public, anon, authenticated;

-- Key registration and lifecycle changes are performed by trusted operators.
create or replace function public.register_feed_signing_key(_key_id text, _public_key_b64 text)
returns void language plpgsql security definer set search_path = pg_catalog, private
as $$
declare v_actor uuid := auth.uid(); v_key bytea;
begin
  if v_actor is null or not private.has_active_role('platform_admin') then raise exception using errcode='42501', message='role_required'; end if;
  if _key_id !~ '^[A-Za-z0-9_-]{1,64}$' or _public_key_b64 !~ '^[A-Za-z0-9+/]{43}=$' then raise exception using errcode='22023', message='invalid_key'; end if;
  v_key := decode(_public_key_b64, 'base64');
  if octet_length(v_key) <> 32 then raise exception using errcode='22023', message='invalid_key'; end if;
  insert into private.feed_signing_keys(key_id, public_key) values (_key_id, v_key);
  insert into private.audit_events(actor_id, actor_role_snapshot, action, object_type, purpose_code, decision, metadata_min)
  values (v_actor, 'platform_admin', 'feed.key_registered', 'feed_signing_key', 'feed_security', 'allowed', jsonb_build_object('key_id', _key_id));
end; $$;

create or replace function public.begin_feed_release(_actor_id uuid, _key_id text, _valid_until timestamptz, _correlation_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, private
as $$
declare v_actor uuid := _actor_id; v_id uuid; v_version bigint; v_now timestamptz := now(); v_items jsonb;
begin
  if auth.role() <> 'service_role' or v_actor is null or not exists (
    select 1 from private.role_assignments ra where ra.user_id=v_actor and ra.role='platform_admin'
      and ra.revoked_at is null and ra.starts_at<=now() and (ra.expires_at is null or ra.expires_at>now())
  ) then raise exception using errcode='42501', message='role_required'; end if;
  if _correlation_id is null or _valid_until <= v_now or _valid_until > v_now + interval '24 hours' then raise exception using errcode='22023', message='invalid_release_window'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cluttersheild-feed-release', 0));
  update private.feed_releases set state='failed' where state='preparing' and created_at < v_now - interval '10 minutes';
  if not exists(select 1 from private.feed_signing_keys k where k.key_id=_key_id and k.state='active' and k.not_before<=v_now) then raise exception using errcode='22023', message='signing_key_unavailable'; end if;
  insert into private.feed_releases(key_id, generated_at, valid_until, created_by, correlation_id)
  values (_key_id, v_now, _valid_until, v_actor, _correlation_id) returning id, feed_version into v_id, v_version;
  select coalesce(jsonb_agg(jsonb_build_object(
    'indicator_id', i.id,
    'type', case i.type when 'phone_number' then 'phone' when 'domain' then 'domain' when 'url' then 'url' else null end,
    'scope', i.scope::text,
    'ciphertext', encode(i.canonical_value_ciphertext, 'base64'),
    'risk_category', i.risk_category::text,
    'confidence_band', case when i.confidence >= 80 then 'high' when i.confidence >= 60 then 'medium' else 'low' end,
    'last_reviewed_at', i.updated_at
  ) order by i.type, i.canonical_hash), '[]'::jsonb)
  into v_items from private.indicators i
  where i.status='published' and (i.expires_at is null or i.expires_at > v_now)
    and i.type in ('domain', 'url', 'phone_number');
  if jsonb_array_length(v_items) > 50000 then raise exception using errcode='54000', message='feed_item_limit'; end if;
  return jsonb_build_object('release_id', v_id, 'feed_version', v_version, 'generated_at', v_now, 'valid_until', _valid_until,
    'key_id', _key_id, 'public_key', (select encode(k.public_key, 'base64') from private.feed_signing_keys k where k.key_id=_key_id), 'items', v_items);
end; $$;

create or replace function public.finish_feed_release(_actor_id uuid, _release_id uuid, _snapshot jsonb, _payload_sha256 text, _signature text, _item_rows jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, private
as $$
declare v_actor uuid := _actor_id; v_release private.feed_releases%rowtype; v_key private.feed_signing_keys%rowtype;
begin
  if auth.role() <> 'service_role' or v_actor is null or not exists (
    select 1 from private.role_assignments ra where ra.user_id=v_actor and ra.role='platform_admin'
      and ra.revoked_at is null and ra.starts_at<=now() and (ra.expires_at is null or ra.expires_at>now())
  ) then raise exception using errcode='42501', message='role_required'; end if;
  select * into v_release from private.feed_releases where id=_release_id and state='preparing' and created_by=v_actor for update;
  if not found then raise exception using errcode='P0002', message='release_unavailable'; end if;
  select * into v_key from private.feed_signing_keys where key_id=v_release.key_id and state='active' for share;
  if not found or v_release.valid_until <= now() or jsonb_typeof(_snapshot) <> 'object' or jsonb_typeof(_item_rows) <> 'array'
    or jsonb_array_length(_item_rows) > 50000 or _payload_sha256 !~ '^[a-f0-9]{64}$' or _signature !~ '^[A-Za-z0-9+/]{86}==$'
    or _snapshot->>'key_id' <> v_release.key_id or (_snapshot->>'feed_version')::bigint <> v_release.feed_version
    or _snapshot->>'payload_sha256' <> _payload_sha256 or _snapshot->>'signature' <> _signature then
    raise exception using errcode='22023', message='invalid_snapshot';
  end if;
  if not exists (select 1 from private.feed_signing_keys k where k.key_id=v_release.key_id and k.public_key is not null) then raise exception using errcode='22023', message='signing_key_unavailable'; end if;
  insert into private.feed_release_items(release_id, indicator_id, type, scope, match_value, risk_category, confidence_band, last_reviewed_at, advisory)
  select _release_id, (x->>'indicator_id')::uuid, x->>'type', x->>'scope', x->>'match_value', x->>'risk_category', x->>'confidence_band', (x->>'last_reviewed_at')::timestamptz, x->>'advisory'
  from jsonb_array_elements(_item_rows) x;
  update private.feed_releases set state='published', snapshot=_snapshot, payload_sha256=_payload_sha256, signature=_signature,
    item_count=jsonb_array_length(_item_rows), published_at=now() where id=_release_id;
  update private.feed_control set current_release_id=_release_id, updated_at=now(), updated_by=v_actor where singleton=true;
  insert into private.audit_events(actor_id, actor_role_snapshot, action, object_type, object_id, purpose_code, decision, correlation_id, metadata_min)
  values(v_actor, 'platform_admin', 'feed.release_published', 'feed_release', _release_id, 'feed_security', 'published', v_release.correlation_id,
    jsonb_build_object('feed_version', v_release.feed_version, 'item_count', jsonb_array_length(_item_rows), 'key_id', v_release.key_id));
  return jsonb_build_object('release_id',_release_id,'feed_version',v_release.feed_version,'item_count',jsonb_array_length(_item_rows));
end; $$;

create or replace function public.get_current_feed_snapshot()
returns jsonb language sql stable security definer set search_path = pg_catalog, private
as $$
  select r.snapshot from private.feed_control c join private.feed_releases r on r.id=c.current_release_id
  where c.singleton=true and r.state='published' and r.valid_until > now()
    and exists(select 1 from private.feed_signing_keys k where k.key_id=r.key_id and k.state <> 'revoked');
$$;

create or replace function public.revoke_feed_release(_feed_version bigint, _reason_code text)
returns void language plpgsql security definer set search_path = pg_catalog, private
as $$
declare v_actor uuid := auth.uid(); v_id uuid;
begin
  if v_actor is null or not private.has_active_role('platform_admin') then raise exception using errcode='42501', message='role_required'; end if;
  if _reason_code !~ '^[a-z0-9_]{2,64}$' then raise exception using errcode='22023', message='invalid_request'; end if;
  update private.feed_releases set state='revoked', revoked_at=now(), snapshot=null, published_at=null
  where feed_version=_feed_version and state='published' returning id into v_id;
  if v_id is null then raise exception using errcode='P0002', message='release_unavailable'; end if;
  update private.feed_control set current_release_id=null, updated_at=now(), updated_by=v_actor where singleton=true and current_release_id=v_id;
  insert into private.audit_events(actor_id, actor_role_snapshot, action, object_type, object_id, purpose_code, decision, metadata_min)
  values(v_actor,'platform_admin','feed.release_revoked','feed_release',v_id,'feed_security','revoked',jsonb_build_object('feed_version',_feed_version,'reason_code',_reason_code));
end; $$;

create or replace function public.rollback_feed_release(_feed_version bigint, _reason_code text)
returns void language plpgsql security definer set search_path = pg_catalog, private
as $$
declare v_actor uuid := auth.uid(); v_id uuid;
begin
  if v_actor is null or not private.has_active_role('platform_admin') then raise exception using errcode='42501', message='role_required'; end if;
  if _reason_code !~ '^[a-z0-9_]{2,64}$' then raise exception using errcode='22023', message='invalid_request'; end if;
  update private.feed_releases set state='rolled_back', snapshot=null, published_at=null
  where feed_version=_feed_version and state='published' returning id into v_id;
  if v_id is null then raise exception using errcode='P0002', message='release_unavailable'; end if;
  update private.feed_control set current_release_id=null, updated_at=now(), updated_by=v_actor where singleton=true and current_release_id=v_id;
  insert into private.audit_events(actor_id, actor_role_snapshot, action, object_type, object_id, purpose_code, decision, metadata_min)
  values(v_actor,'platform_admin','feed.release_rolled_back','feed_release',v_id,'feed_security','rolled_back',jsonb_build_object('feed_version',_feed_version,'reason_code',_reason_code));
end; $$;

create or replace function public.revoke_feed_signing_key(_key_id text, _reason_code text)
returns void language plpgsql security definer set search_path = pg_catalog, private
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not private.has_active_role('platform_admin') then raise exception using errcode='42501', message='role_required'; end if;
  if _reason_code !~ '^[a-z0-9_]{2,64}$' then raise exception using errcode='22023', message='invalid_request'; end if;
  update private.feed_signing_keys set state='revoked', revoked_at=now() where key_id=_key_id and state <> 'revoked';
  if not found then raise exception using errcode='P0002', message='key_unavailable'; end if;
  update private.feed_releases set state='revoked', revoked_at=now(), snapshot=null, published_at=null where key_id=_key_id and state='published';
  update private.feed_control set current_release_id=null, updated_at=now(), updated_by=v_actor
  where singleton=true and current_release_id in (select id from private.feed_releases where key_id=_key_id and state='revoked');
  insert into private.audit_events(actor_id, actor_role_snapshot, action, object_type, purpose_code, decision, metadata_min)
  values(v_actor,'platform_admin','feed.key_revoked','feed_signing_key','feed_security','revoked',jsonb_build_object('key_id',_key_id,'reason_code',_reason_code));
end; $$;

revoke all on function public.register_feed_signing_key(text,text) from public, anon;
revoke all on function public.begin_feed_release(uuid,text,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.finish_feed_release(uuid,uuid,jsonb,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.get_current_feed_snapshot() from public;
revoke all on function public.revoke_feed_release(bigint,text) from public, anon;
revoke all on function public.rollback_feed_release(bigint,text) from public, anon;
revoke all on function public.revoke_feed_signing_key(text,text) from public, anon;
grant execute on function public.register_feed_signing_key(text,text) to authenticated;
grant execute on function public.begin_feed_release(uuid,text,timestamptz,uuid) to service_role;
grant execute on function public.finish_feed_release(uuid,uuid,jsonb,text,text,jsonb) to service_role;
grant execute on function public.get_current_feed_snapshot() to anon, authenticated;
grant execute on function public.revoke_feed_release(bigint,text) to authenticated;
grant execute on function public.rollback_feed_release(bigint,text) to authenticated;
grant execute on function public.revoke_feed_signing_key(text,text) to authenticated;
