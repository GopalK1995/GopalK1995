-- 0017 metadata (BUILD-PLAN 2.5, 1.4): object types, field definitions, custom jsonb columns + validation trigger, custom-object
-- records and links, configurable pipelines (stages move under pipelines), layouts, saved views, authz support for custom objects.
-- Forward-only, idempotent. RLS is enabled on every new table in this file. Validation is done in plpgsql from field_defs
-- (no pg_jsonschema dependency); object_types.json_schema is a compiled JSON Schema snapshot for clients, bumped with schema_version.

create schema if not exists metadata;
revoke all on schema metadata from public, anon;
grant usage on schema metadata to authenticated, service_role;

create extension if not exists pg_trgm with schema extensions;

-- ---------- 1. Tables ----------
create table if not exists public.object_types (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid references public.workspaces(id) on delete cascade,   -- null = org-wide
  key            text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  kind           text not null check (kind in ('system', 'custom')),
  label          jsonb not null default '{}' check (jsonb_typeof(label) = 'object'),
  icon           text,
  primary_field  text,
  is_enabled     boolean not null default true,
  position       int not null default 0,
  json_schema    jsonb not null default '{}',
  schema_version int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint object_types_tenant_key unique (tenant_id, key)
);
create index if not exists object_types_ws on public.object_types (workspace_id) where workspace_id is not null;

create table if not exists public.field_defs (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  object_type_id      uuid not null references public.object_types(id) on delete cascade,
  key                 text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label               jsonb not null default '{}' check (jsonb_typeof(label) = 'object'),
  type                text not null check (type in ('text','long_text','number','money','percent','date','datetime','boolean',
                                                    'select','multi_select','user','lookup','phone','email','url','rating')),
  options             jsonb not null default '{}',
  required            boolean not null default false,
  unique_in_workspace boolean not null default false,
  is_pii              boolean not null default false,
  is_searchable       boolean not null default false,
  is_filterable       boolean not null default false,
  "default"           jsonb,
  validation          jsonb not null default '{}',
  help                jsonb not null default '{}',
  section             text,
  position            int not null default 0,
  editable_perm       text,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint field_defs_type_key unique (object_type_id, key)
);
create index if not exists field_defs_tenant on public.field_defs (tenant_id);

create table if not exists public.records (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  object_type_id uuid not null references public.object_types(id) on delete restrict,
  title          text not null default '' check (length(title) <= 300),
  data           jsonb not null default '{}',
  owner_id       uuid references public.profiles(id) on delete set null,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  version        int not null default 1,
  deleted_at     timestamptz
);
create index if not exists records_ws_type on public.records (workspace_id, object_type_id, created_at desc);
create index if not exists records_owner on public.records (owner_id);
create index if not exists records_data_gin on public.records using gin (data jsonb_path_ops);
create index if not exists records_title_trgm on public.records using gin (title extensions.gin_trgm_ops);

create table if not exists public.record_links (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  from_type    text not null,
  from_id      uuid not null,
  to_type      text not null,
  to_id        uuid not null,
  relation     text not null default 'related' check (length(relation) between 1 and 60),
  created_at   timestamptz not null default now(),
  constraint record_links_unique unique (workspace_id, from_type, from_id, to_type, to_id, relation)
);
create index if not exists record_links_from on public.record_links (from_type, from_id);
create index if not exists record_links_to on public.record_links (to_type, to_id);

create table if not exists public.pipelines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  object_type  text not null,                       -- 'lead', 'deal', or a custom object key
  key          text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name         jsonb not null default '{}' check (jsonb_typeof(name) = 'object'),
  is_default   boolean not null default false,
  position     int not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint pipelines_ws_type_key unique (workspace_id, object_type, key)
);
create unique index if not exists pipelines_one_default on public.pipelines (workspace_id, object_type) where is_default and archived_at is null;
create index if not exists pipelines_ws on public.pipelines (workspace_id, created_at desc);

create table if not exists public.layouts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid references public.workspaces(id) on delete cascade,   -- null = org-wide
  object_type_id uuid not null references public.object_types(id) on delete cascade,
  kind           text not null check (kind in ('detail', 'form', 'list', 'card')),
  role_id        uuid references public.roles(id) on delete cascade,
  spec           jsonb not null default '{}',
  version        int not null default 1,
  updated_by     uuid,
  updated_at     timestamptz not null default now()
);
create unique index if not exists layouts_scope_unique on public.layouts
  (object_type_id, kind, coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.saved_views (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  object_type_id uuid not null references public.object_types(id) on delete cascade,
  owner_id       uuid references public.profiles(id) on delete cascade,     -- null = shared system view
  name           text not null check (length(name) between 1 and 80),
  filters        jsonb not null default '{}',
  sort           jsonb not null default '[]',
  columns        text[] not null default '{}',
  visibility     text not null default 'private' check (visibility in ('private', 'team', 'workspace')),
  position       int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists saved_views_ws on public.saved_views (workspace_id, object_type_id, position);

alter table public.object_types enable row level security;
alter table public.field_defs   enable row level security;
alter table public.records      enable row level security;
alter table public.record_links enable row level security;
alter table public.pipelines    enable row level security;
alter table public.layouts      enable row level security;
alter table public.saved_views  enable row level security;

-- tenant / updated_at / version triggers on the new tables
create or replace function metadata.tenant_from_object_type() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select ot.tenant_id into new.tenant_id from public.object_types ot where ot.id = new.object_type_id;
  if new.tenant_id is null then raise exception 'unknown object type' using errcode = '23503'; end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['records', 'record_links', 'pipelines', 'saved_views'] loop
    execute format('drop trigger if exists a00_%1$s_tenant on public.%1$I', t);
    execute format('create trigger a00_%1$s_tenant before insert or update of workspace_id, tenant_id on public.%1$I
                    for each row execute function public.set_tenant_from_workspace()', t);
  end loop;
  foreach t in array array['field_defs', 'layouts'] loop
    execute format('drop trigger if exists a00_%1$s_tenant on public.%1$I', t);
    execute format('create trigger a00_%1$s_tenant before insert or update of object_type_id on public.%1$I
                    for each row execute function metadata.tenant_from_object_type()', t);
  end loop;
  foreach t in array array['object_types', 'field_defs', 'records'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
  execute 'drop trigger if exists z9_records_version on public.records';
  execute 'create trigger z9_records_version before update on public.records for each row execute function public.bump_version()';
end $$;

-- ---------- 2. Authz for custom objects (extends the 0013 helpers) ----------
-- Object type strings for custom objects are 'obj:<key>'; they resolve to table records and permissions obj:<key>.read|write|delete.
create or replace function authz.object_table(p_type text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select case p_type
    when 'lead' then 'leads' when 'deal' then 'deals' when 'account' then 'accounts' when 'contact' then 'contacts'
    when 'task' then 'tasks' when 'campaign' then 'campaigns' when 'conversation' then 'conversations'
    else case when p_type ~ '^obj:[a-z][a-z0-9_]{1,40}$' then 'records' end end
$$;

create or replace function authz.object_perm(p_type text, p_mode text default 'read') returns text
language sql immutable parallel safe set search_path = '' as $$
  select case when p_type ~ '^obj:[a-z][a-z0-9_]{1,40}$' then p_type || '.' || case when p_mode = 'read' then 'read' else 'write' end
              when authz.object_table(p_type) is null then 'records.share'
              when p_type = 'conversation' then case when p_mode = 'read' then 'inbox.read' else 'inbox.reply' end
              else (authz.object_table(p_type)) || '.' || case when p_mode = 'read' then 'read' else 'write' end end
$$;

create or replace function authz.object_row(p_type text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_tbl text := authz.object_table(p_type); v_row jsonb;
begin
  if v_tbl is null or p_id is null then return null; end if;
  if v_tbl = 'records' then
    select to_jsonb(t) into v_row from public.records t join public.object_types ot on ot.id = t.object_type_id
     where t.id = p_id and ot.key = substr(p_type, 5) and t.deleted_at is null;
    return v_row;
  end if;
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_tbl) into v_row using p_id;
  return v_row;
end $$;

create or replace function authz.org_allows(p_tenant uuid, p_flag text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (to_jsonb(p) ->> p_flag)::boolean from public.org_admin_policies p where p.tenant_id = p_tenant), true)
$$;

-- Row-level decision for custom-object records: the grant for obj:<key>.<mode> in the workspace, scope-resolved against the row owner.
create or replace function authz.record_ok(p_ws uuid, p_type uuid, p_mode text, p_owner uuid, p_rec jsonb default null) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_key text; v_g record; v_ok boolean; v_uid uuid := (select auth.uid());
begin
  select ot.key into v_key from public.object_types ot join public.workspaces w on w.id = p_ws and w.tenant_id = ot.tenant_id
   where ot.id = p_type and ot.is_enabled;
  if v_key is null then return false; end if;
  select * into v_g from authz.grants(p_ws) g where g.permission_key = 'obj:' || v_key || '.' || p_mode
   order by authz.scope_rank(g.scope) desc limit 1;
  if v_g.permission_key is null then return false; end if;
  v_ok := case v_g.scope
    when 'all' then true
    when 'team' then (p_owner in (select authz.team_user_ids(p_ws)) or p_owner = v_uid)
    when 'own' then p_owner = v_uid
    else false end;
  if not coalesce(v_ok, false) then return false; end if;
  if p_rec is not null then
    return authz.eval_node(v_g.conditions, p_rec, jsonb_build_object('id', v_uid, 'attrs', authz.attr(p_ws)), now());
  end if;
  return true;
end $$;

create or replace function authz.shared_record_ids(p_min_rel text default 'viewer') returns setof uuid
language sql stable security definer set search_path = '' as $$
  select rt.object_id from public.relationship_tuples rt
   where rt.object_type like 'obj:%'
     and (rt.expires_at is null or rt.expires_at > now())
     and (case rt.relation when 'owner' then 3 when 'editor' then 2 when 'viewer' then 1 else 0 end)
         >= (case p_min_rel when 'owner' then 3 when 'editor' then 2 when 'viewer' then 1 else 99 end)
     and rt.workspace_id in (select public.member_ws_ids())
     and (   (rt.subject_type = 'user' and rt.subject_id = (select auth.uid()))
          or (rt.subject_type = 'team' and rt.subject_id in (select tm.team_id from public.team_members tm where tm.user_id = (select auth.uid())))
          or (rt.subject_type = 'role' and rt.subject_id in (select m.role_id from public.memberships m
                                                              where m.user_id = (select auth.uid()) and m.workspace_id = rt.workspace_id and m.is_active)))
$$;

revoke all on function authz.org_allows(uuid, text), authz.record_ok(uuid, uuid, text, uuid, jsonb), authz.shared_record_ids(text) from public, anon;
grant execute on function authz.org_allows(uuid, text), authz.record_ok(uuid, uuid, text, uuid, jsonb), authz.shared_record_ids(text) to authenticated, service_role;

-- The role_permissions guard (0013) blocks edits of system roles by users. Seeding the default grants of a new custom object type is
-- the one allowed exception: it must run inside the object-type trigger (trigger depth > 1) with the transaction-local flag set.
create or replace function authz.role_permissions_guard() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare v_system boolean;
begin
  if tg_op <> 'DELETE' and exists (select 1 from public.permissions p where p.key = new.permission_key and p.platform_only) then
    raise exception 'platform-only permissions cannot be granted to org roles' using errcode = '42501';
  end if;
  if pg_trigger_depth() > 1 and coalesce(current_setting('app.object_type_seed', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if (select auth.uid()) is not null then
    select r.is_system into v_system from public.roles r where r.id = coalesce(new.role_id, old.role_id);
    if coalesce(v_system, false) then raise exception 'system roles are read-only' using errcode = '42501'; end if;
  end if;
  return coalesce(new, old);
end $fn$;

-- A custom object type owns three permissions; owner and sales_manager system roles get working defaults.
create or replace function metadata.object_type_perms() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_a text;
begin
  if new.kind <> 'custom' then return null; end if;
  perform set_config('app.object_type_seed', 'on', true);
  foreach v_a in array array['read', 'write', 'delete'] loop
    insert into public.permissions (key, resource, action, description)
    values ('obj:' || new.key || '.' || v_a, 'obj:' || new.key, v_a, initcap(v_a) || ' ' || new.key || ' records')
    on conflict (key) do nothing;
    insert into public.role_permissions (role_id, permission_key, scope)
    select r.id, 'obj:' || new.key || '.' || v_a, 'all' from public.roles r
     where r.tenant_id is null and r.is_system and (r.key = 'owner' or (r.key = 'sales_manager' and v_a <> 'delete'))
    on conflict (role_id, permission_key) do nothing;
  end loop;
  perform set_config('app.object_type_seed', 'off', true);
  return null;
end $$;
drop trigger if exists trg_object_types_perms on public.object_types;
create trigger trg_object_types_perms after insert on public.object_types for each row execute function metadata.object_type_perms();

-- ---------- 3. Field validation ----------
-- Error text for a value that does not fit the definition, or null.
create or replace function metadata.check_value(p_def public.field_defs, p_val jsonb) returns text
language plpgsql stable set search_path = '' as $$
declare v_t text := jsonb_typeof(p_val); v_s text; v_n numeric; v_keys text[]; v_max numeric := nullif(p_def.validation ->> 'max', '')::numeric;
        v_min numeric := nullif(p_def.validation ->> 'min', '')::numeric; v_len int := nullif(p_def.validation ->> 'maxLength', '')::int; v_el jsonb;
begin
  if v_t = 'null' then return null; end if;
  case p_def.type
    when 'text', 'long_text', 'phone', 'email', 'url' then
      if v_t <> 'string' then return 'must be text'; end if;
      v_s := p_val #>> '{}';
      if length(v_s) > coalesce(v_len, case p_def.type when 'long_text' then 20000 else 2000 end) then return 'is too long'; end if;
      if p_def.type = 'email' and v_s !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'must be an email address'; end if;
      if p_def.type = 'phone' and v_s !~ '^\+?[0-9 ()-]{7,20}$' then return 'must be a phone number'; end if;
      if p_def.type = 'url' and v_s !~* '^https?://[^\s]+$' then return 'must be an http(s) URL'; end if;
      if p_def.validation ->> 'pattern' is not null and v_s !~ (p_def.validation ->> 'pattern') then return 'does not match the required pattern'; end if;
    when 'number', 'money', 'percent' then
      if v_t <> 'number' then return 'must be a number'; end if;
      v_n := (p_val #>> '{}')::numeric;
      if p_def.type = 'percent' and (v_n < 0 or v_n > 100) then return 'must be between 0 and 100'; end if;
      if p_def.type = 'money' and v_n < 0 then return 'must not be negative'; end if;
      if v_min is not null and v_n < v_min then return 'is below the minimum'; end if;
      if v_max is not null and v_n > v_max then return 'is above the maximum'; end if;
    when 'date' then
      if v_t <> 'string' or (p_val #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then return 'must be a date (YYYY-MM-DD)'; end if;
      perform (p_val #>> '{}')::date;
    when 'datetime' then
      if v_t <> 'string' then return 'must be a date and time'; end if;
      perform (p_val #>> '{}')::timestamptz;
    when 'boolean' then
      if v_t <> 'boolean' then return 'must be true or false'; end if;
    when 'select' then
      if v_t <> 'string' then return 'must be one of the listed choices'; end if;
      if not exists (select 1 from jsonb_array_elements(coalesce(p_def.options -> 'choices', '[]')) c where c ->> 'key' = (p_val #>> '{}')) then
        return 'is not one of the listed choices';
      end if;
    when 'multi_select' then
      if v_t <> 'array' then return 'must be a list of choices'; end if;
      for v_el in select * from jsonb_array_elements(p_val) loop
        if jsonb_typeof(v_el) <> 'string' or not exists (select 1 from jsonb_array_elements(coalesce(p_def.options -> 'choices', '[]')) c where c ->> 'key' = (v_el #>> '{}')) then
          return 'contains a value that is not a listed choice';
        end if;
      end loop;
    when 'user', 'lookup' then
      if v_t <> 'string' or (p_val #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return 'must be a record id'; end if;
    when 'rating' then
      if v_t <> 'number' or (p_val #>> '{}')::numeric <> trunc((p_val #>> '{}')::numeric) then return 'must be a whole number'; end if;
      if (p_val #>> '{}')::numeric < 1 or (p_val #>> '{}')::numeric > coalesce(nullif(p_def.options ->> 'max', '')::numeric, 5) then return 'is outside the rating range'; end if;
  end case;
  return null;
exception when others then
  return 'is not valid';
end $$;

-- BEFORE INSERT/UPDATE trigger on the tables that carry a custom jsonb column (and on records.data):
-- unknown keys, wrong types, missing required values and duplicate unique values are rejected with SQLSTATE 23514.
create or replace function metadata.validate_custom() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_col text := coalesce(tg_argv[0], 'custom'); v_doc jsonb; v_old jsonb; v_ot uuid; v_key text; v_def public.field_defs; v_err text; v_val jsonb;
  v_row jsonb := to_jsonb(new); v_tbl text := tg_table_name; v_dup boolean;
begin
  v_doc := coalesce(v_row -> v_col, '{}'::jsonb);
  if jsonb_typeof(v_doc) <> 'object' then
    raise exception '% must be a JSON object', v_col using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    v_old := coalesce(to_jsonb(old) -> v_col, '{}'::jsonb);
    if v_old = v_doc and v_tbl <> 'records' then return new; end if;
  end if;
  v_key := case v_tbl when 'leads' then 'lead' when 'contacts' then 'contact' when 'accounts' then 'account' when 'deals' then 'deal'
                      when 'tasks' then 'task' when 'campaigns' then 'campaign' when 'conversations' then 'conversation' end;
  if v_tbl = 'records' then
    v_ot := new.object_type_id;
    if not exists (select 1 from public.object_types ot where ot.id = v_ot and ot.tenant_id = new.tenant_id and ot.kind = 'custom') then
      raise exception 'unknown custom object type' using errcode = '23514';
    end if;
  else
    select ot.id into v_ot from public.object_types ot where ot.tenant_id = new.tenant_id and ot.key = v_key;
  end if;
  if v_ot is null then
    if v_doc = '{}'::jsonb then return new; end if;
    raise exception 'no object type for % (custom fields not configured)', v_tbl using errcode = '23514';
  end if;
  -- defaults for absent keys on insert
  if tg_op = 'INSERT' then
    for v_def in select * from public.field_defs f where f.object_type_id = v_ot and f.archived_at is null and f."default" is not null loop
      if not v_doc ? v_def.key then v_doc := v_doc || jsonb_build_object(v_def.key, v_def."default"); end if;
    end loop;
  end if;
  -- unknown keys
  for v_key in select k from jsonb_object_keys(v_doc) k loop
    select * into v_def from public.field_defs f where f.object_type_id = v_ot and f.key = v_key;
    if v_def.id is null or v_def.archived_at is not null then
      raise exception 'unknown custom field "%"', v_key using errcode = '23514';
    end if;
    v_val := v_doc -> v_key;
    v_err := metadata.check_value(v_def, v_val);
    if v_err is not null then
      raise exception 'custom field "%" %', v_key, v_err using errcode = '23514';
    end if;
    if v_def.unique_in_workspace and jsonb_typeof(v_val) <> 'null' then
      if v_tbl = 'records' then
        select exists (select 1 from public.records r where r.workspace_id = new.workspace_id and r.object_type_id = v_ot and r.id <> new.id
                          and r.deleted_at is null and r.data -> v_key = v_val) into v_dup;
      else
        execute format('select exists (select 1 from public.%I r where r.workspace_id = $1 and r.id <> $2 and r.custom -> $3 = $4)', v_tbl)
          into v_dup using new.workspace_id, new.id, v_key, v_val;
      end if;
      if v_dup then raise exception 'custom field "%" must be unique in the workspace', v_key using errcode = '23505'; end if;
    end if;
  end loop;
  -- required
  for v_def in select * from public.field_defs f where f.object_type_id = v_ot and f.archived_at is null and f.required loop
    if coalesce(jsonb_typeof(v_doc -> v_def.key), 'null') = 'null' then
      raise exception 'custom field "%" is required', v_def.key using errcode = '23514';
    end if;
  end loop;
  new := jsonb_populate_record(new, jsonb_build_object(v_col, v_doc));
  return new;
end $$;

-- custom jsonb on the system tables (GIN) + validation trigger
do $$
declare t text;
begin
  foreach t in array array['leads', 'contacts', 'accounts', 'deals', 'tasks', 'campaigns', 'conversations'] loop
    execute format('alter table public.%I add column if not exists custom jsonb not null default ''{}''', t);
    execute format('create index if not exists %I on public.%I using gin (custom jsonb_path_ops)', t || '_custom_gin', t);
    execute format('drop trigger if exists a20_%1$s_custom on public.%1$I', t);
    execute format('create trigger a20_%1$s_custom before insert or update of custom on public.%1$I
                    for each row execute function metadata.validate_custom(''custom'')', t);
  end loop;
end $$;
drop trigger if exists a20_records_data on public.records;
create trigger a20_records_data before insert or update of data, object_type_id on public.records
  for each row execute function metadata.validate_custom('data');

-- compiled JSON Schema snapshot + schema_version bump whenever a field definition changes
create or replace function metadata.compile_schema(p_object_type uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    '$schema', 'https://json-schema.org/draft/2020-12/schema',
    'type', 'object', 'additionalProperties', false,
    'properties', coalesce(jsonb_object_agg(f.key, (
        case f.type
          when 'text' then '{"type":"string"}'::jsonb when 'long_text' then '{"type":"string"}'::jsonb
          when 'phone' then '{"type":"string"}'::jsonb when 'email' then '{"type":"string","format":"email"}'::jsonb
          when 'url' then '{"type":"string","format":"uri"}'::jsonb
          when 'number' then '{"type":"number"}'::jsonb when 'money' then '{"type":"number","minimum":0}'::jsonb
          when 'percent' then '{"type":"number","minimum":0,"maximum":100}'::jsonb
          when 'date' then '{"type":"string","format":"date"}'::jsonb when 'datetime' then '{"type":"string","format":"date-time"}'::jsonb
          when 'boolean' then '{"type":"boolean"}'::jsonb
          when 'select' then jsonb_build_object('type', 'string', 'enum', coalesce((select jsonb_agg(c ->> 'key') from jsonb_array_elements(coalesce(f.options -> 'choices', '[]')) c), '[]'::jsonb))
          when 'multi_select' then jsonb_build_object('type', 'array', 'items', jsonb_build_object('type', 'string', 'enum', coalesce((select jsonb_agg(c ->> 'key') from jsonb_array_elements(coalesce(f.options -> 'choices', '[]')) c), '[]'::jsonb)))
          when 'user' then '{"type":"string","format":"uuid"}'::jsonb when 'lookup' then '{"type":"string","format":"uuid"}'::jsonb
          when 'rating' then jsonb_build_object('type', 'integer', 'minimum', 1, 'maximum', coalesce(nullif(f.options ->> 'max', '')::int, 5))
        end) ) filter (where f.id is not null), '{}'::jsonb),
    'required', coalesce(jsonb_agg(f.key) filter (where f.required), '[]'::jsonb))
  from public.field_defs f where f.object_type_id = p_object_type and f.archived_at is null
$$;

create or replace function metadata.field_defs_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ot uuid;
begin
  for v_ot in select distinct x from unnest(array[case when tg_op <> 'INSERT' then old.object_type_id end, case when tg_op <> 'DELETE' then new.object_type_id end]) x where x is not null loop
    update public.object_types set json_schema = metadata.compile_schema(v_ot), schema_version = schema_version + 1 where id = v_ot;
  end loop;
  return null;
end $$;
drop trigger if exists trg_field_defs_changed on public.field_defs;
create trigger trg_field_defs_changed after insert or update or delete on public.field_defs for each row execute function metadata.field_defs_changed();

-- caps: org policy max_custom_fields, custom objects only when the platform allows them
create or replace function metadata.field_defs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_max int;
begin
  select p.max_custom_fields into v_max from public.org_admin_policies p where p.tenant_id = new.tenant_id;
  if tg_op = 'INSERT' and v_max is not null
     and (select count(*) from public.field_defs f where f.tenant_id = new.tenant_id and f.archived_at is null) >= v_max then
    raise exception 'custom field limit reached for this organisation' using errcode = '23514';
  end if;
  if new.type in ('select', 'multi_select') and jsonb_typeof(coalesce(new.options -> 'choices', '[]')) <> 'array' then
    raise exception 'options.choices must be a list' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists a30_field_defs_guard on public.field_defs;
create trigger a30_field_defs_guard before insert or update on public.field_defs for each row execute function metadata.field_defs_guard();

-- ---------- 4. Pipelines: stages move under pipelines ----------
alter table public.pipeline_stages
  add column if not exists pipeline_id uuid references public.pipelines(id) on delete cascade,
  add column if not exists name jsonb,
  add column if not exists color text,
  add column if not exists outcome text check (outcome in ('open', 'won', 'lost')),
  add column if not exists sla_hours int check (sla_hours is null or sla_hours > 0),
  add column if not exists required_fields text[] not null default '{}',
  add column if not exists archived_at timestamptz;
create index if not exists pipeline_stages_pipeline on public.pipeline_stages (pipeline_id);

-- Get-or-create the default pipeline of a type for a workspace ('lead' pipelines get the six lead stages).
create or replace function metadata.default_pipeline(p_ws uuid, p_type text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_tenant uuid;
begin
  select p.id into v_id from public.pipelines p where p.workspace_id = p_ws and p.object_type = p_type and p.is_default and p.archived_at is null;
  if v_id is not null then return v_id; end if;
  select w.tenant_id into v_tenant from public.workspaces w where w.id = p_ws;
  if v_tenant is null then return null; end if;
  insert into public.pipelines (tenant_id, workspace_id, object_type, key, name, is_default, position)
  values (v_tenant, p_ws, p_type, case p_type when 'lead' then 'leads' when 'deal' then 'sales' else p_type end,
          jsonb_build_object('en', case p_type when 'lead' then 'Lead pipeline' when 'deal' then 'Sales pipeline' else initcap(p_type) end),
          true, 0)
  on conflict (workspace_id, object_type, key) do update set is_default = true, archived_at = null
  returning id into v_id;
  if p_type = 'lead' and not exists (select 1 from public.pipeline_stages s where s.pipeline_id = v_id) then
    insert into public.pipeline_stages (workspace_id, pipeline_id, key, label, name, position, probability, max_days, is_won, is_lost, outcome)
    select p_ws, v_id, x.key, x.label, jsonb_build_object('en', x.label), x.pos, x.prob, 14, x.key = 'converted', x.key = 'disqualified',
           case x.key when 'converted' then 'won' when 'disqualified' then 'lost' else 'open' end
      from (values ('new', 'New', 1, 5), ('contacted', 'Contacted', 2, 15), ('qualified', 'Qualified', 3, 40),
                   ('nurturing', 'Nurturing', 4, 20), ('disqualified', 'Disqualified', 5, 0), ('converted', 'Converted', 6, 100)) x(key, label, pos, prob);
  end if;
  return v_id;
end $$;

-- Existing deal stages -> one default deal pipeline per workspace; every workspace also gets the default lead pipeline.
do $$
declare w record;
begin
  for w in select distinct s.workspace_id from public.pipeline_stages s where s.pipeline_id is null loop
    perform metadata.default_pipeline(w.workspace_id, 'deal');
  end loop;
end $$;
update public.pipeline_stages s
   set pipeline_id = (select p.id from public.pipelines p where p.workspace_id = s.workspace_id and p.object_type = 'deal' and p.is_default and p.archived_at is null)
 where s.pipeline_id is null;
update public.pipeline_stages set name = jsonb_build_object('en', label) where name is null;
update public.pipeline_stages set outcome = case when is_won then 'won' when is_lost then 'lost' else 'open' end where outcome is null;
alter table public.pipeline_stages alter column pipeline_id set not null, alter column name set not null, alter column outcome set not null,
  alter column name set default '{}', alter column outcome set default 'open';

alter table public.pipeline_stages drop constraint if exists pipeline_stages_tenant_id_key_key;
alter table public.pipeline_stages drop constraint if exists pipeline_stages_tenant_id_position_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pipeline_stages_pipeline_key' and conrelid = 'public.pipeline_stages'::regclass) then
    alter table public.pipeline_stages add constraint pipeline_stages_pipeline_key unique (pipeline_id, key);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pipeline_stages_pipeline_position' and conrelid = 'public.pipeline_stages'::regclass) then
    alter table public.pipeline_stages add constraint pipeline_stages_pipeline_position unique (pipeline_id, position) deferrable initially immediate;
  end if;
end $$;

-- default lead pipeline (six stages from the lead_status enum) for every workspace
do $$
declare w record;
begin
  for w in select id from public.workspaces loop
    perform metadata.default_pipeline(w.id, 'lead');
  end loop;
end $$;

-- Legacy inserts (seed_workspace_defaults, old app code) keep working: pipeline defaults to the workspace's default deal pipeline,
-- name/outcome are derived, and outcome <-> is_won/is_lost stay in sync.
create or replace function metadata.pipeline_stages_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.pipeline_id is null then new.pipeline_id := metadata.default_pipeline(new.workspace_id, 'deal'); end if;
  if new.name is null or new.name = '{}'::jsonb then new.name := jsonb_build_object('en', new.label); end if;
  if tg_op = 'UPDATE' and new.outcome is distinct from old.outcome then
    new.is_won := new.outcome = 'won'; new.is_lost := new.outcome = 'lost';
  elsif tg_op = 'UPDATE' and (new.is_won is distinct from old.is_won or new.is_lost is distinct from old.is_lost) then
    new.outcome := case when new.is_won then 'won' when new.is_lost then 'lost' else 'open' end;
  elsif tg_op = 'INSERT' and new.outcome = 'open' and (new.is_won or new.is_lost) then
    new.outcome := case when new.is_won then 'won' else 'lost' end;
  elsif tg_op = 'INSERT' and new.outcome <> 'open' then
    new.is_won := new.outcome = 'won'; new.is_lost := new.outcome = 'lost';
  end if;
  return new;
end $$;
drop trigger if exists a10_pipeline_stages_defaults on public.pipeline_stages;
create trigger a10_pipeline_stages_defaults before insert or update on public.pipeline_stages
  for each row execute function metadata.pipeline_stages_defaults();

-- New workspaces get both default pipelines; new tenants get the system object types.
create or replace function metadata.workspace_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform metadata.default_pipeline(new.id, 'deal');
  perform metadata.default_pipeline(new.id, 'lead');
  return null;
end $$;
drop trigger if exists trg_workspaces_pipelines on public.workspaces;
create trigger trg_workspaces_pipelines after insert on public.workspaces for each row execute function metadata.workspace_defaults();

create or replace function metadata.seed_object_types(p_tenant uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.object_types (tenant_id, key, kind, label, primary_field, position, icon)
  select p_tenant, x.key, 'system', jsonb_build_object('en', jsonb_build_object('one', x.one, 'many', x.many)), x.pf, x.pos, x.icon
    from (values ('lead', 'Lead', 'Leads', 'full_name', 1, 'user-plus'), ('contact', 'Contact', 'Contacts', 'full_name', 2, 'user'),
                 ('account', 'Account', 'Accounts', 'name', 3, 'building'), ('deal', 'Deal', 'Deals', 'name', 4, 'handshake'),
                 ('task', 'Task', 'Tasks', 'title', 5, 'check-square'), ('campaign', 'Campaign', 'Campaigns', 'name', 6, 'megaphone'),
                 ('conversation', 'Conversation', 'Conversations', null, 7, 'message-square')) x(key, one, many, pf, pos, icon)
  on conflict (tenant_id, key) do nothing
$$;
create or replace function metadata.tenant_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform metadata.seed_object_types(new.id); return null; end $$;
drop trigger if exists trg_tenants_object_types on public.tenants;
create trigger trg_tenants_object_types after insert on public.tenants for each row execute function metadata.tenant_defaults();
select metadata.seed_object_types(t.id) from public.tenants t;

-- Leads and deals belong to a pipeline; leads also to a stage. leads.status stays as the derived bucket for the legacy views.
alter table public.leads add column if not exists pipeline_id uuid references public.pipelines(id) on delete set null,
                         add column if not exists stage_id uuid references public.pipeline_stages(id) on delete set null;
alter table public.deals add column if not exists pipeline_id uuid references public.pipelines(id) on delete set null;
create index if not exists leads_stage on public.leads (stage_id);
create index if not exists leads_pipeline on public.leads (pipeline_id);
create index if not exists deals_pipeline on public.deals (pipeline_id);

-- backfill without firing audit / event / version triggers (bookkeeping columns only)
alter table public.leads disable trigger user;
alter table public.deals disable trigger user;
update public.leads l set pipeline_id = s.pipeline_id, stage_id = s.id
  from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id and p.object_type = 'lead' and p.is_default
 where l.stage_id is null and s.workspace_id = l.workspace_id and s.key = l.status::text;
update public.deals d set pipeline_id = s.pipeline_id from public.pipeline_stages s where d.pipeline_id is null and s.id = d.stage_id;
alter table public.leads enable trigger user;
alter table public.deals enable trigger user;

create or replace function metadata.leads_stage_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_st public.pipeline_stages; v_pipe uuid; v_status public.lead_status;
begin
  if new.stage_id is not null and (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id) then
    -- the stage drives the status bucket
    select * into v_st from public.pipeline_stages s where s.id = new.stage_id;
    if v_st.id is null or v_st.workspace_id <> new.workspace_id then
      raise exception 'stage belongs to another workspace' using errcode = '23514';
    end if;
    new.pipeline_id := v_st.pipeline_id;
    select e into v_status from unnest(enum_range(null::public.lead_status)) e where e::text = v_st.key;
    if v_status is null then
      v_status := case v_st.outcome when 'won' then 'converted' when 'lost' then 'disqualified'
                    else case when new.status in ('converted', 'disqualified') then 'contacted' else new.status end end;
    end if;
    new.status := v_status;
  elsif tg_op = 'INSERT' or new.status is distinct from old.status or new.stage_id is null then
    -- legacy writers set status; the stage follows
    v_pipe := coalesce(new.pipeline_id, metadata.default_pipeline(new.workspace_id, 'lead'));
    select s.* into v_st from public.pipeline_stages s where s.pipeline_id = v_pipe and s.key = new.status::text and s.archived_at is null;
    if v_st.id is not null then new.pipeline_id := v_pipe; new.stage_id := v_st.id; end if;
  end if;
  return new;
end $$;
drop trigger if exists z8_leads_stage_sync on public.leads;
create trigger z8_leads_stage_sync before insert or update on public.leads for each row execute function metadata.leads_stage_sync();

create or replace function metadata.deals_pipeline_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select s.pipeline_id into new.pipeline_id from public.pipeline_stages s where s.id = new.stage_id;
  return new;
end $$;
drop trigger if exists z8_deals_pipeline_sync on public.deals;
create trigger z8_deals_pipeline_sync before insert or update of stage_id on public.deals for each row execute function metadata.deals_pipeline_sync();

-- The deal funnel view lists deal pipelines only (lead stages live in the same table now). Same columns, same rows for existing data.
create or replace view public.v_pipeline_summary with (security_barrier = true) as
select s.workspace_id, s.id as stage_id, s.key, s.label, s.position, s.probability,
       count(d.id) as deals,
       coalesce(sum(d.value_inr), 0) as value_inr,
       round(coalesce(sum(d.value_inr * s.probability / 100.0), 0), 2) as weighted_value_inr,
       count(d.id) filter (where now() - d.stage_entered_at > make_interval(days => s.max_days)) as stuck_deals
  from public.pipeline_stages s
  join public.pipelines p on p.id = s.pipeline_id and p.object_type = 'deal'
  left join public.deals d on d.stage_id = s.id and d.deleted_at is null
 where s.workspace_id in (select public.role_ws_ids('owner','sales_manager','marketing','data','viewer'))
 group by s.workspace_id, s.id;
grant select on public.v_pipeline_summary to authenticated;

-- ---------- 5. RLS ----------
-- tenant-level metadata: any member of the tenant reads; writers need the permission as a real member of one of its workspaces
do $$ begin
  perform private.rls_put('object_types', 'select', 'tenant_id in (select public.member_tenant_ids())', null);
  perform private.rls_put('object_types', 'insert', null,
    $p$kind = 'custom' and tenant_id in (select authz.tenant_ids_with('objects.manage', 'all')) and authz.org_allows(tenant_id, 'allow_custom_objects')$p$);
  perform private.rls_put('object_types', 'update',
    $p$tenant_id in (select authz.tenant_ids_with('objects.manage', 'all')) or tenant_id in (select authz.tenant_ids_with('fields.manage', 'all'))$p$,
    $p$(tenant_id in (select authz.tenant_ids_with('objects.manage', 'all')) or tenant_id in (select authz.tenant_ids_with('fields.manage', 'all')))
       and (kind = 'system' or authz.org_allows(tenant_id, 'allow_custom_objects'))$p$);
  perform private.rls_put('object_types', 'delete',
    $p$kind = 'custom' and tenant_id in (select authz.tenant_ids_with('objects.manage', 'all'))$p$, null);

  perform private.rls_put('field_defs', 'select', 'tenant_id in (select public.member_tenant_ids())', null);
  perform private.rls_put('field_defs', 'insert', null, $p$tenant_id in (select authz.tenant_ids_with('fields.manage', 'all'))$p$);
  perform private.rls_put('field_defs', 'update', $p$tenant_id in (select authz.tenant_ids_with('fields.manage', 'all'))$p$,
                          $p$tenant_id in (select authz.tenant_ids_with('fields.manage', 'all'))$p$);
  perform private.rls_put('field_defs', 'delete', $p$tenant_id in (select authz.tenant_ids_with('fields.manage', 'all'))$p$, null);

  -- records: obj:<key>.read|write|delete resolved through object_types.key (authz.record_ok), plus shared tuples
  perform private.rls_put('records', 'select',
    $p$deleted_at is null and (authz.record_ok(workspace_id, object_type_id, 'read', owner_id) or id in (select authz.shared_record_ids('viewer')))$p$, null);
  perform private.rls_put('records', 'insert', null,
    $p$authz.record_ok(workspace_id, object_type_id, 'write', owner_id, to_jsonb(records)) and created_by is not distinct from (select auth.uid())$p$);
  perform private.rls_put('records', 'update',
    $p$authz.record_ok(workspace_id, object_type_id, 'write', owner_id) or id in (select authz.shared_record_ids('editor'))$p$,
    $p$authz.record_ok(workspace_id, object_type_id, 'write', owner_id, to_jsonb(records)) or id in (select authz.shared_record_ids('editor'))$p$);
  perform private.rls_put('records', 'delete', $p$authz.record_ok(workspace_id, object_type_id, 'delete', owner_id)$p$, null);

  -- links: both ends readable to see; editing the from end + reading the to end to create; editing the from end to delete
  perform private.rls_put('record_links', 'select',
    $p$workspace_id in (select public.member_ws_ids())
       and authz.check(workspace_id, authz.object_perm(from_type, 'read'), from_type, from_id)
       and authz.check(workspace_id, authz.object_perm(to_type, 'read'), to_type, to_id)$p$, null);
  perform private.rls_put('record_links', 'insert', null,
    $p$workspace_id in (select public.member_ws_ids())
       and authz.check(workspace_id, authz.object_perm(from_type, 'write'), from_type, from_id)
       and authz.check(workspace_id, authz.object_perm(to_type, 'read'), to_type, to_id)$p$);
  perform private.rls_put('record_links', 'delete',
    $p$workspace_id in (select public.member_ws_ids()) and authz.check(workspace_id, authz.object_perm(from_type, 'write'), from_type, from_id)$p$, null);

  -- pipelines (stages policy was rebuilt in 0016 on pipelines.manage)
  perform private.rls_put('pipelines', 'select', 'workspace_id in (select public.member_ws_ids())', null);
  perform private.rls_put('pipelines', 'insert', null, 'workspace_id in (select authz.ws_with(''pipelines.manage'', ''all''))');
  perform private.rls_put('pipelines', 'update', 'workspace_id in (select authz.ws_with(''pipelines.manage'', ''all''))',
                          'workspace_id in (select authz.ws_with(''pipelines.manage'', ''all''))');
  perform private.rls_put('pipelines', 'delete', 'workspace_id in (select authz.ws_with(''pipelines.manage'', ''all''))', null);

  -- layouts (org-wide rows have no workspace)
  perform private.rls_put('layouts', 'select',
    '(workspace_id is null and tenant_id in (select public.member_tenant_ids())) or workspace_id in (select public.member_ws_ids())', null);
  perform private.rls_put('layouts', 'insert', null,
    '((workspace_id is null and tenant_id in (select authz.tenant_ids_with(''layouts.manage'', ''all''))) or workspace_id in (select authz.ws_with(''layouts.manage'', ''all'')))
     and (workspace_id is null or tenant_id = (select w.tenant_id from public.workspaces w where w.id = layouts.workspace_id))');
  perform private.rls_put('layouts', 'update',
    '(workspace_id is null and tenant_id in (select authz.tenant_ids_with(''layouts.manage'', ''all''))) or workspace_id in (select authz.ws_with(''layouts.manage'', ''all''))',
    '((workspace_id is null and tenant_id in (select authz.tenant_ids_with(''layouts.manage'', ''all''))) or workspace_id in (select authz.ws_with(''layouts.manage'', ''all'')))
     and (workspace_id is null or tenant_id = (select w.tenant_id from public.workspaces w where w.id = layouts.workspace_id))');
  perform private.rls_put('layouts', 'delete',
    '(workspace_id is null and tenant_id in (select authz.tenant_ids_with(''layouts.manage'', ''all''))) or workspace_id in (select authz.ws_with(''layouts.manage'', ''all''))', null);

  -- saved views: private = owner, team = owner's team, workspace = members; sharing needs views.share
  perform private.rls_put('saved_views', 'select',
    $p$workspace_id in (select public.member_ws_ids())
       and (visibility = 'workspace' or owner_id = (select auth.uid()) or (visibility = 'team' and owner_id in (select authz.team_user_ids(workspace_id))))$p$, null);
  perform private.rls_put('saved_views', 'insert', null,
    $p$workspace_id in (select public.member_ws_ids()) and owner_id = (select auth.uid())
       and (visibility = 'private' or workspace_id in (select authz.ws_with('views.share', 'all')))
       and object_type_id in (select ot.id from public.object_types ot where ot.tenant_id = saved_views.tenant_id)$p$);
  perform private.rls_put('saved_views', 'update',
    $p$workspace_id in (select public.member_ws_ids()) and (owner_id = (select auth.uid()) or workspace_id in (select authz.ws_with('views.share', 'all')))$p$,
    $p$workspace_id in (select public.member_ws_ids()) and (visibility = 'private' or workspace_id in (select authz.ws_with('views.share', 'all')))
       and (owner_id = (select auth.uid()) or workspace_id in (select authz.ws_with('views.share', 'all')))
       and object_type_id in (select ot.id from public.object_types ot where ot.tenant_id = saved_views.tenant_id)$p$);
  perform private.rls_put('saved_views', 'delete',
    $p$workspace_id in (select public.member_ws_ids()) and (owner_id = (select auth.uid()) or workspace_id in (select authz.ws_with('views.share', 'all')))$p$, null);
end $$;

-- ---------- 6. Grants ----------
revoke all on public.object_types, public.field_defs, public.records, public.record_links, public.pipelines, public.layouts, public.saved_views from anon;
grant select, insert, update, delete on public.object_types, public.field_defs, public.records, public.record_links,
  public.pipelines, public.layouts, public.saved_views to authenticated;
grant all on public.object_types, public.field_defs, public.records, public.record_links, public.pipelines, public.layouts, public.saved_views to service_role;
revoke all on all functions in schema metadata from public, anon;
grant execute on function metadata.check_value(public.field_defs, jsonb), metadata.compile_schema(uuid) to authenticated, service_role;

-- ---------- 7. Self-check ----------
do $$
begin
  assert (select count(*) from public.pipeline_stages where pipeline_id is null) = 0, '0017: pipeline_stages without pipeline';
  assert not exists (select 1 from public.leads l where l.stage_id is null and exists (select 1 from public.pipeline_stages s where s.workspace_id = l.workspace_id and s.key = l.status::text and s.pipeline_id in (select id from public.pipelines where object_type = 'lead'))), '0017: leads not backfilled to stages';
  assert not exists (select 1 from public.deals where pipeline_id is null), '0017: deals without pipeline';
end $$;
