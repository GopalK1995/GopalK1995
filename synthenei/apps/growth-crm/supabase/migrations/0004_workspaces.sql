-- 0004 workspace model: tenants -> workspaces -> memberships (+ platform admins, audited support sessions).
-- Spec: 03-product-spec.md sections 8, 10, 14. Supersedes the tenant-only role model of 0001-0003:
-- * every business table gains workspace_id (tenant_id kept for reporting/cascade, derived from the workspace)
-- * roles move from profiles.role to memberships.role (one role per user per workspace)
-- * region settings (SLA, business hours, holidays, lead intake) move from tenants to workspaces
-- * old helpers current_tenant_id/current_app_role/has_role and every 0003 policy are dropped (0006 recreates)
-- The tables were empty when this ran, so NOT NULL columns are added without a backfill.

-- ---------- 1. Drop 0003 policies and the tenant-only helpers ----------
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;
drop trigger if exists trg_profiles_guard on public.profiles;
drop function if exists public.guard_profile_update();
drop function if exists public.has_role(variadic public.app_role[]);
drop function if exists public.current_app_role();
drop function if exists public.current_tenant_id();

-- ---------- 2. New tables ----------
create table public.workspaces (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  name               text not null check (length(name) between 2 and 80),
  slug               text not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  region_label       text,
  timezone           text not null default 'Asia/Kolkata',
  sla_first_response_mins integer not null default 120 check (sla_first_response_mins between 5 and 2880),
  business_hours     jsonb not null default '{"days":[1,2,3,4,5,6],"start":"10:00","end":"19:00"}',
  holidays           date[] not null default '{}',
  lead_intake_enabled boolean not null default true,
  is_demo            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  archived_at        timestamptz,
  unique (tenant_id, slug)
);
create unique index workspaces_slug_global on public.workspaces (slug);  -- landing/env refer to a workspace by slug

create table public.memberships (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  role         public.app_role not null,
  is_active    boolean not null default true,
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, workspace_id)
);
create index memberships_ws_role on public.memberships (workspace_id, role) where is_active;

create table public.platform_admins (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  is_active    boolean not null default true,
  mfa_required boolean not null default true,   -- is_platform_admin() then needs JWT aal = 'aal2'
  granted_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table public.support_sessions (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  reason       text not null check (length(trim(reason)) between 20 and 500),
  mode         text not null default 'read_only' check (mode in ('read_only','read_write')),
  started_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  ended_at     timestamptz,
  check (expires_at > started_at and expires_at <= started_at + interval '60 minutes')
);
create index support_sessions_active on public.support_sessions (admin_id, workspace_id) where ended_at is null;

-- ---------- 3. Tenants / profiles reshaped ----------
alter table public.tenants
  add column plan   text not null default 'demo' check (plan in ('demo','starter','growth','enterprise')),
  add column status text not null default 'active' check (status in ('active','suspended','archived')),
  add column primary_owner_id uuid references auth.users(id) on delete set null,   -- only they (or a super admin) edit branding
  drop column sla_first_response_mins,
  drop column business_hours,
  drop column holidays,
  drop column lead_intake_enabled;

alter table public.profiles
  drop column role,
  drop column tenant_id,
  add column last_workspace_id uuid references public.workspaces(id) on delete set null;

-- ---------- 4. workspace_id on every business table ----------
do $$
declare t text;
begin
  foreach t in array array['invitations','pipeline_stages','territories','sales_targets','accounts','contacts',
    'campaigns','campaign_daily_metrics','audience_segments','leads','lead_events','deals','deal_stage_history',
    'activities','tasks','message_templates','conversations','messages','ga4_daily','integrations',
    'integration_field_maps','sync_runs','ai_insights','consent_log'] loop
    execute format('alter table public.%I add column workspace_id uuid not null references public.workspaces(id) on delete cascade', t);
  end loop;
  -- project-wide rows allowed (workspace_id null)
  foreach t in array array['backup_checks','backup_alert_rules','audit_log'] loop
    execute format('alter table public.%I add column workspace_id uuid references public.workspaces(id) on delete cascade', t);
  end loop;
end $$;
alter table public.audit_log add column support_session_id uuid references public.support_sessions(id) on delete set null;

-- Unique/primary keys and indexes that led with tenant_id now lead with workspace_id (isolation boundary).
do $$
declare r record; def text;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
     where c.connamespace = 'public'::regnamespace and c.contype in ('u','p')
       and exists (select 1 from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
                   where a.attname = 'tenant_id')
       and c.conrelid not in ('public.workspaces'::regclass, 'public.memberships'::regclass,
                              'public.tenants'::regclass, 'public.support_sessions'::regclass)
  loop
    def := regexp_replace(r.def, '\mtenant_id\M', 'workspace_id');
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I %s', r.tbl, r.conname, def);
  end loop;
  for r in
    select i.indexrelid::regclass as idx, pg_get_indexdef(i.indexrelid) as def
      from pg_index i join pg_class c on c.oid = i.indrelid
     where c.relnamespace = 'public'::regnamespace
       and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)
       and pg_get_indexdef(i.indexrelid) ~ '\mtenant_id\M'
       and c.relname not in ('workspaces','memberships','support_sessions')
  loop
    execute format('drop index %s', r.idx);
    execute regexp_replace(r.def, '\mtenant_id\M', 'workspace_id');
  end loop;
end $$;
-- invitations: one pending invite per (workspace, email)
drop index if exists public.invitations_pending_email;
create unique index invitations_pending_email on public.invitations (workspace_id, lower(email)) where accepted_at is null;

-- ---------- 5. tenant_id is always derived from workspace_id ----------
create or replace function public.set_tenant_from_workspace() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.workspace_id is null then return new; end if;
  select w.tenant_id into new.tenant_id from public.workspaces w where w.id = new.workspace_id;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['invitations','pipeline_stages','territories','sales_targets','accounts','contacts',
    'campaigns','campaign_daily_metrics','audience_segments','leads','lead_events','deals','deal_stage_history',
    'activities','tasks','message_templates','conversations','messages','ga4_daily','integrations',
    'integration_field_maps','sync_runs','ai_insights','consent_log','backup_checks','backup_alert_rules',
    'memberships','support_sessions'] loop
    -- "a00_" sorts first, so later BEFORE triggers already see the derived tenant_id
    execute format('create trigger a00_%1$s_tenant before insert or update of workspace_id, tenant_id on public.%1$I
                    for each row execute function public.set_tenant_from_workspace()', t);
  end loop;
end $$;

-- ---------- 6. RLS helpers (SECURITY DEFINER, search_path '', never recursive) ----------
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins pa
                  where pa.user_id = auth.uid() and pa.is_active
                    and (not pa.mfa_required or coalesce(auth.jwt()->>'aal', '') = 'aal2'))
$$;

-- Workspaces where the caller is an active member, plus workspaces with an active support session.
create or replace function public.member_ws_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id from public.memberships m
   where m.user_id = auth.uid() and m.is_active
  union
  select s.workspace_id from public.support_sessions s
   where s.admin_id = auth.uid() and s.ended_at is null and now() < s.expires_at and public.is_platform_admin()
$$;

-- Workspaces where the caller's role is in roles. A support session counts as viewer (read_only) or owner (read_write).
create or replace function public.role_ws_ids(variadic roles public.app_role[]) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id from public.memberships m
   where m.user_id = auth.uid() and m.is_active and m.role = any(roles)
  union
  select s.workspace_id from public.support_sessions s
   where s.admin_id = auth.uid() and s.ended_at is null and now() < s.expires_at
     and (case s.mode when 'read_write' then 'owner' else 'viewer' end)::public.app_role = any(roles)
     and public.is_platform_admin()
$$;

-- Same as role_ws_ids but real memberships only: export, erase, AI toggles and integration connect
-- are never allowed through a support session.
create or replace function public.member_role_ws_ids(variadic roles public.app_role[]) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id from public.memberships m
   where m.user_id = auth.uid() and m.is_active and m.role = any(roles)
$$;

create or replace function public.has_member_role(ws uuid, variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select ws in (select public.member_role_ws_ids(variadic roles))
$$;

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select ws in (select public.member_ws_ids())
$$;

create or replace function public.has_ws_role(ws uuid, variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select ws in (select public.role_ws_ids(variadic roles))
$$;

create or replace function public.has_active_support_session(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() and exists (
    select 1 from public.support_sessions s
     where s.admin_id = auth.uid() and s.workspace_id = ws and s.ended_at is null and now() < s.expires_at)
$$;

create or replace function public.ws_role(ws uuid) returns public.app_role
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.role from public.memberships m where m.user_id = auth.uid() and m.workspace_id = ws and m.is_active),
    (select (case s.mode when 'read_write' then 'owner' else 'viewer' end)::public.app_role
       from public.support_sessions s
      where s.admin_id = auth.uid() and s.workspace_id = ws and s.ended_at is null and now() < s.expires_at
        and public.is_platform_admin()
      order by s.started_at desc limit 1))
$$;

-- Tenants the caller can see (member of any workspace in it); and tenants where the caller is an owner somewhere.
create or replace function public.member_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select w.tenant_id from public.workspaces w where w.id in (select public.member_ws_ids())
$$;
create or replace function public.owner_tenant_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.tenant_id from public.memberships m where m.user_id = auth.uid() and m.is_active and m.role = 'owner'
$$;

-- Users who share at least one workspace with the caller (for profile names in lists).
create or replace function public.co_member_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.user_id from public.memberships m where m.workspace_id in (select public.member_ws_ids()) and m.is_active
$$;
