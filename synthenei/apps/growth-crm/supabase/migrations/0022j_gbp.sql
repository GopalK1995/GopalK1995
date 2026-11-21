-- T045: reviews reply columns + gbp_daily (mirrors 0021d: tenant trigger + private.rls_table select for analytics.read; writes service role only).
alter table public.reviews add column if not exists reply_source text check (reply_source is null or reply_source in ('ai', 'template', 'human'));
alter table public.reviews add column if not exists reply_error text check (reply_error is null or reply_error in ('credentials', 'rejected'));
alter table public.reviews add column if not exists external_reply text check (external_reply is null or length(external_reply) <= 4096);
alter table public.reviews add column if not exists external_reply_at timestamptz;

create table if not exists public.gbp_daily (
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  integration_id     uuid not null references public.integrations(id) on delete cascade,
  location_id        text not null,
  day                date not null,
  impressions_search integer check (impressions_search is null or impressions_search >= 0),
  impressions_maps   integer check (impressions_maps is null or impressions_maps >= 0),
  call_clicks        integer check (call_clicks is null or call_clicks >= 0),
  website_clicks     integer check (website_clicks is null or website_clicks >= 0),
  direction_requests integer check (direction_requests is null or direction_requests >= 0),
  conversations      integer check (conversations is null or conversations >= 0),
  bookings           integer check (bookings is null or bookings >= 0),
  food_orders        integer check (food_orders is null or food_orders >= 0),
  source             text not null default 'api' check (source in ('api', 'mock')),
  imported_at        timestamptz not null default now(),
  primary key (workspace_id, integration_id, day)
);
create index if not exists gbp_daily_tenant on public.gbp_daily (tenant_id);
create index if not exists gbp_daily_integration on public.gbp_daily (integration_id);
do $$
begin
  drop trigger if exists a00_gbp_daily_tenant on public.gbp_daily;
  create trigger a00_gbp_daily_tenant before insert or update of workspace_id, tenant_id on public.gbp_daily
    for each row execute function public.set_tenant_from_workspace();
  alter table public.gbp_daily enable row level security;
  perform private.rls_table('gbp_daily', null, array['analytics.read'], null, null, null, null, null, null, null, null, false, false);
end $$;
