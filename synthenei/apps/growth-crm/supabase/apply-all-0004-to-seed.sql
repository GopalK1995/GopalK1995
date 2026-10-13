-- Run ONCE in Supabase SQL Editor (project Lawsome, evybdanqxgkjoybrvzru). 0001-0003 are already applied.
-- Migrations 0004-0009 + seed/seed.sql concatenated in order, inside ONE transaction: if anything fails, nothing is applied.
-- (seed.sql's own begin/commit lines are removed so the outer transaction covers everything.)
begin;

-- ======================= migrations/0004_workspaces.sql =======================
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


-- ======================= migrations/0005_triggers_ws.sql =======================
-- 0005 trigger functions rewritten for the workspace model.

-- updated_at on new tables
create trigger trg_workspaces_updated before update on public.workspaces
  for each row execute function public.set_updated_at();
create trigger trg_memberships_updated before update on public.memberships
  for each row execute function public.set_updated_at();

-- Audit: adds workspace_id and, when a platform admin writes inside an active support session,
-- support_session_id. PII columns are stored as "[pii]" (DPDP erasure leaves nothing behind).
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r     jsonb := coalesce(r_new, r_old);
  diff  jsonb;
  pii   text[] := array['full_name','email','phone','body','note','address_line','firm_name','display_name'];
  v_ws  uuid := coalesce((r->>'workspace_id')::uuid, case when tg_table_name = 'workspaces' then (r->>'id')::uuid end);
  v_ss  uuid;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value))
      into diff
      from jsonb_each(r_new) n join jsonb_each(r_old) o using (key)
     where n.value is distinct from o.value and n.key not in ('updated_at');
    if diff is null then return new; end if;
    select jsonb_object_agg(key, case when key = any(pii) then '{"old":"[pii]","new":"[pii]"}'::jsonb else value end)
      into diff from jsonb_each(diff);
  else
    select jsonb_object_agg(key, case when key = any(pii) and value <> 'null'::jsonb then '"[pii]"'::jsonb else value end)
      into diff from jsonb_each(r);
  end if;
  if auth.uid() is not null and v_ws is not null then
    select s.id into v_ss from public.support_sessions s
     where s.admin_id = auth.uid() and s.workspace_id = v_ws and s.ended_at is null and now() < s.expires_at
     order by s.started_at desc limit 1;
  end if;
  insert into public.audit_log (tenant_id, workspace_id, actor_id, actor_label, action, table_name, row_id, changes, support_session_id)
  values (
    coalesce((r->>'tenant_id')::uuid, case when tg_table_name = 'tenants' then (r->>'id')::uuid end),
    v_ws, auth.uid(),
    coalesce(nullif(current_setting('app.actor_label', true), ''),
             case when v_ss is not null then 'support' when auth.uid() is null then 'service' else 'user' end),
    lower(tg_op), tg_table_name, coalesce(r->>'id', r->>'user_id'), diff, v_ss);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['workspaces','memberships','platform_admins','support_sessions','activities','tasks',
                           'campaigns','sales_targets','messages'] loop
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- Profiles: users edit their own name/phone/language/last_workspace_id; id and email are fixed.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;                 -- service role / SQL editor
  if new.id <> old.id or new.email <> old.email or new.is_active <> old.is_active then
    raise exception 'id, email and active status cannot be changed here' using errcode = '42501';
  end if;
  if new.last_workspace_id is not null and new.last_workspace_id is distinct from old.last_workspace_id
     and not public.is_member(new.last_workspace_id) then
    raise exception 'not a member of that workspace' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Memberships: no self role/status change; sales_manager only moves rep/viewer within rep/viewer;
-- owner (or a read_write support session) may change anything; workspace/user are immutable.
create or replace function public.guard_membership_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare me public.app_role;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  -- real membership role only: support sessions never manage people
  select m.role into me from public.memberships m
   where m.user_id = auth.uid() and m.workspace_id = coalesce(new.workspace_id, old.workspace_id) and m.is_active;
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.workspace_id <> old.workspace_id then
      raise exception 'user and workspace cannot be changed' using errcode = '42501';
    end if;
    if new.role = old.role and new.is_active = old.is_active then return new; end if;
    if new.user_id = auth.uid() then
      raise exception 'you cannot change your own role or active status' using errcode = '42501';
    end if;
  end if;
  if me = 'owner' or public.is_platform_admin() then   -- platform admin: tenant/workspace bootstrap from /admin
    return coalesce(new, old);
  elsif tg_op = 'INSERT' and new.user_id = auth.uid() and new.role = 'owner'
        and new.tenant_id in (select public.owner_tenant_ids()) then   -- tenant owner seats self in a new workspace
    return new;
  elsif me = 'sales_manager'
        and (tg_op = 'INSERT' or old.role in ('sales_rep','viewer'))
        and (tg_op = 'DELETE' or new.role in ('sales_rep','viewer')) then
    return coalesce(new, old);
  end if;
  raise exception 'not allowed to change memberships here' using errcode = '42501';
end $$;
create trigger trg_memberships_guard before insert or update or delete on public.memberships
  for each row execute function public.guard_membership_change();

-- Signup / invite acceptance: confirmed email + pending invitation -> profile (once) + membership.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv record;
begin
  if new.email_confirmed_at is null then return new; end if;
  for inv in
    select * from public.invitations
     where lower(email) = lower(new.email) and accepted_at is null and expires_at > now()
  loop
    insert into public.profiles (id, full_name, email, last_workspace_id)
    values (new.id, coalesce(inv.full_name, split_part(new.email, '@', 1)), new.email, inv.workspace_id)
    on conflict (id) do nothing;
    insert into public.memberships (user_id, workspace_id, role, invited_by)
    values (new.id, inv.workspace_id, inv.role, inv.invited_by)
    on conflict (user_id, workspace_id) do update set role = excluded.role, is_active = true;
    insert into public.territories (workspace_id, district, rep_id)
    select inv.workspace_id, d, new.id from unnest(inv.territory_districts) d
    on conflict (workspace_id, district) do update set rep_id = excluded.rep_id;
    update public.invitations set accepted_at = now() where id = inv.id;
    if inv.role = 'owner' then
      update public.tenants set primary_owner_id = new.id where id = inv.tenant_id and primary_owner_id is null;
    end if;
  end loop;
  return new;
end $$;

-- Lead auto-assignment by district territory inside the lead's workspace.
create or replace function public.lead_assign_on_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is null and new.district is not null then
    select t.rep_id into new.owner_id
      from public.territories t
      join public.memberships m on m.user_id = t.rep_id and m.workspace_id = t.workspace_id and m.is_active
     where t.workspace_id = new.workspace_id and lower(t.district) = lower(new.district);
  end if;
  if new.owner_id is not null and new.assigned_at is null then new.assigned_at := now(); end if;
  return new;
end $$;

-- First-response task uses the workspace SLA.
create or replace function public.lead_first_response_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sla int;
begin
  if new.owner_id is not null and new.first_response_at is null
     and (tg_op = 'INSERT' or old.owner_id is distinct from new.owner_id) then
    if tg_op = 'UPDATE' then new.assigned_at := now(); end if;
    select w.sla_first_response_mins into sla from public.workspaces w where w.id = new.workspace_id;
    insert into public.tasks (workspace_id, lead_id, title, kind, priority, assignee_id, due_at)
    values (new.workspace_id, new.id, 'First response: ' || new.full_name, 'first_response', 1,
            new.owner_id, now() + make_interval(mins => coalesce(sla, 120)));
  end if;
  return new;
end $$;

create or replace function public.activity_touch_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.lead_id is not null and new.kind in ('call','whatsapp','email','meeting')
     and coalesce(new.direction, 'outbound') = 'outbound' then
    update public.leads
       set first_response_at = coalesce(first_response_at, new.created_at),
           last_touch_at = greatest(coalesce(last_touch_at, new.created_at), new.created_at),
           status = case when status = 'new' then 'contacted'::public.lead_status else status end
     where id = new.lead_id and workspace_id = new.workspace_id;
    update public.tasks set status = 'done', completed_at = now()
     where lead_id = new.lead_id and workspace_id = new.workspace_id and kind = 'first_response' and status = 'open';
  end if;
  return new;
end $$;

create or replace function public.deal_stage_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare st public.pipeline_stages;
begin
  select * into st from public.pipeline_stages where id = new.stage_id;
  if st.workspace_id is distinct from new.workspace_id then raise exception 'stage belongs to another workspace'; end if;
  if tg_op = 'INSERT' or new.stage_id <> old.stage_id then
    new.stage_entered_at := case when tg_op = 'INSERT' then coalesce(new.stage_entered_at, now()) else now() end;
    new.won_at  := case when st.is_won  then coalesce(new.won_at, now())  end;
    new.lost_at := case when st.is_lost then coalesce(new.lost_at, now()) end;
    if st.is_won and (new.value_inr <= 0 or new.seats is null) then
      raise exception 'won deals need value_inr > 0 and seats';
    end if;
    if st.is_lost and new.lost_reason is null then
      raise exception 'lost deals need lost_reason';
    end if;
  end if;
  return new;
end $$;

create or replace function public.deal_stage_history_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.stage_id <> old.stage_id then
    insert into public.deal_stage_history (workspace_id, deal_id, from_stage_id, to_stage_id, changed_by, changed_at)
    values (new.workspace_id, new.id, case when tg_op = 'UPDATE' then old.stage_id end, new.stage_id, auth.uid(),
            case when tg_op = 'INSERT' then new.stage_entered_at else now() end);
  end if;
  return new;
end $$;

-- Platform admins and workspace members are disjoint identities (spec 10.5): an operator who also works
-- in a workspace uses a separate account.
create or replace function public.guard_admin_member_exclusive() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'memberships' and exists (select 1 from public.platform_admins where user_id = new.user_id) then
    raise exception 'platform admins cannot hold workspace memberships' using errcode = '23514';
  elsif tg_table_name = 'platform_admins' and exists (select 1 from public.memberships where user_id = new.user_id) then
    raise exception 'workspace members cannot be platform admins' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_memberships_not_admin before insert or update of user_id on public.memberships
  for each row execute function public.guard_admin_member_exclusive();
create trigger trg_platform_admins_not_member before insert or update of user_id on public.platform_admins
  for each row execute function public.guard_admin_member_exclusive();


-- ======================= migrations/0006_rls_ws.sql =======================
-- 0006 RLS for the workspace model. Every business-table policy is workspace-scoped:
--   member   = workspace_id in (select public.member_ws_ids())
--   role X   = workspace_id in (select public.role_ws_ids(X))       (support session = viewer / owner)
--   strict X = workspace_id in (select public.member_role_ws_ids(X)) (real members only; no support session):
--              used for memberships/invitations writes, integrations + field-map writes, leads_delete
-- The uncorrelated "in (select fn())" form is evaluated once per statement (hashed subplan).
-- is_platform_admin() alone opens only platform tables (tenants, workspaces, memberships, profiles, platform_admins,
-- support_sessions, audit_log) - never business tables; those need an active support session.
-- Role rules per table are unchanged from 0003 (sales_rep own/territory, viewer masked, ...), plus the
-- reference-visibility WITH CHECK clauses at the end.

alter table public.workspaces       enable row level security;
alter table public.memberships      enable row level security;
alter table public.platform_admins  enable row level security;
alter table public.support_sessions enable row level security;

-- ---------- platform / tenancy tables ----------
create policy tenants_select on public.tenants for select to authenticated
  using (id in (select public.member_tenant_ids()) or (select public.is_platform_admin()));
create policy tenants_update on public.tenants for update to authenticated   -- branding, AI toggles
  using (primary_owner_id = (select auth.uid()) or (select public.is_platform_admin()))
  with check (primary_owner_id = (select auth.uid()) or (select public.is_platform_admin()));
-- tenants are created only through admin_create_tenant()

create policy workspaces_select on public.workspaces for select to authenticated
  using (id in (select public.member_ws_ids()) or (select public.is_platform_admin()));
create policy workspaces_update on public.workspaces for update to authenticated   -- SLA, hours, holidays, archive
  using (id in (select public.role_ws_ids('owner')) or (select public.is_platform_admin()))
  with check (id in (select public.role_ws_ids('owner')) or (select public.is_platform_admin()));
-- workspaces are created only through create_workspace() / admin_create_tenant()

create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or workspace_id in (select public.member_ws_ids())
         or (select public.is_platform_admin()));
create policy memberships_update on public.memberships for update to authenticated   -- guard trigger enforces role rules
  using (workspace_id in (select public.member_role_ws_ids('owner','sales_manager')))
  with check (workspace_id in (select public.member_role_ws_ids('owner','sales_manager')));
create policy memberships_delete on public.memberships for delete to authenticated
  using (workspace_id in (select public.member_role_ws_ids('owner','sales_manager')));
-- memberships are created by invite acceptance (trigger) or invite_member() for existing users

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or id in (select public.co_member_ids()) or (select public.is_platform_admin()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy invitations_select on public.invitations for select to authenticated
  using (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (select public.is_platform_admin()));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (workspace_id in (select public.member_role_ws_ids('owner'))
              or (workspace_id in (select public.member_role_ws_ids('sales_manager')) and role in ('sales_rep','viewer')));
create policy invitations_update on public.invitations for update to authenticated
  using (workspace_id in (select public.member_role_ws_ids('owner','sales_manager')))
  with check (workspace_id in (select public.member_role_ws_ids('owner'))
              or (workspace_id in (select public.member_role_ws_ids('sales_manager')) and role in ('sales_rep','viewer')));
create policy invitations_delete on public.invitations for delete to authenticated
  using (workspace_id in (select public.member_role_ws_ids('owner','sales_manager')));

create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_platform_admin()));
-- platform_admins rows are managed with SQL only (see README)

create policy support_sessions_select on public.support_sessions for select to authenticated
  using (admin_id = (select auth.uid()) or (select public.is_platform_admin())
         or workspace_id in (select public.member_role_ws_ids('owner')));   -- owners see who accessed their workspace
-- support sessions are opened/closed only through start_support_session() / end_support_session()

-- ---------- business tables ----------
create policy pipeline_stages_select on public.pipeline_stages for select to authenticated
  using (workspace_id in (select public.member_ws_ids()));
create policy pipeline_stages_insert on public.pipeline_stages for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
              and (workspace_id in (select public.member_ws_ids())));
create policy pipeline_stages_update on public.pipeline_stages for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
              and (workspace_id in (select public.member_ws_ids())));
create policy pipeline_stages_delete on public.pipeline_stages for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')));
create policy territories_select on public.territories for select to authenticated
  using (workspace_id in (select public.member_ws_ids()));
create policy territories_insert on public.territories for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
              and (workspace_id in (select public.member_ws_ids())));
create policy territories_update on public.territories for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
              and (workspace_id in (select public.member_ws_ids())));
create policy territories_delete on public.territories for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')));
create policy sales_targets_select on public.sales_targets for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','viewer')) or rep_id = (select auth.uid())));
create policy sales_targets_insert on public.sales_targets for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
              and (workspace_id in (select public.member_ws_ids())));
create policy sales_targets_update on public.sales_targets for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')))
              and (workspace_id in (select public.member_ws_ids())));
create policy sales_targets_delete on public.sales_targets for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager')));

-- accounts (firm-level business data; viewers may read)
create policy accounts_select on public.accounts for select to authenticated
  using (workspace_id in (select public.member_ws_ids()));
create policy accounts_insert on public.accounts for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and workspace_id in (select public.role_ws_ids('owner','sales_manager','sales_rep','marketing','data')));
create policy accounts_update on public.accounts for update to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','data')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid()))))
  with check (workspace_id in (select public.member_ws_ids()));
create policy accounts_delete on public.accounts for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')));

-- contacts (personal data): no viewer; reps only own contacts or contacts on their accounts
create policy contacts_select on public.contacts for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data'))
              or (workspace_id in (select public.role_ws_ids('sales_rep')) and (owner_id = (select auth.uid())
                  or exists (select 1 from public.accounts a where a.id = contacts.account_id and a.owner_id = (select auth.uid()))))));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and workspace_id in (select public.role_ws_ids('owner','sales_manager','sales_rep','marketing','data'))
              and (account_id is null or exists (select 1 from public.accounts a where a.id = contacts.account_id)));
create policy contacts_update on public.contacts for update to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','data')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid()))))
  with check (workspace_id in (select public.member_ws_ids()));
create policy contacts_delete on public.contacts for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')));

-- leads: reps see own + unassigned in their territory; viewers use v_leads_masked
create policy leads_select on public.leads for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data'))
              or (workspace_id in (select public.role_ws_ids('sales_rep')) and (owner_id = (select auth.uid())
                  or (owner_id is null and exists (select 1 from public.territories t
                        where t.workspace_id = leads.workspace_id and t.rep_id = (select auth.uid())
                          and lower(t.district) = lower(leads.district)))))));
create policy leads_insert on public.leads for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data'))
                   or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid())))
              and (account_id is null or exists (select 1 from public.accounts a where a.id = leads.account_id)));
create policy leads_update on public.leads for update to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data'))
              or (workspace_id in (select public.role_ws_ids('sales_rep')) and (owner_id = (select auth.uid())
                  or (owner_id is null and exists (select 1 from public.territories t
                        where t.workspace_id = leads.workspace_id and t.rep_id = (select auth.uid())
                          and lower(t.district) = lower(leads.district)))))))
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data')) or owner_id = (select auth.uid())));
create policy leads_delete on public.leads for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner')));

-- lead_events
create policy lead_events_select on public.lead_events for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data'))
              or (workspace_id in (select public.role_ws_ids('sales_rep')) and exists (select 1 from public.leads l
                    where l.id = lead_events.lead_id and l.owner_id = (select auth.uid())))));
create policy lead_events_insert on public.lead_events for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and workspace_id in (select public.role_ws_ids('owner','sales_manager','sales_rep','marketing','data'))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = lead_events.lead_id)));

-- deals: viewers read (no personal data on deals); reps own only
create policy deals_select on public.deals for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data','viewer')) or owner_id = (select auth.uid())));
create policy deals_insert on public.deals for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid())))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = deals.lead_id))
              and (account_id is null or exists (select 1 from public.accounts a where a.id = deals.account_id))
              and (primary_contact_id is null or exists (select 1 from public.contacts c where c.id = deals.primary_contact_id)));
create policy deals_update on public.deals for update to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid()))))
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or owner_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = deals.lead_id))
              and (account_id is null or exists (select 1 from public.accounts a where a.id = deals.account_id)));
create policy deals_delete on public.deals for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')));

create policy dsh_select on public.deal_stage_history for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and exists (select 1 from public.deals d where d.id = deal_stage_history.deal_id));  -- inherits deals RLS

-- activities
create policy activities_select on public.activities for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing'))
              or owner_id = (select auth.uid())
              or (workspace_id in (select public.role_ws_ids('sales_rep')) and exists (select 1 from public.leads l
                    where l.id = activities.lead_id and l.owner_id = (select auth.uid())))));
create policy activities_insert on public.activities for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid())))
              -- referenced rows must be visible to the caller (subqueries run under their RLS)
              and (lead_id is null or exists (select 1 from public.leads l where l.id = activities.lead_id))
              and (deal_id is null or exists (select 1 from public.deals d where d.id = activities.deal_id))
              and (contact_id is null or exists (select 1 from public.contacts c where c.id = activities.contact_id)));
create policy activities_update on public.activities for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or owner_id = (select auth.uid())))
  with check (workspace_id in (select public.member_ws_ids())
              and (lead_id is null or exists (select 1 from public.leads l where l.id = activities.lead_id)));
create policy activities_delete on public.activities for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')));

-- tasks
create policy tasks_select on public.tasks for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid()) or created_by = (select auth.uid())));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids()) and not workspace_id in (select public.role_ws_ids('viewer'))
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = tasks.lead_id))
              and (deal_id is null or exists (select 1 from public.deals d where d.id = tasks.deal_id)));
create policy tasks_update on public.tasks for update to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid())))
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid())));
create policy tasks_delete on public.tasks for delete to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or created_by = (select auth.uid())));

-- campaigns: all roles read names (reps see campaign on a lead); owner + marketing write
create policy campaigns_select on public.campaigns for select to authenticated
  using (workspace_id in (select public.member_ws_ids()));
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing')))
              and (workspace_id in (select public.member_ws_ids())));
create policy campaigns_update on public.campaigns for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing')))
              and (workspace_id in (select public.member_ws_ids())));
create policy campaigns_delete on public.campaigns for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing')));
create policy cdm_select on public.campaign_daily_metrics for select to authenticated
  using (workspace_id in (select public.member_ws_ids()) and not workspace_id in (select public.role_ws_ids('sales_rep')));
create policy cdm_insert on public.campaign_daily_metrics for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')))
              and (workspace_id in (select public.member_ws_ids())));
create policy cdm_update on public.campaign_daily_metrics for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')))
              and (workspace_id in (select public.member_ws_ids())));
create policy cdm_delete on public.campaign_daily_metrics for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')));
create policy segments_select on public.audience_segments for select to authenticated
  using (workspace_id in (select public.member_ws_ids()) and not workspace_id in (select public.role_ws_ids('sales_rep')));
create policy segments_insert on public.audience_segments for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')))
              and (workspace_id in (select public.member_ws_ids())));
create policy segments_update on public.audience_segments for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')))
              and (workspace_id in (select public.member_ws_ids())));
create policy segments_delete on public.audience_segments for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data')));
create policy ga4_select on public.ga4_daily for select to authenticated
  using (workspace_id in (select public.member_ws_ids()) and not workspace_id in (select public.role_ws_ids('sales_rep')));

-- inbox
create policy templates_select on public.message_templates for select to authenticated
  using (workspace_id in (select public.member_ws_ids()));
create policy templates_insert on public.message_templates for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing')))
              and (workspace_id in (select public.member_ws_ids())));
create policy templates_update on public.message_templates for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing')))
              and (workspace_id in (select public.member_ws_ids())));
create policy templates_delete on public.message_templates for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing')));
create policy conversations_select on public.conversations for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing'))
              or (workspace_id in (select public.role_ws_ids('sales_rep')) and assignee_id = (select auth.uid()))));
create policy conversations_insert on public.conversations for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and assignee_id = (select auth.uid()))))
              and (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = conversations.lead_id))));
create policy conversations_update on public.conversations for update to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and assignee_id = (select auth.uid()))))
  with check ((workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and assignee_id = (select auth.uid()))))
              and (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = conversations.lead_id))));
create policy conversations_delete on public.conversations for delete to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and assignee_id = (select auth.uid()))));
create policy messages_select on public.messages for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and exists (select 1 from public.conversations c where c.id = messages.conversation_id));  -- inherits conversations RLS
create policy messages_insert on public.messages for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and workspace_id in (select public.role_ws_ids('owner','sales_manager','sales_rep'))
              and sent_by = (select auth.uid())
              and exists (select 1 from public.conversations c where c.id = messages.conversation_id
                          and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or c.assignee_id = (select auth.uid()))));

-- integrations
create policy integrations_select on public.integrations for select to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data')));
create policy integrations_insert on public.integrations for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner')))
              and (workspace_id in (select public.member_ws_ids())));
create policy integrations_update on public.integrations for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner')))
              and (workspace_id in (select public.member_ws_ids())));
create policy integrations_delete on public.integrations for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner')));
create policy ifm_select on public.integration_field_maps for select to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data')));
create policy ifm_insert on public.integration_field_maps for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner','data')))
              and (workspace_id in (select public.member_ws_ids())));
create policy ifm_update on public.integration_field_maps for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner','data')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner','data')))
              and (workspace_id in (select public.member_ws_ids())));
create policy ifm_delete on public.integration_field_maps for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.member_role_ws_ids('owner','data')));
create policy sync_runs_select on public.sync_runs for select to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data')));
create policy sync_runs_insert on public.sync_runs for insert to authenticated   -- CSV imports from the app
  with check (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','marketing','data'))
              and kind = 'csv' and started_by = (select auth.uid()));
create policy sync_runs_update on public.sync_runs for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and started_by = (select auth.uid()))
  with check (workspace_id in (select public.member_ws_ids()));

-- backups (rows are written by the backup job with the service role)
create policy backup_checks_select on public.backup_checks for select to authenticated
  using ((workspace_id is null or workspace_id in (select public.member_ws_ids()))
         and workspace_id in (select public.role_ws_ids('owner','sales_manager','data')));
create policy backup_rules_select on public.backup_alert_rules for select to authenticated
  using ((workspace_id is null or workspace_id in (select public.member_ws_ids()))
         and workspace_id in (select public.role_ws_ids('owner','sales_manager','data')));
create policy backup_rules_insert on public.backup_alert_rules for insert to authenticated
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')))
              and (workspace_id in (select public.member_ws_ids())));
create policy backup_rules_update on public.backup_alert_rules for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')))
  with check ((workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')))
              and (workspace_id in (select public.member_ws_ids())));
create policy backup_rules_delete on public.backup_alert_rules for delete to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner')));

-- AI insights: requester or owner/sales_manager
create policy ai_select on public.ai_insights for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (user_id = (select auth.uid()) or workspace_id in (select public.role_ws_ids('owner','sales_manager'))));
create policy ai_insert on public.ai_insights for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids()) and user_id = (select auth.uid()) and not workspace_id in (select public.role_ws_ids('viewer')));
create policy ai_update on public.ai_insights for update to authenticated
  using (workspace_id in (select public.member_ws_ids()) and user_id = (select auth.uid()))
  with check (workspace_id in (select public.member_ws_ids()) and user_id = (select auth.uid()));

-- consent_log: append-only
create policy consent_select on public.consent_log for select to authenticated
  using (workspace_id in (select public.member_ws_ids()) and workspace_id in (select public.role_ws_ids('owner','sales_manager','data')));
create policy consent_insert on public.consent_log for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and workspace_id in (select public.role_ws_ids('owner','sales_manager','sales_rep','data'))
              and recorded_by = (select auth.uid())
              and (lead_id is null or exists (select 1 from public.leads l where l.id = consent_log.lead_id)));

-- audit_log: read-only for owner + sales_manager; written only by trigger
create policy audit_select on public.audit_log for select to authenticated
  using (workspace_id in (select public.member_role_ws_ids('owner','sales_manager'))
         or (select public.is_platform_admin()));

-- ---------- reference visibility (cross-row references must point at rows the caller can see) ----------
alter policy leads_insert on public.leads
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data'))
                   or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid())))
              and (account_id  is null or exists (select 1 from public.accounts  x where x.id = leads.account_id))
              and (contact_id  is null or exists (select 1 from public.contacts  x where x.id = leads.contact_id))
              and (campaign_id is null or exists (select 1 from public.campaigns x where x.id = leads.campaign_id)));
alter policy leads_update on public.leads
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data')) or owner_id = (select auth.uid()))
              and (account_id  is null or exists (select 1 from public.accounts  x where x.id = leads.account_id))
              and (contact_id  is null or exists (select 1 from public.contacts  x where x.id = leads.contact_id))
              and (campaign_id is null or exists (select 1 from public.campaigns x where x.id = leads.campaign_id)));

alter policy deals_insert on public.deals
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid())))
              and (lead_id    is null or exists (select 1 from public.leads    x where x.id = deals.lead_id))
              and (account_id is null or exists (select 1 from public.accounts x where x.id = deals.account_id))
              and (primary_contact_id is null or exists (select 1 from public.contacts x where x.id = deals.primary_contact_id)));
alter policy deals_update on public.deals
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or owner_id = (select auth.uid()))
              and (lead_id    is null or exists (select 1 from public.leads    x where x.id = deals.lead_id))
              and (account_id is null or exists (select 1 from public.accounts x where x.id = deals.account_id))
              and (primary_contact_id is null or exists (select 1 from public.contacts x where x.id = deals.primary_contact_id)));

alter policy activities_insert on public.activities
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or (workspace_id in (select public.role_ws_ids('sales_rep')) and owner_id = (select auth.uid())))
              and (lead_id    is null or exists (select 1 from public.leads    x where x.id = activities.lead_id))
              and (deal_id    is null or exists (select 1 from public.deals    x where x.id = activities.deal_id))
              and (account_id is null or exists (select 1 from public.accounts x where x.id = activities.account_id))
              and (contact_id is null or exists (select 1 from public.contacts x where x.id = activities.contact_id)));
alter policy activities_update on public.activities
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or owner_id = (select auth.uid()))
              and (lead_id    is null or exists (select 1 from public.leads    x where x.id = activities.lead_id))
              and (deal_id    is null or exists (select 1 from public.deals    x where x.id = activities.deal_id))
              and (account_id is null or exists (select 1 from public.accounts x where x.id = activities.account_id))
              and (contact_id is null or exists (select 1 from public.contacts x where x.id = activities.contact_id)));

alter policy tasks_insert on public.tasks
  with check (workspace_id in (select public.member_ws_ids()) and not workspace_id in (select public.role_ws_ids('viewer'))
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads x where x.id = tasks.lead_id))
              and (deal_id is null or exists (select 1 from public.deals x where x.id = tasks.deal_id)));
alter policy tasks_update on public.tasks
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id is null or exists (select 1 from public.leads x where x.id = tasks.lead_id))
              and (deal_id is null or exists (select 1 from public.deals x where x.id = tasks.deal_id)));

alter policy conversations_insert on public.conversations
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager'))
                   or (workspace_id in (select public.role_ws_ids('sales_rep')) and assignee_id = (select auth.uid())))
              and (lead_id    is null or exists (select 1 from public.leads    x where x.id = conversations.lead_id))
              and (contact_id is null or exists (select 1 from public.contacts x where x.id = conversations.contact_id)));
alter policy conversations_update on public.conversations
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select public.role_ws_ids('owner','sales_manager')) or assignee_id = (select auth.uid()))
              and (lead_id    is null or exists (select 1 from public.leads    x where x.id = conversations.lead_id))
              and (contact_id is null or exists (select 1 from public.contacts x where x.id = conversations.contact_id)));

alter policy ai_insert on public.ai_insights
  with check (workspace_id in (select public.member_ws_ids()) and user_id = (select auth.uid())
              and not workspace_id in (select public.role_ws_ids('viewer'))
              and (lead_id is null or exists (select 1 from public.leads x where x.id = ai_insights.lead_id))
              and (deal_id is null or exists (select 1 from public.deals x where x.id = ai_insights.deal_id))
              and (campaign_id is null or exists (select 1 from public.campaigns x where x.id = ai_insights.campaign_id))
              and (conversation_id is null or exists (select 1 from public.conversations x where x.id = ai_insights.conversation_id)));

alter policy consent_insert on public.consent_log
  with check (workspace_id in (select public.member_ws_ids())
              and workspace_id in (select public.role_ws_ids('owner','sales_manager','sales_rep','data'))
              and recorded_by = (select auth.uid())
              and (lead_id is null or exists (select 1 from public.leads x where x.id = consent_log.lead_id)));


-- ======================= migrations/0007_rpcs.sql =======================
-- 0007 RPCs for the workspace model: landing intake (anon), workspace switcher, invites, platform admin.
-- All SECURITY DEFINER with search_path = '' and explicit authorisation inside; EXECUTE grants in 0009.

-- ---------- defaults for a new workspace (internal) ----------
create or replace function public.seed_workspace_defaults(p_ws uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.pipeline_stages (workspace_id, key, label, position, probability, max_days, is_won, is_lost) values
    (p_ws, 'discovery',      'Discovery',       1, 10, 14, false, false),
    (p_ws, 'demo_scheduled', 'Demo scheduled',  2, 25, 10, false, false),
    (p_ws, 'demo_done',      'Demo done',       3, 40, 14, false, false),
    (p_ws, 'proposal',       'Proposal sent',   4, 60, 14, false, false),
    (p_ws, 'negotiation',    'Negotiation',     5, 80, 21, false, false),
    (p_ws, 'won',            'Won',             6, 100, 999, true, false),
    (p_ws, 'lost',           'Lost',            7, 0, 999, false, true)
  on conflict do nothing;
  insert into public.integrations (workspace_id, provider, label, category, direction, status, auth_method) values
    (p_ws, 'zoho_crm',   'Zoho CRM',             'crm',        'both', 'showcase', 'OAuth 2.0 (accounts.zoho.in)'),
    (p_ws, 'hubspot',    'HubSpot',              'crm',        'both', 'showcase', 'OAuth 2.0 / private app token'),
    (p_ws, 'whatsapp',   'WhatsApp Business',    'messaging',  'both', 'showcase', 'System user token'),
    (p_ws, 'linkedin',   'LinkedIn Lead Gen',    'ads',        'in',   'showcase', 'OAuth 2.0'),
    (p_ws, 'meta_ads',   'Meta Ads',             'ads',        'both', 'showcase', 'System user token'),
    (p_ws, 'google_ads', 'Google Ads',           'ads',        'both', 'showcase', 'OAuth 2.0 + developer token'),
    (p_ws, 'ga4',        'Google Analytics 4',   'analytics',  'both', 'showcase', 'Service account'),
    (p_ws, 'mailchimp',  'Mailchimp',            'email',      'in',   'showcase', 'API key / OAuth 2.0'),
    (p_ws, 'gmail',      'Gmail',                'email',      'both', 'showcase', 'OAuth 2.0 (restricted scopes)'),
    (p_ws, 'outlook',    'Outlook',              'email',      'both', 'showcase', 'OAuth 2.0 (Microsoft Graph)'),
    (p_ws, 'calendly',   'Calendly',             'scheduling', 'in',   'showcase', 'OAuth 2.0 / personal token'),
    (p_ws, 'calcom',     'Cal.com',              'scheduling', 'in',   'showcase', 'API key'),
    (p_ws, 'slack',      'Slack',                'automation', 'out',  'showcase', 'Incoming webhook'),
    (p_ws, 'zapier',     'Zapier',               'automation', 'both', 'showcase', 'Signed webhooks'),
    (p_ws, 'make',       'Make',                 'automation', 'both', 'showcase', 'Signed webhooks'),
    (p_ws, 'razorpay',   'Razorpay',             'payments',   'in',   'showcase', 'Key + webhook secret'),
    (p_ws, 'landing',    'Landing page',         'internal',   'in',   'not_configured', 'submit_lead RPC'),
    (p_ws, 'csv',        'CSV import',           'internal',   'in',   'connected', 'User session')
  on conflict do nothing;
$$;

-- ---------- branding for the login page (no personal data) ----------
create or replace function public.tenant_branding(p_slug text default null, p_domain text default null)
returns table (tenant_id uuid, slug text, brand_name text, brand_logo_url text, brand_logo_dark_url text,
               brand_favicon_url text, brand_primary text, brand_accent text, support_email text, is_demo boolean)
language sql stable security definer set search_path = '' as $$
  select t.id, t.slug, t.brand_name, t.brand_logo_url, t.brand_logo_dark_url, t.brand_favicon_url,
         t.brand_primary, t.brand_accent, t.support_email, t.is_demo
    from public.tenants t
   where t.status = 'active'
     and ((p_slug is not null and t.slug = p_slug) or (p_domain is not null and t.custom_domain = lower(p_domain)))
   limit 1
$$;

-- ---------- landing intake (anon) ----------
-- p_workspace: workspace slug (e.g. 'lawsome-tn') or id. The landing app sends NEXT_PUBLIC_LEAD_WORKSPACE.
create or replace function public.submit_lead(
  p_workspace          text,
  p_full_name          text,
  p_email              text,
  p_phone              text default null,
  p_firm_name          text default null,
  p_role_title         text default null,
  p_city               text default null,
  p_district           text default null,
  p_practice_area      text default null,
  p_consent_followup   boolean default false,
  p_consent_whatsapp   boolean default false,
  p_consent_marketing  boolean default false,
  p_notice_version     text default 'v1',
  p_utm                jsonb default '{}',
  p_click_ids          jsonb default '{}',
  p_anon_id            text default null,
  p_landing_path       text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  w          public.workspaces;
  v_name     text := trim(p_full_name);
  v_email    text := lower(trim(p_email));
  v_phone    text := nullif(regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g'), '');
  v_firm     text := nullif(trim(p_firm_name), '');
  v_role     text := nullif(trim(p_role_title), '');
  v_city     text := nullif(trim(p_city), '');
  v_district text := nullif(trim(p_district), '');
  v_practice text := nullif(trim(p_practice_area), '');
  v_path     text := left(nullif(trim(p_landing_path), ''), 300);
  v_anon     text := nullif(trim(p_anon_id), '');
  v_notice   text := coalesce(nullif(trim(p_notice_version), ''), 'v1');
  v_utm      jsonb := '{}';
  v_clicks   jsonb := '{}';
  v_src      text;
  v_med      text;
  v_subject  text;
  v_lead     uuid;
  v_account  uuid;
  v_campaign uuid;
  v_channel  public.channel_kind;
  v_personal boolean;
  v_factors  jsonb := '[]';
  v_score    int := 0;
begin
  select ws.* into w from public.workspaces ws join public.tenants t on t.id = ws.tenant_id
   where (ws.slug = p_workspace or ws.id::text = p_workspace)
     and ws.lead_intake_enabled and ws.archived_at is null and t.status = 'active';
  if w.id is null then raise exception 'unknown workspace' using errcode = '22023'; end if;

  -- validation (mirrors apps/lawsome-landing/src/app/api/leads/route.ts)
  if v_name is null or length(v_name) not between 2 and 120 then
    raise exception 'invalid name' using errcode = '22023'; end if;
  if v_email is null or length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then
    raise exception 'invalid email' using errcode = '22023'; end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{8,15}$' then
    raise exception 'invalid phone' using errcode = '22023'; end if;
  if length(coalesce(v_firm,'')) > 160 or length(coalesce(v_role,'')) > 80
     or length(coalesce(v_city,'')) > 80 or length(coalesce(v_district,'')) > 80
     or length(coalesce(v_practice,'')) > 80 or length(v_notice) > 20
     or (v_anon is not null and length(v_anon) not between 8 and 64) then
    raise exception 'field too long' using errcode = '22023'; end if;
  if v_role is not null and v_role not in ('Managing partner / owner','Senior advocate / practice head',
       'Associate / lawyer','Legal operations / admin','Other') then
    raise exception 'invalid role' using errcode = '22023'; end if;
  v_district := initcap(v_district);
  if v_district is not null and v_district not in ('Ariyalur','Chengalpattu','Chennai','Coimbatore',
       'Cuddalore','Dharmapuri','Dindigul','Erode','Kallakurichi','Kanchipuram','Kanniyakumari','Karur','Krishnagiri',
       'Madurai','Mayiladuthurai','Nagapattinam','Namakkal','Nilgiris','Perambalur','Pudukkottai','Ramanathapuram',
       'Ranipet','Salem','Sivaganga','Tenkasi','Thanjavur','Theni','Thoothukudi','Tiruchirappalli','Tirunelveli',
       'Tirupathur','Tiruppur','Tiruvallur','Tiruvannamalai','Tiruvarur','Vellore','Viluppuram','Virudhunagar','Puducherry',
       -- Kerala pilot workspace
       'Thiruvananthapuram','Kollam','Pathanamthitta','Alappuzha','Kottayam','Idukki','Ernakulam','Thrissur',
       'Palakkad','Malappuram','Kozhikode','Wayanad','Kannur','Kasaragod') then
    v_district := null;
  end if;
  if not coalesce(p_consent_followup, false) then
    raise exception 'consent for demo follow-up is required' using errcode = '22023'; end if;
  if pg_column_size(p_utm) > 2000 or pg_column_size(p_click_ids) > 1000 then
    raise exception 'payload too large' using errcode = '22023'; end if;

  -- keep only whitelisted, string-valued keys (accepts "source" or "utm_source")
  if jsonb_typeof(p_utm) = 'object' then
    select coalesce(jsonb_object_agg(k, left(v, 120)), '{}') into v_utm
      from (select regexp_replace(key, '^utm_', '') k, value #>> '{}' v from jsonb_each(p_utm)
             where jsonb_typeof(value) = 'string') s
     where k in ('source','medium','campaign','term','content') and length(v) > 0;
  end if;
  if jsonb_typeof(p_click_ids) = 'object' then
    select coalesce(jsonb_object_agg(key, left(value #>> '{}', 200)), '{}') into v_clicks
      from jsonb_each(p_click_ids)
     where key in ('gclid','fbclid','li_fat_id','msclkid') and jsonb_typeof(value) = 'string';
  end if;

  -- throttle: 5 submissions per email per hour, 300 per workspace per 10 minutes
  if (select count(*) from public.lead_events e join public.leads l on l.id = e.lead_id
       where l.workspace_id = w.id and lower(l.email) = v_email and e.event_name = 'form_submit'
         and e.occurred_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.lead_events e
          where e.workspace_id = w.id and e.event_name = 'form_submit'
            and e.occurred_at > now() - interval '10 minutes') >= 300 then
    raise exception 'too many submissions, try later' using errcode = '54000';
  end if;

  v_subject  := encode(sha256(convert_to(v_email, 'UTF8')), 'hex');
  v_personal := split_part(v_email, '@', 2) in ('gmail.com','googlemail.com','yahoo.com','yahoo.co.in','outlook.com',
                  'hotmail.com','live.com','rediffmail.com','icloud.com','proton.me','protonmail.com');
  v_src := lower(coalesce(v_utm->>'source', ''));
  v_med := lower(coalesce(v_utm->>'medium', ''));
  v_channel := case
                 when v_src = 'linkedin' then 'linkedin'
                 when v_src in ('facebook','instagram','meta','fb','ig') then 'meta'
                 when v_src in ('google','gads','adwords') then
                   case when v_med in ('cpc','paid','ppc','search') or v_src <> 'google' then 'google_ads' else 'organic' end
                 when v_src = 'whatsapp' then 'whatsapp'
                 when v_src in ('email','mailchimp','newsletter') or v_med = 'email' then 'email'
                 when v_src = 'referral' or v_med = 'referral' then 'referral'
                 when v_src in ('event','webinar') then 'event'
                 when v_src = '' then 'direct'
                 else 'other'
               end::public.channel_kind;
  select id into v_campaign from public.campaigns where workspace_id = w.id and utm_campaign = v_utm->>'campaign';

  -- transparent rule-based score (never presented as an AI prediction)
  select coalesce(jsonb_agg(jsonb_build_object('factor', f, 'label', l, 'points', p)), '[]'), coalesce(sum(p), 0)
    into v_factors, v_score
    from (values
      ('role_owner',     'Managing partner / owner',        40, v_role = 'Managing partner / owner'),
      ('role_senior',    'Senior advocate / practice head', 25, v_role = 'Senior advocate / practice head'),
      ('role_associate', 'Associate / lawyer',              10, v_role = 'Associate / lawyer'),
      ('work_email',     'Work email domain',               15, not v_personal),
      ('phone_given',    'Phone number shared',              5, v_phone is not null),
      ('whatsapp_optin', 'WhatsApp opt-in',                  5, coalesce(p_consent_whatsapp, false))
    ) x(f, l, p, hit)
   where hit;

  select id into v_lead from public.leads
   where workspace_id = w.id and lower(email) = v_email and deleted_at is null;

  if v_lead is null and v_firm is not null and length(v_firm) > 1 then   -- accounts only for new leads (anti-spam)
    select id into v_account from public.accounts
     where workspace_id = w.id and lower(name) = lower(v_firm)
       and lower(coalesce(city,'')) = lower(coalesce(v_city,'')) and deleted_at is null;
    if v_account is null then
      insert into public.accounts (workspace_id, name, city, district)
      values (w.id, v_firm, v_city, v_district)
      returning id into v_account;
    end if;
  end if;

  if v_lead is null then
    insert into public.leads (workspace_id, full_name, email, phone, role_title, firm_name, account_id, city, district,
                              practice_area, personal_email, campaign_id, first_touch_channel, first_touch_campaign,
                              last_touch_channel, last_touch_campaign, utm, click_ids, landing_path, source,
                              consent_demo_followup, consent_whatsapp, consent_marketing, score, score_factors)
    values (w.id, v_name, v_email, v_phone, v_role, v_firm, v_account, v_city, v_district, v_practice, v_personal,
            v_campaign, v_channel, v_utm->>'campaign', v_channel, v_utm->>'campaign', v_utm, v_clicks, v_path,
            'landing', true, coalesce(p_consent_whatsapp,false), coalesce(p_consent_marketing,false),
            least(v_score, 100), v_factors)
    returning id into v_lead;
  else
    -- repeat submission: keep first touch, refresh last touch and consents
    update public.leads
       set last_touch_channel = v_channel, last_touch_campaign = v_utm->>'campaign',
           phone = coalesce(phone, v_phone),
           consent_demo_followup = true,
           consent_whatsapp  = consent_whatsapp  or coalesce(p_consent_whatsapp,false),
           consent_marketing = consent_marketing or coalesce(p_consent_marketing,false)
     where id = v_lead;
  end if;

  insert into public.lead_events (workspace_id, lead_id, anon_id, event_name, utm, path)
  values (w.id, v_lead, v_anon, 'form_submit', v_utm, v_path);
  if v_anon is not null then
    update public.lead_events set lead_id = v_lead
     where workspace_id = w.id and anon_id = v_anon and lead_id is null;
  end if;

  insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via)
  select w.id, v_lead, v_subject, x.purpose, 'granted', v_notice, 'landing_form'
    from (values ('demo_followup'::public.consent_purpose, true),
                 ('whatsapp'::public.consent_purpose, coalesce(p_consent_whatsapp,false)),
                 ('marketing_email'::public.consent_purpose, coalesce(p_consent_marketing,false))) x(purpose, given)
   where x.given;

  return v_lead;
end $$;

create or replace function public.track_event(
  p_workspace text, p_anon_id text, p_event_name text,
  p_path text default null, p_utm jsonb default '{}', p_props jsonb default '{}'
) returns void
language plpgsql security definer set search_path = '' as $$
declare ws_id uuid;
begin
  select ws.id into ws_id from public.workspaces ws
   where (ws.slug = p_workspace or ws.id::text = p_workspace) and ws.lead_intake_enabled and ws.archived_at is null;
  if ws_id is null then raise exception 'unknown workspace' using errcode = '22023'; end if;
  if p_event_name not in ('page_view','cta_click','form_start','tour_play','pricing_view','demo_booked') then
    raise exception 'event not allowed' using errcode = '22023'; end if;
  if p_anon_id is null or length(p_anon_id) not between 8 and 64 then
    raise exception 'anon_id required (consented visitors only)' using errcode = '22023'; end if;
  if pg_column_size(p_props) > 2000 or pg_column_size(p_utm) > 2000 then
    raise exception 'payload too large' using errcode = '22023'; end if;
  if (select count(*) from public.lead_events
       where workspace_id = ws_id and anon_id = p_anon_id and occurred_at > now() - interval '1 minute') >= 60 then
    return;  -- silently drop floods
  end if;
  insert into public.lead_events (workspace_id, lead_id, anon_id, event_name, utm, path, props)
  values (ws_id, (select lead_id from public.lead_events
                   where workspace_id = ws_id and anon_id = p_anon_id and lead_id is not null limit 1),
          p_anon_id, p_event_name, coalesce(p_utm,'{}'), left(p_path, 300), coalesce(p_props,'{}'));
end $$;

-- ---------- DPDP erasure: real workspace owner only (never via a support session) ----------
create or replace function public.erase_lead(p_lead uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.leads;
begin
  select * into l from public.leads where id = p_lead;
  if l.id is null or l.workspace_id not in (select public.member_role_ws_ids('owner')) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  perform set_config('app.actor_label', 'erasure', true);
  update public.leads set full_name = 'Erased lead', email = null, phone = null, firm_name = null,
         utm = '{}', click_ids = '{}', score_factors = '[]', external_ids = '{}', deleted_at = coalesce(deleted_at, now())
   where id = p_lead;
  update public.activities set body = null, subject = null where lead_id = p_lead;
  update public.messages m set body = null from public.conversations c
   where c.id = m.conversation_id and c.lead_id = p_lead;
  update public.lead_events set props = '{}', anon_id = null where lead_id = p_lead;
  delete from public.ai_insights where lead_id = p_lead;
  insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via, recorded_by, note)
  select l.workspace_id, p_lead, coalesce((select subject_ref from public.consent_log where lead_id = p_lead limit 1), 'unknown'),
         'demo_followup', 'erasure_completed', 'n/a', 'request', auth.uid(), left(p_note, 200);
end $$;

-- ---------- workspace switcher ----------
create or replace function public.my_workspaces()
returns table (workspace_id uuid, workspace_name text, workspace_slug text, region_label text, is_demo boolean,
               tenant_id uuid, tenant_name text, tenant_slug text, branding jsonb, role public.app_role,
               via_support_session boolean, support_session_expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with mine as (
    select m.workspace_id, m.role, false as via_ss, null::timestamptz as ss_expires
      from public.memberships m where m.user_id = auth.uid() and m.is_active
    union all
    select s.workspace_id, (case s.mode when 'read_write' then 'owner' else 'viewer' end)::public.app_role, true, s.expires_at
      from public.support_sessions s
     where s.admin_id = auth.uid() and s.ended_at is null and now() < s.expires_at and public.is_platform_admin()
  )
  select w.id, w.name, w.slug, w.region_label, w.is_demo, t.id, t.name, t.slug,
         jsonb_build_object('brand_name', t.brand_name, 'brand_logo_url', t.brand_logo_url,
                            'brand_logo_dark_url', t.brand_logo_dark_url, 'brand_favicon_url', t.brand_favicon_url,
                            'brand_primary', t.brand_primary, 'brand_accent', t.brand_accent,
                            'support_email', t.support_email),
         mine.role, mine.via_ss, mine.ss_expires
    from mine join public.workspaces w on w.id = mine.workspace_id join public.tenants t on t.id = w.tenant_id
   where w.archived_at is null and t.status = 'active'
   order by t.name, w.name
$$;

-- ---------- membership / invitation (internal, no auth check; callers authorise) ----------
create or replace function public._add_member_or_invite(p_ws uuid, p_email text, p_role public.app_role,
                                                       p_full_name text, p_districts text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_inv uuid; v_email text := lower(trim(p_email));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or length(v_email) > 160 then
    raise exception 'invalid email' using errcode = '22023'; end if;
  select u.id into v_user from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null;
  if v_user is not null then
    insert into public.profiles (id, full_name, email, last_workspace_id)
    values (v_user, coalesce(nullif(trim(p_full_name), ''), split_part(v_email, '@', 1)), v_email, p_ws)
    on conflict (id) do nothing;
    insert into public.memberships (user_id, workspace_id, role, invited_by)
    values (v_user, p_ws, p_role, auth.uid())
    on conflict (user_id, workspace_id) do update set role = excluded.role, is_active = true;
    insert into public.territories (workspace_id, district, rep_id)
    select p_ws, d, v_user from unnest(coalesce(p_districts, '{}')) d
    on conflict (workspace_id, district) do update set rep_id = excluded.rep_id;
    if p_role = 'owner' then
      update public.tenants t set primary_owner_id = v_user
       where t.id = (select w.tenant_id from public.workspaces w where w.id = p_ws) and t.primary_owner_id is null;
    end if;
    return jsonb_build_object('status', 'member_added', 'user_id', v_user);
  end if;
  delete from public.invitations where workspace_id = p_ws and lower(email) = v_email and accepted_at is null;
  insert into public.invitations (workspace_id, email, full_name, role, territory_districts, invited_by)
  values (p_ws, v_email, nullif(trim(p_full_name), ''), p_role, coalesce(p_districts, '{}'),
          (select p.id from public.profiles p where p.id = auth.uid()))
  returning id into v_inv;
  -- the server action must now call auth.admin.inviteUserByEmail(email) with the service role
  return jsonb_build_object('status', 'invited', 'invitation_id', v_inv);
end $$;

-- Owner: any role. Sales manager: sales_rep / viewer only. Platform admin: only to seat the OWNER of a workspace
-- that has no active owner (bootstrap from /admin/tenants/[id]); otherwise admins must use a support session
-- like everyone else, so a second account cannot be used to bypass the support-session model.
create or replace function public.invite_member(p_ws uuid, p_email text, p_role public.app_role,
                                                p_full_name text default null, p_districts text[] default '{}')
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not (p_ws in (select public.member_role_ws_ids('owner'))
          or (p_ws in (select public.member_role_ws_ids('sales_manager')) and p_role in ('sales_rep','viewer'))
          or (public.is_platform_admin() and p_role = 'owner'
              and not exists (select 1 from public.memberships m
                               where m.workspace_id = p_ws and m.role = 'owner' and m.is_active))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public._add_member_or_invite(p_ws, p_email, p_role, p_full_name, p_districts);
end $$;

-- Tenant owners (owner in any workspace of the tenant) and platform admins.
create or replace function public.create_workspace(p_tenant uuid, p_name text, p_slug text default null,
                                                   p_region_label text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_slug text;
begin
  if not (p_tenant in (select public.owner_tenant_ids()) or public.is_platform_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_slug := coalesce(nullif(trim(p_slug), ''),
                     trim(both '-' from left(regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'), 40)));
  insert into public.workspaces (tenant_id, name, slug, region_label, is_demo)
  values (p_tenant, trim(p_name), v_slug, nullif(trim(p_region_label), ''),
          (select t.is_demo from public.tenants t where t.id = p_tenant))
  returning id into v_ws;
  perform public.seed_workspace_defaults(v_ws);
  if p_tenant in (select public.owner_tenant_ids()) then
    insert into public.memberships (user_id, workspace_id, role, invited_by) values (auth.uid(), v_ws, 'owner', auth.uid());
  end if;
  return v_ws;
end $$;

-- Platform admin: new white-label tenant + first workspace + owner seat (member or invitation).
create or replace function public.admin_create_tenant(p_name text, p_slug text, p_branding jsonb,
                                                      p_owner_email text, p_workspace_name text default 'Main')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_t uuid; v_ws uuid; v_owner jsonb; b jsonb := coalesce(p_branding, '{}');
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.tenants (slug, name, brand_name, brand_logo_url, brand_primary, brand_accent, support_email,
                              email_sender_name, is_demo)
  values (p_slug, trim(p_name), coalesce(b->>'brand_name', trim(p_name)), b->>'brand_logo_url',
          coalesce(b->>'brand_primary', '#1D5FBF'), coalesce(b->>'brand_accent', '#0F8B8D'),
          b->>'support_email', b->>'email_sender_name', coalesce((b->>'is_demo')::boolean, false))
  returning id into v_t;
  insert into public.workspaces (tenant_id, name, slug, is_demo)
  values (v_t, p_workspace_name,
          left(p_slug || '-' || trim(both '-' from regexp_replace(lower(p_workspace_name), '[^a-z0-9]+', '-', 'g')), 40),
          coalesce((b->>'is_demo')::boolean, false))
  returning id into v_ws;
  perform public.seed_workspace_defaults(v_ws);
  v_owner := public._add_member_or_invite(v_ws, p_owner_email, 'owner', null, '{}');
  return jsonb_build_object('tenant_id', v_t, 'workspace_id', v_ws, 'owner', v_owner);
end $$;

-- ---------- audited break-glass access ----------
create or replace function public.start_support_session(p_workspace_id uuid, p_reason text, p_mode text default 'read_only',
                                                        p_minutes int default 30)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_minutes not in (15, 30, 60) then raise exception 'duration must be 15, 30 or 60 minutes' using errcode = '22023'; end if;
  update public.support_sessions set ended_at = now()
   where admin_id = auth.uid() and ended_at is null;                   -- one open session per admin
  insert into public.support_sessions (admin_id, workspace_id, reason, mode, expires_at)
  values (auth.uid(), p_workspace_id, trim(p_reason), p_mode, now() + make_interval(mins => p_minutes))
  returning id into v_id;
  return v_id;
end $$;

-- End by session id, or every open session of the caller in a workspace (p_workspace_id), or all of the caller's.
create or replace function public.end_support_session(p_id uuid default null, p_workspace_id uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.support_sessions set ended_at = now()
   where ended_at is null and admin_id = auth.uid()
     and (p_id is null or id = p_id) and (p_workspace_id is null or workspace_id = p_workspace_id);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- platform admin console (aggregates only, no personal data) ----------
create or replace function public.admin_workspace_stats()
returns table (tenant_id uuid, tenant_name text, tenant_status text, workspace_id uuid, workspace_name text,
               workspace_slug text, members int, leads_total int, leads_30d int, integrations_attention int,
               failed_syncs_24h int, last_activity_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select t.id, t.name, t.status, w.id, w.name, w.slug,
         (select count(*)::int from public.memberships m where m.workspace_id = w.id and m.is_active),
         (select count(*)::int from public.leads l where l.workspace_id = w.id and l.deleted_at is null),
         (select count(*)::int from public.leads l where l.workspace_id = w.id and l.deleted_at is null
            and l.created_at > now() - interval '30 days'),
         (select count(*)::int from public.integrations i where i.workspace_id = w.id
            and i.status in ('needs_attention','error')),
         (select count(*)::int from public.sync_runs r where r.workspace_id = w.id and r.status = 'failed'
            and r.started_at > now() - interval '24 hours'),
         greatest((select max(a.created_at) from public.activities a where a.workspace_id = w.id),
                  (select max(l.created_at) from public.leads l where l.workspace_id = w.id))
    from public.workspaces w join public.tenants t on t.id = w.tenant_id
   order by t.name, w.name;
end $$;

create or replace function public.admin_set_tenant_status(p_tenant uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status not in ('active','suspended','archived') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.tenants set status = p_status where id = p_tenant;
end $$;
-- Granting/revoking platform admin is deliberately SQL-only (service role), see README.


-- ======================= migrations/0008_views.sql =======================
-- 0008 aggregate views, workspace-scoped. They run as the view owner on purpose (Viewers read dashboards
-- without row access to leads) and filter inside by workspace membership AND role. No personal data except
-- the masked directory. Sales reps get no rows from team-level views and only their own scorecard row.
-- The Supabase advisor flags these as security_definer_view; accepted and documented (README).

create view public.v_funnel_daily with (security_barrier = true) as
select e.workspace_id,
       (e.occurred_at at time zone 'Asia/Kolkata')::date as day,
       e.event_name,
       count(*) as events,
       count(distinct coalesce(e.lead_id::text, e.anon_id)) as people
  from public.lead_events e
 where e.workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data','viewer'))
 group by 1, 2, 3;

create view public.v_campaign_perf with (security_barrier = true) as
with allowed as (
  select public.role_ws_ids('owner','sales_manager','marketing','data','viewer') as ws
), m as (
  select campaign_id, sum(spend_inr) spend_inr, sum(reach) reach, sum(impressions) impressions,
         sum(clicks) clicks, sum(reactions + comments + shares) interactions, sum(opens) opens,
         sum(platform_leads) platform_leads
    from public.campaign_daily_metrics
   where workspace_id in (select ws from allowed)
   group by campaign_id
), l as (
  select ld.workspace_id, ld.first_touch_campaign as utm_campaign, count(*) leads
    from public.leads ld
   where ld.workspace_id in (select ws from allowed) and ld.deleted_at is null
   group by 1, 2
), d as (
  select ld.workspace_id, ld.first_touch_campaign as utm_campaign,
         count(distinct dl.id) filter (where exists (select 1 from public.deal_stage_history h
              join public.pipeline_stages s on s.id = h.to_stage_id
             where h.deal_id = dl.id and s.position >= (select s2.position from public.pipeline_stages s2
                    where s2.workspace_id = dl.workspace_id and s2.key = 'demo_scheduled')
               and not s.is_lost)) as demos,
         count(*) filter (where dl.won_at is not null) as won_deals,
         coalesce(sum(dl.value_inr) filter (where dl.won_at is not null), 0) as revenue_inr
    from public.deals dl join public.leads ld on ld.id = dl.lead_id
   where dl.workspace_id in (select ws from allowed) and dl.deleted_at is null
   group by 1, 2
)
select c.workspace_id, c.id as campaign_id, c.name, c.channel, c.status, c.utm_campaign,
       coalesce(m.spend_inr,0) spend_inr, coalesce(m.reach,0) reach, coalesce(m.impressions,0) impressions,
       coalesce(m.clicks,0) clicks, coalesce(m.interactions,0) interactions, coalesce(m.platform_leads,0) platform_leads,
       coalesce(l.leads,0) leads, coalesce(d.demos,0) demos, coalesce(d.won_deals,0) won_deals,
       coalesce(d.revenue_inr,0) revenue_inr,
       round(m.clicks::numeric / nullif(m.impressions,0), 4)                         as ctr,               -- M7
       round(m.spend_inr / nullif(l.leads,0), 2)                                     as cpl_inr,           -- M9
       round(m.spend_inr / nullif(d.demos,0), 2)                                     as cost_per_demo_inr, -- M11
       round(coalesce(l.leads,0)::numeric / nullif(m.clicks,0), 4)                   as click_to_lead,     -- M47
       round((m.clicks + m.interactions + case when c.channel = 'email' then m.opens else 0 end)::numeric
             / nullif(m.impressions,0), 4)                                           as engagement_rate,   -- M46
       round(d.revenue_inr / nullif(m.spend_inr,0), 2)                               as roas,              -- M43
       coalesce(m.platform_leads,0) - coalesce(l.leads,0)                            as platform_crm_gap   -- M13
  from public.campaigns c
  left join m on m.campaign_id = c.id
  left join l on l.workspace_id = c.workspace_id and l.utm_campaign = c.utm_campaign
  left join d on d.workspace_id = c.workspace_id and d.utm_campaign = c.utm_campaign
 where c.workspace_id in (select ws from allowed);

-- M45 reach profile: 5 axes normalised 0-100 within each workspace
create view public.v_campaign_reach_profile with (security_barrier = true) as
select p.workspace_id, p.campaign_id, p.name, p.channel,
       round(100.0 * p.reach / nullif(max(p.reach) over w, 0))::int                         as axis_reach,
       round(100.0 * p.engagement_rate / nullif(max(p.engagement_rate) over w, 0))::int     as axis_engagement,
       round(100.0 * p.ctr / nullif(max(p.ctr) over w, 0))::int                             as axis_ctr,
       round(100.0 * p.click_to_lead / nullif(max(p.click_to_lead) over w, 0))::int         as axis_lead_rate,
       case when p.spend_inr = 0 and p.leads > 0 then 100
            when p.leads = 0 then 0
            else coalesce(round(100.0 * (min(p.cpl_inr) over w) / nullif(p.cpl_inr, 0))::int, 0) end as axis_cost_efficiency
  from public.v_campaign_perf p
window w as (partition by p.workspace_id);

create view public.v_pipeline_summary with (security_barrier = true) as
select s.workspace_id, s.id as stage_id, s.key, s.label, s.position, s.probability,
       count(d.id) as deals,
       coalesce(sum(d.value_inr), 0) as value_inr,                                              -- M34
       round(coalesce(sum(d.value_inr * s.probability / 100.0), 0), 2) as weighted_value_inr,   -- M35
       count(d.id) filter (where now() - d.stage_entered_at > make_interval(days => s.max_days)) as stuck_deals -- M41
  from public.pipeline_stages s
  left join public.deals d on d.stage_id = s.id and d.deleted_at is null
 where s.workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data','viewer'))
 group by s.workspace_id, s.id;

-- Rep scorecard, current month (IST), per workspace. Reps see only their own row.
create view public.v_rep_scorecard with (security_barrier = true) as
with bounds as (
  select date_trunc('month', now() at time zone 'Asia/Kolkata')::date as m
)
select ms.workspace_id, ms.user_id as rep_id, p.full_name,
       (select count(*) from public.leads l where l.workspace_id = ms.workspace_id and l.owner_id = ms.user_id
          and l.deleted_at is null and l.status not in ('disqualified','converted')) as open_leads,
       (select count(*) from public.leads l where l.workspace_id = ms.workspace_id and l.owner_id = ms.user_id
          and l.created_at >= (select m from bounds)) as leads_this_month,
       (select round(100.0 * count(*) filter (where l.first_response_at - l.created_at
                   <= make_interval(mins => w.sla_first_response_mins)) / nullif(count(*),0), 1)
          from public.leads l where l.workspace_id = ms.workspace_id and l.owner_id = ms.user_id
           and l.created_at >= now() - interval '30 days') as sla_pct_30d,
       (select count(*) from public.activities a where a.workspace_id = ms.workspace_id and a.owner_id = ms.user_id
          and a.kind = 'meeting' and a.meeting_type = 'demo' and a.done_at >= (select m from bounds)) as demos_done,
       (select coalesce(sum(d.value_inr),0) from public.deals d where d.workspace_id = ms.workspace_id
          and d.owner_id = ms.user_id and d.won_at >= (select m from bounds)) as won_value_inr,
       st.target_demos, st.won_value_inr as target_won_inr,
       round(100.0 * (select coalesce(sum(d.value_inr),0) from public.deals d where d.workspace_id = ms.workspace_id
          and d.owner_id = ms.user_id and d.won_at >= (select m from bounds)) / nullif(st.won_value_inr,0), 1) as attainment_pct -- M38
  from public.memberships ms
  join public.workspaces w on w.id = ms.workspace_id
  left join public.profiles p on p.id = ms.user_id
  left join public.sales_targets st on st.workspace_id = ms.workspace_id and st.rep_id = ms.user_id
                                   and st.month = (select m from bounds)
 where ms.role = 'sales_rep' and ms.is_active
   and (ms.workspace_id in (select public.role_ws_ids('owner','sales_manager','viewer'))
        or (ms.user_id = (select auth.uid()) and ms.workspace_id in (select public.member_ws_ids())));

-- Masked lead directory for viewers (and anyone needing counts without PII)
create view public.v_leads_masked with (security_barrier = true) as
select l.workspace_id, l.id,
       (with n as (select regexp_replace(l.full_name, '^(adv|dr|mr|ms|mrs|thiru|tmt)\.?\s+', '', 'i') as v)
        select split_part(n.v, ' ', 1) || coalesce(' ' || nullif(left(split_part(n.v, ' ', 2), 1), '') || '.', '') from n) as display_name,
       l.role_title, l.firm_name, l.city, l.district, l.status, l.score, l.first_touch_channel,
       l.first_touch_campaign, l.owner_id, l.created_at,
       case when l.email is not null then '•••@' || split_part(l.email, '@', 2) end as email_masked,
       case when l.phone is not null then '••••••' || right(l.phone, 4) end as phone_masked
  from public.leads l
 where l.deleted_at is null
   and l.workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data','viewer'));

create view public.v_backup_latest with (security_barrier = true) as
select distinct on (b.workspace_id, b.check_kind) b.workspace_id, b.check_kind, b.status, b.checked_at,
       b.backup_taken_at, b.size_bytes, b.retention_days, b.pitr_enabled, b.location,
       extract(epoch from now() - b.backup_taken_at) / 3600 as age_hours   -- M24
  from public.backup_checks b
 where b.status = 'success'
   and ((b.workspace_id is null and exists (select 1 from public.role_ws_ids('owner','sales_manager','data')))
        or b.workspace_id in (select public.role_ws_ids('owner','sales_manager','data')))
 order by b.workspace_id, b.check_kind, b.checked_at desc;

create view public.v_sync_freshness with (security_barrier = true) as
select i.workspace_id, i.provider, i.label, i.category, i.status, i.last_sync_at,
       extract(epoch from now() - i.last_sync_at) / 3600 as hours_since_sync,               -- M27
       (select count(*) filter (where r.status = 'failed')::numeric / nullif(count(*),0)
          from public.sync_runs r where r.integration_id = i.id
           and r.started_at > now() - interval '7 days') as error_rate_7d                   -- M56
  from public.integrations i
 where i.workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data'));


-- ======================= migrations/0009_grants.sql =======================
-- 0009 grants. anon: no table/view access at all; only the intake RPCs. authenticated: table privileges
-- (RLS decides rows), helpers and app RPCs. Trigger/internal functions: nobody.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

do $$
declare t text;
begin
  foreach t in array array['profiles','invitations','pipeline_stages','territories','sales_targets',
    'accounts','contacts','campaigns','campaign_daily_metrics','audience_segments','leads','lead_events',
    'deals','activities','tasks','message_templates','conversations','messages',
    'integrations','integration_field_maps','sync_runs','backup_alert_rules','ai_insights'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- read-mostly tables: writes only through RPCs / triggers / service role
revoke all on public.tenants, public.workspaces, public.memberships, public.platform_admins, public.support_sessions,
              public.deal_stage_history, public.ga4_daily, public.backup_checks, public.audit_log, public.consent_log
  from authenticated;
grant select on public.tenants, public.workspaces, public.memberships, public.platform_admins, public.support_sessions,
                public.deal_stage_history, public.ga4_daily, public.backup_checks, public.audit_log, public.consent_log
  to authenticated;
grant update on public.tenants, public.workspaces to authenticated;              -- branding / workspace settings (RLS)
grant update, delete on public.memberships to authenticated;                     -- role change / removal (RLS + guard)
grant insert on public.consent_log to authenticated;                             -- append-only
grant select on public.v_funnel_daily, public.v_campaign_perf, public.v_campaign_reach_profile,
                public.v_pipeline_summary, public.v_rep_scorecard, public.v_leads_masked,
                public.v_backup_latest, public.v_sync_freshness to authenticated;

-- functions
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_platform_admin(), public.member_ws_ids(), public.role_ws_ids(public.app_role[]),
  public.member_role_ws_ids(public.app_role[]), public.is_member(uuid), public.has_ws_role(uuid, public.app_role[]),
  public.has_member_role(uuid, public.app_role[]), public.has_active_support_session(uuid), public.ws_role(uuid),
  public.member_tenant_ids(), public.owner_tenant_ids(), public.co_member_ids()
  to authenticated;
grant execute on function public.my_workspaces(), public.invite_member(uuid, text, public.app_role, text, text[]),
  public.create_workspace(uuid, text, text, text), public.admin_create_tenant(text, text, jsonb, text, text),
  public.start_support_session(uuid, text, text, int), public.end_support_session(uuid, uuid),
  public.admin_workspace_stats(), public.admin_set_tenant_status(uuid, text),
  public.erase_lead(uuid, text)
  to authenticated;
grant execute on function public.tenant_branding(text, text) to anon, authenticated;
grant execute on function public.submit_lead(text, text, text, text, text, text, text, text, text,
                          boolean, boolean, boolean, text, jsonb, jsonb, text, text) to anon, authenticated;
grant execute on function public.track_event(text, text, text, text, jsonb, jsonb) to anon, authenticated;

-- objects created later (dashboard or future migrations run as postgres) start closed to anon/public
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;


-- ======================= seed/seed.sql =======================
-- Growth CRM demo seed (synthetic, deterministic). Loads into a project without the demo tenants; to rebuild,
-- run seed/reset_demo.sql first (it deletes the demo tenants, which cascades to all their rows).
-- Tenants: LAWSOME (workspaces lawsome-tn "LAWSOME · Tamil Nadu", lawsome-kl "LAWSOME · Kerala pilot") and
-- Kaveri LegalTech (demo) (workspace kaveri-cbe "Kaveri · Coimbatore") to demonstrate isolation.
-- All people and firms are fictional; emails use .example domains; phone numbers are deliberately invalid
-- (+91 00000 xxxxx). Dates are relative to the day the seed runs (IST). Pseudo-randomness is hash-based, so the
-- same rows come out every time. Owners (owner_id) stay empty: there are no auth users in a fresh project.
-- After inviting users, run seed/assign_owners.sql to spread leads/deals/tasks across the workspace's reps.
-- Run as postgres/service role (SQL editor or MCP execute_sql). Never run against a production tenant.

select set_config('app.actor_label', 'seed', true);


-- ---------- tenants + workspaces (fixed ids, see README) ----------
insert into public.tenants (id, slug, name, brand_name, brand_primary, brand_accent, support_email, email_sender_name, is_demo, plan)
values ('10000000-0000-4000-8000-000000000001', 'lawsome', 'LAWSOME', 'LAWSOME Growth', '#1D5FBF', '#0F8B8D',
        'support@lawsome.example', 'LAWSOME Growth', true, 'demo'),
       ('10000000-0000-4000-8000-000000000002', 'kaveri-demo', 'Kaveri LegalTech (demo)', 'Kaveri Growth', '#0F7B6C', '#B7791F',
        'help@kaveri-legaltech.example', 'Kaveri Growth', true, 'demo');

insert into public.workspaces (id, tenant_id, name, slug, region_label, is_demo, sla_first_response_mins)
values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'LAWSOME · Tamil Nadu',  'lawsome-tn', 'Tamil Nadu', true, 120),
       ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'LAWSOME · Kerala pilot', 'lawsome-kl', 'Kerala',     true, 240),
       ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'Kaveri · Coimbatore',    'kaveri-cbe', 'Kongu belt', true, 180);

select public.seed_workspace_defaults(id) from public.workspaces where slug in ('lawsome-tn','lawsome-kl','kaveri-cbe');

-- ---------- firms (accounts) ----------
create temp table seed_firms (ws text, k int, name text, city text, locality text, district text, practices text[]) on commit drop;
insert into seed_firms values
 ('lawsome-tn', 1,'Ramanathan & Associates','Chennai','Mylapore','Chennai','{civil,property}'),
 ('lawsome-tn', 2,'Cauvery Delta Legal LLP','Chennai','T. Nagar','Chennai','{corporate,tax}'),
 ('lawsome-tn', 3,'Marina Law Partners','Chennai','Egmore','Chennai','{civil,criminal}'),
 ('lawsome-tn', 4,'Srinivasan Law Chambers','Chennai','Mylapore','Chennai','{property,family}'),
 ('lawsome-tn', 5,'Arcot Road Chambers','Chennai','T. Nagar','Chennai','{criminal}'),
 ('lawsome-tn', 6,'Venkatraman & Co. Advocates','Chennai','Egmore','Chennai','{civil,labour}'),
 ('lawsome-tn', 7,'Lakshmi Narayanan Legal','Chennai','Anna Nagar','Chennai','{family,civil}'),
 ('lawsome-tn', 8,'Thillai Law Associates','Chennai','Anna Nagar','Chennai','{property,civil}'),
 ('lawsome-tn', 9,'Pallavan Legal Partners','Chennai','Egmore','Chennai','{corporate,labour}'),
 ('lawsome-tn',10,'Santhome Law Offices','Chennai','Mylapore','Chennai','{family,property}'),
 ('lawsome-tn',11,'Rajaratnam Chambers','Chennai','T. Nagar','Chennai','{tax,corporate}'),
 ('lawsome-tn',12,'Natarajan & Sekar Advocates','Chennai','Egmore','Chennai','{criminal,civil}'),
 ('lawsome-tn',13,'Coromandel Legal LLP','Chennai','Anna Nagar','Chennai','{corporate,tax,labour}'),
 ('lawsome-tn',14,'Krishnaswamy Law Group','Chennai','T. Nagar','Chennai','{civil,property,tax}'),
 ('lawsome-tn',15,'Elango & Partners','Chennai','Mylapore','Chennai','{labour,civil}'),
 ('lawsome-tn',16,'Bharathi Legal Associates','Chennai','Anna Nagar','Chennai','{criminal,family}'),
 ('lawsome-tn',17,'Kovai Legal Associates','Coimbatore','R.S. Puram','Coimbatore','{civil,property}'),
 ('lawsome-tn',18,'Noyyal Law Chambers','Coimbatore','Gandhipuram','Coimbatore','{labour,corporate}'),
 ('lawsome-tn',19,'Palaniappan & Co.','Coimbatore','Race Course','Coimbatore','{tax,corporate}'),
 ('lawsome-tn',20,'Siruvani Advocates','Coimbatore','Saibaba Colony','Coimbatore','{family,civil}'),
 ('lawsome-tn',21,'Velusamy Law Offices','Coimbatore','R.S. Puram','Coimbatore','{property}'),
 ('lawsome-tn',22,'Kongu Legal Partners','Coimbatore','Peelamedu','Coimbatore','{corporate,labour}'),
 ('lawsome-tn',23,'Annamalai & Associates','Coimbatore','Gandhipuram','Coimbatore','{criminal,civil}'),
 ('lawsome-tn',24,'Vaigai Advocates','Madurai','K.K. Nagar','Madurai','{civil,criminal}'),
 ('lawsome-tn',25,'Pandian Law Chambers','Madurai','Anna Nagar','Madurai','{property,civil}'),
 ('lawsome-tn',26,'Alagar Legal Associates','Madurai','Tallakulam','Madurai','{family,criminal}'),
 ('lawsome-tn',27,'Sellur Law Offices','Madurai','Sellur','Madurai','{labour}'),
 ('lawsome-tn',28,'Mariappan & Co.','Madurai','K.K. Nagar','Madurai','{tax,civil}'),
 ('lawsome-tn',29,'Tamukkam Chambers','Madurai','Tallakulam','Madurai','{criminal}'),
 ('lawsome-tn',30,'Rockfort Chambers','Tiruchirappalli','Cantonment','Tiruchirappalli','{civil,property}'),
 ('lawsome-tn',31,'Kollidam Legal','Tiruchirappalli','Thillai Nagar','Tiruchirappalli','{family,civil}'),
 ('lawsome-tn',32,'Srirangam Law Associates','Tiruchirappalli','Srirangam','Tiruchirappalli','{property}'),
 ('lawsome-tn',33,'Uraiyur Advocates','Tiruchirappalli','Thillai Nagar','Tiruchirappalli','{criminal,labour}'),
 ('lawsome-tn',34,'Shevaroy Legal','Salem','Fairlands','Salem','{corporate,civil}'),
 ('lawsome-tn',35,'Yercaud Road Chambers','Salem','Hasthampatti','Salem','{property,family}'),
 ('lawsome-tn',36,'Thirumanimuthar Law Offices','Salem','Fairlands','Salem','{civil}'),
 ('lawsome-tn',37,'Ramasamy & Partners','Salem','Swarnapuri','Salem','{tax,labour}'),
 ('lawsome-tn',38,'Thamirabarani Law Offices','Tirunelveli','Palayamkottai','Tirunelveli','{civil,property}'),
 ('lawsome-tn',39,'Nellai Legal Associates','Tirunelveli','Palayamkottai','Tirunelveli','{criminal,family}'),
 ('lawsome-tn',40,'Kuttalam Chambers','Tirunelveli','Vannarpettai','Tirunelveli','{civil}'),
 ('lawsome-kl', 1,'Periyar Law Chambers','Kochi','Kaloor','Ernakulam','{civil,commercial}'),
 ('lawsome-kl', 2,'Ananthapuri Advocates','Thiruvananthapuram','Vanchiyoor','Thiruvananthapuram','{criminal,family}'),
 ('lawsome-kl', 3,'Malabar Legal Partners','Kozhikode','Mavoor Road','Kozhikode','{property,civil}'),
 ('lawsome-kl', 4,'Vadakkunnathan Law Offices','Thrissur','Round North','Thrissur','{family,mact}'),
 ('kaveri-cbe', 1,'Bhavani Law Associates','Coimbatore','R.S. Puram','Coimbatore','{civil,property}'),
 ('kaveri-cbe', 2,'Tiruppur Textile Legal','Tiruppur','Kumaran Road','Tiruppur','{commercial,labour}'),
 ('kaveri-cbe', 3,'Amaravathi Chambers','Coimbatore','Peelamedu','Coimbatore','{criminal,ni_138}');

insert into public.accounts (id, workspace_id, name, city, district, address_line, court_focus, practice_areas, size_band,
                             lawyers_count, clerks_count, sites, current_tools, website, customer_status, is_synthetic, created_at)
select md5('acct-' || f.ws || '-' || f.k)::uuid, w.id, f.name, f.city, f.district, f.locality || ', ' || f.city,
       case when f.city = 'Chennai' then '{madras_hc,district}'::text[]
            when f.district in ('Madurai','Tiruchirappalli','Tirunelveli') then '{madurai_bench,district}'::text[]
            when f.ws = 'lawsome-kl' then '{district}'::text[]
            else '{district,madras_hc}'::text[] end,
       f.practices,
       (array['solo','2-5','6-20','6-20','21-50','2-5','50+'])[1 + (f.k * 5) % 7],
       (array[1, 4, 9, 14, 32, 3, 64])[1 + (f.k * 5) % 7],
       (array[1, 2, 4, 6, 12, 2, 20])[1 + (f.k * 5) % 7],
       case when (f.k * 5) % 7 in (4, 6) then jsonb_build_array(jsonb_build_object('label', f.locality || ' HQ', 'city', f.city),
                                                              jsonb_build_object('label', 'High Court chamber', 'city', case when f.district in ('Madurai','Tiruchirappalli','Tirunelveli') then 'Madurai' else 'Chennai' end))
            else jsonb_build_array(jsonb_build_object('label', f.locality || ' office', 'city', f.city)) end,
       (array['Excel + WhatsApp groups','Paper diary + clerk','Generic case diary app','Excel + Google Drive','Tally + Excel'])[1 + f.k % 5],
       'https://' || regexp_replace(lower(f.name), '[^a-z0-9]+', '', 'g') || '.example',
       case when f.k in (3, 13, 24) then 'customer'::public.customer_status when f.k in (17, 30) then 'trial' else 'prospect' end,
       true, now() - make_interval(days => 120 - f.k)
  from seed_firms f join public.workspaces w on w.slug = f.ws;

-- ---------- campaigns (utm ids identical to the UI mock catalog) ----------
create temp table seed_campaigns (ws text, k int, name text, channel public.channel_kind, status text, objective text,
  src text, med text, utm text, start_off int, end_off int, daily int, budget numeric) on commit drop;
insert into seed_campaigns values
 ('lawsome-tn',1,'Hearing-day visibility — Chennai partners','linkedin','active','Demo requests from managing partners','linkedin','paid_social','li_hearing_day_chn',-78,null,4100,320000),
 ('lawsome-tn',2,'eCourts made easy — Madurai advocates','whatsapp','active','Conversations with Madurai Bench practitioners','whatsapp','message','wa_ecourts_mdu',-62,null,1300,85000),
 ('lawsome-tn',3,'Ask Nidhi launch — Mailchimp','email','ended','Re-engage dormant leads with the Ask Nidhi research assistant','email','email','em_ask_nidhi_launch',-44,-12,650,22000),
 ('lawsome-tn',4,'Coimbatore firms — Meta lead ads','meta','active','Lead form submissions from Coimbatore & Tiruppur firms','meta','paid_social','meta_kovai_firms',-56,null,3900,240000),
 ('lawsome-tn',5,'Google Search — legal practice software','google_ads','active','High-intent search demand across Tamil Nadu','google','cpc','gads_practice_sw',-89,null,3800,360000),
 ('lawsome-tn',6,'Cause-list alerts — Trichy & Salem','whatsapp','paused','Test WhatsApp alerts offer outside Chennai','whatsapp','message','wa_causelist_try_slm',-36,-9,1100,40000),
 ('lawsome-tn',7,'DPDP for law firms — partner webinar','linkedin','ended','Webinar registrations, then demo follow-up','linkedin','paid_social','li_dpdp_webinar',-88,-52,3000,110000),
 ('lawsome-tn',8,'Site retargeting — Meta','meta','active','Bring back pricing-page visitors','meta','paid_social','meta_retarget_pricing',-30,null,2600,90000),
 ('lawsome-kl',1,'Kerala pilot — Kochi partners (LinkedIn)','linkedin','active','Pilot demand test in Ernakulam','linkedin','paid_social','li_kochi_pilot',-28,null,1800,50000),
 ('kaveri-cbe',1,'Kaveri — Tiruppur commercial firms (Meta)','meta','active','Lead forms from Kongu belt firms','meta','paid_social','meta_kaveri_tpr',-40,null,1500,60000);

insert into public.campaigns (id, workspace_id, name, channel, status, objective, utm_source, utm_medium, utm_campaign,
                              starts_on, ends_on, budget_inr, is_synthetic, notes)
select md5('cmp-' || c.ws || '-' || c.k)::uuid, w.id, c.name, c.channel, c.status, c.objective, c.src, c.med, c.utm,
       current_date + c.start_off, case when c.end_off is null then null else current_date + c.end_off end, c.budget, true,
       'Synthetic demo campaign'
  from seed_campaigns c join public.workspaces w on w.slug = c.ws;

insert into public.campaign_daily_metrics (workspace_id, campaign_id, day, spend_inr, impressions, reach, clicks, reactions,
                                           comments, shares, opens, bounces, unsubscribes, platform_leads, source)
select w.id, md5('cmp-' || c.ws || '-' || c.k)::uuid, d::date,
       case when c.channel = 'email' then round(c.daily * 0.15)
            else round(c.daily * (0.75 + (abs(hashtext(c.utm || d::text)) % 50) / 100.0)) end,
       x.impr, round(x.impr * 0.62), greatest(1, round(x.impr * x.ctr)),
       case when c.channel in ('linkedin','meta') then round(x.impr * 0.004) else 0 end,
       case when c.channel in ('linkedin','meta') then round(x.impr * 0.0006) else 0 end,
       case when c.channel in ('linkedin','meta') then round(x.impr * 0.0003) else 0 end,
       case when c.channel in ('email','whatsapp') then round(x.impr * case when c.channel = 'email' then 0.34 else 0.81 end) else 0 end,
       case when c.channel = 'email' then round(x.impr * 0.012) else 0 end,
       case when c.channel = 'email' then round(x.impr * 0.002) else 0 end,
       (abs(hashtext('pl' || c.utm || d::text)) % case c.channel when 'meta' then 4 when 'linkedin' then 3 when 'google_ads' then 3 else 2 end),
       'mock'
  from seed_campaigns c
  join public.workspaces w on w.slug = c.ws
  cross join lateral generate_series(current_date + c.start_off, coalesce(current_date + c.end_off, current_date - 1), interval '1 day') d
  cross join lateral (select
       (case c.channel when 'linkedin' then 5200 when 'meta' then 9800 when 'google_ads' then 2100
                       when 'email' then case when (d::date - (current_date + c.start_off)) % 8 = 0 then 1700 else 0 end
                       else 260 end)
         * (80 + abs(hashtext('im' || c.utm || d::text)) % 40) / 100 as impr,
       case c.channel when 'linkedin' then 0.0065 when 'meta' then 0.011 when 'google_ads' then 0.052
                      when 'email' then 0.041 else 0.09 end as ctr) x
 where x.impr > 0 or c.channel <> 'email';

-- ---------- leads ----------
create temp table seed_leads on commit drop as
with ws as (
  select w.id as ws_id, w.slug, n.n_leads, (select count(*) from seed_firms f where f.ws = w.slug) as n_firms
    from public.workspaces w
    join (values ('lawsome-tn', 120), ('lawsome-kl', 15), ('kaveri-cbe', 10)) n(slug, n_leads) on n.slug = w.slug
), base as (
  select ws.ws_id, ws.slug, i, f.k as firm_k, f.name as firm, f.city, f.district, f.practices,
         (array['Karthikeyan','Saravanan','Lakshmi','Revathi','Senthil','Gayathri','Murugan','Deepa','Vignesh','Sangeetha',
                'Balaji','Kavitha','Prakash','Anitha','Ramesh','Janani','Ganesh','Bhuvana','Harish','Nandhini',
                'Selvam','Priyadharshini','Arvind','Malathi','Dinesh','Shalini','Mohan','Keerthana','Suresh','Vidhya',
                'Rajesh','Hema','Kumaran','Sowmya','Elango','Abirami','Thirumalai','Pavithra','Ilango','Yamuna'])[1 + (i * 7 + length(ws.slug)) % 40] as first,
         (array['Subramanian','Krishnan','Natarajan','Ramasamy','Palanisamy','Venkatesan','Murugesan','Rajendran','Shanmugam',
                'Balasubramanian','Chandrasekaran','Ganesan','Raghavan','Thangaraj','Kannan','Periyasamy','Arumugam','Selvaraj'])[1 + (i * 11) % 18] as last,
         (array['Managing partner / owner','Managing partner / owner','Managing partner / owner','Managing partner / owner',
                'Senior advocate / practice head','Senior advocate / practice head','Senior advocate / practice head',
                'Associate / lawyer','Associate / lawyer','Associate / lawyer','Legal operations / admin','Legal operations / admin','Other'])[1 + (i * 5) % 13] as role_title,
         (array['email','linkedin','linkedin','meta','meta','whatsapp','whatsapp','google','google','google','referral','direct','linkedin','meta','email','google','whatsapp','referral','direct','google'])[1 + (i * 13) % 20] as src,
         1 + (i * 37) % 88 as age_days,
         abs(hashtext('lead' || ws.slug || i)) % 100 as h
    from ws
    cross join lateral generate_series(1, ws.n_leads) i
    join seed_firms f on f.ws = ws.slug and f.k = 1 + ((i * 7) % ws.n_firms)
)
select b.*,
       md5('lead-' || b.slug || '-' || b.i)::uuid as lead_id,
       md5('acct-' || b.slug || '-' || b.firm_k)::uuid as account_id,
       case b.src
         when 'linkedin' then case when b.city = 'Chennai' then 'li_hearing_day_chn' when b.slug = 'lawsome-kl' then 'li_kochi_pilot' else 'li_dpdp_webinar' end
         when 'whatsapp' then case when b.district in ('Tiruchirappalli','Salem') then 'wa_causelist_try_slm' else 'wa_ecourts_mdu' end
         when 'meta'     then case when b.slug = 'kaveri-cbe' then 'meta_kaveri_tpr' when b.city = 'Coimbatore' then 'meta_kovai_firms' else 'meta_retarget_pricing' end
         when 'google'   then 'gads_practice_sw'
         when 'email'    then 'em_ask_nidhi_launch'
       end as utm_campaign,
       case b.src when 'linkedin' then 'paid_social' when 'meta' then 'paid_social' when 'google' then 'cpc'
                  when 'whatsapp' then 'message' when 'email' then 'email' when 'referral' then 'referral' end as utm_medium,
       case b.src when 'linkedin' then 'linkedin' when 'meta' then 'meta' when 'google' then 'google_ads'
                  when 'whatsapp' then 'whatsapp' when 'email' then 'email' when 'referral' then 'referral' else 'direct' end::public.channel_kind as channel,
       (now() at time zone 'Asia/Kolkata')::date - b.age_days + make_interval(hours => 9 + b.h % 10, mins => (b.i * 7) % 60) as created_ist,
       case when b.age_days <= 5 then 'new'
            when b.h < 33 then 'contacted' when b.h < 55 then 'qualified' when b.h < 70 then 'nurturing'
            when b.h < 80 then 'disqualified' else 'converted' end::public.lead_status as status,
       b.h % 7 = 0 as personal
  from base b;

-- campaigns that only exist in another workspace must not be referenced
update seed_leads l set utm_campaign = null, utm_medium = null
 where utm_campaign is not null
   and not exists (select 1 from seed_campaigns c where c.ws = l.slug and c.utm = l.utm_campaign);

insert into public.leads (id, workspace_id, full_name, email, phone, role_title, firm_name, account_id, city, district,
                          practice_area, personal_email, status, disqualify_reason, campaign_id, first_touch_channel,
                          first_touch_campaign, last_touch_channel, last_touch_campaign, utm, landing_path, source,
                          consent_demo_followup, consent_whatsapp, consent_marketing, score, score_factors,
                          first_response_at, last_touch_at, next_step_at, is_synthetic, created_at)
select l.lead_id, l.ws_id,
       case when l.role_title in ('Managing partner / owner','Senior advocate / practice head') then 'Adv. ' else '' end || l.first || ' ' || l.last,
       lower(l.first) || '.' || lower(left(l.last, 6)) || l.i || '@' ||
         case when l.personal then 'mail.example' else regexp_replace(lower(l.firm), '[^a-z0-9]+', '', 'g') || '.example' end,
       case when l.h % 3 = 0 then '+91 00000 ' || lpad((l.i * 97 % 100000)::text, 5, '0') end,
       l.role_title, l.firm, l.account_id, l.city, l.district, l.practices[1], l.personal, l.status,
       case when l.status = 'disqualified' then (array['not_a_fit','in_house_excel','no_decision'])[1 + l.i % 3] end,
       (select c.id from public.campaigns c where c.workspace_id = l.ws_id and c.utm_campaign = l.utm_campaign),
       l.channel, l.utm_campaign,
       case when l.h % 5 = 0 then 'email'::public.channel_kind else l.channel end,
       case when l.h % 5 = 0 and l.slug = 'lawsome-tn' then 'em_ask_nidhi_launch' else l.utm_campaign end,
       case when l.src = 'direct' then '{}'::jsonb
            else jsonb_strip_nulls(jsonb_build_object('source', l.src, 'medium', l.utm_medium, 'campaign', l.utm_campaign)) end,
       (array['/','/demo','/pricing','/ask-nidhi','/ecourts'])[1 + l.i % 5], 'landing',
       true, l.h % 2 = 0, l.h % 3 <> 0,
       least(100, (case l.role_title when 'Managing partner / owner' then 40 when 'Senior advocate / practice head' then 25
                                     when 'Associate / lawyer' then 10 else 0 end)
                  + case when l.personal then 0 else 15 end + case when l.h % 3 = 0 then 5 else 0 end
                  + case when l.h % 2 = 0 then 5 else 0 end
                  + case when l.status in ('qualified','converted') then 20 else 0 end),
       (select jsonb_agg(jsonb_build_object('factor', f, 'label', lb, 'points', p))
          from (values ('role', l.role_title, case l.role_title when 'Managing partner / owner' then 40
                         when 'Senior advocate / practice head' then 25 when 'Associate / lawyer' then 10 else 0 end),
                       ('work_email', 'Work email domain', case when l.personal then 0 else 15 end),
                       ('phone_given', 'Phone number shared', case when l.h % 3 = 0 then 5 else 0 end),
                       ('whatsapp_optin', 'WhatsApp opt-in', case when l.h % 2 = 0 then 5 else 0 end),
                       ('demo_booked', 'Demo booked', case when l.status in ('qualified','converted') then 20 else 0 end)) x(f, lb, p)
         where p > 0),
       case when l.status <> 'new' then (l.created_ist at time zone 'Asia/Kolkata') + make_interval(mins => 12 + (l.i * 53) % 400) end,
       case when l.status <> 'new' then (l.created_ist at time zone 'Asia/Kolkata') + make_interval(days => least(l.age_days - 1, 1 + l.i % 9)) end,
       case when l.status in ('new','contacted','qualified','nurturing') then now() + make_interval(days => (l.i % 9) - 3, hours => l.i % 6) end,
       true, l.created_ist at time zone 'Asia/Kolkata'
  from seed_leads l;

-- consent records for every form lead (subject_ref = sha256(lower(email)))
insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via, occurred_at)
select l.workspace_id, l.id, encode(sha256(convert_to(lower(l.email), 'UTF8')), 'hex'), x.purpose, 'granted', 'v1', 'landing_form', l.created_at
  from public.leads l
  cross join lateral (values ('demo_followup'::public.consent_purpose, true),
                             ('whatsapp'::public.consent_purpose, l.consent_whatsapp),
                             ('marketing_email'::public.consent_purpose, l.consent_marketing)) x(purpose, given)
 where l.is_synthetic and x.given
   and l.workspace_id in (select id from public.workspaces where slug in ('lawsome-tn','lawsome-kl','kaveri-cbe'));
insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via, occurred_at, note)
select l.workspace_id, l.id, encode(sha256(convert_to(lower(l.email), 'UTF8')), 'hex'), 'marketing_email', 'withdrawn', 'v1', 'request',
       l.created_at + interval '20 days', 'Unsubscribed from newsletter (synthetic)'
  from public.leads l join public.workspaces w on w.id = l.workspace_id and w.slug = 'lawsome-tn'
 where l.consent_marketing and l.created_at < now() - interval '25 days' and abs(hashtext(l.id::text)) % 9 = 0;

-- ---------- funnel events: one journey per lead + consented anonymous visitors ----------
insert into public.lead_events (workspace_id, lead_id, anon_id, event_name, utm, path, occurred_at)
select l.workspace_id, l.id, 'anon-' || left(md5(l.id::text), 16), e.name, l.utm, l.landing_path,
       l.created_at - e.before
  from public.leads l
  cross join lateral (values ('page_view', interval '9 minutes'), ('cta_click', interval '6 minutes'),
                             ('form_start', interval '4 minutes'), ('form_submit', interval '0 minutes')) e(name, before)
 where l.is_synthetic and l.workspace_id in (select id from public.workspaces where slug in ('lawsome-tn','lawsome-kl','kaveri-cbe'));
insert into public.lead_events (workspace_id, lead_id, anon_id, event_name, path, occurred_at)
select l.workspace_id, l.id, 'anon-' || left(md5(l.id::text), 16), 'tour_play', '/demo', l.created_at + interval '2 minutes'
  from public.leads l where l.is_synthetic and abs(hashtext(l.id::text)) % 4 = 0
   and l.workspace_id in (select id from public.workspaces where slug in ('lawsome-tn','lawsome-kl','kaveri-cbe'));

insert into public.lead_events (workspace_id, anon_id, event_name, utm, path, occurred_at)
select w.id, 'anon-v' || w.slug || '-' || d::date || '-' || v, ev.name,
       case when v % 4 = 0 then '{"source":"google","medium":"cpc","campaign":"gads_practice_sw"}'::jsonb
            when v % 4 = 1 then '{"source":"linkedin","medium":"paid_social"}'::jsonb else '{}'::jsonb end,
       (array['/','/pricing','/ask-nidhi','/ecourts','/demo'])[1 + v % 5],
       d + make_interval(hours => 8 + v % 12, mins => (v * 13) % 60)
  from public.workspaces w
  cross join lateral generate_series(current_date - 89, current_date - 1, interval '1 day') d
  cross join lateral generate_series(1, case w.slug when 'lawsome-tn' then 22 + abs(hashtext(w.slug || d::text)) % 26
                                                   else 3 + abs(hashtext(w.slug || d::text)) % 5 end) v
  cross join lateral (select 'page_view' as name
                      union all select 'cta_click' where v % 3 = 0
                      union all select 'form_start' where v % 9 = 0
                      union all select 'pricing_view' where v % 5 = 1) ev
 where w.slug in ('lawsome-tn','lawsome-kl','kaveri-cbe');

-- ---------- deals (25 in Tamil Nadu, a few elsewhere) ----------
create temp table seed_deals on commit drop as
select * from (
select l.id as lead_id, l.workspace_id, l.account_id, l.firm_name, l.created_at, w.slug,
       row_number() over (partition by l.workspace_id order by abs(hashtext('deal' || l.id::text))) as r
  from public.leads l join public.workspaces w on w.id = l.workspace_id
 where l.is_synthetic and l.status in ('qualified','converted','nurturing')
   and w.slug in ('lawsome-tn','lawsome-kl','kaveri-cbe')
) x where (slug = 'lawsome-tn' and r <= 25) or (slug <> 'lawsome-tn' and r <= 3);

insert into public.deals (id, workspace_id, name, account_id, lead_id, stage_id, stage_entered_at, value_inr, seats, plan,
                          expected_close_on, next_step, next_step_at, objections, lost_reason, competitor, won_at,
                          is_synthetic, created_at)
select md5('deal-' || d.lead_id)::uuid, d.workspace_id,
       d.firm_name || ' — ' || initcap(x.plan) || ' plan, ' || x.seats || ' seats',
       d.account_id, d.lead_id, s.id,
       d.created_at + make_interval(days => 3 + d.r::int % 12),
       x.seats * x.per_seat, x.seats, x.plan,
       current_date + (d.r::int * 3) % 45 - 5,
       case when x.stage not in ('won','lost') then (array['Send proposal','Schedule demo','Partner sign-off call','Share security note','Trial review'])[1 + d.r::int % 5] end,
       case when x.stage not in ('won','lost') then now() + make_interval(days => d.r::int % 8) end,
       case when d.r % 3 = 0 then '{price}'::text[] when d.r % 5 = 0 then '{ai_accuracy,data_security}'::text[]
            when d.r % 7 = 0 then '{ecourts_reliability}'::text[] else '{}'::text[] end,
       case when x.stage = 'lost' then (array['price','competitor','no_decision','in_house_excel'])[1 + d.r::int % 4] end,
       case when x.stage = 'lost' and d.r % 2 = 0 then 'Generic case diary app' end,
       case when x.stage = 'won' then d.created_at + make_interval(days => 18 + d.r::int % 20) end,
       true, d.created_at + interval '2 days'
  from seed_deals d
  cross join lateral (select
       case when d.slug <> 'lawsome-tn' then (array['discovery','demo_scheduled','proposal'])[d.r]
            else (array['won','won','won','won','won','lost','lost','lost','lost','negotiation','negotiation','negotiation',
                        'proposal','proposal','proposal','proposal','demo_done','demo_done','demo_done','demo_done',
                        'demo_scheduled','demo_scheduled','demo_scheduled','discovery','discovery'])[d.r] end as stage,
       (array[3, 5, 8, 12, 4, 18, 6, 25, 9, 40, 7, 15, 10])[1 + d.r::int % 13] as seats,
       (array[14400, 17400, 21600, 28800, 16800, 36000])[1 + (d.r::int * 7) % 6] as per_seat,
       case when (array[3, 5, 8, 12, 4, 18, 6, 25, 9, 40, 7, 15, 10])[1 + d.r::int % 13] >= 20 then 'enterprise'
            when (array[3, 5, 8, 12, 4, 18, 6, 25, 9, 40, 7, 15, 10])[1 + d.r::int % 13] >= 8 then 'chambers'
            else 'practice' end as plan) x
  join public.pipeline_stages s on s.workspace_id = d.workspace_id and s.key = x.stage;

-- won deals: the firm becomes a customer
update public.accounts a set customer_status = 'customer'
  from public.deals d where d.account_id = a.id and d.won_at is not null and d.is_synthetic;

-- ---------- activities ----------
insert into public.activities (workspace_id, kind, lead_id, account_id, deal_id, direction, outcome, meeting_type,
                               scheduled_at, duration_mins, subject, body, done_at, source, created_at)
select l.workspace_id, a.kind, l.id, l.account_id, (select d.id from public.deals d where d.lead_id = l.id),
       a.direction, a.outcome, a.meeting_type,
       case when a.kind = 'meeting' then l.first_response_at + interval '3 days' end,
       case when a.kind = 'call' then 4 + abs(hashtext(l.id::text)) % 14 when a.kind = 'meeting' then 40 end,
       a.subject, a.body,
       case when a.kind = 'meeting' and l.first_response_at + interval '3 days' > now() then null
            else l.first_response_at + a.offs end,
       'simulated', l.first_response_at + a.offs
  from public.leads l
  cross join lateral (values
     ('call'::public.activity_kind, 'outbound'::public.msg_direction, 'connected', null::text, 'Intro call',
      'Discussed hearing-day workflow and cause-list tracking. Interested in a demo for partners.', interval '0 minutes', 0),
     ('whatsapp', 'outbound', null, null, 'Demo link shared', 'Shared demo slot options and the Ask Nidhi overview.', interval '1 day', 1),
     ('email', 'outbound', null, null, 'Follow-up: pricing and DPDP note', 'Sent pricing placeholder and the data-security note.', interval '2 days', 2),
     ('meeting', 'outbound', null, 'demo', 'Product demo', 'Demo of matter diary, eCourts sync and team calendar.', interval '3 days', 3),
     ('note', null, null, null, 'Internal note', 'Partner prefers Tamil-language WhatsApp updates.', interval '4 days', 4)
  ) a(kind, direction, outcome, meeting_type, subject, body, offs, step)
 where l.is_synthetic and l.first_response_at is not null
   and a.step <= case l.status when 'contacted' then 1 when 'nurturing' then 2 when 'disqualified' then 0
                               when 'qualified' then 3 when 'converted' then 4 else 0 end
   and l.workspace_id in (select id from public.workspaces where slug in ('lawsome-tn','lawsome-kl','kaveri-cbe'));

-- ---------- tasks ----------
insert into public.tasks (workspace_id, lead_id, deal_id, title, kind, priority, due_at, status, completed_at, created_at)
select l.workspace_id, l.id, (select d.id from public.deals d where d.lead_id = l.id),
       t.title || ': ' || l.firm_name, t.kind, 1 + abs(hashtext('p' || l.id::text)) % 3,
       now() + make_interval(days => (abs(hashtext('t' || l.id::text)) % 11) - 4, hours => abs(hashtext(l.id::text)) % 8),
       case when abs(hashtext('s' || l.id::text)) % 4 = 0 then 'done' else 'open' end::public.task_status,
       case when abs(hashtext('s' || l.id::text)) % 4 = 0 then now() - interval '1 day' end,
       l.created_at + interval '1 day'
  from public.leads l
  cross join lateral (select (array['Call back','Send proposal','Share demo recording','WhatsApp follow-up','Prepare demo'])[1 + abs(hashtext('k' || l.id::text)) % 5] as title,
                             (array['call','proposal','email','whatsapp','demo_prep'])[1 + abs(hashtext('k' || l.id::text)) % 5] as kind) t
 where l.is_synthetic and l.status in ('new','contacted','qualified','nurturing')
   and l.workspace_id in (select id from public.workspaces where slug in ('lawsome-tn','lawsome-kl','kaveri-cbe'))
   and abs(hashtext('task' || l.id::text)) % 5 < 3;

-- ---------- GA4 (mock feed, 90 days) ----------
insert into public.ga4_daily (workspace_id, day, channel_group, source_medium, device_category, sessions, engaged_sessions,
                              total_users, new_users, avg_engagement_secs, key_events, source)
select w.id, d::date, c.grp, c.sm, dev.name, x.sessions, round(x.sessions * c.eng), round(x.sessions * 0.86),
       round(x.sessions * 0.71), c.secs * dev.f, round(x.sessions * c.kr), 'mock'
  from public.workspaces w
  cross join generate_series(current_date - 90, current_date - 1, interval '1 day') d
  cross join (values ('Organic Search','google / organic',0.61,74.0,0.010,42),('Paid Search','google / cpc',0.55,61.0,0.024,38),
                     ('Paid Social','linkedin / paid_social',0.43,38.0,0.012,30),('Paid Social','meta / paid_social',0.38,29.0,0.009,46),
                     ('Email','email / email',0.66,88.0,0.016,12),('Direct','(direct) / (none)',0.58,70.0,0.008,26),
                     ('Referral','referral / referral',0.69,96.0,0.020,6),('Organic Social','whatsapp / message',0.52,47.0,0.011,10)) c(grp, sm, eng, secs, kr, base)
  cross join (values ('mobile', 0.68, 0.85), ('desktop', 0.32, 1.25)) dev(name, share, f)
  cross join lateral (select greatest(1, round(c.base * dev.share * case w.slug when 'lawsome-tn' then 1 else 0.12 end
                              * (85 + abs(hashtext(w.slug || c.sm || d::text)) % 30) / 100.0
                              * case when extract(isodow from d) = 7 then 0.55 else 1 end)) as sessions) x
 where w.slug in ('lawsome-tn','lawsome-kl','kaveri-cbe');

-- ---------- integrations: showcase cards fed by sample data ----------
update public.integrations i
   set settings = jsonb_build_object('sample_feed', true),
       last_sync_at = now() - make_interval(mins => 20 + abs(hashtext(i.provider)) % 600)
  from public.workspaces w
 where w.id = i.workspace_id and w.slug in ('lawsome-tn','lawsome-kl','kaveri-cbe')
   and i.provider in ('ga4','linkedin','meta_ads','google_ads','mailchimp','whatsapp','zoho_crm','calendly');
update public.integrations i set status = 'needs_attention', last_error = 'Sample: token expires in 5 days (re-auth needed)'
  from public.workspaces w where w.id = i.workspace_id and w.slug = 'lawsome-tn' and i.provider = 'meta_ads';
update public.integrations i set status = 'connected', last_sync_at = now() - interval '7 minutes'
  from public.workspaces w where w.id = i.workspace_id and w.slug in ('lawsome-tn','lawsome-kl','kaveri-cbe') and i.provider = 'landing';

insert into public.integration_field_maps (workspace_id, integration_id, external_object, external_field, local_table,
                                           local_column, direction, transform, conflict_owner, sample_value)
select i.workspace_id, i.id, m.obj, m.fld, m.tbl, m.col, m.dir, m.tf, m.co, m.sample
  from public.integrations i join public.workspaces w on w.id = i.workspace_id and w.slug = 'lawsome-tn'
  join (values ('zoho_crm','Leads','Last_Name','leads','full_name','both',null,'crm','Subramanian'),
               ('zoho_crm','Leads','Lead_Source','leads','first_touch_channel','in','channel_map','external','LinkedIn'),
               ('zoho_crm','Deals','Stage','deals','stage_id','both','stage_key_map','crm','Proposal/Price Quote'),
               ('zoho_crm','Deals','Amount','deals','value_inr','both',null,'crm','172800'),
               ('zoho_crm','Accounts','Account_Name','accounts','name','both',null,'crm','Rockfort Chambers'),
               ('hubspot','contacts','phone','contacts','phone','in','e164_phone','external','+91 00000 00000'),
               ('razorpay','payment','amount','deals','value_inr','in','inr_paise_to_rupees','external','17280000')
       ) m(provider, obj, fld, tbl, col, dir, tf, co, sample) on m.provider = i.provider;

insert into public.sync_runs (workspace_id, integration_id, kind, started_at, finished_at, status, rows_in, rows_out, rows_rejected, error)
select i.workspace_id, i.id, r.kind, now() - r.ago, now() - r.ago + interval '42 seconds', r.status, r.rin, r.rout, r.rej, r.err
  from public.integrations i join public.workspaces w on w.id = i.workspace_id and w.slug = 'lawsome-tn'
  join (values ('ga4','poll',interval '3 hours','success'::public.sync_status,1240,0,0,null),
               ('ga4','poll',interval '27 hours','success',1188,0,0,null),
               ('linkedin','csv',interval '2 days','partial',214,0,6,'6 rows rejected: missing campaign id (sample)'),
               ('meta_ads','poll',interval '5 hours','failed',0,0,0,'Sample: OAuth token near expiry'),
               ('meta_ads','poll',interval '29 hours','success',96,0,0,null),
               ('google_ads','poll',interval '4 hours','success',88,0,0,null),
               ('mailchimp','webhook',interval '12 hours','success',37,0,0,null),
               ('landing','webhook',interval '7 minutes','success',1,0,0,null),
               ('zoho_crm','outbound',interval '6 hours','success',0,18,0,null),
               ('whatsapp','webhook',interval '9 hours','success',22,0,0,null),
               ('csv','csv',interval '6 days','success',58,0,2,null),
               ('calendly','webhook',interval '1 day','success',3,0,0,null)) r(provider, kind, ago, status, rin, rout, rej, err)
    on r.provider = i.provider;

-- ---------- backups: heartbeat rows (project-wide, workspace_id null) ----------
insert into public.backup_checks (workspace_id, checked_at, check_kind, status, backup_taken_at, size_bytes, retention_days,
                                  pitr_enabled, location, row_counts, detail)
select null::uuid, (current_date - k) + time '03:30', 'supabase_daily', 'success', (current_date - k) + time '02:10',
       null, 7, false, 'demo:supabase-managed', null, 'Supabase daily backup observed (no official status API; recorded by backup job)'
  from generate_series(0, 13) k
union all
select null, (current_date - k) + time '02:20', 'logical_dump',
       case when k = 9 then 'failed' else 'success' end::public.backup_status,
       case when k = 9 then null else (current_date - k) + time '02:05' end,
       case when k = 9 then null else 18400000 + (13 - k) * 152000 end, 30, false, 'demo:offsite:crm-dumps',
       case when k = 9 then null else jsonb_build_object('leads', 145 - k, 'deals', 31, 'activities', 260 - k, 'lead_events', 9000 - k * 40) end,
       case when k = 9 then 'pg_dump exited 1: connection reset (synthetic incident)' else 'nightly pg_dump, gzip, encrypted' end
  from generate_series(0, 13) k
union all
select null, current_date - 41 + time '11:00', 'restore_drill', 'success', current_date - 42 + time '02:05', 17900000, null, null,
       'demo:scratch-db', null, 'Quarterly restore drill: row counts matched (synthetic)'
union all
select null, now() - interval '10 minutes', 'heartbeat', 'success', null, null, null, null, 'demo:uptime', null, '/api/health ok';

insert into public.backup_alert_rules (workspace_id, name, check_kind, condition, max_age_hours, max_size_drop_pct, notify_to)
values (null, 'Nightly dump missing', 'logical_dump', 'no success in 26h', 26, null, 'demo:slack #ops'),
       (null, 'Dump size drop', 'logical_dump', 'size dropped more than 20% vs 7-day median', null, 20, 'demo:slack #ops'),
       (null, 'Restore drill overdue', 'restore_drill', 'no success in 100 days', 2400, null, 'demo:email owner');


commit;
