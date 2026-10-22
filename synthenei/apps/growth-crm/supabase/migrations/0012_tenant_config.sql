-- 0012 per-tenant configuration (wording, stages, taxonomies, modules, branding/fonts, dashboard, data settings).
-- Additive only: two new tables, policies, triggers and RPCs. No drop/delete/truncate.
-- Model: one JSON document per tenant (`tenant_config.config`, sparse overrides over a code preset, versioned).
--   * members read their tenant's config; owners of the tenant insert/update it (RLS);
--   * platform admins read it and write only through admin_set_tenant_config() with a reason (audited);
--   * every write lands in tenant_config_history and audit_log through one AFTER trigger (append-only).
-- Config is not business data: no support session is needed to read or write it.

create table public.tenant_config (
  tenant_id  uuid primary key references public.tenants(id) on delete cascade,
  version    integer not null default 1 check (version >= 1),
  config     jsonb not null default '{}'
             check (jsonb_typeof(config) = 'object' and pg_column_size(config) <= 65536
                    and (not (config ? 'v') or config->>'v' = '1')),
  updated_by uuid,                       -- auth.uid(); null for service role
  updated_at timestamptz not null default now()
);

create table public.tenant_config_history (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  version    integer not null,
  config     jsonb not null,
  changed_by uuid,
  actor_label text,                      -- 'owner' | 'platform_admin' | 'service'
  reason     text,
  created_at timestamptz not null default now(),
  unique (tenant_id, version)
);
create index tenant_config_history_tenant_time on public.tenant_config_history (tenant_id, created_at desc);

alter table public.tenant_config enable row level security;
alter table public.tenant_config_history enable row level security;

-- Read: members of the tenant (and support sessions, via member_tenant_ids) and platform admins.
create policy tenant_config_select on public.tenant_config for select to authenticated
  using (tenant_id in (select public.member_tenant_ids()) or (select public.is_platform_admin()));
create policy tenant_config_history_select on public.tenant_config_history for select to authenticated
  using (tenant_id in (select public.member_tenant_ids()) or (select public.is_platform_admin()));
-- Write: owners of the tenant only (real membership; a support session never counts).
create policy tenant_config_insert on public.tenant_config for insert to authenticated
  with check (tenant_id in (select public.owner_tenant_ids()));
create policy tenant_config_update on public.tenant_config for update to authenticated
  using (tenant_id in (select public.owner_tenant_ids()))
  with check (tenant_id in (select public.owner_tenant_ids()));
-- No delete policy and no history write policy: history is trigger-only.

revoke all on public.tenant_config, public.tenant_config_history from anon, authenticated;
grant select, insert, update on public.tenant_config to authenticated;
grant select on public.tenant_config_history to authenticated;

-- Keep version monotonic: an update must bump the version by exactly one (optimistic concurrency for editors).
create or replace function public.tenant_config_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    if new.tenant_id <> old.tenant_id then raise exception 'tenant_id is fixed' using errcode = '42501'; end if;
    new.version := old.version + 1;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger trg_tenant_config_before before insert or update on public.tenant_config
  for each row execute function public.tenant_config_before_write();

-- History + audit in one place, for owner writes and for the admin RPC alike.
create or replace function public.tenant_config_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(current_setting('app.config_reason', true), '');
  v_label  text := coalesce(nullif(current_setting('app.actor_label', true), ''),
                            case when auth.uid() is null then 'service' else 'owner' end);
begin
  insert into public.tenant_config_history (tenant_id, version, config, changed_by, actor_label, reason)
  values (new.tenant_id, new.version, new.config, auth.uid(), v_label, v_reason);
  insert into public.audit_log (tenant_id, actor_id, actor_label, action, table_name, row_id, changes)
  values (new.tenant_id, auth.uid(), v_label, lower(tg_op), 'tenant_config', new.tenant_id::text,
          jsonb_build_object('version', jsonb_build_object('old', case when tg_op = 'UPDATE' then old.version end, 'new', new.version),
                             'reason', v_reason,
                             'keys', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(new.config) k)));
  return new;
end $$;
create trigger trg_tenant_config_after after insert or update on public.tenant_config
  for each row execute function public.tenant_config_after_write();

-- Resolve a tenant by slug or uuid and return its config; callable by members and platform admins only.
create or replace function public.get_tenant_config(p_tenant text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_t uuid; v_row public.tenant_config;
begin
  select t.id into v_t from public.tenants t where t.slug = p_tenant or t.id::text = p_tenant;
  if v_t is null then return null; end if;
  if not (v_t in (select public.member_tenant_ids()) or public.is_platform_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_row from public.tenant_config c where c.tenant_id = v_t;
  return jsonb_build_object('tenant_id', v_t, 'version', coalesce(v_row.version, 0), 'config', coalesce(v_row.config, '{}'),
                            'updated_at', v_row.updated_at, 'updated_by', v_row.updated_by);
end $$;

create or replace function public.get_tenant_config_history(p_tenant text, p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_t uuid;
begin
  select t.id into v_t from public.tenants t where t.slug = p_tenant or t.id::text = p_tenant;
  if v_t is null then return '[]'::jsonb; end if;
  if not (v_t in (select public.member_tenant_ids()) or public.is_platform_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(h) order by h.version desc), '[]')
            from (select version, config, changed_by, actor_label, reason, created_at
                    from public.tenant_config_history where tenant_id = v_t
                   order by version desc limit least(greatest(p_limit, 1), 100)) h);
end $$;

-- Platform admin write path: reason required, audited, versioned. Returns the new version.
create or replace function public.admin_set_tenant_config(p_tenant text, p_config jsonb, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_t uuid; v_ver integer;
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) < 8 then raise exception 'a reason of at least 8 characters is required' using errcode = '22023'; end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' then raise exception 'config must be a JSON object' using errcode = '22023'; end if;
  select t.id into v_t from public.tenants t where t.slug = p_tenant or t.id::text = p_tenant;
  if v_t is null then raise exception 'unknown tenant' using errcode = '22023'; end if;
  perform set_config('app.config_reason', trim(p_reason), true);
  perform set_config('app.actor_label', 'platform_admin', true);
  insert into public.tenant_config as c (tenant_id, config) values (v_t, p_config)
  on conflict (tenant_id) do update set config = excluded.config
  returning c.version into v_ver;
  return v_ver;
end $$;

revoke execute on function public.tenant_config_before_write(), public.tenant_config_after_write() from public, anon, authenticated;
revoke execute on function public.get_tenant_config(text), public.get_tenant_config_history(text, int),
  public.admin_set_tenant_config(text, jsonb, text) from public, anon;
grant execute on function public.get_tenant_config(text), public.get_tenant_config_history(text, int),
  public.admin_set_tenant_config(text, jsonb, text) to authenticated;
