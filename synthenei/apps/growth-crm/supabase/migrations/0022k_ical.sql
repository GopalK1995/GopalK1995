-- T046: iCal import feeds (URL lives in the Vault, never in a column) and export tokens (SHA-256 hash only).
create table if not exists public.ical_feeds (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  property_key   text not null check (length(property_key) between 1 and 80),
  source         text not null check (source in ('airbnb', 'booking_com', 'other')),
  label          text not null default '' check (length(label) <= 80),
  timezone       text,
  url_secret_id  uuid not null,
  url_host       text,
  last_hash      text,
  failures       integer not null default 0 check (failures >= 0),
  last_error     text check (last_error is null or length(last_error) <= 60),
  last_ok_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists ical_feeds_conn on public.ical_feeds (integration_id);
create index if not exists ical_feeds_ws on public.ical_feeds (workspace_id, created_at desc);
create index if not exists ical_feeds_tenant on public.ical_feeds (tenant_id);
alter table public.ical_feeds enable row level security;
drop policy if exists ical_feeds_select on public.ical_feeds;
create policy ical_feeds_select on public.ical_feeds for select to authenticated
  using (workspace_id in (select authz.ws_with('integrations.read', 'all')));
revoke all on public.ical_feeds from anon, authenticated;
grant select (id, tenant_id, workspace_id, integration_id, property_key, source, label, timezone, url_host, failures, last_error, last_ok_at, created_at) on public.ical_feeds to authenticated;
grant select, insert, update, delete on public.ical_feeds to service_role;

create table if not exists public.ical_export_tokens (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  property_key    text not null check (length(property_key) between 1 and 80),
  exclude_source  text check (exclude_source is null or exclude_source in ('airbnb', 'booking_com', 'other')),
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_fetched_at timestamptz,
  revoked_at      timestamptz
);
create index if not exists ical_export_tokens_ws on public.ical_export_tokens (workspace_id, created_at desc);
create index if not exists ical_export_tokens_tenant on public.ical_export_tokens (tenant_id);
create index if not exists ical_export_tokens_created_by on public.ical_export_tokens (created_by);
alter table public.ical_export_tokens enable row level security;
drop policy if exists ical_export_tokens_select on public.ical_export_tokens;
create policy ical_export_tokens_select on public.ical_export_tokens for select to authenticated
  using (workspace_id in (select authz.ws_with('integrations.manage', 'all')));
revoke all on public.ical_export_tokens from anon, authenticated;
grant select (id, tenant_id, workspace_id, property_key, exclude_source, created_at, last_fetched_at, revoked_at) on public.ical_export_tokens to authenticated;
grant select, insert, update on public.ical_export_tokens to service_role;

do $$
declare t text;
begin
  foreach t in array array['ical_feeds','ical_export_tokens'] loop
    execute format('drop trigger if exists a00_%1$s_tenant on public.%1$I', t);
    execute format('create trigger a00_%1$s_tenant before insert or update of workspace_id, tenant_id on public.%1$I for each row execute function public.set_tenant_from_workspace()', t);
  end loop;
end $$;
