-- T044: LinkedIn ad account ownership (one workspace per account, platform-wide). Reads for workspace members; writes service role only.
create table if not exists public.linkedin_assets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid references public.integrations(id) on delete set null,
  platform       text not null check (platform in ('linkedin_ad_account')),
  external_id    text not null,
  name           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint linkedin_assets_asset_unique unique (platform, external_id)
);
create index if not exists linkedin_assets_workspace on public.linkedin_assets (workspace_id);
create index if not exists linkedin_assets_integration on public.linkedin_assets (integration_id);
create index if not exists linkedin_assets_tenant on public.linkedin_assets (tenant_id);
alter table public.linkedin_assets enable row level security;
drop policy if exists linkedin_assets_read on public.linkedin_assets;
create policy linkedin_assets_read on public.linkedin_assets for select to authenticated
  using (workspace_id in (select public.member_ws_ids()));
drop trigger if exists a00_linkedin_assets_tenant on public.linkedin_assets;
create trigger a00_linkedin_assets_tenant before insert or update of workspace_id, tenant_id on public.linkedin_assets
  for each row execute function public.set_tenant_from_workspace();
drop trigger if exists linkedin_assets_updated on public.linkedin_assets;
create trigger linkedin_assets_updated before update on public.linkedin_assets
  for each row execute function public.set_updated_at();
create index if not exists campaigns_linkedin_external on public.campaigns (workspace_id, (external_ids->>'linkedin')) where external_ids ? 'linkedin';
