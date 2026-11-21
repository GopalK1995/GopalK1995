-- T071: Instagram + Facebook organic metrics. Reads need analytics.read; writes are service role only (the sync).
create table if not exists public.social_accounts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  integration_id   uuid references public.integrations(id) on delete set null,
  platform         text not null check (platform in ('instagram','facebook')),
  external_id      text not null,
  display_name     text,
  username         text,
  followers        integer,
  last_synced_at   timestamptz,
  last_sync_status text check (last_sync_status in ('ok','partial','error','needs_attention')),
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, platform, external_id)
);
create index if not exists social_accounts_ws on public.social_accounts (workspace_id);
create index if not exists social_accounts_integration on public.social_accounts (integration_id);

create table if not exists public.social_posts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  account_id   uuid not null references public.social_accounts(id) on delete cascade,
  external_id  text not null,
  kind         text not null default 'feed' check (kind in ('feed','reel','story','carousel','video')),
  caption      text,
  permalink    text,
  media_url    text,
  posted_at    timestamptz,
  status       text not null default 'live' check (status in ('live','expired','deleted')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (account_id, external_id)
);
create index if not exists social_posts_ws_posted on public.social_posts (workspace_id, posted_at desc);
create index if not exists social_posts_account on public.social_posts (account_id, posted_at desc);

-- One row per post per day, re-written by every 3-hourly sync (captured_at shows the latest pull). Unavailable metric = null, never 0.
create table if not exists public.social_post_metrics_daily (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  post_id      uuid not null references public.social_posts(id) on delete cascade,
  day          date not null,
  impressions  integer,
  reach        integer,
  likes        integer,
  comments     integer,
  shares       integer,
  saves        integer,
  video_views  integer,
  link_clicks  integer,
  engagement_rate numeric generated always as (
    case when reach > 0 then round((coalesce(likes,0)+coalesce(comments,0)+coalesce(shares,0)+coalesce(saves,0))::numeric / reach, 4) end
  ) stored,
  captured_at  timestamptz not null default now(),
  unique (post_id, day)
);
create index if not exists social_post_metrics_ws_day on public.social_post_metrics_daily (workspace_id, day desc);

create table if not exists public.social_account_metrics_daily (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  account_id     uuid not null references public.social_accounts(id) on delete cascade,
  day            date not null,
  followers      integer,
  follower_delta integer,
  profile_views  integer,
  reach          integer,
  website_clicks integer,
  captured_at    timestamptz not null default now(),
  unique (account_id, day)
);
create index if not exists social_account_metrics_ws_day on public.social_account_metrics_daily (workspace_id, day desc);

do $$
declare t text;
begin
  foreach t in array array['social_accounts','social_posts','social_post_metrics_daily','social_account_metrics_daily'] loop
    execute format('drop trigger if exists a00_%1$s_tenant on public.%1$I', t);
    execute format('create trigger a00_%1$s_tenant before insert or update of workspace_id, tenant_id on public.%1$I for each row execute function public.set_tenant_from_workspace()', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array array['social_accounts','social_posts'] loop
    execute format('drop trigger if exists %1$s_updated on public.%1$I', t);
    execute format('create trigger %1$s_updated before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['social_accounts','social_posts','social_post_metrics_daily','social_account_metrics_daily'] loop
    perform private.rls_table(t, null, array['analytics.read'], null, null, null, null, null, null, null, null, false, false);
  end loop;
end $$;
