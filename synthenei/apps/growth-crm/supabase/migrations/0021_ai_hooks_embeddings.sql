-- 0021 AI hooks + embeddings (BUILD-PLAN 2.9, T031) plus the 0021 items of docs/migrations-backlog.md.
--   AI:            pgvector, ai_providers (BYOK via vault ids), ai_policies (replaces the AI_OFF constant), ai_usage (monthly partitions),
--                  ai_audit, agents (+ bot user and role are mandatory), agent_triggers, agent_runs, agent queue + agent_enqueue(),
--                  embeddings (RLS mirrors the source object through authz.check), ai_cap_status() caps function.
--   Backlog 0021:  mock connector catalogue + availability, unique (workspace_id, connector_id) on integrations, connector.scan scheduled
--                  job (every 15 min), conversations.status 'snoozed', notification quiet hours + dedupe_key (unique per user),
--                  event types (segment.*, audience.exported, comment/mention, plus lead.exported and ops.test which the app already emits),
--                  can_contact_many(uuid[], purpose), audit trigger on audience_segments.
--   Webhooks:      webhook_endpoints.options / last_success_at, webhook_bump_failures() atomic counter.
--   Custom fields: metadata.validate_custom() no longer rejects an UNCHANGED value under a retired (archived) key; field_defs.version.
-- Forward-only and idempotent. Requires 0020. RLS on every new table; no policy and no grant lets a client write what only a job may write.
begin;

-- ---------- 1. Extension ----------
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- ---------- 2. Helpers ----------
-- A bot user is an auth user whose server-only app_metadata says kind = 'agent'. Users cannot edit app_metadata, so a human cannot
-- promote themselves into a bot. (Created by the service through the Auth admin API, never by a signup.)
create or replace function authz.is_bot_user(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select u.raw_app_meta_data ->> 'kind' = 'agent' from auth.users u where u.id = p_user), false)
$$;
revoke all on function authz.is_bot_user(uuid) from public, anon;
grant execute on function authz.is_bot_user(uuid) to authenticated, service_role;

-- True when the caller IS the bot user of the given agent (used by agent_runs policies so they do not depend on agents RLS).
create or replace function authz.is_agent_bot(p_agent uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (select 1 from public.agents a where a.id = p_agent and a.bot_user_id = (select auth.uid()));
end
$$;
revoke all on function authz.is_agent_bot(uuid) from public, anon;
grant execute on function authz.is_agent_bot(uuid) to authenticated, service_role;

-- ---------- 3. AI tables ----------
create table if not exists public.ai_providers (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  provider       text not null check (provider in ('anthropic', 'openai', 'google', 'azure_openai', 'bedrock', 'openrouter')),
  secret_id      uuid,                                   -- vault secret (BYOK); null = the platform key. Never selectable by clients.
  has_secret     boolean generated always as (secret_id is not null) stored,
  default_model  text,
  allowed_models text[] not null default '{}',
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ai_providers_tenant_provider unique (tenant_id, provider)
);
create index if not exists ai_providers_tenant on public.ai_providers (tenant_id, created_at desc);

create table if not exists public.ai_policies (
  tenant_id          uuid primary key references public.tenants(id) on delete cascade,
  monthly_call_cap   int    check (monthly_call_cap is null or monthly_call_cap >= 0),     -- null = no cap of its own (the plan limit still applies)
  monthly_token_cap  bigint check (monthly_token_cap is null or monthly_token_cap >= 0),
  per_user_daily_cap int    check (per_user_daily_cap is null or per_user_daily_cap >= 0),
  pii_redaction      boolean not null default true,
  store_prompts      text not null default 'redacted' check (store_prompts in ('none', 'redacted', 'full')),
  features           jsonb not null default '{}' check (jsonb_typeof(features) = 'object'),  -- {"reply_draft": true, ...}; absent = off
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles(id) on delete set null
);

create table if not exists public.ai_usage (
  id             bigint generated always as identity,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  principal_kind text not null check (principal_kind in ('user', 'agent', 'api_key', 'system', 'connector')),
  principal_id   uuid,
  feature        text not null check (length(feature) between 1 and 60),
  provider       text not null,
  model          text not null,
  input_tokens   int not null default 0 check (input_tokens >= 0),
  output_tokens  int not null default 0 check (output_tokens >= 0),
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),
  latency_ms     int check (latency_ms is null or latency_ms >= 0),
  at             timestamptz not null default now(),
  primary key (id, at)
) partition by range (at);
create index if not exists ai_usage_ws_at on public.ai_usage (workspace_id, at desc);
create index if not exists ai_usage_tenant_at on public.ai_usage (tenant_id, at desc);
create index if not exists ai_usage_principal on public.ai_usage (principal_id, at desc) where principal_id is not null;
create table if not exists public.ai_usage_default partition of public.ai_usage default;
alter table public.ai_usage_default enable row level security;
revoke all on public.ai_usage_default from anon, authenticated;
select private.ensure_month_partitions('public.ai_usage', date '2026-10-01', 15);

create table if not exists public.ai_audit (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  principal_kind  text not null check (principal_kind in ('user', 'agent', 'api_key', 'system', 'connector')),
  principal_id    uuid,
  feature         text not null check (length(feature) between 1 and 60),
  model           text not null,
  prompt_redacted text,
  tool_calls      jsonb not null default '[]' check (jsonb_typeof(tool_calls) = 'array'),
  output_excerpt  text check (output_excerpt is null or length(output_excerpt) <= 4000),
  source_refs     jsonb not null default '[]' check (jsonb_typeof(source_refs) = 'array'),
  ai_insight_id   uuid references public.ai_insights(id) on delete set null,
  at              timestamptz not null default now()
);
create index if not exists ai_audit_ws_at on public.ai_audit (workspace_id, at desc);
create index if not exists ai_audit_tenant on public.ai_audit (tenant_id);
create index if not exists ai_audit_insight on public.ai_audit (ai_insight_id) where ai_insight_id is not null;

-- ---------- 4. Agents ----------
-- An agent never runs as the service role: it acts through its own bot user, with the permissions of a role in the agent's workspace.
create table if not exists public.agents (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 2 and 80),
  instructions text not null default '' check (length(instructions) <= 20000),
  provider     text not null default 'anthropic' check (provider in ('anthropic', 'openai', 'google', 'azure_openai', 'bedrock', 'openrouter')),
  model        text,
  tools        text[] not null default '{}',
  role_id      uuid not null references public.roles(id),
  bot_user_id  uuid not null references public.profiles(id),
  enabled      boolean not null default false,
  version      int not null default 1,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint agents_ws_name unique (workspace_id, name),
  constraint agents_ws_bot unique (workspace_id, bot_user_id)
);
create index if not exists agents_ws on public.agents (workspace_id, created_at desc);
create index if not exists agents_tenant on public.agents (tenant_id);
create index if not exists agents_role on public.agents (role_id);
create index if not exists agents_bot on public.agents (bot_user_id);
create index if not exists agents_created_by on public.agents (created_by) where created_by is not null;

create table if not exists public.agent_triggers (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  agent_id         uuid not null references public.agents(id) on delete cascade,
  kind             text not null check (kind in ('event', 'schedule', 'webhook')),
  event_types      text[] not null default '{}',
  filter           jsonb not null default '{}' check (jsonb_typeof(filter) = 'object'),
  cron             text check (cron is null or length(cron) between 5 and 100),
  webhook_secret_id uuid,                                    -- vault
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint agent_triggers_shape check (
    (kind = 'event' and cardinality(event_types) > 0 and cron is null)
    or (kind = 'schedule' and cron is not null and cardinality(event_types) = 0)
    or (kind = 'webhook' and cardinality(event_types) = 0 and cron is null and (webhook_secret_id is not null or not enabled)))
);
create index if not exists agent_triggers_agent on public.agent_triggers (agent_id);
create index if not exists agent_triggers_ws on public.agent_triggers (workspace_id, created_at desc);
create index if not exists agent_triggers_tenant on public.agent_triggers (tenant_id);
create index if not exists agent_triggers_events on public.agent_triggers using gin (event_types) where kind = 'event' and enabled;

create table if not exists public.agent_runs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  agent_id        uuid not null references public.agents(id) on delete cascade,
  trigger_id      uuid references public.agent_triggers(id) on delete set null,
  event_id        bigint,                                      -- events is partitioned: no foreign key
  status          text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped')),
  steps           jsonb not null default '[]' check (jsonb_typeof(steps) = 'array'),
  tokens_in       int not null default 0 check (tokens_in >= 0),
  tokens_out      int not null default 0 check (tokens_out >= 0),
  cost_micro_usd  bigint not null default 0 check (cost_micro_usd >= 0),
  error           text check (error is null or length(error) <= 2000),
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);
create index if not exists agent_runs_agent on public.agent_runs (agent_id, created_at desc);
create index if not exists agent_runs_ws on public.agent_runs (workspace_id, created_at desc);
create index if not exists agent_runs_tenant on public.agent_runs (tenant_id);
create index if not exists agent_runs_trigger on public.agent_runs (trigger_id) where trigger_id is not null;
create index if not exists agent_runs_open on public.agent_runs (status, created_at) where status in ('queued', 'running');

-- ---------- 5. Embeddings ----------
create table if not exists public.embeddings (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  object_type  text not null check (object_type ~ '^[a-z][a-z0-9_:-]{1,60}$'),   -- 'lead', 'obj:<key>', ... as in relationship_tuples
  object_id    uuid not null,
  chunk_ix     int not null default 0 check (chunk_ix >= 0),
  content_hash text not null check (length(content_hash) between 16 and 128),
  model        text not null,
  dims         smallint not null default 1024 check (dims = 1024),      -- the column is vector(1024); other sizes need a new column
  embedding    extensions.vector(1024) not null,
  created_at   timestamptz not null default now(),
  constraint embeddings_chunk unique (tenant_id, object_type, object_id, chunk_ix, model)
);
create index if not exists embeddings_ws_obj on public.embeddings (workspace_id, object_type, object_id);
create index if not exists embeddings_tenant on public.embeddings (tenant_id);
create index if not exists embeddings_hnsw on public.embeddings using hnsw (embedding extensions.vector_cosine_ops);

-- ---------- 6. Triggers ----------
do $$
declare t text;
begin
  foreach t in array array['ai_usage', 'ai_audit', 'agents', 'embeddings'] loop
    execute format('drop trigger if exists a00_%1$s_tenant on public.%1$I', t);
    execute format('create trigger a00_%1$s_tenant before insert or update of workspace_id, tenant_id on public.%1$I
                    for each row execute function public.set_tenant_from_workspace()', t);
  end loop;
  foreach t in array array['ai_providers', 'ai_policies', 'agents'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['ai_providers', 'ai_policies', 'agents', 'agent_triggers'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

drop trigger if exists z9_agents_version on public.agents;
create trigger z9_agents_version before update on public.agents for each row execute function public.bump_version();

-- Agent rules: the bot is a real bot user, the role is visible to the tenant and is never an owner role, an enabled agent holds exactly that
-- role in its workspace (active membership), and a platform admin can never be a bot.
create or replace function private.agents_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_role public.roles;
begin
  if not authz.is_bot_user(new.bot_user_id) then
    raise exception 'an agent needs a bot user (auth app_metadata kind = agent)' using errcode = '23514';
  end if;
  if exists (select 1 from public.platform_admins pa where pa.user_id = new.bot_user_id) then
    raise exception 'a bot user cannot be a platform admin' using errcode = '23514';
  end if;
  select * into v_role from public.roles r where r.id = new.role_id;
  if v_role.id is null or (v_role.tenant_id is not null and v_role.tenant_id is distinct from new.tenant_id) then
    raise exception 'unknown role for this tenant' using errcode = '23514';
  end if;
  if v_role.base_role = 'owner' then
    raise exception 'an agent cannot hold an owner role' using errcode = '23514';
  end if;
  if new.enabled and not exists (select 1 from public.memberships m
        where m.user_id = new.bot_user_id and m.workspace_id = new.workspace_id and m.role_id = new.role_id and m.is_active
          and (m.valid_until is null or m.valid_until > now())) then
    raise exception 'the bot user needs an active membership with the agent role in the workspace' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists a30_agents_guard on public.agents;
create trigger a30_agents_guard before insert or update on public.agents for each row execute function private.agents_guard();

-- A bot membership that is removed, deactivated or moved to another role switches its agents off (fail closed).
create or replace function private.agents_membership_drift() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.agents a set enabled = false
   where a.bot_user_id = old.user_id and a.workspace_id = old.workspace_id and a.enabled
     and (tg_op = 'DELETE' or not new.is_active or new.role_id is distinct from a.role_id
          or (new.valid_until is not null and new.valid_until <= now()));
  return null;
end $$;
drop trigger if exists z8_memberships_agents on public.memberships;
create trigger z8_memberships_agents after update or delete on public.memberships for each row execute function private.agents_membership_drift();

-- Triggers and runs take tenant and workspace from their agent (a client cannot point them elsewhere).
create or replace function private.agent_child_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select a.tenant_id, a.workspace_id into new.tenant_id, new.workspace_id from public.agents a where a.id = new.agent_id;
  if new.tenant_id is null then raise exception 'unknown agent' using errcode = '23503'; end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['agent_triggers', 'agent_runs'] loop
    execute format('drop trigger if exists a00_%1$s_scope on public.%1$I', t);
    execute format('create trigger a00_%1$s_scope before insert or update of agent_id on public.%1$I
                    for each row execute function private.agent_child_scope()', t);
  end loop;
end $$;

-- Event triggers may only name agent-eligible event types (exact, or a "domain.*" wildcard that matches at least one).
create or replace function private.agent_triggers_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_t text;
begin
  foreach v_t in array new.event_types loop
    if not exists (select 1 from public.event_types e where e.agent_eligible
                    and (e.type = v_t or (v_t like '%.*' and starts_with(e.type, left(v_t, -1))))) then
      raise exception 'event type "%" is unknown or not agent-eligible', v_t using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists a30_agent_triggers_guard on public.agent_triggers;
create trigger a30_agent_triggers_guard before insert or update of event_types on public.agent_triggers
  for each row execute function private.agent_triggers_guard();

-- store_prompts = 'none': prompt and output text are never kept in the audit row.
create or replace function private.ai_audit_policy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select p.store_prompts from public.ai_policies p where p.tenant_id = new.tenant_id) = 'none' then
    new.prompt_redacted := null; new.output_excerpt := null;
  end if;
  return new;
end $$;
drop trigger if exists a40_ai_audit_policy on public.ai_audit;
create trigger a40_ai_audit_policy before insert on public.ai_audit for each row execute function private.ai_audit_policy();

-- Every tenant has an ai_policies row: all features off until a tenant admin switches them on.
create or replace function private.tenant_ai_policy_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ai_policies (tenant_id) values (new.id) on conflict (tenant_id) do nothing;
  return null;
end $$;
drop trigger if exists trg_tenants_ai_policy on public.tenants;
create trigger trg_tenants_ai_policy after insert on public.tenants for each row execute function private.tenant_ai_policy_default();
insert into public.ai_policies (tenant_id) select t.id from public.tenants t on conflict (tenant_id) do nothing;

-- ---------- 7. Queue, enqueue RPC, caps function ----------
select pgmq.create('agent');
select pgmq.create('agent_dlq');

-- Queue one agent run. Callers: the event fan-out (service, auth.uid() null) or a member holding ai.toggle (manual "run now").
-- The run itself executes as the agent's bot user, never as the service role.
create or replace function public.agent_enqueue(p_agent uuid, p_trigger uuid default null, p_event bigint default null,
                                                p_input jsonb default '{}') returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare a public.agents; v_run uuid;
begin
  select * into a from public.agents x where x.id = p_agent;
  if a.id is null then raise exception 'unknown agent' using errcode = '22023'; end if;
  if (select auth.uid()) is not null and a.workspace_id not in (select authz.ws_with_member('ai.toggle', 'all')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not a.enabled then raise exception 'agent is disabled' using errcode = '22023'; end if;
  if p_trigger is not null and not exists (select 1 from public.agent_triggers t where t.id = p_trigger and t.agent_id = a.id) then
    raise exception 'trigger does not belong to the agent' using errcode = '22023';
  end if;
  insert into public.agent_runs (agent_id, trigger_id, event_id, status) values (a.id, p_trigger, p_event, 'queued') returning id into v_run;
  perform pgmq.send('agent', jsonb_build_object('kind', 'agent.run', 'tenant_id', a.tenant_id,
    'payload', jsonb_build_object('run_id', v_run, 'agent_id', a.id, 'trigger_id', p_trigger, 'event_id', p_event,
                                  'workspace_id', a.workspace_id, 'input', coalesce(p_input, '{}'::jsonb))));
  return v_run;
end $$;
revoke all on function public.agent_enqueue(uuid, uuid, bigint, jsonb) from public, anon;
grant execute on function public.agent_enqueue(uuid, uuid, bigint, jsonb) to authenticated, service_role;

-- Caps for one more AI call by p_user (default: the caller). Month and day are IST. A null cap means "no cap of its own";
-- the plan limit "ai_calls" (plans.limits) is checked too. Returns {allowed, reason, usage:{...}, caps:{...}}.
create or replace function public.ai_cap_status(p_tenant uuid, p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := coalesce(p_user, (select auth.uid()));
  p public.ai_policies;
  v_plan_calls bigint;
  v_m0 timestamptz := (date_trunc('month', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata';
  v_d0 timestamptz := (date_trunc('day', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata';
  v_calls bigint; v_tokens bigint; v_ucalls bigint; v_reason text;
begin
  if (select auth.uid()) is not null and not (p_tenant in (select public.member_tenant_ids())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into p from public.ai_policies x where x.tenant_id = p_tenant;
  select nullif(pl.limits ->> 'ai_calls', '')::bigint into v_plan_calls
    from public.tenant_subscriptions s join public.plans pl on pl.id = s.plan_id where s.tenant_id = p_tenant;
  select count(*), coalesce(sum(u.input_tokens + u.output_tokens), 0) into v_calls, v_tokens
    from public.ai_usage u where u.tenant_id = p_tenant and u.at >= v_m0;
  select count(*) into v_ucalls from public.ai_usage u
   where u.tenant_id = p_tenant and u.principal_id = v_user and u.at >= v_d0;
  v_reason := case
    when p.monthly_call_cap is not null and v_calls >= p.monthly_call_cap then 'monthly_calls'
    when v_plan_calls is not null and v_calls >= v_plan_calls then 'plan_calls'
    when p.monthly_token_cap is not null and v_tokens >= p.monthly_token_cap then 'monthly_tokens'
    when p.per_user_daily_cap is not null and v_user is not null and v_ucalls >= p.per_user_daily_cap then 'user_daily'
    else null end;
  return jsonb_build_object('allowed', v_reason is null, 'reason', v_reason,
    'usage', jsonb_build_object('calls_month', v_calls, 'tokens_month', v_tokens, 'user_calls_today', v_ucalls),
    'caps', jsonb_build_object('monthly_call_cap', p.monthly_call_cap, 'monthly_token_cap', p.monthly_token_cap,
                               'per_user_daily_cap', p.per_user_daily_cap, 'plan_calls', v_plan_calls));
end $$;
revoke all on function public.ai_cap_status(uuid, uuid) from public, anon;
grant execute on function public.ai_cap_status(uuid, uuid) to authenticated, service_role;

-- Partitions for ai_usage, kept ahead by pg_cron (separate job: the 0014 maintenance function is not touched).
create or replace function private.ai_maintenance() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_month_partitions('public.ai_usage', date_trunc('month', now())::date, 4);
end $$;
revoke all on function private.ai_maintenance() from public, anon, authenticated;
grant execute on function private.ai_maintenance() to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('gcrm_ai_maintenance', '17 * * * *', $cron$select private.ai_maintenance()$cron$);
  end if;
end $$;

-- ---------- 8. RLS for the AI tables ----------
alter table public.ai_providers   enable row level security;
alter table public.ai_policies    enable row level security;
alter table public.ai_usage       enable row level security;
alter table public.ai_audit       enable row level security;
alter table public.agents         enable row level security;
alter table public.agent_triggers enable row level security;
alter table public.agent_runs     enable row level security;
alter table public.embeddings     enable row level security;

-- providers: tenant admins (ai.toggle) only
drop policy if exists ai_providers_select on public.ai_providers;
create policy ai_providers_select on public.ai_providers for select to authenticated
  using (tenant_id in (select authz.tenant_ids_with('ai.toggle', 'all')));
drop policy if exists ai_providers_insert on public.ai_providers;
create policy ai_providers_insert on public.ai_providers for insert to authenticated
  with check (tenant_id in (select authz.tenant_ids_with('ai.toggle', 'all')));
drop policy if exists ai_providers_update on public.ai_providers;
create policy ai_providers_update on public.ai_providers for update to authenticated
  using (tenant_id in (select authz.tenant_ids_with('ai.toggle', 'all')))
  with check (tenant_id in (select authz.tenant_ids_with('ai.toggle', 'all')));
drop policy if exists ai_providers_delete on public.ai_providers;
create policy ai_providers_delete on public.ai_providers for delete to authenticated
  using (tenant_id in (select authz.tenant_ids_with('ai.toggle', 'all')));

-- policies: every member of the tenant reads (the gateway needs the feature flags), ai.toggle holders write; rows are never deleted by clients
drop policy if exists ai_policies_select on public.ai_policies;
create policy ai_policies_select on public.ai_policies for select to authenticated
  using (tenant_id in (select public.member_tenant_ids()) or (select public.is_platform_admin()));
drop policy if exists ai_policies_insert on public.ai_policies;
create policy ai_policies_insert on public.ai_policies for insert to authenticated
  with check (tenant_id in (select authz.tenant_ids_with('ai.toggle', 'all')));
drop policy if exists ai_policies_update on public.ai_policies;
create policy ai_policies_update on public.ai_policies for update to authenticated
  using (tenant_id in (select authz.tenant_ids_with('ai.toggle', 'all')))
  with check (tenant_id in (select authz.tenant_ids_with('ai.toggle', 'all')));

-- usage and audit: admins read the workspace, everyone reads their own usage; append-only, and only as yourself (user or agent bot)
drop policy if exists ai_usage_select on public.ai_usage;
create policy ai_usage_select on public.ai_usage for select to authenticated
  using (workspace_id in (select authz.ws_with('ai.toggle', 'all')) or principal_id = (select auth.uid()));
drop policy if exists ai_usage_insert on public.ai_usage;
create policy ai_usage_insert on public.ai_usage for insert to authenticated
  with check (workspace_id in (select authz.ws_with('ai.use', 'own')) and principal_kind in ('user', 'agent')
              and principal_id = (select auth.uid()));
drop policy if exists ai_audit_select on public.ai_audit;
create policy ai_audit_select on public.ai_audit for select to authenticated
  using (workspace_id in (select authz.ws_with('ai.toggle', 'all')) or principal_id = (select auth.uid()));
drop policy if exists ai_audit_insert on public.ai_audit;
create policy ai_audit_insert on public.ai_audit for insert to authenticated
  with check (workspace_id in (select authz.ws_with('ai.use', 'own')) and principal_kind in ('user', 'agent')
              and principal_id = (select auth.uid()));

-- agents and triggers: ai.use reads, ai.toggle (real members, never a support session) writes
select private.rls_table('agents', null, array['ai.use'], null, null, null,
                         array['ai.toggle'], null, null, array['ai.toggle'], null, true, false);
select private.rls_table('agent_triggers', null, array['ai.use'], null, null, null,
                         array['ai.toggle'], null, null, array['ai.toggle'], null, true, false);

-- runs: admins read; the agent's own bot user (its JWT) creates and updates its runs; nobody deletes
drop policy if exists agent_runs_select on public.agent_runs;
create policy agent_runs_select on public.agent_runs for select to authenticated
  using (workspace_id in (select authz.ws_with('ai.toggle', 'all')) or (select authz.is_agent_bot(agent_id)));
drop policy if exists agent_runs_insert on public.agent_runs;
create policy agent_runs_insert on public.agent_runs for insert to authenticated
  with check (workspace_id in (select authz.ws_with_member('ai.toggle', 'all')) or (select authz.is_agent_bot(agent_id)));
drop policy if exists agent_runs_update on public.agent_runs;
create policy agent_runs_update on public.agent_runs for update to authenticated
  using ((select authz.is_agent_bot(agent_id)))
  with check ((select authz.is_agent_bot(agent_id)));

-- embeddings: a row is visible exactly when its source object is (same decision the source table's RLS makes). Written by the embedding
-- job only (service role): the index is derived data, there is no client write path.
drop policy if exists embeddings_select on public.embeddings;
create policy embeddings_select on public.embeddings for select to authenticated
  using (workspace_id in (select authz.ws_with('ai.use', 'own'))
         and authz.check(workspace_id, authz.object_perm(object_type, 'read'), object_type, object_id));

-- ---------- 9. Grants ----------
revoke all on public.ai_providers, public.ai_policies, public.ai_usage, public.ai_audit, public.agents, public.agent_triggers,
  public.agent_runs, public.embeddings from anon, authenticated;
-- secret_id is never readable or writable by clients (set by the vault wrapper, service role)
grant select (id, tenant_id, provider, has_secret, default_model, allowed_models, enabled, created_at, updated_at) on public.ai_providers to authenticated;
grant insert (tenant_id, provider, default_model, allowed_models, enabled) on public.ai_providers to authenticated;
grant update (default_model, allowed_models, enabled) on public.ai_providers to authenticated;
grant delete on public.ai_providers to authenticated;
grant select, insert, update on public.ai_policies to authenticated;
grant select, insert on public.ai_usage, public.ai_audit to authenticated;
grant select, insert, update, delete on public.agents, public.agent_triggers to authenticated;
grant select, insert, update on public.agent_runs to authenticated;
grant select on public.embeddings to authenticated;
grant select, insert, update, delete on public.ai_providers, public.ai_policies, public.ai_usage, public.ai_audit, public.agents,
  public.agent_triggers, public.agent_runs, public.embeddings to service_role;

-- =====================================================================================================================================
-- Backlog items "0021 (with T031)"
-- =====================================================================================================================================

-- ---------- 10. Mock connector (catalogue + availability) ----------
-- Production stays disabled: the mock is for staging and demo only. Platform-controlled afterwards: never overwritten.
insert into public.connector_catalog (id, name, category, auth_kind, verticals, gate, sandbox_supported, docs_url)
values ('mock', 'Mock connector', 'data', 'api_key', '{legal,hospitality}', 'none', true, null)
on conflict (id) do nothing;
insert into public.connector_availability (connector_id, env, mode, gate_status, note)
select 'mock', e.env, case when e.env = 'production' then 'disabled' else 'sandbox' end, 'ready', 'Test connector with synthetic data'
  from (values ('production'), ('staging'), ('demo')) e(env)
on conflict (connector_id, env) do nothing;

-- ---------- 11. One connection per connector per workspace ----------
do $$
begin
  if exists (select 1 from public.integrations i where i.workspace_id is not null and i.connector_id is not null
              group by i.workspace_id, i.connector_id having count(*) > 1) then
    raise exception '0021: duplicate (workspace_id, connector_id) rows in integrations; merge them before this migration';
  end if;
end $$;
create unique index if not exists integrations_ws_connector_uq on public.integrations (workspace_id, connector_id);

-- ---------- 12. connector.scan scheduled job (global, every 15 minutes) ----------
create unique index if not exists scheduled_jobs_global_kind on public.scheduled_jobs (kind)
  where tenant_id is null and workspace_id is null;
insert into public.scheduled_jobs (tenant_id, workspace_id, kind, cron, tz, payload)
select null, null, 'connector.scan', '*/15 * * * *', 'Asia/Kolkata', '{}'
 where not exists (select 1 from public.scheduled_jobs j where j.kind = 'connector.scan' and j.tenant_id is null and j.workspace_id is null);

-- ---------- 13. conversations.status gains 'snoozed' ----------
do $$
declare v_c text;
begin
  for v_c in select c.conname from pg_constraint c
              where c.conrelid = 'public.conversations'::regclass and c.contype = 'c'
                and pg_get_constraintdef(c.oid) ilike '%status%open%' loop
    execute format('alter table public.conversations drop constraint %I', v_c);
  end loop;
end $$;
alter table public.conversations add constraint conversations_status_check check (status in ('open', 'snoozed', 'closed'));

-- ---------- 14. Notifications: quiet hours and de-duplication ----------
-- Quiet hours are kept on the user's notification_prefs row for the workspace (kind '*'); both ends or neither.
alter table public.notification_prefs
  add column if not exists quiet_from time,
  add column if not exists quiet_to   time,
  add column if not exists quiet_tz   text not null default 'Asia/Kolkata';
alter table public.notification_prefs drop constraint if exists notification_prefs_quiet_pair;
alter table public.notification_prefs add constraint notification_prefs_quiet_pair
  check ((quiet_from is null) = (quiet_to is null));

alter table public.notifications add column if not exists dedupe_key text check (dedupe_key is null or length(dedupe_key) between 1 and 200);
-- backfill from the key the notify handler stored in body.dedupe (first row per user and key only, so the unique index cannot fail)
update public.notifications n set dedupe_key = d.k
  from (select x.id, x.k from (select id, left(body ->> 'dedupe', 200) as k,
                                      row_number() over (partition by user_id, left(body ->> 'dedupe', 200) order by created_at, id) as rn
                                 from public.notifications where body ? 'dedupe' and nullif(body ->> 'dedupe', '') is not null
                                   and dedupe_key is null) x where x.rn = 1) d
 where n.id = d.id
   and not exists (select 1 from public.notifications o where o.user_id = n.user_id and o.dedupe_key = d.k);
create unique index if not exists notifications_user_dedupe on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

-- ---------- 15. Event types ----------
insert into public.event_types (type, domain, description, webhook_eligible, agent_eligible) values
  ('segment.created', 'segment', 'An audience segment was created', true, true),
  ('segment.updated', 'segment', 'An audience segment was changed', true, true),
  ('segment.deleted', 'segment', 'An audience segment was deleted', true, true),
  ('audience.exported', 'segment', 'An audience was exported', true, true),
  ('comment.created', 'collab', 'A comment was added', true, true),
  ('mention.created', 'collab', 'Someone was mentioned', false, true),
  ('lead.exported', 'lead', 'Leads were exported', true, true),
  ('ops.test', 'ops', 'Synthetic event emitted from the ops console', false, false)
on conflict (type) do update set domain = excluded.domain, description = excluded.description,
  webhook_eligible = excluded.webhook_eligible, agent_eligible = excluded.agent_eligible;

-- ---------- 16. Batch consent check ----------
-- Same rule as public.can_contact(), for many leads in one round trip (campaign audiences). Leads the caller cannot see come back false.
create or replace function public.can_contact_many(p_leads uuid[], p_purpose public.consent_purpose)
returns table (lead_id uuid, allowed boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_leads is null then return; end if;
  if cardinality(p_leads) > 50000 then raise exception 'too many leads in one call (max 50000)' using errcode = '22023'; end if;
  return query
  select l.id,
         coalesce((select c.action = 'granted' from public.consent_log c
                    where c.lead_id = l.id and c.purpose = p_purpose
                    order by c.occurred_at desc, c.id desc limit 1), false)
         and l.deleted_at is null
         and ((select auth.uid()) is null or l.workspace_id in (select public.member_ws_ids()))
    from public.leads l where l.id = any (p_leads)
   union
  select x, false from unnest(p_leads) x where not exists (select 1 from public.leads l2 where l2.id = x);
end $$;
revoke all on function public.can_contact_many(uuid[], public.consent_purpose) from public, anon;
grant execute on function public.can_contact_many(uuid[], public.consent_purpose) to authenticated, service_role;

-- ---------- 17. Audit trigger on audience_segments ----------
drop trigger if exists trg_audience_segments_audit on public.audience_segments;
create trigger trg_audience_segments_audit after insert or update or delete on public.audience_segments
  for each row execute function public.audit_row_change();

-- ---------- 18. Webhooks (T024 follow-ups) ----------
alter table public.webhook_endpoints
  add column if not exists options         jsonb not null default '{}' check (jsonb_typeof(options) = 'object'),
  add column if not exists last_success_at timestamptz;

-- Atomic outcome of one delivery attempt: success resets the counter and stamps last_success_at, failure adds one. Returns the new count.
-- Service role only (the delivery worker); concurrent attempts add up, none is lost.
create or replace function public.webhook_bump_failures(p_endpoint uuid, p_ok boolean) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_n int;
begin
  if p_ok then
    update public.webhook_endpoints e set consecutive_failures = 0, last_success_at = now() where e.id = p_endpoint
      returning e.consecutive_failures into v_n;
  else
    update public.webhook_endpoints e set consecutive_failures = e.consecutive_failures + 1 where e.id = p_endpoint
      returning e.consecutive_failures into v_n;
  end if;
  return v_n;                       -- null when the endpoint does not exist
end $$;
revoke all on function public.webhook_bump_failures(uuid, boolean) from public, anon, authenticated;
grant execute on function public.webhook_bump_failures(uuid, boolean) to service_role;

-- ---------- 19. Custom fields (T030) ----------
-- field_defs.version: optimistic-concurrency token, bumped by the same trigger the record tables use.
alter table public.field_defs add column if not exists version int not null default 1;
drop trigger if exists z9_field_defs_version on public.field_defs;
create trigger z9_field_defs_version before update on public.field_defs for each row execute function public.bump_version();

-- validate_custom(): identical to 0017 except for keys whose field has been retired. A retired key is accepted when the row already held
-- exactly that value (an edit of other fields must not fail because a field was retired); a NEW or CHANGED value for it is still rejected.
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
  -- unknown keys, then retired keys, then value checks
  for v_key in select k from jsonb_object_keys(v_doc) k loop
    select * into v_def from public.field_defs f where f.object_type_id = v_ot and f.key = v_key;
    if v_def.id is null then
      raise exception 'unknown custom field "%"', v_key using errcode = '23514';
    end if;
    if v_def.archived_at is not null then
      -- retired field: keep an unchanged stored value, reject anything new or changed
      if tg_op = 'UPDATE' and v_old ? v_key and v_old -> v_key = v_doc -> v_key then continue; end if;
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

-- ---------- 20. verify ----------
do $$
begin
  assert (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname in ('ai_providers', 'ai_policies', 'ai_usage', 'ai_audit', 'agents', 'agent_triggers',
                                                        'agent_runs', 'embeddings') and c.relrowsecurity) = 8, '0021: RLS on all eight new tables';
  assert exists (select 1 from pgmq.list_queues() q where q.queue_name = 'agent'), '0021: agent queue';
  assert not has_column_privilege('authenticated', 'public.ai_providers', 'secret_id', 'select'), '0021: secret_id is not selectable';
  assert not has_table_privilege('authenticated', 'public.embeddings', 'insert'), '0021: embeddings are written by the job only';
  assert not has_table_privilege('authenticated', 'public.ai_usage', 'update'), '0021: ai_usage is append-only';
  assert not has_function_privilege('authenticated', 'public.webhook_bump_failures(uuid,boolean)', 'execute'), '0021: webhook_bump_failures is service only';
  assert not has_function_privilege('anon', 'public.can_contact_many(uuid[],public.consent_purpose)', 'execute'), '0021: anon cannot call can_contact_many';
  assert exists (select 1 from public.connector_catalog where id = 'mock'), '0021: mock connector';
  assert exists (select 1 from public.scheduled_jobs where kind = 'connector.scan' and cron = '*/15 * * * *'), '0021: connector.scan job';
  assert (select count(*) from public.event_types where type in ('segment.created', 'segment.updated', 'segment.deleted', 'audience.exported')) = 4, '0021: segment event types';
  assert not exists (select 1 from public.tenants t where not exists (select 1 from public.ai_policies p where p.tenant_id = t.id)), '0021: every tenant has ai_policies';
end $$;

commit;
