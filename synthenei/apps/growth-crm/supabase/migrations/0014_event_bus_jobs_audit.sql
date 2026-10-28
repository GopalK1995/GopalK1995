-- 0014 event bus, jobs and audit (BUILD-PLAN 1.6, 1.10, 1.11 and 2.2, CONTRACTS C8):
-- pgmq/pg_cron/pg_net, partitioned events outbox + events.emit()/events.row_change() triggers, event_types, queues,
-- job_runs, scheduled_jobs, private.settings (tick URL) + the pg_cron tick and maintenance jobs, audit_log extension
-- (append-only), idempotency_keys, rate_limits + rate_limit_hit(), version columns + bump_version().
-- Forward-only and idempotent. Requires 0013 (authz.*). Nothing here calls out until private.settings.tick_url AND the
-- Vault secret jobs_tick_secret are set: the tick job is a no-op otherwise.
begin;

create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
alter default privileges in schema private revoke execute on functions from public, anon;
create schema if not exists events;
revoke all on schema events from public, anon;
grant usage on schema events to authenticated, service_role;
alter default privileges in schema events revoke execute on functions from public, anon;
create schema if not exists jobs;
revoke all on schema jobs from public, anon, authenticated;
grant usage on schema jobs to service_role;

-- ---------- 1. Partition helper (monthly range partitions, RLS on, closed to API roles) ----------
create or replace function private.ensure_month_partitions(p_parent regclass, p_from date, p_months int) returns int
language plpgsql security definer set search_path = '' as $$
declare i int; v_start date; v_name text; v_rel regclass; v_made int := 0;
begin
  for i in 0 .. greatest(p_months, 1) - 1 loop
    v_start := (date_trunc('month', p_from) + make_interval(months => i))::date;
    v_name := (select c.relname from pg_class c where c.oid = p_parent) || '_p' || to_char(v_start, 'YYYYMM');
    if to_regclass(format('public.%I', v_name)) is null then
      execute format('create table public.%I partition of %s for values from (%L) to (%L)',
                     v_name, p_parent, v_start, (v_start + interval '1 month')::date);
      v_made := v_made + 1;
    end if;
    execute format('alter table public.%I enable row level security', v_name);
    execute format('revoke all on public.%I from anon, authenticated', v_name);
  end loop;
  return v_made;
end $$;

-- ---------- 2. Events outbox ----------
create table if not exists public.events (
  id                 bigint generated always as identity,
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  type               text not null,
  object_type        text,
  object_id          uuid,
  actor_kind         text not null default 'system'
                     check (actor_kind in ('user', 'api_key', 'system', 'connector', 'agent', 'support')),
  actor_id           uuid,
  support_session_id uuid,
  request_id         text,
  data               jsonb not null default '{}',
  occurred_at        timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);
create index if not exists events_ws_time on public.events (workspace_id, occurred_at desc);
create index if not exists events_object on public.events (object_type, object_id, occurred_at desc);

-- Safety net so a missing month can never fail a business write; the maintenance job creates months ahead.
create table if not exists public.events_default partition of public.events default;
alter table public.events_default enable row level security;
revoke all on public.events_default from anon, authenticated;
-- Oct 2026 .. Dec 2027 (plan says Nov 2026; Oct covers branch-DB testing before go-live)
select private.ensure_month_partitions('public.events', date '2026-10-01', 15);

alter table public.events enable row level security;
drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (workspace_id in (select authz.ws_with('events.read', 'all')));
-- no insert/update/delete policy and no grant: rows come only from events.emit() / events.row_change()

create table if not exists public.event_types (
  type              text primary key check (type ~ '^[a-z][a-z0-9_.:*-]{1,80}$'),
  domain            text not null,
  description       text not null default '',
  webhook_eligible  boolean not null default true,
  agent_eligible    boolean not null default true
);
alter table public.event_types enable row level security;
drop policy if exists event_types_select on public.event_types;
create policy event_types_select on public.event_types for select to authenticated using (true);

insert into public.event_types (type, domain, description, webhook_eligible, agent_eligible) values
  ('lead.created', 'lead', 'A lead was created', true, true),
  ('lead.updated', 'lead', 'A lead was changed', true, true),
  ('lead.assigned', 'lead', 'A lead got a new owner', true, true),
  ('lead.stage_changed', 'lead', 'A lead status changed', true, true),
  ('lead.deleted', 'lead', 'A lead was deleted', true, true),
  ('deal.created', 'deal', 'A deal was created', true, true),
  ('deal.updated', 'deal', 'A deal was changed', true, true),
  ('deal.stage_changed', 'deal', 'A deal moved stage', true, true),
  ('deal.won', 'deal', 'A deal was won', true, true),
  ('deal.lost', 'deal', 'A deal was lost', true, true),
  ('deal.deleted', 'deal', 'A deal was deleted', true, true),
  ('account.created', 'account', 'An account was created', true, true),
  ('account.updated', 'account', 'An account was changed', true, true),
  ('account.deleted', 'account', 'An account was deleted', true, true),
  ('contact.created', 'contact', 'A contact was created', true, true),
  ('contact.updated', 'contact', 'A contact was changed', true, true),
  ('contact.deleted', 'contact', 'A contact was deleted', true, true),
  ('task.created', 'task', 'A task was created', true, true),
  ('task.updated', 'task', 'A task was changed', true, true),
  ('task.completed', 'task', 'A task was completed', true, true),
  ('task.deleted', 'task', 'A task was deleted', true, true),
  ('activity.created', 'activity', 'An activity row was created', false, true),
  ('activity.updated', 'activity', 'An activity row was changed', false, true),
  ('activity.deleted', 'activity', 'An activity row was deleted', false, true),
  ('activity.logged', 'activity', 'An activity was logged', true, true),
  ('conversation.created', 'inbox', 'A conversation was created', true, true),
  ('conversation.updated', 'inbox', 'A conversation was changed', true, true),
  ('conversation.deleted', 'inbox', 'A conversation was deleted', false, true),
  ('message.created', 'inbox', 'A message row was created', false, true),
  ('message.updated', 'inbox', 'A message row was changed', false, true),
  ('message.deleted', 'inbox', 'A message row was deleted', false, true),
  ('message.received', 'inbox', 'An inbound message arrived', true, true),
  ('message.sent', 'inbox', 'An outbound message was created', true, true),
  ('message.status', 'inbox', 'A message delivery status changed', true, false),
  ('campaign.created', 'campaign', 'A campaign was created', true, true),
  ('campaign.updated', 'campaign', 'A campaign was changed', true, true),
  ('campaign.deleted', 'campaign', 'A campaign was deleted', true, true),
  ('comment.created', 'collab', 'A comment was added', true, true),
  ('mention.created', 'collab', 'Someone was mentioned', false, true),
  ('connector.sync.completed', 'connector', 'A connector sync finished', true, true),
  ('connector.sync.failed', 'connector', 'A connector sync failed', true, true),
  ('consent.changed', 'privacy', 'Consent was granted or withdrawn', true, true),
  ('metadata.changed', 'config', 'Custom fields, objects or pipelines changed', true, false),
  ('member.created', 'member', 'A member joined a workspace', true, false),
  ('member.updated', 'member', 'A membership changed', true, false),
  ('member.deleted', 'member', 'A member was removed', true, false),
  ('webhook.endpoint.disabled', 'webhook', 'An outbound webhook endpoint was disabled', false, false)
on conflict (type) do update set domain = excluded.domain, description = excluded.description,
  webhook_eligible = excluded.webhook_eligible, agent_eligible = excluded.agent_eligible;

-- ---------- 3. Queues (pgmq) ----------
do $$
declare q text;
begin
  foreach q in array array['events', 'webhook_out', 'connector_sync', 'connector_inbound', 'notify', 'import', 'maintenance', 'agent'] loop
    perform pgmq.create(q);
    perform pgmq.create(q || '_dlq');
  end loop;
end $$;

-- pgmq stays closed to API roles; only service_role (the tick route) and our security definer functions touch it
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'pgmq') then
    revoke all on schema pgmq from anon, authenticated;
    revoke all on all tables in schema pgmq from anon, authenticated;
    revoke all on all sequences in schema pgmq from anon, authenticated;
    revoke execute on all functions in schema pgmq from public, anon, authenticated;
    grant usage on schema pgmq to service_role;
    grant select, insert, update, delete on all tables in schema pgmq to service_role;
    grant usage on all sequences in schema pgmq to service_role;
    grant execute on all functions in schema pgmq to service_role;
  end if;
end $$;

-- ---------- 4. Emit + row-change triggers ----------
create or replace function events._insert(p_tenant uuid, p_ws uuid, p_type text, p_object_type text, p_object_id uuid, p_data jsonb)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_ss uuid; v_id bigint; v_ts timestamptz := now();
begin
  v_kind := nullif(current_setting('app.actor_kind', true), '');
  if v_kind is null or v_kind not in ('user', 'api_key', 'system', 'connector', 'agent', 'support') then
    v_kind := case when auth.uid() is null then 'system' else 'user' end;
  end if;
  if auth.uid() is not null then
    select s.id into v_ss from public.support_sessions s
     where s.admin_id = auth.uid() and s.workspace_id = p_ws and s.ended_at is null and now() < s.expires_at
     order by s.started_at desc limit 1;
    if v_ss is not null then v_kind := 'support'; end if;
  end if;
  insert into public.events (tenant_id, workspace_id, type, object_type, object_id, actor_kind, actor_id,
                             support_session_id, request_id, data, occurred_at)
  values (p_tenant, p_ws, p_type, p_object_type, p_object_id, v_kind, auth.uid(), v_ss,
          nullif(current_setting('app.request_id', true), ''), coalesce(p_data, '{}'::jsonb), v_ts)
  returning id into v_id;
  perform pgmq.send('events', jsonb_build_object('event_id', v_id, 'occurred_at', v_ts, 'type', p_type,
                                                 'tenant_id', p_tenant, 'workspace_id', p_ws));
  return v_id;
end $$;

-- App-level emit for non-row events. Workspace comes from p_data->>'workspace_id' or from the object row.
create or replace function events.emit(p_type text, p_object_type text, p_object_id uuid, p_data jsonb default '{}')
returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid; v_tenant uuid;
begin
  if p_type is null or p_type !~ '^[a-z][a-z0-9_.:-]{1,80}$' then
    raise exception 'invalid event type' using errcode = '22023';
  end if;
  if p_data is not null and jsonb_typeof(p_data) <> 'object' then
    raise exception 'event data must be a JSON object' using errcode = '22023';
  end if;
  v_ws := nullif(p_data->>'workspace_id', '')::uuid;
  if v_ws is null and p_object_type is not null and p_object_id is not null then
    v_ws := (authz.object_row(p_object_type, p_object_id)->>'workspace_id')::uuid;
  end if;
  if v_ws is null then raise exception 'workspace_id is required' using errcode = '22023'; end if;
  if auth.uid() is not null and v_ws not in (select public.member_ws_ids()) then
    raise exception 'not a member of this workspace' using errcode = '42501';
  end if;
  select w.tenant_id into v_tenant from public.workspaces w where w.id = v_ws;
  if v_tenant is null then raise exception 'unknown workspace' using errcode = '22023'; end if;
  return events._insert(v_tenant, v_ws, p_type, p_object_type, p_object_id, coalesce(p_data, '{}'::jsonb) - 'workspace_id');
end $$;

create or replace function public.emit_event(p_type text, p_object_type text, p_object_id uuid, p_data jsonb default '{}')
returns bigint
language sql security definer set search_path = '' as $$ select events.emit(p_type, p_object_type, p_object_id, p_data) $$;

create or replace function events.row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r jsonb := coalesce(r_new, r_old);
  v_obj text := case tg_table_name
    when 'leads' then 'lead' when 'deals' then 'deal' when 'accounts' then 'account' when 'contacts' then 'contact'
    when 'tasks' then 'task' when 'activities' then 'activity' when 'conversations' then 'conversation'
    when 'messages' then 'message' when 'campaigns' then 'campaign' when 'memberships' then 'member' end;
  v_ws uuid := (r->>'workspace_id')::uuid;
  v_tenant uuid := (r->>'tenant_id')::uuid;
  v_oid uuid := nullif(r->>'id', '')::uuid;
  v_changed text[]; v_data jsonb; v_verb text;
  -- personal data and identifiers never travel in events; consumers refetch under their own principal
  v_hide text[] := array['full_name', 'email', 'phone', 'body', 'note', 'address_line', 'firm_name', 'display_name',
                         'personal_email', 'click_ids', 'external_data', 'external_ids', 'utm', 'attributes'];
  v_before jsonb; v_after jsonb;
begin
  if v_obj is null or v_ws is null then return coalesce(new, old); end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.workspaces w where w.id = v_ws) then
    return old;   -- workspace/tenant purge cascade: nothing left to attach the event to
  end if;
  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
      from jsonb_each(r_new) n join jsonb_each(r_old) o using (key)
     where n.value is distinct from o.value and n.key not in ('updated_at', 'version');
    if v_changed is null then return new; end if;
    select jsonb_object_agg(key, value) into v_before from jsonb_each(r_old) where key = any(v_changed) and key <> all(v_hide);
    select jsonb_object_agg(key, value) into v_after from jsonb_each(r_new) where key = any(v_changed) and key <> all(v_hide);
    v_verb := case when r_old->>'deleted_at' is null and r_new->>'deleted_at' is not null then 'deleted' else 'updated' end;
  elsif tg_op = 'INSERT' then
    v_changed := null;
    select jsonb_object_agg(key, value) into v_after from jsonb_each(r_new) where key <> all(v_hide);
    v_verb := 'created';
  else
    select jsonb_object_agg(key, value) into v_before from jsonb_each(r_old) where key <> all(v_hide);
    v_verb := 'deleted';
  end if;
  v_data := jsonb_strip_nulls(jsonb_build_object('changed_fields', to_jsonb(v_changed), 'before', v_before, 'after', v_after));
  if pg_column_size(v_data) > 6000 then v_data := jsonb_build_object('changed_fields', to_jsonb(v_changed), 'truncated', true); end if;

  perform events._insert(v_tenant, v_ws, v_obj || '.' || v_verb, v_obj, v_oid, v_data);

  -- derived events
  if tg_op = 'UPDATE' then
    if tg_table_name = 'leads' then
      if r_new->>'owner_id' is distinct from r_old->>'owner_id' then
        perform events._insert(v_tenant, v_ws, 'lead.assigned', v_obj, v_oid,
          jsonb_build_object('before', jsonb_build_object('owner_id', r_old->'owner_id'), 'after', jsonb_build_object('owner_id', r_new->'owner_id')));
      end if;
      if r_new->>'status' is distinct from r_old->>'status' then
        perform events._insert(v_tenant, v_ws, 'lead.stage_changed', v_obj, v_oid,
          jsonb_build_object('before', jsonb_build_object('status', r_old->'status'), 'after', jsonb_build_object('status', r_new->'status')));
      end if;
    elsif tg_table_name = 'deals' then
      if r_new->>'stage_id' is distinct from r_old->>'stage_id' then
        perform events._insert(v_tenant, v_ws, 'deal.stage_changed', v_obj, v_oid,
          jsonb_build_object('before', jsonb_build_object('stage_id', r_old->'stage_id'), 'after', jsonb_build_object('stage_id', r_new->'stage_id')));
      end if;
      if r_old->>'won_at' is null and r_new->>'won_at' is not null then
        perform events._insert(v_tenant, v_ws, 'deal.won', v_obj, v_oid, jsonb_build_object('after', jsonb_build_object('won_at', r_new->'won_at')));
      end if;
      if r_old->>'lost_at' is null and r_new->>'lost_at' is not null then
        perform events._insert(v_tenant, v_ws, 'deal.lost', v_obj, v_oid, jsonb_build_object('after', jsonb_build_object('lost_at', r_new->'lost_at')));
      end if;
    elsif tg_table_name = 'tasks' then
      if r_new->>'status' = 'done' and r_old->>'status' is distinct from 'done' then
        perform events._insert(v_tenant, v_ws, 'task.completed', v_obj, v_oid, '{}'::jsonb);
      end if;
    end if;
  elsif tg_op = 'INSERT' then
    if tg_table_name = 'messages' then
      perform events._insert(v_tenant, v_ws, case when r_new->>'direction' = 'inbound' then 'message.received' else 'message.sent' end,
                             v_obj, v_oid, jsonb_build_object('after', jsonb_build_object('conversation_id', r_new->'conversation_id', 'direction', r_new->'direction')));
    elsif tg_table_name = 'activities' then
      perform events._insert(v_tenant, v_ws, 'activity.logged', v_obj, v_oid, '{}'::jsonb);
    end if;
  end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['leads', 'deals', 'accounts', 'contacts', 'tasks', 'activities', 'conversations', 'messages', 'campaigns', 'memberships'] loop
    execute format('drop trigger if exists trg_%1$s_events on public.%1$I', t);
    execute format('create trigger trg_%1$s_events after insert or update or delete on public.%1$I
                    for each row execute function events.row_change()', t);
  end loop;
end $$;

-- ---------- 5. Jobs ----------
create table if not exists public.job_runs (
  id           bigint generated always as identity primary key,
  queue        text not null,
  msg_id       bigint,
  kind         text not null,
  tenant_id    uuid references public.tenants(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  status       text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'dead')),
  attempt      int not null default 1,
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ms           int
);
create index if not exists job_runs_queue_time on public.job_runs (queue, started_at desc);
create index if not exists job_runs_tenant_time on public.job_runs (tenant_id, started_at desc);
alter table public.job_runs enable row level security;
drop policy if exists job_runs_select on public.job_runs;
create policy job_runs_select on public.job_runs for select to authenticated
  using ((select public.is_platform_admin()) or tenant_id in (select public.owner_tenant_ids()));
-- tenant owners get everything but the error text (may carry internals); platform admins read errors with the service client
revoke all on public.job_runs from anon, authenticated;
grant select (id, queue, msg_id, kind, tenant_id, workspace_id, status, attempt, started_at, finished_at, ms) on public.job_runs to authenticated;

create or replace view public.v_job_runs_tenant with (security_invoker = true) as
  select j.id, j.queue, j.kind, j.tenant_id, j.workspace_id, j.status, j.attempt, j.started_at, j.finished_at, j.ms
    from public.job_runs j
   where j.tenant_id in (select public.owner_tenant_ids());
revoke all on public.v_job_runs_tenant from anon;
grant select on public.v_job_runs_tenant to authenticated;

create table if not exists public.scheduled_jobs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenants(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  kind         text not null,
  cron         text not null check (length(cron) between 5 and 100),
  tz           text not null default 'Asia/Kolkata',
  payload      jsonb not null default '{}',
  next_run_at  timestamptz,
  enabled      boolean not null default true,
  last_run_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists scheduled_jobs_due on public.scheduled_jobs (next_run_at) where enabled;
create index if not exists scheduled_jobs_tenant on public.scheduled_jobs (tenant_id);
drop trigger if exists a00_scheduled_jobs_tenant on public.scheduled_jobs;
create trigger a00_scheduled_jobs_tenant before insert or update of workspace_id, tenant_id on public.scheduled_jobs
  for each row execute function public.set_tenant_from_workspace();
alter table public.scheduled_jobs enable row level security;
drop policy if exists scheduled_jobs_select on public.scheduled_jobs;
create policy scheduled_jobs_select on public.scheduled_jobs for select to authenticated
  using (tenant_id in (select public.owner_tenant_ids()) or (select public.is_platform_admin()));
drop policy if exists scheduled_jobs_insert on public.scheduled_jobs;
create policy scheduled_jobs_insert on public.scheduled_jobs for insert to authenticated
  with check (workspace_id in (select authz.ws_with_member('integrations.manage', 'all')));
drop policy if exists scheduled_jobs_update on public.scheduled_jobs;
create policy scheduled_jobs_update on public.scheduled_jobs for update to authenticated
  using (workspace_id in (select authz.ws_with_member('integrations.manage', 'all')))
  with check (workspace_id in (select authz.ws_with_member('integrations.manage', 'all')));
drop policy if exists scheduled_jobs_delete on public.scheduled_jobs;
create policy scheduled_jobs_delete on public.scheduled_jobs for delete to authenticated
  using (workspace_id in (select authz.ws_with_member('integrations.manage', 'all')));
revoke all on public.scheduled_jobs from anon, authenticated;
grant select, insert, update, delete on public.scheduled_jobs to authenticated;

create table if not exists private.settings (
  key   text primary key,
  value text
);
alter table private.settings enable row level security;
revoke all on private.settings from public, anon, authenticated;
grant select, insert, update, delete on private.settings to service_role;

create or replace function jobs.try_lock(p_key text) returns boolean
language sql volatile security definer set search_path = '' as $$
  select pg_try_advisory_xact_lock(hashtextextended(p_key, 0))
$$;

-- Queue wrappers for the Node tick route (supabase-js only reaches exposed schemas). service_role only.
create or replace function public.queue_send(p_queue text, p_msg jsonb, p_delay int default 0) returns bigint
language sql volatile security definer set search_path = '' as $$ select pgmq.send(p_queue, p_msg, p_delay) $$;
create or replace function public.queue_read(p_queue text, p_vt int default 60, p_qty int default 20) returns setof jsonb
language sql volatile security definer set search_path = '' as $$ select to_jsonb(m) from pgmq.read(p_queue, p_vt, p_qty) m $$;
create or replace function public.queue_archive(p_queue text, p_msg_id bigint) returns boolean
language sql volatile security definer set search_path = '' as $$ select pgmq.archive(p_queue, p_msg_id) $$;
create or replace function public.queue_delete(p_queue text, p_msg_id bigint) returns boolean
language sql volatile security definer set search_path = '' as $$ select pgmq.delete(p_queue, p_msg_id) $$;

-- The 10-second tick: POST to the app only when a URL and the Vault secret exist (otherwise a no-op).
create or replace function private.tick() returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select s.value into v_url from private.settings s where s.key = 'tick_url';
  if v_url is null or length(trim(v_url)) = 0 then return; end if;
  select d.decrypted_secret into v_secret from vault.decrypted_secrets d where d.name = 'jobs_tick_secret' limit 1;
  if v_secret is null then return; end if;
  perform net.http_post(url := v_url, body := '{}'::jsonb,
                        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
                        timeout_milliseconds := 5000);
end $$;

-- Every 5 minutes: partitions ahead, retention of operational tables.
create or replace function private.maintenance() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_month_partitions('public.events', date_trunc('month', now())::date, 4);
  if to_regclass('public.webhook_deliveries') is not null then
    perform private.ensure_month_partitions('public.webhook_deliveries', date_trunc('month', now())::date, 4);
  end if;
  if to_regclass('public.api_request_log') is not null then
    perform private.ensure_month_partitions('public.api_request_log', date_trunc('month', now())::date, 4);
  end if;
  delete from public.idempotency_keys where created_at < now() - interval '24 hours';
  delete from public.rate_limits where window_start < now() - interval '1 day';
  delete from public.job_runs where started_at < now() - interval '90 days';
  if to_regclass('public.webhook_inbox') is not null then
    delete from public.webhook_inbox where received_at < now() - interval '30 days';
  end if;
end $$;

select cron.schedule('gcrm_tick', '10 seconds', $cron$select private.tick()$cron$);
select cron.schedule('gcrm_maintenance', '*/5 * * * *', $cron$select private.maintenance()$cron$);

-- ---------- 6. Audit log: extension + append-only ----------
alter table public.audit_log
  add column if not exists actor_kind text check (actor_kind in ('user', 'api_key', 'system', 'connector', 'agent', 'support', 'platform_admin')),
  add column if not exists source     text check (source in ('ui', 'api', 'connector', 'job', 'agent', 'support')),
  add column if not exists request_id text,
  add column if not exists ip         inet,
  add column if not exists user_agent text,
  add column if not exists reason     text,
  add column if not exists summary    text;

-- config/role/field/connector/key/webhook/support actions log with their own verbs, not only insert/update/delete
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action ~ '^[a-z][a-z0-9_.:-]{0,63}$');

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
  v_ip  inet;
  v_kind text; v_src text;
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
  begin v_ip := nullif(current_setting('app.client_ip', true), '')::inet; exception when others then v_ip := null; end;
  v_kind := coalesce(nullif(current_setting('app.actor_kind', true), ''),
                     case when v_ss is not null then 'support' when auth.uid() is null then 'system' else 'user' end);
  if v_kind not in ('user', 'api_key', 'system', 'connector', 'agent', 'support', 'platform_admin') then v_kind := 'system'; end if;
  v_src := coalesce(nullif(current_setting('app.audit_source', true), ''),
                    case when v_ss is not null then 'support' when auth.uid() is null then 'job' else 'ui' end);
  if v_src not in ('ui', 'api', 'connector', 'job', 'agent', 'support') then v_src := 'ui'; end if;
  insert into public.audit_log (tenant_id, workspace_id, actor_id, actor_label, action, table_name, row_id, changes, support_session_id,
                                actor_kind, source, request_id, ip, user_agent, reason, summary)
  values (
    coalesce((r->>'tenant_id')::uuid, case when tg_table_name = 'tenants' then (r->>'id')::uuid end),
    v_ws, auth.uid(),
    coalesce(nullif(current_setting('app.actor_label', true), ''),
             case when v_ss is not null then 'support' when auth.uid() is null then 'service' else 'user' end),
    lower(tg_op), tg_table_name, coalesce(r->>'id', r->>'user_id'), diff, v_ss,
    v_kind, v_src, nullif(current_setting('app.request_id', true), ''), v_ip,
    left(nullif(current_setting('app.user_agent', true), ''), 300),
    left(nullif(current_setting('app.audit_reason', true), ''), 500),
    coalesce(left(nullif(current_setting('app.audit_summary', true), ''), 300), lower(tg_op) || ' ' || tg_table_name));
  return coalesce(new, old);
end $$;

-- Append-only. Update/delete/truncate raise for every role, service_role included. The one exception is the referential
-- action of a tenant/workspace purge (FK cascade / set null), recognisable by trigger depth > 1.
create or replace function private.audit_append_only() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.support_session_id is null
     and (to_jsonb(new) - 'support_session_id') = (to_jsonb(old) - 'support_session_id') then return new; end if;
  raise exception 'audit_log is append-only' using errcode = '42501';
end $$;
drop trigger if exists audit_append_only on public.audit_log;
create trigger audit_append_only before update or delete on public.audit_log
  for each row execute function private.audit_append_only();
create or replace function private.audit_no_truncate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin raise exception 'audit_log is append-only' using errcode = '42501'; end $$;
drop trigger if exists audit_no_truncate on public.audit_log;
create trigger audit_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_no_truncate();
revoke update, delete, truncate on public.audit_log from anon, authenticated, service_role;

-- ---------- 7. Idempotency keys + rate limits ----------
create table if not exists public.idempotency_keys (
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  key_id       uuid not null,   -- api_keys.id (0015); no FK so the API path stays a single cheap insert
  idem_key     text not null check (length(idem_key) between 8 and 200),
  request_hash text not null,
  response     jsonb,
  status       int,
  created_at   timestamptz not null default now(),
  primary key (key_id, idem_key)
);
create index if not exists idempotency_keys_age on public.idempotency_keys (created_at);
alter table public.idempotency_keys enable row level security;   -- service only: no policy, no grant
revoke all on public.idempotency_keys from anon, authenticated;
grant select, insert, update, delete on public.idempotency_keys to service_role;

create table if not exists public.rate_limits (
  bucket       text not null check (length(bucket) between 1 and 200),
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (bucket, window_start)
);
alter table public.rate_limits enable row level security;       -- only rate_limit_hit() (definer) writes
revoke all on public.rate_limits from anon, authenticated;
grant select, insert, update, delete on public.rate_limits to service_role;

-- true = allowed (within limit), false = over the limit. Fixed window of p_window_s seconds.
create or replace function public.rate_limit_hit(p_bucket text, p_limit int, p_window_s int) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_start timestamptz; v_n int;
begin
  if p_bucket is null or length(p_bucket) not between 1 and 200 or p_limit is null or p_limit not between 1 and 100000
     or p_window_s is null or p_window_s not between 1 and 86400 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  insert into public.rate_limits as r (bucket, window_start, count) values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set count = r.count + 1
  returning r.count into v_n;
  return v_n <= p_limit;
end $$;

-- ---------- 8. Row versions (optimistic concurrency) ----------
create or replace function public.bump_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'version' - 'updated_at') is distinct from (to_jsonb(old) - 'version' - 'updated_at') then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['leads', 'deals', 'accounts', 'contacts', 'tasks', 'campaigns', 'conversations', 'audience_segments', 'pipeline_stages'] loop
    execute format('alter table public.%I add column if not exists version int not null default 1', t);
    execute format('drop trigger if exists z9_%1$s_version on public.%1$I', t);
    execute format('create trigger z9_%1$s_version before update on public.%1$I
                    for each row execute function public.bump_version()', t);
  end loop;
end $$;

-- ---------- 9. Grants ----------
revoke all on public.events, public.event_types from anon, authenticated;
grant select on public.events, public.event_types to authenticated;
grant select, insert, update, delete on public.events, public.event_types, public.job_runs to service_role;
grant select, insert, update, delete on public.scheduled_jobs to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on function events.emit(text, text, uuid, jsonb), events._insert(uuid, uuid, text, text, uuid, jsonb),
  events.row_change(), private.ensure_month_partitions(regclass, date, int), private.tick(), private.maintenance(),
  private.audit_append_only(), private.audit_no_truncate(), public.bump_version(), jobs.try_lock(text),
  public.emit_event(text, text, uuid, jsonb), public.rate_limit_hit(text, int, int),
  public.queue_send(text, jsonb, int), public.queue_read(text, int, int), public.queue_archive(text, bigint),
  public.queue_delete(text, bigint)
  from public, anon, authenticated;
grant execute on function events.emit(text, text, uuid, jsonb), public.emit_event(text, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.rate_limit_hit(text, int, int) to anon, authenticated, service_role;
grant execute on function events._insert(uuid, uuid, text, text, uuid, jsonb), private.ensure_month_partitions(regclass, date, int),
  private.maintenance(), jobs.try_lock(text), public.queue_send(text, jsonb, int), public.queue_read(text, int, int),
  public.queue_archive(text, bigint), public.queue_delete(text, bigint) to service_role;

-- ---------- 10. verify ----------
do $$
begin
  assert (select count(*) from pg_inherits i join pg_class c on c.oid = i.inhparent where c.relname = 'events') >= 15,
    '0014: events partitions missing';
  assert (select count(*) from pgmq.list_queues()) >= 16, '0014: 16 queues expected (8 + 8 dlq)';
  assert (select count(*) from cron.job where jobname in ('gcrm_tick', 'gcrm_maintenance')) = 2, '0014: cron jobs missing';
  assert not has_table_privilege('authenticated', 'public.audit_log', 'update'), '0014: audit_log must not be updatable';
  assert not has_table_privilege('service_role', 'public.audit_log', 'delete'), '0014: service_role must not delete audit_log';
  assert not has_table_privilege('anon', 'public.events', 'select'), '0014: anon must not read events';
  assert (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'version'
            and table_name in ('leads','deals','accounts','contacts','tasks','campaigns','conversations','audience_segments','pipeline_stages')) = 9,
    '0014: version columns';
end $$;

commit;
