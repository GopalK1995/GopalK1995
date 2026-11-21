-- 0021c T036: Meta asset ownership (a Facebook Page / Instagram account belongs to exactly one workspace). Idempotent, additive.
-- Already applied to the Lawsome Supabase; copied here so the repo matches.
create table if not exists public.meta_assets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid references public.integrations(id) on delete set null,
  platform       text not null check (platform in ('facebook_page', 'instagram')),
  external_id    text not null,
  name           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint meta_assets_asset_unique unique (platform, external_id)
);
create index if not exists meta_assets_workspace on public.meta_assets (workspace_id);
create index if not exists meta_assets_integration on public.meta_assets (integration_id);
alter table public.meta_assets enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'meta_assets' and policyname = 'meta_assets_read') then
    create policy meta_assets_read on public.meta_assets for select to authenticated using (workspace_id in (select public.member_ws_ids()));
  end if;
end $$;
create unique index if not exists messages_external_id_unique on public.messages (tenant_id, external_id) where external_id is not null;
create index if not exists leads_ig_igsid on public.leads (workspace_id, (external_ids->>'instagram_igsid')) where external_ids ? 'instagram_igsid';
create index if not exists campaigns_meta_external on public.campaigns (workspace_id, (external_ids->>'meta')) where external_ids ? 'meta';
