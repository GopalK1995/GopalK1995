-- 0013 authorization core (BUILD-PLAN 1.3 and 2.1, CONTRACTS C3): permission catalogue, roles + role_permissions (RBAC),
-- memberships.role_id/attributes/valid_until (ABAC attributes), teams + relationship_tuples (ReBAC), org_admin_policies
-- (what the platform super admin lets an org's admins do), platform_admins.platform_role, and the SQL evaluators in
-- schema authz (ws_with, ws_with_member, team_user_ids, shared_ids, attr, cond_ok, check, explain, my_grants).
-- Forward-only and idempotent: create ... if not exists, create or replace, guarded DO blocks, upserts.
-- The six system roles are generated from src/lib/authz/catalog/system-roles.ts by scripts/gen-authz-seed.mjs and
-- reproduce roles.ts CAN + PAGE_ACCESS exactly. The existing role/policy model (0004-0012) is NOT changed here:
-- memberships.role (enum) stays authoritative for today's policies; 0016 switches policies to authz.*.
begin;

create schema if not exists authz;
revoke all on schema authz from public, anon;
grant usage on schema authz to authenticated, service_role;
alter default privileges in schema authz revoke execute on functions from public, anon;

-- ---------- 1. Pure helpers (no table access) ----------
create or replace function authz.scope_rank(p_scope text) returns int
language sql immutable parallel safe set search_path = '' as $$
  select case p_scope when 'none' then 0 when 'own' then 1 when 'team' then 2 when 'all' then 3 else 99 end
$$;

-- One clause of the conditions grammar (CONTRACTS C3.3). Anything unknown is invalid.
create or replace function authz.valid_clause(c jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_op text; v_f text; v_val jsonb;
begin
  if c is null or jsonb_typeof(c) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(c) k where k not in ('field', 'op', 'value', 'tz')) then return false; end if;
  if jsonb_typeof(c->'field') is distinct from 'string' or jsonb_typeof(c->'op') is distinct from 'string' then return false; end if;
  v_f := c->>'field'; v_op := c->>'op'; v_val := c->'value';
  if v_f !~ '^(now|record\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*|principal\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*)$' then return false; end if;
  if v_op not in ('eq', 'neq', 'in', 'nin', 'contains', 'gte', 'lte', 'between_hours', 'is_true') then return false; end if;
  if c ? 'tz' and (v_op <> 'between_hours' or jsonb_typeof(c->'tz') <> 'string') then return false; end if;
  if v_op = 'is_true' then return true; end if;
  if v_val is null or jsonb_typeof(v_val) = 'null' then return false; end if;
  if v_op = 'between_hours' then
    return v_f = 'now' and jsonb_typeof(v_val) = 'array' and jsonb_array_length(v_val) = 2
       and not exists (select 1 from jsonb_array_elements(v_val) e
                        where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
  if v_op in ('in', 'nin') then
    return jsonb_typeof(v_val) = 'array' or (jsonb_typeof(v_val) = 'string' and (v_val #>> '{}') like '@principal.%');
  end if;
  return jsonb_typeof(v_val) in ('string', 'number', 'boolean');
end $$;

-- Top level {} (no condition), or exactly one of all/any with 1..10 clauses; one level of nesting; at most 10 clauses overall.
create or replace function authz.valid_conditions(c jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_arr jsonb; el jsonb; sub jsonb; v_n int := 0; v_k text;
begin
  if c is null then return false; end if;
  if jsonb_typeof(c) <> 'object' then return false; end if;
  if c = '{}'::jsonb then return true; end if;
  if (select count(*) from jsonb_object_keys(c)) <> 1 then return false; end if;
  v_k := (select k from jsonb_object_keys(c) k);
  if v_k not in ('all', 'any') then return false; end if;
  v_arr := c->v_k;
  if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) not between 1 and 10 then return false; end if;
  for el in select value from jsonb_array_elements(v_arr) loop
    if jsonb_typeof(el) = 'object' and (el ? 'all' or el ? 'any') then
      if (select count(*) from jsonb_object_keys(el)) <> 1 then return false; end if;
      sub := coalesce(el->'all', el->'any');
      if jsonb_typeof(sub) <> 'array' or jsonb_array_length(sub) not between 1 and 10 then return false; end if;
      if exists (select 1 from jsonb_array_elements(sub) s where not authz.valid_clause(s)) then return false; end if;
      v_n := v_n + jsonb_array_length(sub);
    else
      if not authz.valid_clause(el) then return false; end if;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n <= 10;
end $$;

-- Evaluate a conditions document against a record and a principal document. Unknown operator/prefix, bad types,
-- missing fields, depth > 2: false (fail closed). The twin of src/lib/authz/conditions.ts.
create or replace function authz.eval_node(p_node jsonb, p_record jsonb, p_principal jsonb, p_now timestamptz, p_depth int default 0)
returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_arr jsonb; el jsonb; v_op text; v_f text; v_field jsonb; v_val jsonb; v_tz text;
  v_from time; v_to time; v_t time;
begin
  if p_node is null or jsonb_typeof(p_node) <> 'object' or p_depth > 2 then return false; end if;
  if p_node = '{}'::jsonb then return p_depth = 0; end if;
  if p_node ? 'all' or p_node ? 'any' then
    if p_depth >= 2 or (select count(*) from jsonb_object_keys(p_node)) <> 1 then return false; end if;
    v_arr := coalesce(p_node->'all', p_node->'any');
    if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) not between 1 and 10 then return false; end if;
    if p_node ? 'all' then
      for el in select value from jsonb_array_elements(v_arr) loop
        if not authz.eval_node(el, p_record, p_principal, p_now, p_depth + 1) then return false; end if;
      end loop;
      return true;
    end if;
    for el in select value from jsonb_array_elements(v_arr) loop
      if authz.eval_node(el, p_record, p_principal, p_now, p_depth + 1) then return true; end if;
    end loop;
    return false;
  end if;
  if not authz.valid_clause(p_node) then return false; end if;
  v_op := p_node->>'op'; v_f := p_node->>'field'; v_val := p_node->'value';
  if v_f = 'now' then v_field := to_jsonb(p_now);
  elsif v_f like 'record.%' then v_field := p_record #> string_to_array(substr(v_f, 8), '.');
  else v_field := p_principal #> string_to_array(substr(v_f, 11), '.');
  end if;
  if v_field is null or jsonb_typeof(v_field) = 'null' then return false; end if;
  if jsonb_typeof(v_val) = 'string' and (v_val #>> '{}') like '@principal.%' then
    v_val := p_principal #> string_to_array(substr(v_val #>> '{}', 12), '.');
    if v_val is null or jsonb_typeof(v_val) = 'null' then return false; end if;
  end if;
  case v_op
    when 'eq' then return v_field = v_val;
    when 'neq' then return v_field <> v_val;
    when 'in' then return jsonb_typeof(v_val) = 'array' and v_val @> jsonb_build_array(v_field);
    when 'nin' then return jsonb_typeof(v_val) = 'array' and not (v_val @> jsonb_build_array(v_field));
    when 'contains' then
      if jsonb_typeof(v_field) = 'array' then return v_field @> jsonb_build_array(v_val); end if;
      if jsonb_typeof(v_field) = 'string' and jsonb_typeof(v_val) = 'string' then
        return strpos(v_field #>> '{}', v_val #>> '{}') > 0;
      end if;
      return false;
    when 'gte', 'lte' then
      if jsonb_typeof(v_field) = 'number' and jsonb_typeof(v_val) = 'number' then
        return case when v_op = 'gte' then (v_field #>> '{}')::numeric >= (v_val #>> '{}')::numeric
                    else (v_field #>> '{}')::numeric <= (v_val #>> '{}')::numeric end;
      end if;
      if jsonb_typeof(v_field) = 'string' and jsonb_typeof(v_val) = 'string' then
        return case when v_op = 'gte' then (v_field #>> '{}') >= (v_val #>> '{}') else (v_field #>> '{}') <= (v_val #>> '{}') end;
      end if;
      return false;
    when 'is_true' then return v_field = 'true'::jsonb;
    when 'between_hours' then
      v_tz := coalesce(p_node->>'tz', 'Asia/Kolkata');
      v_from := (v_val->>0)::time; v_to := (v_val->>1)::time;
      v_t := (p_now at time zone v_tz)::time;
      if v_from <= v_to then return v_t >= v_from and v_t <= v_to; end if;
      return v_t >= v_from or v_t <= v_to;   -- overnight window
    else return false;
  end case;
exception when others then
  return false;
end $$;

-- ---------- 2. Tables ----------
create table if not exists public.permissions (
  key             text primary key check (key ~ '^[a-z][a-z0-9_.:-]*$'),
  resource        text not null,
  action          text not null,
  description     text not null default '',
  is_pii          boolean not null default false,
  platform_only   boolean not null default false,
  support_blocked boolean not null default false
);

create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete cascade,   -- null = system template
  key         text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name        text not null check (length(name) between 2 and 60),
  description text not null default '',
  base_role   public.app_role not null,   -- keeps nav defaults (HOME_FOR, mobile nav) and today's policies working for custom roles
  is_system   boolean not null default false,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint roles_tenant_key_unique unique nulls not distinct (tenant_id, key),
  constraint roles_system_has_no_tenant check (is_system = (tenant_id is null))
);
create index if not exists roles_tenant on public.roles (tenant_id);

create table if not exists public.role_permissions (
  role_id        uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on update cascade on delete cascade,
  scope          text not null check (scope in ('all', 'team', 'own', 'none')),
  conditions     jsonb not null default '{}' check (authz.valid_conditions(conditions)),
  field_mask     text[] not null default '{}',
  primary key (role_id, permission_key)
);
create index if not exists role_permissions_perm on public.role_permissions (permission_key);

alter table public.memberships
  add column if not exists role_id     uuid references public.roles(id),
  add column if not exists attributes  jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object'),   -- regions, districts, languages, verticals
  add column if not exists valid_until timestamptz;
create index if not exists memberships_role_id on public.memberships (role_id);
create index if not exists memberships_user_active on public.memberships (user_id, workspace_id) where is_active;

create table if not exists public.teams (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  name           text not null check (length(name) between 2 and 80),
  parent_team_id uuid references public.teams(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists teams_ws on public.teams (workspace_id, created_at desc);
create index if not exists teams_parent on public.teams (parent_team_id);

create table if not exists public.team_members (
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  is_manager boolean not null default false,
  primary key (team_id, user_id)
);
create index if not exists team_members_user on public.team_members (user_id);

create table if not exists public.relationship_tuples (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  object_type  text not null,
  object_id    uuid not null,
  relation     text not null check (relation in ('owner', 'editor', 'viewer', 'follower')),
  subject_type text not null check (subject_type in ('user', 'team', 'role')),
  subject_id   uuid not null,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  constraint relationship_tuples_unique unique (object_type, object_id, relation, subject_type, subject_id)
);
create index if not exists relationship_tuples_subject on public.relationship_tuples (subject_type, subject_id);
create index if not exists relationship_tuples_ws on public.relationship_tuples (workspace_id, created_at desc);

-- null in an array column or a cap = no restriction from the platform
create table if not exists public.org_admin_policies (
  tenant_id            uuid primary key references public.tenants(id) on delete cascade,
  allow_custom_roles   boolean not null default true,
  allow_custom_objects boolean not null default true,
  allow_api_keys       boolean not null default true,
  allow_webhooks       boolean not null default true,
  allow_byok           boolean not null default false,
  allow_connectors     text[],
  allowed_modules      text[],
  max_seats            int check (max_seats is null or max_seats >= 0),
  max_workspaces       int check (max_workspaces is null or max_workspaces >= 0),
  max_custom_fields    int check (max_custom_fields is null or max_custom_fields >= 0),
  updated_by           uuid,
  updated_at           timestamptz not null default now()
);

alter table public.platform_admins
  add column if not exists platform_role text not null default 'super_admin'
    check (platform_role in ('super_admin', 'support', 'billing', 'readonly'));

-- ---------- 3. Row resolution helpers (security definer, used by the evaluators) ----------
-- object_type -> table. 0017 may extend this for custom objects with create or replace.
create or replace function authz.object_table(p_type text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case p_type
    when 'lead' then 'leads' when 'deal' then 'deals' when 'account' then 'accounts' when 'contact' then 'contacts'
    when 'task' then 'tasks' when 'campaign' then 'campaigns' when 'conversation' then 'conversations' end
$$;

-- permission that governs an object type; unmapped types are governed by records.share
create or replace function authz.object_perm(p_type text, p_mode text default 'read') returns text
language sql immutable parallel safe set search_path = '' as $$
  select case when authz.object_table(p_type) is null then 'records.share'
              when p_type = 'conversation' then case when p_mode = 'read' then 'inbox.read' else 'inbox.reply' end
              else (authz.object_table(p_type)) || '.' || case when p_mode = 'read' then 'read' else 'write' end end
$$;

create or replace function authz.object_row(p_type text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_tbl text := authz.object_table(p_type); v_row jsonb;
begin
  if v_tbl is null or p_id is null then return null; end if;
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_tbl) into v_row using p_id;
  return v_row;
end $$;

-- ---------- 4. SQL evaluators (CONTRACTS C3.4) ----------
-- Workspaces where the caller holds p_perm at >= p_min_scope. A live support session counts as the system viewer
-- (read_only: read permissions only) or owner (read_write: minus support_blocked permissions).
create or replace function authz.ws_with(p_perm text, p_min_scope text default 'own') returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id
    from public.memberships m
    join public.role_permissions rp on rp.role_id = m.role_id and rp.permission_key = p_perm
   where m.user_id = (select auth.uid()) and m.is_active and (m.valid_until is null or m.valid_until > now())
     and authz.scope_rank(rp.scope) > 0 and authz.scope_rank(rp.scope) >= authz.scope_rank(p_min_scope)
  union
  select s.workspace_id
    from public.support_sessions s
    join public.roles r on r.tenant_id is null and r.key = (case s.mode when 'read_write' then 'owner' else 'viewer' end)
    join public.role_permissions rp on rp.role_id = r.id and rp.permission_key = p_perm
    join public.permissions pm on pm.key = rp.permission_key
   where s.admin_id = (select auth.uid()) and s.ended_at is null and now() < s.expires_at
     and authz.scope_rank(rp.scope) > 0 and authz.scope_rank(rp.scope) >= authz.scope_rank(p_min_scope)
     and (case s.mode when 'read_write' then not pm.support_blocked else pm.action = 'read' end)
     and public.is_platform_admin()
$$;

-- Same, real memberships only (never during support): export, integrations, webhooks, API keys, member management.
create or replace function authz.ws_with_member(p_perm text, p_min_scope text default 'own') returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.workspace_id
    from public.memberships m
    join public.role_permissions rp on rp.role_id = m.role_id and rp.permission_key = p_perm
   where m.user_id = (select auth.uid()) and m.is_active and (m.valid_until is null or m.valid_until > now())
     and authz.scope_rank(rp.scope) > 0 and authz.scope_rank(rp.scope) >= authz.scope_rank(p_min_scope)
$$;

-- Self + members of my teams + members of teams under teams I manage (recursive via parent_team_id), in p_ws.
create or replace function authz.team_user_ids(p_ws uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive mine as (
    select tm.team_id, tm.is_manager
      from public.team_members tm join public.teams t on t.id = tm.team_id
     where tm.user_id = (select auth.uid()) and t.workspace_id = p_ws),
  down(team_id) as (
    select team_id from mine where is_manager
    union
    select t.id from public.teams t join down d on t.parent_team_id = d.team_id where t.workspace_id = p_ws)
  select (select auth.uid())
  union
  select tm.user_id from public.team_members tm where tm.team_id in (select team_id from mine)
  union
  select tm.user_id from public.team_members tm where tm.team_id in (select team_id from down)
$$;

-- Object ids of p_type shared to me / my teams / my role at relation >= p_min_rel, not expired, in workspaces I belong to.
create or replace function authz.shared_ids(p_type text, p_min_rel text default 'viewer') returns setof uuid
language sql stable security definer set search_path = '' as $$
  select rt.object_id
    from public.relationship_tuples rt
   where rt.object_type = p_type
     and (rt.expires_at is null or rt.expires_at > now())
     and (case rt.relation when 'owner' then 3 when 'editor' then 2 when 'viewer' then 1 else 0 end)
         >= (case p_min_rel when 'owner' then 3 when 'editor' then 2 when 'viewer' then 1 else 99 end)
     and rt.workspace_id in (select public.member_ws_ids())
     and (   (rt.subject_type = 'user' and rt.subject_id = (select auth.uid()))
          or (rt.subject_type = 'team' and rt.subject_id in (select tm.team_id from public.team_members tm where tm.user_id = (select auth.uid())))
          or (rt.subject_type = 'role' and rt.subject_id in (select m.role_id from public.memberships m
                                                              where m.user_id = (select auth.uid()) and m.workspace_id = rt.workspace_id and m.is_active)))
$$;

create or replace function authz.attr(p_ws uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.attributes from public.memberships m
                    where m.user_id = (select auth.uid()) and m.workspace_id = p_ws and m.is_active), '{}'::jsonb)
$$;

-- The caller's effective grant rows in p_ws (member role, or support-session overlay).
create or replace function authz.grants(p_ws uuid, p_member_only boolean default false)
returns table (permission_key text, scope text, conditions jsonb, field_mask text[], via_support boolean)
language sql stable security definer set search_path = '' as $$
  select rp.permission_key, rp.scope, rp.conditions, rp.field_mask, false
    from public.memberships m
    join public.role_permissions rp on rp.role_id = m.role_id
   where m.user_id = (select auth.uid()) and m.workspace_id = p_ws and m.is_active
     and (m.valid_until is null or m.valid_until > now()) and rp.scope <> 'none'
  union all
  select rp.permission_key, rp.scope, rp.conditions, rp.field_mask, true
    from public.support_sessions s
    join public.roles r on r.tenant_id is null and r.key = (case s.mode when 'read_write' then 'owner' else 'viewer' end)
    join public.role_permissions rp on rp.role_id = r.id and rp.scope <> 'none'
    join public.permissions pm on pm.key = rp.permission_key
   where not p_member_only
     and s.admin_id = (select auth.uid()) and s.workspace_id = p_ws and s.ended_at is null and now() < s.expires_at
     and (case s.mode when 'read_write' then not pm.support_blocked else pm.action = 'read' end)
     and public.is_platform_admin()
$$;

-- Full decision. Order (first deny wins, default deny): authenticate, org state, grant lookup (RBAC, support overlay baked in),
-- record scope (ReBAC: all / team / own incl. the unassigned-in-territory arm / shared tuples), conditions (ABAC).
create or replace function authz.explain(p_ws uuid, p_perm text, p_object_type text default null, p_object_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text; v_g record; v_rec jsonb; v_is_read boolean := right(p_perm, 5) = '.read';
  v_scope_ok boolean := false; v_shared boolean := false; v_has_obj boolean := p_object_type is not null and p_object_id is not null;
  v_owner uuid; v_asg uuid; v_attrs jsonb;
  v_principal jsonb;
  v_member boolean;
begin
  if v_uid is null then
    return jsonb_build_object('allow', false, 'step', 1, 'reason', 'unauthenticated');
  end if;
  select t.status into v_status from public.workspaces w join public.tenants t on t.id = w.tenant_id where w.id = p_ws;
  if v_status is null then
    return jsonb_build_object('allow', false, 'step', 2, 'reason', 'unknown_workspace');
  end if;
  if v_status <> 'active' and not v_is_read then
    return jsonb_build_object('allow', false, 'step', 2, 'reason', 'tenant_' || v_status);
  end if;
  select * into v_g from authz.grants(p_ws) g where g.permission_key = p_perm
    order by authz.scope_rank(g.scope) desc limit 1;
  v_member := p_ws in (select public.member_ws_ids());
  if v_has_obj then
    v_rec := authz.object_row(p_object_type, p_object_id);
    if v_rec is null or (v_rec->>'workspace_id')::uuid is distinct from p_ws then
      return jsonb_build_object('allow', false, 'step', 6, 'reason', 'object_not_found');
    end if;
    if v_member and p_object_id in (select authz.shared_ids(p_object_type, case when v_is_read then 'viewer' else 'editor' end)) then
      v_shared := true;
    end if;
  end if;
  if v_g.permission_key is null and not v_shared then
    return jsonb_build_object('allow', false, 'step', case when v_member then 5 else 4 end,
                              'reason', case when v_member then 'no_grant' else 'not_a_member' end);
  end if;
  v_attrs := authz.attr(p_ws);
  v_principal := jsonb_build_object('id', v_uid, 'attrs', v_attrs);
  if v_g.permission_key is not null then
    if v_has_obj then
      v_owner := nullif(v_rec->>'owner_id', '')::uuid;
      v_asg := nullif(v_rec->>'assignee_id', '')::uuid;
      v_scope_ok := case v_g.scope
        when 'all' then true
        when 'team' then (v_owner in (select authz.team_user_ids(p_ws)) or v_asg in (select authz.team_user_ids(p_ws)))
        when 'own' then (v_owner = v_uid or v_asg = v_uid
                         or (p_object_type = 'lead' and v_is_read and v_owner is null
                             and v_attrs->'districts' ? (v_rec->>'district')))
        else false end;
      v_scope_ok := coalesce(v_scope_ok, false);
      if v_g.scope = 'team' and not v_scope_ok then
        v_scope_ok := coalesce(v_owner = v_uid or v_asg = v_uid, false);
      end if;
    else
      v_scope_ok := true;
    end if;
  end if;
  if not v_scope_ok and not v_shared then
    return jsonb_build_object('allow', false, 'step', 6, 'reason', 'scope_' || v_g.scope || '_no_match',
                              'grant', jsonb_build_object('scope', v_g.scope));
  end if;
  if v_scope_ok and v_g.permission_key is not null
     and not authz.eval_node(v_g.conditions, coalesce(v_rec, '{}'::jsonb), v_principal, now()) then
    if not v_shared then
      return jsonb_build_object('allow', false, 'step', 7, 'reason', 'condition_failed',
                                'grant', jsonb_build_object('scope', v_g.scope, 'conditions', v_g.conditions));
    end if;
  end if;
  return jsonb_build_object('allow', true, 'step', case when v_scope_ok then 8 else 6 end,
                            'reason', case when v_scope_ok then 'granted' else 'shared' end,
                            'grant', case when v_g.permission_key is null then null
                                          else jsonb_build_object('scope', v_g.scope, 'via_support', v_g.via_support) end,
                            'matched', case when v_shared then 'relationship_tuple' else 'role_permission' end);
end $$;

create or replace function authz.check(p_ws uuid, p_perm text, p_object_type text default null, p_object_id uuid default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((authz.explain(p_ws, p_perm, p_object_type, p_object_id)->>'allow')::boolean, false)
$$;

-- Evaluate the caller's conditions for p_perm in p_ws against p_record. No grant = false; no conditions = true.
create or replace function authz.cond_ok(p_ws uuid, p_perm text, p_record jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_g record;
begin
  select * into v_g from authz.grants(p_ws) g where g.permission_key = p_perm order by authz.scope_rank(g.scope) desc limit 1;
  if v_g.permission_key is null then return false; end if;
  return authz.eval_node(v_g.conditions, coalesce(p_record, '{}'::jsonb),
                         jsonb_build_object('id', (select auth.uid()), 'attrs', authz.attr(p_ws)), now());
end $$;

-- One round trip for the TS principal loader (CONTRACTS C3.4). null when the caller has no access to p_ws.
create or replace function authz.my_grants(p_ws uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_role record; v_ss record; v_t record; v_perms jsonb; v_pol jsonb;
begin
  if v_uid is null then return null; end if;
  select r.id, r.key, r.base_role into v_role
    from public.memberships m join public.roles r on r.id = m.role_id
   where m.user_id = v_uid and m.workspace_id = p_ws and m.is_active and (m.valid_until is null or m.valid_until > now());
  if v_role.id is null then
    select s.id, s.mode, s.expires_at into v_ss from public.support_sessions s
     where s.admin_id = v_uid and s.workspace_id = p_ws and s.ended_at is null and now() < s.expires_at and public.is_platform_admin()
     order by s.started_at desc limit 1;
    if v_ss.id is null then return null; end if;
    select r.id, r.key, r.base_role into v_role from public.roles r
     where r.tenant_id is null and r.key = (case v_ss.mode when 'read_write' then 'owner' else 'viewer' end);
  end if;
  select t.id, t.slug, t.status into v_t from public.workspaces w join public.tenants t on t.id = w.tenant_id where w.id = p_ws;
  select coalesce(jsonb_object_agg(g.permission_key, jsonb_build_object('scope', g.scope, 'conditions', g.conditions,
                                                                      'field_mask', to_jsonb(g.field_mask))), '{}'::jsonb)
    into v_perms from authz.grants(p_ws) g;
  select to_jsonb(p) - 'updated_by' into v_pol from public.org_admin_policies p where p.tenant_id = v_t.id;
  return jsonb_build_object(
    'role', jsonb_build_object('id', v_role.id, 'key', v_role.key, 'base', v_role.base_role),
    'perms', v_perms,
    'team_user_ids', (select coalesce(jsonb_agg(u), '[]'::jsonb) from authz.team_user_ids(p_ws) u),
    'attrs', authz.attr(p_ws),
    'support', case when v_ss.id is null then null
                    else jsonb_build_object('mode', v_ss.mode, 'expires_at', v_ss.expires_at) end,
    'tenant', jsonb_build_object('uuid', v_t.id, 'slug', v_t.slug, 'status', v_t.status, 'trial_ends_at', null),
    'policy', v_pol);
end $$;

-- PostgREST exposes public only: thin wrapper so supabase-js can call rpc('my_grants').
create or replace function public.my_grants(p_ws uuid) returns jsonb
language sql stable security definer set search_path = '' as $$ select authz.my_grants(p_ws) $$;

-- Can the caller manage tenant roles (roles.manage as a real member of a workspace in the tenant, and the platform allows it)?
create or replace function authz.can_manage_roles(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspaces w
                  where w.tenant_id = p_tenant and w.id in (select authz.ws_with_member('roles.manage', 'all')))
     and coalesce((select p.allow_custom_roles from public.org_admin_policies p where p.tenant_id = p_tenant), true)
$$;

-- Does the caller (as a real member of p_ws) hold every permission of p_role at >= scope? (no privilege escalation)
create or replace function authz.role_within_caller(p_ws uuid, p_role uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.role_permissions rp
     where rp.role_id = p_role and rp.scope <> 'none'
       and not exists (select 1 from authz.grants(p_ws, true) g
                        where g.permission_key = rp.permission_key
                          and authz.scope_rank(g.scope) >= authz.scope_rank(rp.scope)))
$$;

-- ---------- 5. Triggers ----------
do $$
declare t text;
begin
  foreach t in array array['teams', 'relationship_tuples'] loop
    execute format('drop trigger if exists a00_%1$s_tenant on public.%1$I', t);
    execute format('create trigger a00_%1$s_tenant before insert or update of workspace_id, tenant_id on public.%1$I
                    for each row execute function public.set_tenant_from_workspace()', t);
  end loop;
end $$;

drop trigger if exists trg_roles_touch on public.roles;
create trigger trg_roles_touch before update on public.roles
  for each row execute function public.set_updated_at();

create or replace function authz.roles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, (select auth.uid()));
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id or new.is_system is distinct from old.is_system then
      raise exception 'tenant and system flag of a role are fixed' using errcode = '42501';
    end if;
    if old.is_system and (select auth.uid()) is not null then
      raise exception 'system roles are read-only' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.is_system and (select auth.uid()) is not null then
    raise exception 'system roles are read-only' using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists trg_roles_guard on public.roles;
create trigger trg_roles_guard before insert or update or delete on public.roles
  for each row execute function authz.roles_guard();

create or replace function authz.role_permissions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_system boolean;
begin
  if tg_op <> 'DELETE' and exists (select 1 from public.permissions p where p.key = new.permission_key and p.platform_only) then
    -- system templates never carry platform_only keys either (the generator does not emit them)
    raise exception 'platform-only permissions cannot be granted to org roles' using errcode = '42501';
  end if;
  if (select auth.uid()) is not null then
    select r.is_system into v_system from public.roles r where r.id = coalesce(new.role_id, old.role_id);
    if coalesce(v_system, false) then raise exception 'system roles are read-only' using errcode = '42501'; end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_role_permissions_guard on public.role_permissions;
create trigger trg_role_permissions_guard before insert or update or delete on public.role_permissions
  for each row execute function authz.role_permissions_guard();

-- Teams: parent in the same workspace, no cycles; members belong to the team's workspace.
create or replace function authz.teams_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_team_id is not null then
    if not exists (select 1 from public.teams p where p.id = new.parent_team_id and p.workspace_id = new.workspace_id) then
      raise exception 'parent team must be in the same workspace' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and exists (
         with recursive up(id, parent_team_id) as (
           select t.id, t.parent_team_id from public.teams t where t.id = new.parent_team_id
           union select t.id, t.parent_team_id from public.teams t join up on t.id = up.parent_team_id)
         select 1 from up where up.id = new.id) then
      raise exception 'team hierarchy cannot contain a cycle' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_teams_guard on public.teams;
create trigger trg_teams_guard before insert or update of parent_team_id, workspace_id on public.teams
  for each row execute function authz.teams_guard();

create or replace function authz.team_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.teams t join public.memberships m on m.workspace_id = t.workspace_id
                  where t.id = new.team_id and m.user_id = new.user_id and m.is_active) then
    raise exception 'user must be an active member of the team workspace' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_team_members_guard on public.team_members;
create trigger trg_team_members_guard before insert or update of team_id, user_id on public.team_members
  for each row execute function authz.team_members_guard();

-- Tuples: the object must exist in the tuple's workspace (otherwise shared_ids() could leak across workspaces) and the
-- subject must belong to it.
create or replace function authz.relationship_tuples_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_row jsonb;
begin
  v_row := authz.object_row(new.object_type, new.object_id);
  if authz.object_table(new.object_type) is null then
    raise exception 'unsupported object_type %', new.object_type using errcode = '22023';
  end if;
  if v_row is null or (v_row->>'workspace_id')::uuid is distinct from new.workspace_id then
    raise exception 'object not found in this workspace' using errcode = '23514';
  end if;
  if new.subject_type = 'user' and not exists (select 1 from public.memberships m
        where m.user_id = new.subject_id and m.workspace_id = new.workspace_id and m.is_active) then
    raise exception 'subject user is not a member of this workspace' using errcode = '23514';
  elsif new.subject_type = 'team' and not exists (select 1 from public.teams t
        where t.id = new.subject_id and t.workspace_id = new.workspace_id) then
    raise exception 'subject team is not in this workspace' using errcode = '23514';
  elsif new.subject_type = 'role' and not exists (select 1 from public.roles r
        where r.id = new.subject_id and (r.tenant_id is null or r.tenant_id = new.tenant_id)) then
    raise exception 'subject role is not available to this tenant' using errcode = '23514';
  end if;
  new.created_by := coalesce(new.created_by, (select auth.uid()));
  return new;
end $$;
drop trigger if exists trg_relationship_tuples_guard on public.relationship_tuples;
create trigger trg_relationship_tuples_guard before insert or update on public.relationship_tuples
  for each row execute function authz.relationship_tuples_guard();

-- territories (0004) feed memberships.attributes.districts, which the territory arm of lead visibility reads.
create or replace function authz.sync_territory_attrs() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select distinct x.workspace_id, x.rep_id from (
      select case when tg_op <> 'INSERT' then old.workspace_id end as workspace_id, case when tg_op <> 'INSERT' then old.rep_id end as rep_id
      union all
      select case when tg_op <> 'DELETE' then new.workspace_id end, case when tg_op <> 'DELETE' then new.rep_id end) x
     where x.workspace_id is not null
  loop
    update public.memberships m
       set attributes = jsonb_set(m.attributes, '{districts}', coalesce(
             (select to_jsonb(array_agg(t.district order by t.district)) from public.territories t
               where t.workspace_id = r.workspace_id and t.rep_id = r.rep_id), '[]'::jsonb))
     where m.workspace_id = r.workspace_id and m.user_id = r.rep_id
       and m.attributes->'districts' is distinct from coalesce(
             (select to_jsonb(array_agg(t.district order by t.district)) from public.territories t
               where t.workspace_id = r.workspace_id and t.rep_id = r.rep_id), '[]'::jsonb);
  end loop;
  return null;
end $$;
drop trigger if exists trg_territories_attrs on public.territories;
create trigger trg_territories_attrs after insert or update or delete on public.territories
  for each row execute function authz.sync_territory_attrs();

-- Every tenant gets a (permissive-default) policy row.
create or replace function authz.tenant_policy_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.org_admin_policies (tenant_id) values (new.id) on conflict (tenant_id) do nothing;
  return new;
end $$;
drop trigger if exists trg_tenants_org_policy on public.tenants;
create trigger trg_tenants_org_policy after insert on public.tenants
  for each row execute function authz.tenant_policy_default();

-- memberships.role (enum, authoritative for today's policies) and role_id stay in sync:
-- set role_id => role := base_role of that role; set only role => role_id := the system role. Runs before the guard.
create or replace function authz.memberships_role_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.role_id is null then
      select r.id into new.role_id from public.roles r where r.tenant_id is null and r.key = new.role::text;
    else
      select r.base_role into new.role from public.roles r where r.id = new.role_id;
    end if;
  else
    if new.role_id is distinct from old.role_id then
      if new.role_id is null then raise exception 'role_id cannot be cleared' using errcode = '23502'; end if;
      select r.base_role into new.role from public.roles r where r.id = new.role_id;
    elsif new.role is distinct from old.role then
      select r.id into new.role_id from public.roles r where r.tenant_id is null and r.key = new.role::text;
    end if;
  end if;
  if new.role_id is null then raise exception 'unknown role' using errcode = '23502'; end if;
  if exists (select 1 from public.roles r where r.id = new.role_id and r.tenant_id is not null
                and r.tenant_id is distinct from new.tenant_id) then
    raise exception 'role belongs to another tenant' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists a10_memberships_role_sync on public.memberships;
create trigger a10_memberships_role_sync before insert or update of role, role_id, tenant_id on public.memberships
  for each row execute function authz.memberships_role_sync();

-- Guard from 0005 extended: custom roles need roles.manage (or a platform admin), you cannot change your own role_id,
-- and nobody assigns a role holding more than they hold. Legacy rules for the enum role are unchanged.
create or replace function public.guard_membership_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me public.app_role;
  v_custom boolean := false;
  v_ws uuid := coalesce(new.workspace_id, old.workspace_id);
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  -- real membership role only: support sessions never manage people
  select m.role into me from public.memberships m
   where m.user_id = auth.uid() and m.workspace_id = v_ws and m.is_active;
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.workspace_id <> old.workspace_id then
      raise exception 'user and workspace cannot be changed' using errcode = '42501';
    end if;
    if (new.attributes is distinct from old.attributes or new.valid_until is distinct from old.valid_until)
       and not (me = 'owner' or public.is_platform_admin()
                or (me = 'sales_manager' and old.role in ('sales_rep','viewer') and new.user_id <> auth.uid())) then
      raise exception 'not allowed to change member attributes' using errcode = '42501';
    end if;
    if new.role = old.role and new.is_active = old.is_active and new.role_id is not distinct from old.role_id then return new; end if;
    if new.user_id = auth.uid() then
      raise exception 'you cannot change your own role or active status' using errcode = '42501';
    end if;
  end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.role_id is distinct from old.role_id) then
    select exists (select 1 from public.roles r where r.tenant_id is not null and r.id in (new.role_id, case when tg_op = 'UPDATE' then old.role_id end))
      into v_custom;
    if v_custom and not public.is_platform_admin() then
      if v_ws not in (select authz.ws_with_member('roles.manage', 'all')) then
        raise exception 'changing custom roles needs the roles.manage permission' using errcode = '42501';
      end if;
      if not authz.role_within_caller(v_ws, new.role_id) then
        raise exception 'you cannot grant a role with more permissions than you hold' using errcode = '42501';
      end if;
    end if;
  end if;
  if me = 'owner' or public.is_platform_admin() then   -- platform admin: tenant/workspace bootstrap from /admin
    return coalesce(new, old);
  elsif tg_op = 'INSERT' and new.user_id = auth.uid() and new.role = 'owner'
        and new.tenant_id in (select public.owner_tenant_ids()) then   -- tenant owner seats self in a new workspace
    return new;
  elsif me = 'sales_manager'
        and not v_custom
        and (tg_op = 'INSERT' or old.role in ('sales_rep','viewer'))
        and (tg_op = 'DELETE' or new.role in ('sales_rep','viewer')) then
    return coalesce(new, old);
  end if;
  raise exception 'not allowed to change memberships here' using errcode = '42501';
end $$;

-- Super admin only, audited (the audit trigger below records the change; 0014 adds the reason column).
create or replace function public.admin_set_org_admin_policy(p_tenant uuid, p_policy jsonb, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.org_admin_policies;
begin
  if not public.is_platform_admin()
     or not exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.is_active and pa.platform_role = 'super_admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 8 then raise exception 'a reason of at least 8 characters is required' using errcode = '22023'; end if;
  if p_policy is null or jsonb_typeof(p_policy) <> 'object' then raise exception 'policy must be a JSON object' using errcode = '22023'; end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then raise exception 'unknown tenant' using errcode = '22023'; end if;
  perform set_config('app.audit_reason', trim(p_reason), true);
  perform set_config('app.actor_label', 'platform_admin', true);
  v := jsonb_populate_record(null::public.org_admin_policies, p_policy);
  insert into public.org_admin_policies as o (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  update public.org_admin_policies o set
    allow_custom_roles   = case when p_policy ? 'allow_custom_roles'   then coalesce(v.allow_custom_roles, o.allow_custom_roles) else o.allow_custom_roles end,
    allow_custom_objects = case when p_policy ? 'allow_custom_objects' then coalesce(v.allow_custom_objects, o.allow_custom_objects) else o.allow_custom_objects end,
    allow_api_keys       = case when p_policy ? 'allow_api_keys'       then coalesce(v.allow_api_keys, o.allow_api_keys) else o.allow_api_keys end,
    allow_webhooks       = case when p_policy ? 'allow_webhooks'       then coalesce(v.allow_webhooks, o.allow_webhooks) else o.allow_webhooks end,
    allow_byok           = case when p_policy ? 'allow_byok'           then coalesce(v.allow_byok, o.allow_byok) else o.allow_byok end,
    allow_connectors     = case when p_policy ? 'allow_connectors'     then v.allow_connectors else o.allow_connectors end,
    allowed_modules      = case when p_policy ? 'allowed_modules'      then v.allowed_modules else o.allowed_modules end,
    max_seats            = case when p_policy ? 'max_seats'            then v.max_seats else o.max_seats end,
    max_workspaces       = case when p_policy ? 'max_workspaces'       then v.max_workspaces else o.max_workspaces end,
    max_custom_fields    = case when p_policy ? 'max_custom_fields'    then v.max_custom_fields else o.max_custom_fields end,
    updated_by = auth.uid(), updated_at = now()
   where o.tenant_id = p_tenant;
end $$;

-- ---------- 6. RLS ----------
alter table public.permissions        enable row level security;
alter table public.roles              enable row level security;
alter table public.role_permissions   enable row level security;
alter table public.teams              enable row level security;
alter table public.team_members       enable row level security;
alter table public.relationship_tuples enable row level security;
alter table public.org_admin_policies enable row level security;

drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions for select to authenticated using (true);
-- no write policies: the catalogue is changed by migrations only

drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles for select to authenticated
  using (tenant_id is null or tenant_id in (select public.member_tenant_ids()) or (select public.is_platform_admin()));
drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles for insert to authenticated
  with check (tenant_id is not null and not is_system and (select authz.can_manage_roles(tenant_id)));
drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles for update to authenticated
  using (tenant_id is not null and not is_system and (select authz.can_manage_roles(tenant_id)))
  with check (tenant_id is not null and not is_system and (select authz.can_manage_roles(tenant_id)));
drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles for delete to authenticated
  using (tenant_id is not null and not is_system and (select authz.can_manage_roles(tenant_id)));

drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id));   -- parent role's own RLS decides
drop policy if exists role_permissions_insert on public.role_permissions;
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (exists (select 1 from public.roles r where r.id = role_id and r.tenant_id is not null and not r.is_system
                       and (select authz.can_manage_roles(r.tenant_id))));
drop policy if exists role_permissions_update on public.role_permissions;
create policy role_permissions_update on public.role_permissions for update to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and r.tenant_id is not null and not r.is_system
                  and (select authz.can_manage_roles(r.tenant_id))))
  with check (exists (select 1 from public.roles r where r.id = role_id and r.tenant_id is not null and not r.is_system
                       and (select authz.can_manage_roles(r.tenant_id))));
drop policy if exists role_permissions_delete on public.role_permissions;
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and r.tenant_id is not null and not r.is_system
                  and (select authz.can_manage_roles(r.tenant_id))));

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
  using (workspace_id in (select public.member_ws_ids()));
drop policy if exists teams_insert on public.teams;
create policy teams_insert on public.teams for insert to authenticated
  with check (workspace_id in (select authz.ws_with('teams.manage', 'all')));
drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams for update to authenticated
  using (workspace_id in (select authz.ws_with('teams.manage', 'all')))
  with check (workspace_id in (select authz.ws_with('teams.manage', 'all')));
drop policy if exists teams_delete on public.teams;
create policy teams_delete on public.teams for delete to authenticated
  using (workspace_id in (select authz.ws_with('teams.manage', 'all')));

drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members for select to authenticated
  using (team_id in (select t.id from public.teams t where t.workspace_id in (select public.member_ws_ids())));
drop policy if exists team_members_insert on public.team_members;
create policy team_members_insert on public.team_members for insert to authenticated
  with check (team_id in (select t.id from public.teams t where t.workspace_id in (select authz.ws_with('teams.manage', 'all'))));
drop policy if exists team_members_update on public.team_members;
create policy team_members_update on public.team_members for update to authenticated
  using (team_id in (select t.id from public.teams t where t.workspace_id in (select authz.ws_with('teams.manage', 'all'))))
  with check (team_id in (select t.id from public.teams t where t.workspace_id in (select authz.ws_with('teams.manage', 'all'))));
drop policy if exists team_members_delete on public.team_members;
create policy team_members_delete on public.team_members for delete to authenticated
  using (team_id in (select t.id from public.teams t where t.workspace_id in (select authz.ws_with('teams.manage', 'all'))));

-- tuples: visible to members who can read the object (or records.share holders); writable by object editors/owners or records.share
drop policy if exists relationship_tuples_select on public.relationship_tuples;
create policy relationship_tuples_select on public.relationship_tuples for select to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select authz.ws_with('records.share', 'all'))
              or (select authz.check(workspace_id, authz.object_perm(object_type, 'read'), object_type, object_id))));
drop policy if exists relationship_tuples_insert on public.relationship_tuples;
create policy relationship_tuples_insert on public.relationship_tuples for insert to authenticated
  with check (workspace_id in (select public.member_ws_ids())
              and (workspace_id in (select authz.ws_with('records.share', 'all'))
                   or object_id in (select authz.shared_ids(object_type, 'editor'))));
drop policy if exists relationship_tuples_delete on public.relationship_tuples;
create policy relationship_tuples_delete on public.relationship_tuples for delete to authenticated
  using (workspace_id in (select public.member_ws_ids())
         and (workspace_id in (select authz.ws_with('records.share', 'all'))
              or object_id in (select authz.shared_ids(object_type, 'editor'))));

drop policy if exists org_admin_policies_select on public.org_admin_policies;
create policy org_admin_policies_select on public.org_admin_policies for select to authenticated
  using (tenant_id in (select public.member_tenant_ids()) or (select public.is_platform_admin()));
-- no write policies: admin_set_org_admin_policy() only

-- ---------- 7. Grants ----------
revoke all on public.permissions, public.roles, public.role_permissions, public.teams, public.team_members,
              public.relationship_tuples, public.org_admin_policies from anon, authenticated;
grant select on public.permissions, public.roles, public.role_permissions, public.teams, public.team_members,
                public.relationship_tuples, public.org_admin_policies to authenticated;
grant insert, update, delete on public.roles, public.role_permissions, public.teams, public.team_members to authenticated;
grant insert, delete on public.relationship_tuples to authenticated;

revoke execute on all functions in schema authz from public, anon, authenticated;
grant execute on function authz.ws_with(text, text), authz.ws_with_member(text, text), authz.team_user_ids(uuid),
  authz.shared_ids(text, text), authz.attr(uuid), authz.cond_ok(uuid, text, jsonb), authz.check(uuid, text, text, uuid),
  authz.explain(uuid, text, text, uuid), authz.my_grants(uuid), authz.valid_conditions(jsonb), authz.can_manage_roles(uuid),
  authz.object_perm(text, text), authz.object_table(text), authz.scope_rank(text), authz.role_within_caller(uuid, uuid)
  to authenticated, service_role;
grant execute on all functions in schema authz to service_role;
revoke execute on function public.my_grants(uuid), public.admin_set_org_admin_policy(uuid, jsonb, text) from public, anon;
grant execute on function public.my_grants(uuid), public.admin_set_org_admin_policy(uuid, jsonb, text) to authenticated;

-- ---------- 8. System roles seed (generated; reproduces CAN + PAGE_ACCESS) ----------
-- BEGIN GENERATED: system roles (scripts/gen-authz-seed.mjs). Do not edit by hand.
insert into public.permissions (key, resource, action, description, is_pii, platform_only, support_blocked) values
  ('dashboard.read', 'dashboard', 'read', 'Read dashboard', false, false, false),
  ('myday.read', 'myday', 'read', 'Read myday', false, false, false),
  ('settings.read', 'settings', 'read', 'Read settings', false, false, false),
  ('pii.read', 'pii', 'read', 'Read pii', true, false, false),
  ('records.share', 'records', 'share', 'Share records', false, false, false),
  ('comments.write', 'comments', 'write', 'Write comments', false, false, false),
  ('comments.moderate', 'comments', 'moderate', 'Moderate comments', false, false, false),
  ('audit.read', 'audit', 'read', 'Read audit', false, false, false),
  ('org.admin', 'org', 'admin', 'Admin org', false, false, true),
  ('org.branding', 'org', 'branding', 'Branding org', false, false, true),
  ('config.edit', 'config', 'edit', 'Edit config', false, false, false),
  ('events.read', 'events', 'read', 'Read events', false, false, false),
  ('leads.read', 'leads', 'read', 'Read leads', false, false, false),
  ('leads.create', 'leads', 'create', 'Create leads', false, false, false),
  ('leads.write', 'leads', 'write', 'Write leads', false, false, false),
  ('leads.assign', 'leads', 'assign', 'Assign leads', false, false, false),
  ('leads.delete', 'leads', 'delete', 'Delete leads', false, false, true),
  ('leads.export', 'leads', 'export', 'Export leads', false, false, true),
  ('leads.import', 'leads', 'import', 'Import leads', false, false, false),
  ('contacts.read', 'contacts', 'read', 'Read contacts', false, false, false),
  ('contacts.write', 'contacts', 'write', 'Write contacts', false, false, false),
  ('contacts.delete', 'contacts', 'delete', 'Delete contacts', false, false, true),
  ('accounts.read', 'accounts', 'read', 'Read accounts', false, false, false),
  ('accounts.write', 'accounts', 'write', 'Write accounts', false, false, false),
  ('accounts.merge', 'accounts', 'merge', 'Merge accounts', false, false, false),
  ('accounts.delete', 'accounts', 'delete', 'Delete accounts', false, false, true),
  ('deals.read', 'deals', 'read', 'Read deals', false, false, false),
  ('deals.write', 'deals', 'write', 'Write deals', false, false, false),
  ('deals.move', 'deals', 'move', 'Move deals', false, false, false),
  ('deals.delete', 'deals', 'delete', 'Delete deals', false, false, true),
  ('tasks.read', 'tasks', 'read', 'Read tasks', false, false, false),
  ('tasks.write', 'tasks', 'write', 'Write tasks', false, false, false),
  ('tasks.assign', 'tasks', 'assign', 'Assign tasks', false, false, false),
  ('activities.read', 'activities', 'read', 'Read activities', false, false, false),
  ('activities.write', 'activities', 'write', 'Write activities', false, false, false),
  ('campaigns.read', 'campaigns', 'read', 'Read campaigns', false, false, false),
  ('campaigns.write', 'campaigns', 'write', 'Write campaigns', false, false, false),
  ('segments.read', 'segments', 'read', 'Read segments', false, false, false),
  ('segments.write', 'segments', 'write', 'Write segments', false, false, false),
  ('audience.export', 'audience', 'export', 'Export audience', false, false, true),
  ('analytics.read', 'analytics', 'read', 'Read analytics', false, false, false),
  ('inbox.read', 'inbox', 'read', 'Read inbox', false, false, false),
  ('inbox.reply', 'inbox', 'reply', 'Reply inbox', false, false, false),
  ('inbox.assign', 'inbox', 'assign', 'Assign inbox', false, false, false),
  ('messages.send_whatsapp', 'messages', 'send_whatsapp', 'Send whatsapp messages', false, false, false),
  ('messages.send_email', 'messages', 'send_email', 'Send email messages', false, false, false),
  ('members.invite', 'members', 'invite', 'Invite members', false, false, true),
  ('members.manage', 'members', 'manage', 'Manage members', false, false, true),
  ('roles.manage', 'roles', 'manage', 'Manage roles', false, false, true),
  ('teams.manage', 'teams', 'manage', 'Manage teams', false, false, false),
  ('fields.manage', 'fields', 'manage', 'Manage fields', false, false, false),
  ('objects.manage', 'objects', 'manage', 'Manage objects', false, false, false),
  ('pipelines.manage', 'pipelines', 'manage', 'Manage pipelines', false, false, false),
  ('layouts.manage', 'layouts', 'manage', 'Manage layouts', false, false, false),
  ('views.share', 'views', 'share', 'Share views', false, false, false),
  ('notifications.manage', 'notifications', 'manage', 'Manage notifications', false, false, false),
  ('integrations.read', 'integrations', 'read', 'Read integrations', false, false, false),
  ('integrations.manage', 'integrations', 'manage', 'Manage integrations', false, false, true),
  ('webhooks.manage', 'webhooks', 'manage', 'Manage webhooks', false, false, true),
  ('api_keys.manage', 'api_keys', 'manage', 'Manage api keys', false, false, true),
  ('data_health.read', 'data_health', 'read', 'Read data health', false, false, false),
  ('data_health.manage', 'data_health', 'manage', 'Manage data health', false, false, false),
  ('backups.manage', 'backups', 'manage', 'Manage backups', false, false, false),
  ('privacy.fulfil', 'privacy', 'fulfil', 'Fulfil privacy', false, false, true),
  ('billing.read', 'billing', 'read', 'Read billing', false, false, false),
  ('billing.manage', 'billing', 'manage', 'Manage billing', false, false, true),
  ('ai.use', 'ai', 'use', 'Use ai', false, false, false),
  ('ai.toggle', 'ai', 'toggle', 'Toggle ai', false, false, true),
  ('platform.tenants.manage', 'platform', 'tenants.manage', 'Tenants manage platform', false, true, false),
  ('platform.policies.manage', 'platform', 'policies.manage', 'Policies manage platform', false, true, false),
  ('platform.support', 'platform', 'support', 'Support platform', false, true, false),
  ('platform.billing', 'platform', 'billing', 'Billing platform', false, true, false),
  ('platform.read', 'platform', 'read', 'Read platform', false, true, false)
on conflict (key) do update set resource = excluded.resource, action = excluded.action, description = excluded.description,
  is_pii = excluded.is_pii, platform_only = excluded.platform_only, support_blocked = excluded.support_blocked;

insert into public.roles (id, tenant_id, key, name, description, base_role, is_system) values
  ('30000000-0000-4000-8000-000000000001'::uuid, null::uuid, 'owner', 'Owner', 'Revenue, pipeline, team and branding. Full access.', 'owner'::public.app_role, true),
  ('30000000-0000-4000-8000-000000000002'::uuid, null::uuid, 'sales_manager', 'Sales Manager', 'Team pipeline, assignment, targets and SLAs.', 'sales_manager'::public.app_role, true),
  ('30000000-0000-4000-8000-000000000003'::uuid, null::uuid, 'sales_rep', 'Sales Rep', 'Own leads, demos and follow-ups for the day.', 'sales_rep'::public.app_role, true),
  ('30000000-0000-4000-8000-000000000004'::uuid, null::uuid, 'marketing', 'Marketing', 'Campaigns, audience, web analytics and attribution.', 'marketing'::public.app_role, true),
  ('30000000-0000-4000-8000-000000000005'::uuid, null::uuid, 'data', 'Data', 'Imports, integrations, sync health and backups.', 'data'::public.app_role, true),
  ('30000000-0000-4000-8000-000000000006'::uuid, null::uuid, 'viewer', 'Viewer', 'Read-only dashboards, no personal data.', 'viewer'::public.app_role, true)
on conflict (id) do update set key = excluded.key, name = excluded.name, description = excluded.description,
  base_role = excluded.base_role, is_system = true;

insert into public.role_permissions (role_id, permission_key, scope) values
  ('30000000-0000-4000-8000-000000000001'::uuid, 'accounts.delete', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'accounts.merge', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'accounts.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'accounts.write', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'activities.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'activities.write', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'ai.toggle', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'ai.use', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'analytics.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'api_keys.manage', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'audience.export', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'audit.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'backups.manage', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'billing.manage', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'billing.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'campaigns.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'campaigns.write', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'comments.moderate', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'comments.write', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'config.edit', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'contacts.delete', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'contacts.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'contacts.write', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'dashboard.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'data_health.manage', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'data_health.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'deals.delete', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'deals.move', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'deals.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'deals.write', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'events.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'fields.manage', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'inbox.assign', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'inbox.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'inbox.reply', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'integrations.manage', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'integrations.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'layouts.manage', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'leads.assign', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'leads.create', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'leads.delete', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'leads.export', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'leads.import', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'leads.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'leads.write', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'members.invite', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'members.manage', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'messages.send_email', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'messages.send_whatsapp', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'myday.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'notifications.manage', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'objects.manage', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'org.admin', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'org.branding', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'pii.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'pipelines.manage', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'privacy.fulfil', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'records.share', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'roles.manage', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'segments.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'segments.write', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'settings.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'tasks.assign', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'tasks.read', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'tasks.write', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'teams.manage', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'views.share', 'all'),
  ('30000000-0000-4000-8000-000000000001'::uuid, 'webhooks.manage', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'accounts.merge', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'accounts.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'accounts.write', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'activities.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'activities.write', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'ai.use', 'own'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'analytics.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'audit.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'campaigns.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'comments.moderate', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'comments.write', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'contacts.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'contacts.write', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'dashboard.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'data_health.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'deals.move', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'deals.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'deals.write', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'events.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'inbox.assign', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'inbox.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'inbox.reply', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'integrations.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'leads.assign', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'leads.create', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'leads.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'leads.write', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'members.invite', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'members.manage', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'messages.send_email', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'messages.send_whatsapp', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'myday.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'pii.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'pipelines.manage', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'records.share', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'segments.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'settings.read', 'own'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'tasks.assign', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'tasks.read', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'tasks.write', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'teams.manage', 'all'),
  ('30000000-0000-4000-8000-000000000002'::uuid, 'views.share', 'all'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'accounts.read', 'all'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'activities.read', 'own'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'activities.write', 'own'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'ai.use', 'all'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'comments.write', 'all'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'contacts.read', 'own'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'deals.move', 'own'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'deals.read', 'own'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'deals.write', 'own'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'inbox.read', 'own'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'inbox.reply', 'own'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'leads.create', 'own'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'leads.read', 'own'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'leads.write', 'own'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'messages.send_email', 'all'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'messages.send_whatsapp', 'all'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'myday.read', 'own'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'pii.read', 'all'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'tasks.read', 'own'),
  ('30000000-0000-4000-8000-000000000003'::uuid, 'tasks.write', 'own'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'accounts.read', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'activities.read', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'ai.use', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'analytics.read', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'campaigns.read', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'campaigns.write', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'comments.write', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'contacts.read', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'deals.read', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'inbox.read', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'integrations.read', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'leads.import', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'leads.read', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'pii.read', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'segments.read', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'segments.write', 'all'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'tasks.read', 'own'),
  ('30000000-0000-4000-8000-000000000004'::uuid, 'tasks.write', 'own'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'accounts.read', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'accounts.write', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'activities.read', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'ai.use', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'analytics.read', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'audience.export', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'campaigns.read', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'comments.write', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'contacts.read', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'contacts.write', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'data_health.manage', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'data_health.read', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'deals.read', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'events.read', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'integrations.read', 'own'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'leads.export', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'leads.import', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'leads.read', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'pii.read', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'segments.read', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'segments.write', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'settings.read', 'all'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'tasks.read', 'own'),
  ('30000000-0000-4000-8000-000000000005'::uuid, 'tasks.write', 'own'),
  ('30000000-0000-4000-8000-000000000006'::uuid, 'accounts.read', 'all'),
  ('30000000-0000-4000-8000-000000000006'::uuid, 'activities.read', 'all'),
  ('30000000-0000-4000-8000-000000000006'::uuid, 'analytics.read', 'all'),
  ('30000000-0000-4000-8000-000000000006'::uuid, 'campaigns.read', 'all'),
  ('30000000-0000-4000-8000-000000000006'::uuid, 'dashboard.read', 'all'),
  ('30000000-0000-4000-8000-000000000006'::uuid, 'deals.read', 'all'),
  ('30000000-0000-4000-8000-000000000006'::uuid, 'leads.read', 'all'),
  ('30000000-0000-4000-8000-000000000006'::uuid, 'segments.read', 'all')
on conflict (role_id, permission_key) do update set scope = excluded.scope;
-- END GENERATED

-- ---------- 9. Backfill ----------
insert into public.org_admin_policies (tenant_id) select t.id from public.tenants t on conflict (tenant_id) do nothing;

update public.memberships m
   set role_id = r.id
  from public.roles r
 where m.role_id is null and r.tenant_id is null and r.key = m.role::text;

update public.memberships m
   set attributes = m.attributes || jsonb_build_object('districts', d.districts)
  from (select t.workspace_id, t.rep_id, to_jsonb(array_agg(t.district order by t.district)) as districts
          from public.territories t group by t.workspace_id, t.rep_id) d
 where d.workspace_id = m.workspace_id and d.rep_id = m.user_id and not (m.attributes ? 'districts');

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'memberships'
                and column_name = 'role_id' and is_nullable = 'YES') then
    alter table public.memberships alter column role_id set not null;
  end if;
end $$;

-- audit (PII-masked, workspace/support stamped by audit_row_change from 0005); attached after the seed so the seed is not audited
do $$
declare t text;
begin
  foreach t in array array['roles', 'role_permissions', 'teams', 'team_members', 'relationship_tuples', 'org_admin_policies'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- ---------- 10. verify ----------
do $$
begin
  assert (select count(*) from public.roles where tenant_id is null and is_system) >= 6, '0013: six system roles expected';
  assert not exists (select 1 from public.memberships where role_id is null), '0013: every membership has role_id';
  assert not exists (select 1 from public.memberships m join public.roles r on r.id = m.role_id where r.base_role <> m.role),
    '0013: memberships.role must equal role base_role';
  assert (select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id
           where r.key = 'viewer' and r.tenant_id is null and rp.permission_key = 'pii.read') = 0, '0013: viewer has no pii.read';
  assert not has_table_privilege('anon', 'public.roles', 'select'), '0013: anon must not read roles';
  assert not has_function_privilege('anon', 'authz.ws_with(text,text)', 'execute'), '0013: anon must not execute authz.ws_with';
  assert (select count(*) from public.tenants) = (select count(*) from public.org_admin_policies), '0013: one policy row per tenant';
end $$;

commit;
