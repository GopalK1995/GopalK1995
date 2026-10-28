-- 0015 integrations, outbound webhooks and public API schema (BUILD-PLAN 1.7 to 1.9 and 2.3, CONTRACTS C9 to C11):
-- connector_catalog + connector_availability (seeded), integrations extended into connections, oauth_states,
-- sync_cursors, sync_runs extension, external_links, webhook_inbox, webhook_endpoints, webhook_deliveries (monthly
-- partitions), api_keys (hash never selectable), api_request_log (monthly partitions), Vault wrappers (service_role only),
-- public.can_contact(). Forward-only and idempotent. Requires 0013 (authz.*) and 0014 (job_runs, partition helper).
begin;

-- ---------- 1. Connector catalogue (global) ----------
create table if not exists public.connector_catalog (
  id                text primary key check (id ~ '^[a-z][a-z0-9-]{1,40}$'),
  name              text not null,
  category          text not null check (category in ('crm', 'messaging', 'email', 'ads', 'analytics', 'scheduling', 'payments', 'automation', 'ota', 'data')),
  auth_kind         text not null check (auth_kind in ('oauth2', 'api_key', 'service_account', 'webhook_secret', 'none')),
  verticals         text[] not null default '{legal,hospitality}',
  gate              text not null default 'none' check (gate in ('none', 'needs_vendor_approval', 'needs_client_credentials')),
  sandbox_supported boolean not null default false,
  docs_url          text
);

create table if not exists public.connector_availability (
  connector_id text not null references public.connector_catalog(id) on delete cascade,
  env          text not null check (env in ('production', 'staging', 'demo')),
  mode         text not null check (mode in ('disabled', 'sandbox', 'live')),
  gate_status  text not null check (gate_status in ('needs_vendor_approval', 'needs_client_credentials', 'ready')),
  note         text,
  primary key (connector_id, env)
);

insert into public.connector_catalog (id, name, category, auth_kind, verticals, gate, sandbox_supported, docs_url) values
  ('csv', 'CSV import', 'data', 'none', '{legal,hospitality}', 'none', true, null),
  ('email-smtp', 'Email (SMTP)', 'email', 'api_key', '{legal,hospitality}', 'none', true, null),
  ('resend', 'Resend', 'email', 'api_key', '{legal,hospitality}', 'none', true, 'https://resend.com/docs'),
  ('whatsapp', 'WhatsApp Business', 'messaging', 'api_key', '{legal,hospitality}', 'needs_vendor_approval', true, 'https://developers.facebook.com/docs/whatsapp/cloud-api'),
  ('meta-ads', 'Meta Ads', 'ads', 'oauth2', '{legal,hospitality}', 'needs_vendor_approval', true, 'https://developers.facebook.com/docs/marketing-apis'),
  ('razorpay', 'Razorpay', 'payments', 'api_key', '{legal,hospitality}', 'needs_client_credentials', true, 'https://razorpay.com/docs/'),
  ('gmail', 'Gmail', 'email', 'oauth2', '{legal,hospitality}', 'needs_vendor_approval', true, 'https://developers.google.com/gmail/api'),
  ('outlook', 'Outlook', 'email', 'oauth2', '{legal,hospitality}', 'needs_client_credentials', true, 'https://learn.microsoft.com/graph/'),
  ('google-ads', 'Google Ads', 'ads', 'oauth2', '{legal,hospitality}', 'needs_vendor_approval', false, 'https://developers.google.com/google-ads/api'),
  ('ga4', 'Google Analytics 4', 'analytics', 'service_account', '{legal,hospitality}', 'needs_client_credentials', false, 'https://developers.google.com/analytics/devguides/reporting/data/v1'),
  ('google-business', 'Google Business Profile', 'data', 'oauth2', '{legal,hospitality}', 'needs_vendor_approval', false, 'https://developers.google.com/my-business'),
  ('linkedin', 'LinkedIn', 'ads', 'oauth2', '{legal,hospitality}', 'needs_vendor_approval', false, 'https://learn.microsoft.com/linkedin/'),
  ('mailchimp', 'Mailchimp', 'email', 'oauth2', '{legal,hospitality}', 'needs_client_credentials', true, 'https://mailchimp.com/developer/'),
  ('booking-com', 'Booking.com', 'ota', 'api_key', '{hospitality}', 'needs_vendor_approval', false, null),
  ('makemytrip', 'MakeMyTrip', 'ota', 'api_key', '{hospitality}', 'needs_vendor_approval', false, null),
  ('airbnb', 'Airbnb', 'ota', 'oauth2', '{hospitality}', 'needs_vendor_approval', false, null),
  ('google-calendar', 'Google Calendar', 'scheduling', 'oauth2', '{legal,hospitality}', 'needs_vendor_approval', true, 'https://developers.google.com/calendar'),
  ('google-sheets', 'Google Sheets', 'data', 'oauth2', '{legal,hospitality}', 'needs_client_credentials', true, 'https://developers.google.com/sheets/api'),
  ('calendly', 'Calendly', 'scheduling', 'oauth2', '{legal,hospitality}', 'needs_client_credentials', true, 'https://developer.calendly.com/'),
  ('cal-com', 'Cal.com', 'scheduling', 'api_key', '{legal,hospitality}', 'none', true, 'https://cal.com/docs'),
  ('zoho-crm', 'Zoho CRM', 'crm', 'oauth2', '{legal,hospitality}', 'needs_client_credentials', true, 'https://www.zoho.com/crm/developer/docs/'),
  ('hubspot', 'HubSpot', 'crm', 'oauth2', '{legal,hospitality}', 'needs_client_credentials', true, 'https://developers.hubspot.com/'),
  ('slack', 'Slack', 'automation', 'oauth2', '{legal,hospitality}', 'needs_client_credentials', true, 'https://api.slack.com/'),
  ('zapier', 'Zapier', 'automation', 'webhook_secret', '{legal,hospitality}', 'none', true, null),
  ('make', 'Make', 'automation', 'webhook_secret', '{legal,hospitality}', 'none', true, null)
on conflict (id) do update set name = excluded.name, category = excluded.category, auth_kind = excluded.auth_kind,
  verticals = excluded.verticals, gate = excluded.gate, sandbox_supported = excluded.sandbox_supported, docs_url = excluded.docs_url;

-- production: live only when nothing external is needed; staging/demo: sandbox when the vendor offers one
insert into public.connector_availability (connector_id, env, mode, gate_status, note)
select c.id, e.env,
       case when c.gate = 'none' and e.env <> 'demo' then 'live'
            when e.env = 'production' then 'disabled'
            when c.sandbox_supported then 'sandbox' else 'disabled' end,
       case c.gate when 'none' then 'ready' else c.gate end,
       null
  from public.connector_catalog c cross join (values ('production'), ('staging'), ('demo')) e(env)
on conflict (connector_id, env) do nothing;   -- platform-controlled afterwards: never overwrite

alter table public.connector_catalog     enable row level security;
alter table public.connector_availability enable row level security;
drop policy if exists connector_catalog_select on public.connector_catalog;
create policy connector_catalog_select on public.connector_catalog for select to authenticated using (true);
drop policy if exists connector_availability_select on public.connector_availability;
create policy connector_availability_select on public.connector_availability for select to authenticated using (true);
drop policy if exists connector_availability_write on public.connector_availability;
create policy connector_availability_write on public.connector_availability for all to authenticated
  using ((select public.is_platform_admin()) and exists (select 1 from public.platform_admins pa
          where pa.user_id = (select auth.uid()) and pa.is_active and pa.platform_role = 'super_admin'))
  with check ((select public.is_platform_admin()) and exists (select 1 from public.platform_admins pa
          where pa.user_id = (select auth.uid()) and pa.is_active and pa.platform_role = 'super_admin'));

-- ---------- 2. Integrations become connections ----------
alter type public.integration_status add value if not exists 'sandbox';
alter type public.integration_status add value if not exists 'disconnected';

alter table public.integrations
  add column if not exists connector_id           text references public.connector_catalog(id),
  add column if not exists mode                   text not null default 'sandbox' check (mode in ('sandbox', 'live')),
  add column if not exists credential_secret_id   uuid,   -- Vault secret id, never the secret
  add column if not exists webhook_secret_id      uuid,
  add column if not exists oauth_scopes           text[],
  add column if not exists external_account_id    text,
  add column if not exists external_account_label text,
  add column if not exists connected_by           uuid,
  add column if not exists connected_at           timestamptz,
  add column if not exists token_expires_at       timestamptz,
  add column if not exists health                 jsonb not null default '{}',
  add column if not exists disabled_at            timestamptz;
create index if not exists integrations_connector on public.integrations (connector_id);

update public.integrations i set connector_id = replace(i.provider, '_', '-')
 where i.connector_id is null and replace(i.provider, '_', '-') in (select c.id from public.connector_catalog c);

drop policy if exists integrations_select on public.integrations;
create policy integrations_select on public.integrations for select to authenticated
  using (workspace_id in (select authz.ws_with('integrations.read', 'own')));
drop policy if exists integrations_insert on public.integrations;
create policy integrations_insert on public.integrations for insert to authenticated
  with check (workspace_id in (select authz.ws_with_member('integrations.manage', 'all')));
drop policy if exists integrations_update on public.integrations;
create policy integrations_update on public.integrations for update to authenticated
  using (workspace_id in (select authz.ws_with_member('integrations.manage', 'all')))
  with check (workspace_id in (select authz.ws_with_member('integrations.manage', 'all')));
drop policy if exists integrations_delete on public.integrations;
create policy integrations_delete on public.integrations for delete to authenticated
  using (workspace_id in (select authz.ws_with_member('integrations.manage', 'all')));

create table if not exists public.oauth_states (
  state_hash   text primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connector_id text not null references public.connector_catalog(id),
  user_id      uuid not null,
  redirect_to  text,
  expires_at   timestamptz not null
);
create index if not exists oauth_states_expiry on public.oauth_states (expires_at);

create table if not exists public.sync_cursors (
  integration_id uuid not null references public.integrations(id) on delete cascade,
  stream         text not null,
  "cursor"       jsonb,
  updated_at     timestamptz not null default now(),
  primary key (integration_id, stream)
);

alter table public.sync_runs
  add column if not exists stream     text,
  add column if not exists job_run_id bigint references public.job_runs(id) on delete set null,
  add column if not exists mode       text check (mode in ('sandbox', 'live'));

create table if not exists public.external_links (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  integration_id   uuid not null references public.integrations(id) on delete cascade,
  external_object  text not null,
  external_id      text not null,
  local_table      text not null,
  local_id         uuid not null,
  content_hash     text,
  last_synced_at   timestamptz,
  direction        text not null default 'in' check (direction in ('in', 'out', 'both')),
  constraint external_links_unique unique (integration_id, external_object, external_id)
);
create index if not exists external_links_local on public.external_links (local_table, local_id);
create index if not exists external_links_ws on public.external_links (workspace_id);

create table if not exists public.webhook_inbox (
  id                bigint generated always as identity primary key,
  connector_id      text not null references public.connector_catalog(id),
  integration_id    uuid references public.integrations(id) on delete set null,
  tenant_id         uuid references public.tenants(id) on delete cascade,      -- filled once the connection is resolved
  workspace_id      uuid references public.workspaces(id) on delete cascade,
  provider_event_id text not null,
  received_at       timestamptz not null default now(),
  signature_ok      boolean not null default false,
  headers           jsonb not null default '{}',   -- allow-listed headers only
  body              text,                          -- null when the signature failed
  status            text not null default 'queued' check (status in ('queued', 'processed', 'failed', 'ignored')),
  error             text,
  processed_at      timestamptz,
  constraint webhook_inbox_dedupe unique (connector_id, provider_event_id)
);
create index if not exists webhook_inbox_age on public.webhook_inbox (received_at);   -- 30-day retention (private.maintenance)
create index if not exists webhook_inbox_ws on public.webhook_inbox (workspace_id, received_at desc);

create table if not exists public.webhook_endpoints (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  url                  text not null check (url ~ '^https://'),
  description          text,
  event_types          text[] not null default '{}',
  secret_id            uuid,   -- Vault
  previous_secret_id   uuid,
  secret_rotated_at    timestamptz,
  active               boolean not null default true,
  disabled_reason      text,
  consecutive_failures int not null default 0,
  created_by           uuid,
  created_at           timestamptz not null default now()
);
create index if not exists webhook_endpoints_ws on public.webhook_endpoints (workspace_id, created_at desc);

create table if not exists public.webhook_deliveries (
  id              bigint generated always as identity,
  endpoint_id     uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_id        bigint,
  event_type      text not null,
  attempt         int not null default 1,
  status          text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'dead')),
  response_status int,
  response_ms     int,
  response_excerpt text,
  next_attempt_at timestamptz,
  created_at      timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);
create index if not exists webhook_deliveries_endpoint on public.webhook_deliveries (endpoint_id, created_at desc);
create index if not exists webhook_deliveries_due on public.webhook_deliveries (next_attempt_at) where status in ('pending', 'failed');
select private.ensure_month_partitions('public.webhook_deliveries', date '2026-10-01', 15);

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(name) between 2 and 80),
  prefix       text not null unique,
  key_hash     text not null,
  env          text not null default 'live' check (env in ('live', 'test')),
  scopes       text[] not null default '{}',
  role_id      uuid references public.roles(id),
  bot_user_id  uuid references auth.users(id) on delete set null,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz
);
create index if not exists api_keys_ws on public.api_keys (workspace_id, created_at desc);

create table if not exists public.api_request_log (
  id           bigint generated always as identity,
  key_id       uuid,   -- no FK: the log outlives a deleted key
  tenant_id    uuid,
  workspace_id uuid,
  method       text,
  path         text,
  status       int,
  ms           int,
  ip           inet,
  request_id   text,
  at           timestamptz not null default now(),
  primary key (id, at)
) partition by range (at);
create index if not exists api_request_log_key on public.api_request_log (key_id, at desc);
create index if not exists api_request_log_ws on public.api_request_log (workspace_id, at desc);
select private.ensure_month_partitions('public.api_request_log', date '2026-10-01', 15);

do $$
declare t text;
begin
  foreach t in array array['external_links', 'webhook_endpoints', 'api_keys', 'oauth_states'] loop
    execute format('drop trigger if exists a00_%1$s_tenant on public.%1$I', t);
    execute format('create trigger a00_%1$s_tenant before insert or update of workspace_id, tenant_id on public.%1$I
                    for each row execute function public.set_tenant_from_workspace()', t);
  end loop;
  -- webhook_inbox: tenant is optional, derive only when a workspace is given
  drop trigger if exists a00_webhook_inbox_tenant on public.webhook_inbox;
  create trigger a00_webhook_inbox_tenant before insert or update of workspace_id, tenant_id on public.webhook_inbox
    for each row execute function public.set_tenant_from_workspace();
end $$;

-- changes to connections, endpoints and keys are audited (summaries via app.audit_summary)
do $$
declare t text;
begin
  foreach t in array array['webhook_endpoints', 'api_keys', 'connector_availability'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- ---------- 3. RLS ----------
alter table public.oauth_states        enable row level security;   -- service only
alter table public.sync_cursors        enable row level security;
alter table public.external_links      enable row level security;
alter table public.webhook_inbox       enable row level security;
alter table public.webhook_endpoints   enable row level security;
alter table public.webhook_deliveries  enable row level security;
alter table public.api_keys            enable row level security;
alter table public.api_request_log     enable row level security;

drop policy if exists sync_cursors_select on public.sync_cursors;
create policy sync_cursors_select on public.sync_cursors for select to authenticated
  using (integration_id in (select i.id from public.integrations i));   -- integrations RLS decides (integrations.read)
drop policy if exists external_links_select on public.external_links;
create policy external_links_select on public.external_links for select to authenticated
  using (workspace_id in (select authz.ws_with('integrations.read', 'own')));

drop policy if exists webhook_inbox_select on public.webhook_inbox;
create policy webhook_inbox_select on public.webhook_inbox for select to authenticated
  using (workspace_id in (select authz.ws_with_member('integrations.manage', 'all')));   -- counts only: body/headers not granted

drop policy if exists webhook_endpoints_select on public.webhook_endpoints;
create policy webhook_endpoints_select on public.webhook_endpoints for select to authenticated
  using (workspace_id in (select authz.ws_with_member('webhooks.manage', 'all')));
drop policy if exists webhook_endpoints_insert on public.webhook_endpoints;
create policy webhook_endpoints_insert on public.webhook_endpoints for insert to authenticated
  with check (workspace_id in (select authz.ws_with_member('webhooks.manage', 'all'))
              and coalesce((select p.allow_webhooks from public.org_admin_policies p where p.tenant_id = webhook_endpoints.tenant_id), true));
drop policy if exists webhook_endpoints_update on public.webhook_endpoints;
create policy webhook_endpoints_update on public.webhook_endpoints for update to authenticated
  using (workspace_id in (select authz.ws_with_member('webhooks.manage', 'all')))
  with check (workspace_id in (select authz.ws_with_member('webhooks.manage', 'all')));
drop policy if exists webhook_endpoints_delete on public.webhook_endpoints;
create policy webhook_endpoints_delete on public.webhook_endpoints for delete to authenticated
  using (workspace_id in (select authz.ws_with_member('webhooks.manage', 'all')));

drop policy if exists webhook_deliveries_select on public.webhook_deliveries;
create policy webhook_deliveries_select on public.webhook_deliveries for select to authenticated
  using (endpoint_id in (select e.id from public.webhook_endpoints e));   -- endpoint RLS (webhooks.manage, never in support)

drop policy if exists api_keys_select on public.api_keys;
create policy api_keys_select on public.api_keys for select to authenticated
  using (workspace_id in (select authz.ws_with_member('api_keys.manage', 'all')));
drop policy if exists api_keys_update on public.api_keys;
create policy api_keys_update on public.api_keys for update to authenticated
  using (workspace_id in (select authz.ws_with_member('api_keys.manage', 'all')))
  with check (workspace_id in (select authz.ws_with_member('api_keys.manage', 'all')));
drop policy if exists api_keys_delete on public.api_keys;
create policy api_keys_delete on public.api_keys for delete to authenticated
  using (workspace_id in (select authz.ws_with_member('api_keys.manage', 'all')));
-- keys are created server-side with the service client (needs the hash): no insert policy for authenticated

drop policy if exists api_request_log_select on public.api_request_log;
create policy api_request_log_select on public.api_request_log for select to authenticated
  using (workspace_id in (select authz.ws_with_member('api_keys.manage', 'all')));

-- owners see delivery counts, never bodies or headers
create or replace view public.v_webhook_inbox_stats with (security_invoker = true) as
  select w.workspace_id, w.connector_id, w.status, count(*) as events, max(w.received_at) as last_received_at
    from public.webhook_inbox w
   group by w.workspace_id, w.connector_id, w.status;

-- ---------- 4. Grants ----------
revoke all on public.connector_catalog, public.connector_availability, public.oauth_states, public.sync_cursors,
  public.external_links, public.webhook_inbox, public.webhook_endpoints, public.webhook_deliveries, public.api_keys,
  public.api_request_log, public.v_webhook_inbox_stats from anon, authenticated;
grant select on public.connector_catalog, public.connector_availability, public.sync_cursors, public.external_links,
  public.webhook_deliveries, public.api_request_log to authenticated;
grant insert, update, delete on public.connector_availability to authenticated;   -- RLS: super_admin only
grant select, insert, update, delete on public.webhook_endpoints to authenticated;
grant select (id, connector_id, integration_id, workspace_id, tenant_id, received_at, signature_ok, status, processed_at)
  on public.webhook_inbox to authenticated;
grant select on public.v_webhook_inbox_stats to authenticated;
-- key_hash is never selectable by API roles
grant select (id, tenant_id, workspace_id, name, prefix, env, scopes, role_id, bot_user_id, created_by, created_at, last_used_at, expires_at, revoked_at)
  on public.api_keys to authenticated;
grant update (name, scopes, expires_at, revoked_at) on public.api_keys to authenticated;
grant delete on public.api_keys to authenticated;

grant select, insert, update, delete on public.connector_catalog, public.connector_availability, public.oauth_states,
  public.sync_cursors, public.external_links, public.webhook_inbox, public.webhook_endpoints, public.webhook_deliveries,
  public.api_keys, public.api_request_log to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------- 5. Vault wrappers (service_role only) ----------
create or replace function private.put_secret(p_name text, p_secret text, p_desc text default '') returns uuid
language sql volatile security definer set search_path = '' as $$
  select vault.create_secret(p_secret, p_name, coalesce(p_desc, ''))
$$;
create or replace function private.get_secret(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select d.decrypted_secret from vault.decrypted_secrets d where d.id = p_id
$$;
create or replace function private.delete_secret(p_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  delete from vault.secrets where id = p_id
$$;
-- PostgREST reaches only exposed schemas: public wrappers, same restriction
create or replace function public.vault_put_secret(p_name text, p_secret text, p_desc text default '') returns uuid
language sql volatile security definer set search_path = '' as $$ select private.put_secret(p_name, p_secret, p_desc) $$;
create or replace function public.vault_get_secret(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$ select private.get_secret(p_id) $$;
create or replace function public.vault_delete_secret(p_id uuid) returns void
language sql volatile security definer set search_path = '' as $$ select private.delete_secret(p_id) $$;

-- ---------- 6. Consent gate ----------
-- true when the latest consent_log entry for (lead, purpose) is a grant. The caller must be able to see the lead's workspace
-- (service role, auth.uid() null, is trusted).
create or replace function public.can_contact(p_lead uuid, p_purpose public.consent_purpose) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.action = 'granted'
       from public.consent_log c
      where c.lead_id = p_lead and c.purpose = p_purpose
      order by c.occurred_at desc, c.id desc limit 1), false)
    and exists (select 1 from public.leads l
                 where l.id = p_lead and l.deleted_at is null
                   and (auth.uid() is null or l.workspace_id in (select public.member_ws_ids())))
$$;

revoke execute on function private.put_secret(text, text, text), private.get_secret(uuid), private.delete_secret(uuid),
  public.vault_put_secret(text, text, text), public.vault_get_secret(uuid), public.vault_delete_secret(uuid),
  public.can_contact(uuid, public.consent_purpose) from public, anon, authenticated;
grant execute on function private.put_secret(text, text, text), private.get_secret(uuid), private.delete_secret(uuid),
  public.vault_put_secret(text, text, text), public.vault_get_secret(uuid), public.vault_delete_secret(uuid) to service_role;
grant execute on function public.can_contact(uuid, public.consent_purpose) to authenticated, service_role;

-- ---------- 7. verify ----------
do $$
begin
  assert (select count(*) from public.connector_catalog) >= 25, '0015: 22 connectors + csv, email-smtp, resend';
  assert (select count(*) from public.connector_availability) >= 75, '0015: availability for every connector and env';
  assert not has_column_privilege('authenticated', 'public.api_keys', 'key_hash', 'select'), '0015: key_hash must not be selectable';
  assert not has_table_privilege('authenticated', 'public.webhook_inbox', 'insert'), '0015: webhook_inbox is service-written';
  assert not has_function_privilege('authenticated', 'private.get_secret(uuid)', 'execute'), '0015: vault wrappers are service_role only';
  assert not has_function_privilege('anon', 'public.can_contact(uuid,public.consent_purpose)', 'execute'), '0015: anon cannot call can_contact';
  assert (select count(*) from pg_inherits i join pg_class c on c.oid = i.inhparent where c.relname = 'webhook_deliveries') >= 15, '0015: delivery partitions';
end $$;

commit;
