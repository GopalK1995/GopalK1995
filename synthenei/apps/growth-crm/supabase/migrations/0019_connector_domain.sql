-- 0019 connector domain (BUILD-PLAN 2.7) + org-admin follow-ups requested by T012, T014, T015, T017 and T018.
--   * enum additions (committed by the end of this migration, never used inside it);
--   * message_templates extended for provider-synced WhatsApp templates;
--   * wa_numbers, payments, calendar_events, reviews, ad_accounts, import_jobs, email_identities (RLS on every table);
--   * campaign_daily_metrics gains integration_id / external_campaign_id / source;
--   * hospitality preset seed: the `booking` custom object (object_types + field_defs), never seeded for other presets;
--   * T017: last-owner guard on memberships, invitations.role_id + invite_member(p_role_id), save_role(), territories uniqueness;
--   * T018: admin_workspace_stats extra columns, admin_set_connector_availability / admin_set_tenant_branding (audited),
--           start_support_session fills tenant_id, platform admin read access re-asserted;
--   * T014 move_deal(), T015 merge_accounts() (atomic).
-- Forward-only and idempotent. Requires 0013 to 0018.
begin;

-- ---------- 1. Enum additions (not used again in this file: new labels are only usable after commit) ----------
alter type public.conv_channel add value if not exists 'instagram';
alter type public.conv_channel add value if not exists 'sms';
alter type public.conv_channel add value if not exists 'gbp';
alter type public.msg_status   add value if not exists 'pending_template';

-- ---------- 2. message_templates: WhatsApp templates synced from Meta ----------
-- `category` already exists since 0001 (marketing | utility | authentication) and keeps its check.
alter table public.message_templates
  add column if not exists provider_template_id text,
  add column if not exists status               text,
  add column if not exists components           jsonb not null default '[]',
  add column if not exists integration_id       uuid references public.integrations(id) on delete set null,
  add column if not exists rejected_reason      text;
update public.message_templates set status = case approval_status
    when 'approved' then 'approved' when 'rejected' then 'rejected' when 'pending' then 'submitted' else 'draft' end
 where status is null;
alter table public.message_templates alter column status set default 'draft', alter column status set not null;
alter table public.message_templates drop constraint if exists message_templates_status_check;
alter table public.message_templates add constraint message_templates_status_check
  check (status in ('draft', 'submitted', 'approved', 'rejected', 'paused'));
alter table public.message_templates drop constraint if exists message_templates_components_check;
alter table public.message_templates add constraint message_templates_components_check check (jsonb_typeof(components) = 'array');
create index if not exists message_templates_integration on public.message_templates (integration_id) where integration_id is not null;
create unique index if not exists message_templates_provider_id on public.message_templates (integration_id, provider_template_id)
  where provider_template_id is not null;

-- ---------- 3. campaign_daily_metrics: ads insights ----------
alter table public.campaign_daily_metrics
  add column if not exists integration_id        uuid references public.integrations(id) on delete set null,
  add column if not exists external_campaign_id  text;
-- `source` (api, csv, manual, mock) already exists since 0001 with a superset of the planned check: left untouched.
create index if not exists campaign_daily_metrics_integration on public.campaign_daily_metrics (integration_id) where integration_id is not null;

-- ---------- 4. New tables ----------
create table if not exists public.wa_numbers (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  integration_id       uuid references public.integrations(id) on delete cascade,
  waba_id              text not null,
  phone_number_id      text not null,
  display_number       text not null,
  verified_name        text,
  quality_rating       text not null default 'unknown' check (quality_rating in ('green', 'yellow', 'red', 'unknown')),
  messaging_limit_tier text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint wa_numbers_phone_unique unique (workspace_id, phone_number_id)
);
create index if not exists wa_numbers_tenant on public.wa_numbers (tenant_id);
create index if not exists wa_numbers_integration on public.wa_numbers (integration_id);

create table if not exists public.payments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid references public.integrations(id) on delete set null,
  provider       text not null check (provider ~ '^[a-z][a-z0-9_-]{1,40}$'),
  external_id    text,
  amount_paise   bigint not null check (amount_paise >= 0),
  currency       text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  status         text not null default 'created' check (status in ('created', 'pending', 'paid', 'failed', 'refunded', 'cancelled')),
  link_url       text,
  lead_id        uuid references public.leads(id) on delete set null,
  deal_id        uuid references public.deals(id) on delete set null,
  record_id      uuid references public.records(id) on delete set null,   -- booking custom object
  paid_at        timestamptz,
  raw_ref        text,                                                    -- pointer to the provider event (webhook_inbox id), never the body
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists payments_provider_external on public.payments (workspace_id, provider, external_id) where external_id is not null;
create index if not exists payments_tenant on public.payments (tenant_id);
create index if not exists payments_lead on public.payments (lead_id) where lead_id is not null;
create index if not exists payments_deal on public.payments (deal_id) where deal_id is not null;
create index if not exists payments_record on public.payments (record_id) where record_id is not null;
create index if not exists payments_integration on public.payments (integration_id) where integration_id is not null;

create table if not exists public.calendar_events (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid references public.integrations(id) on delete cascade,
  external_id    text,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  title          text not null default '' check (length(title) <= 300),
  object_type    text,                                                    -- linked object (lead | deal | contact | obj:<key>)
  object_id      uuid,
  status         text not null default 'confirmed' check (status in ('confirmed', 'tentative', 'cancelled')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (ends_at >= starts_at)
);
create unique index if not exists calendar_events_external on public.calendar_events (integration_id, external_id) where external_id is not null;
create index if not exists calendar_events_ws_time on public.calendar_events (workspace_id, starts_at);
create index if not exists calendar_events_tenant on public.calendar_events (tenant_id);
create index if not exists calendar_events_object on public.calendar_events (object_type, object_id) where object_id is not null;

create table if not exists public.reviews (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  integration_id     uuid references public.integrations(id) on delete cascade,
  external_id        text,
  rating             smallint check (rating between 1 and 5),
  review_text        text,
  author_name        text,
  reviewed_at        timestamptz,
  reply_draft        text check (reply_draft is null or length(reply_draft) <= 4096),
  reply_status       text not null default 'none' check (reply_status in ('none', 'draft', 'pending_approval', 'approved', 'posted', 'failed')),
  reply_approved_by  uuid,
  reply_approved_at  timestamptz,
  replied_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- a reply is never approved or posted without a named human approver (BUILD-PLAN 1.7: human approval)
  constraint reviews_reply_needs_approver check (reply_status not in ('approved', 'posted') or reply_approved_by is not null)
);
create unique index if not exists reviews_external on public.reviews (integration_id, external_id) where external_id is not null;
create index if not exists reviews_ws_time on public.reviews (workspace_id, reviewed_at desc);
create index if not exists reviews_tenant on public.reviews (tenant_id);

create table if not exists public.ad_accounts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid references public.integrations(id) on delete cascade,
  platform       text not null check (platform ~ '^[a-z][a-z0-9_-]{1,30}$'),
  external_id    text not null,
  name           text,
  currency       text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  timezone       text not null default 'Asia/Kolkata',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ad_accounts_unique unique (workspace_id, platform, external_id)
);
create index if not exists ad_accounts_tenant on public.ad_accounts (tenant_id);
create index if not exists ad_accounts_integration on public.ad_accounts (integration_id);

create table if not exists public.import_jobs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  object_type       text not null check (object_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  storage_path      text,
  mapping           jsonb not null default '{}' check (jsonb_typeof(mapping) = 'object'),
  mode              text not null default 'create' check (mode in ('create', 'update', 'upsert', 'skip_duplicates')),
  status            text not null default 'uploaded' check (status in ('uploaded', 'mapped', 'validating', 'running', 'done', 'failed', 'cancelled')),
  rows_total        int not null default 0 check (rows_total >= 0),
  rows_ok           int not null default 0 check (rows_ok >= 0),
  rows_dup          int not null default 0 check (rows_dup >= 0),
  rows_invalid      int not null default 0 check (rows_invalid >= 0),
  error_report_path text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  finished_at       timestamptz
);
create index if not exists import_jobs_ws on public.import_jobs (workspace_id, created_at desc);
create index if not exists import_jobs_tenant on public.import_jobs (tenant_id);
create index if not exists import_jobs_created_by on public.import_jobs (created_by);

create table if not exists public.email_identities (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid references public.integrations(id) on delete set null,
  provider       text not null check (provider in ('resend', 'smtp')),
  domain         text not null check (domain ~* '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  dkim_status    text not null default 'pending' check (dkim_status in ('pending', 'verified', 'failed')),
  spf_status     text not null default 'pending' check (spf_status in ('pending', 'verified', 'failed')),
  from_addresses text[] not null default '{}',
  verified_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint email_identities_domain_unique unique (tenant_id, domain)
);
create index if not exists email_identities_ws on public.email_identities (workspace_id);
create index if not exists email_identities_integration on public.email_identities (integration_id);

-- tenant_id follows the workspace; updated_at maintained; sensitive tables audited
do $$
declare t text;
begin
  foreach t in array array['wa_numbers', 'payments', 'calendar_events', 'reviews', 'ad_accounts', 'import_jobs', 'email_identities'] loop
    execute format('drop trigger if exists a00_%1$s_tenant on public.%1$I', t);
    execute format('create trigger a00_%1$s_tenant before insert or update of workspace_id, tenant_id on public.%1$I
                    for each row execute function public.set_tenant_from_workspace()', t);
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['wa_numbers', 'payments', 'ad_accounts', 'email_identities'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- Review replies: state machine + the approver is always the caller (cannot be spoofed from the client).
create or replace function private.reviews_reply_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.reply_status in ('approved', 'posted') then
      raise exception 'a reply cannot start approved' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.reply_status is distinct from old.reply_status then
    if not ((old.reply_status, new.reply_status) in (
         ('none', 'draft'), ('draft', 'pending_approval'), ('pending_approval', 'approved'), ('pending_approval', 'draft'),
         ('approved', 'posted'), ('approved', 'failed'), ('approved', 'draft'), ('failed', 'approved'), ('failed', 'draft'),
         ('posted', 'none'))) then
      raise exception 'reply status % to % is not allowed', old.reply_status, new.reply_status using errcode = '23514';
    end if;
    if new.reply_status = 'approved' then
      if (select auth.uid()) is not null then new.reply_approved_by := (select auth.uid()); end if;
      new.reply_approved_at := now();
    elsif new.reply_status = 'posted' then
      new.replied_at := coalesce(new.replied_at, now());
    elsif new.reply_status in ('draft', 'none') then
      new.reply_approved_by := null; new.reply_approved_at := null;
    end if;
  elsif new.reply_draft is distinct from old.reply_draft and old.reply_status in ('approved', 'posted') then
    raise exception 'an approved reply cannot be edited; send it back to draft first' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists a50_reviews_reply_guard on public.reviews;
create trigger a50_reviews_reply_guard before insert or update on public.reviews
  for each row execute function private.reviews_reply_guard();

-- ---------- 5. RLS ----------
alter table public.wa_numbers       enable row level security;
alter table public.payments         enable row level security;
alter table public.calendar_events  enable row level security;
alter table public.reviews          enable row level security;
alter table public.ad_accounts      enable row level security;
alter table public.import_jobs      enable row level security;
alter table public.email_identities enable row level security;

-- connection-level data: integrations.read to see, integrations.manage (real members only, never a support session) to change
select private.rls_table(t, null, array['integrations.read'], null, null, null,
                         array['integrations.manage'], null, null, array['integrations.manage'], null, true, false)
  from unnest(array['wa_numbers', 'ad_accounts', 'email_identities']) t;
-- money follows the deal permissions; providers write through the service role
select private.rls_table('payments', null, array['deals.read', 'leads.read'], null, null, null,
                         array['deals.write'], null, null, array['deals.write'], null, true, false);
-- scheduling follows activities
select private.rls_table('calendar_events', null, array['activities.read'], null, null, null,
                         array['activities.write'], null, null, array['activities.write'], null, false, false);
-- reviews are inbox items; replying needs inbox.reply
select private.rls_table('reviews', null, array['inbox.read'], null, null, null,
                         array['inbox.reply'], null, null, null, null, true, false);
-- imports: leads.import; "own" scope sees and edits only the caller's own jobs
select private.rls_table('import_jobs', null, array['leads.import'], null, array['created_by'], null,
                         array['leads.import'], array['created_by'], null, array['leads.import'], array['created_by'], false, false);

-- ---------- 6. Grants ----------
revoke all on public.wa_numbers, public.payments, public.calendar_events, public.reviews, public.ad_accounts,
  public.import_jobs, public.email_identities from anon, authenticated;
grant select, insert, update, delete on public.wa_numbers, public.payments, public.calendar_events, public.ad_accounts,
  public.import_jobs, public.email_identities to authenticated;
grant select, insert, update on public.reviews to authenticated;
grant select, insert, update, delete on public.wa_numbers, public.payments, public.calendar_events, public.reviews, public.ad_accounts,
  public.import_jobs, public.email_identities to service_role;

-- ---------- 7. Hospitality preset: the `booking` custom object ----------
-- Seeded per tenant, only when the tenant's preset is hospitality (tenant_config.config.preset). Metadata, not a hard-coded table.
create or replace function metadata.seed_hospitality_booking(p_tenant uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ot uuid;
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant) then return false; end if;
  insert into public.object_types (tenant_id, key, kind, label, primary_field, position, icon)
  values (p_tenant, 'booking', 'custom', '{"en":{"one":"Booking","many":"Bookings"}}', 'room', 20, 'calendar-check')
  on conflict (tenant_id, key) do nothing;
  select o.id into v_ot from public.object_types o where o.tenant_id = p_tenant and o.key = 'booking';
  insert into public.field_defs (tenant_id, object_type_id, key, label, type, options, required, is_filterable, section, position)
  select p_tenant, v_ot, f.key, jsonb_build_object('en', f.label), f.type, f.options::jsonb, f.required, true, 'stay', f.pos
    from (values
      ('check_in',       'Check-in',          'date',    '{}', true,  1),
      ('check_out',      'Check-out',         'date',    '{}', true,  2),
      ('room',           'Room',              'text',    '{}', false, 3),
      ('guests',         'Guests',            'number',  '{}', false, 4),
      ('source_ota',     'Source',            'select',  '{"choices":[{"key":"direct","label":"Direct"},{"key":"booking_com","label":"Booking.com"},{"key":"makemytrip","label":"MakeMyTrip"},{"key":"airbnb","label":"Airbnb"},{"key":"walk_in","label":"Walk-in"}]}', false, 5),
      ('commission_pct', 'Commission %',      'percent', '{}', false, 6)
    ) f(key, label, type, options, required, pos)
  on conflict (object_type_id, key) do nothing;
  return true;
exception when check_violation then
  raise warning 'hospitality booking object not fully seeded for %: custom field limit reached', p_tenant;
  return false;
end $$;
revoke all on function metadata.seed_hospitality_booking(uuid) from public, anon, authenticated;
grant execute on function metadata.seed_hospitality_booking(uuid) to service_role;

-- Public entry point: platform admins and owners of the tenant (used when a tenant switches to the hospitality preset).
create or replace function public.seed_hospitality_booking(p_tenant uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_platform_admin() or p_tenant in (select public.owner_tenant_ids())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return metadata.seed_hospitality_booking(p_tenant);
end $$;
revoke all on function public.seed_hospitality_booking(uuid) from public, anon;
grant execute on function public.seed_hospitality_booking(uuid) to authenticated, service_role;

create or replace function metadata.tenant_config_preset_seed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.config ->> 'preset' = 'hospitality' then perform metadata.seed_hospitality_booking(new.tenant_id); end if;
  return null;
end $$;
drop trigger if exists trg_tenant_config_preset_seed on public.tenant_config;
create trigger trg_tenant_config_preset_seed after insert or update of config on public.tenant_config
  for each row execute function metadata.tenant_config_preset_seed();
select metadata.seed_hospitality_booking(c.tenant_id) from public.tenant_config c where c.config ->> 'preset' = 'hospitality';

-- ---------- 8. T017 follow-ups ----------
-- 8.1 territories (workspace_id, district) is unique (0004 rewrote the primary key; add a named constraint only when missing)
do $$
begin
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.territories'::regclass and c.contype in ('u', 'p')
       and (select array_agg(a.attname::text order by a.attname) from unnest(c.conkey) k
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k) = array['district', 'workspace_id']) then
    alter table public.territories add constraint territories_workspace_district_key unique (workspace_id, district);
  end if;
end $$;

-- 8.2 the last active owner of a workspace cannot be demoted, deactivated or deleted (workspace/tenant purges are exempt;
--     a deliberate removal sets app.allow_last_owner_removal = 'on' in its own transaction)
create or replace function authz.memberships_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role is distinct from 'owner' or not old.is_active then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.role = 'owner' and new.is_active then return new; end if;
  if coalesce(current_setting('app.allow_last_owner_removal', true), '') = 'on' then return coalesce(new, old); end if;
  -- cascade from a workspace delete: the workspace row is already gone
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then return coalesce(new, old); end if;
  perform 1 from public.workspaces w where w.id = old.workspace_id for update;   -- serialise concurrent owner changes
  if not exists (select 1 from public.memberships m
                  where m.workspace_id = old.workspace_id and m.role = 'owner' and m.is_active and m.id <> old.id) then
    raise exception 'last_owner: a workspace needs at least one active owner' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function authz.memberships_last_owner() from public, anon, authenticated;
drop trigger if exists z5_memberships_last_owner on public.memberships;
create trigger z5_memberships_last_owner before update or delete on public.memberships
  for each row execute function authz.memberships_last_owner();

-- 8.3 invitations carry the custom role chosen at invite time
alter table public.invitations add column if not exists role_id uuid references public.roles(id) on delete set null;
create index if not exists invitations_role_id on public.invitations (role_id) where role_id is not null;

drop function if exists public._add_member_or_invite(uuid, text, public.app_role, text, text[]);
create or replace function public._add_member_or_invite(p_ws uuid, p_email text, p_role public.app_role,
                                                       p_full_name text, p_districts text[], p_role_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_inv uuid; v_email text := lower(trim(p_email));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or length(v_email) > 160 then
    raise exception 'invalid email' using errcode = '22023'; end if;
  select u.id into v_user from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null;
  if v_user is not null then
    insert into public.profiles (id, full_name, email, last_workspace_id)
    values (v_user, coalesce(nullif(trim(p_full_name), ''), split_part(v_email, '@', 1)), v_email, p_ws)
    on conflict (id) do nothing;
    insert into public.memberships (user_id, workspace_id, role, role_id, invited_by)
    values (v_user, p_ws, p_role, p_role_id, auth.uid())
    on conflict (user_id, workspace_id) do update set role = excluded.role, role_id = excluded.role_id, is_active = true;
    insert into public.territories (workspace_id, district, rep_id)
    select p_ws, d, v_user from unnest(coalesce(p_districts, '{}')) d
    on conflict (workspace_id, district) do update set rep_id = excluded.rep_id;
    if p_role = 'owner' then
      update public.tenants t set primary_owner_id = v_user
       where t.id = (select w.tenant_id from public.workspaces w where w.id = p_ws) and t.primary_owner_id is null;
    end if;
    return jsonb_build_object('status', 'member_added', 'user_id', v_user);
  end if;
  delete from public.invitations where workspace_id = p_ws and lower(email) = v_email and accepted_at is null;
  insert into public.invitations (workspace_id, email, full_name, role, role_id, territory_districts, invited_by)
  values (p_ws, v_email, nullif(trim(p_full_name), ''), p_role, p_role_id, coalesce(p_districts, '{}'),
          (select p.id from public.profiles p where p.id = auth.uid()))
  returning id into v_inv;
  -- the server action must now call auth.admin.inviteUserByEmail(email) with the service role
  return jsonb_build_object('status', 'invited', 'invitation_id', v_inv);
end $$;
revoke all on function public._add_member_or_invite(uuid, text, public.app_role, text, text[], uuid) from public, anon, authenticated;

drop function if exists public.invite_member(uuid, text, public.app_role, text, text[]);
-- p_role_id (optional) picks a system or custom role; its base role replaces p_role. Custom roles need roles.manage and may not
-- exceed the caller's own permissions; sales managers only assign system sales_rep / viewer roles.
create or replace function public.invite_member(p_ws uuid, p_email text, p_role public.app_role,
                                                p_full_name text default null, p_districts text[] default '{}',
                                                p_role_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_role public.app_role := p_role; v_r public.roles; v_tenant uuid;
begin
  if p_role_id is not null then
    select * into v_r from public.roles r where r.id = p_role_id;
    select w.tenant_id into v_tenant from public.workspaces w where w.id = p_ws;
    if v_r.id is null or (v_r.tenant_id is not null and v_r.tenant_id is distinct from v_tenant) then
      raise exception 'unknown role' using errcode = '22023';
    end if;
    v_role := v_r.base_role;
    if v_r.tenant_id is not null and not public.is_platform_admin() then
      if not authz.can_manage_roles(v_tenant) or not authz.role_within_caller(p_ws, v_r.id) then
        raise exception 'not allowed to assign this role' using errcode = '42501';
      end if;
    end if;
  end if;
  if not (p_ws in (select public.member_role_ws_ids('owner'))
          or (p_ws in (select public.member_role_ws_ids('sales_manager')) and v_role in ('sales_rep', 'viewer')
              and (v_r.id is null or v_r.tenant_id is null))
          or (public.is_platform_admin() and v_role = 'owner'
              and not exists (select 1 from public.memberships m
                               where m.workspace_id = p_ws and m.role = 'owner' and m.is_active))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public._add_member_or_invite(p_ws, p_email, v_role, p_full_name, p_districts, p_role_id);
end $$;
revoke all on function public.invite_member(uuid, text, public.app_role, text, text[], uuid) from public, anon;
grant execute on function public.invite_member(uuid, text, public.app_role, text, text[], uuid) to authenticated, service_role;

-- invitation acceptance applies the invited role
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv record;
begin
  if new.email_confirmed_at is null then return new; end if;
  for inv in
    select * from public.invitations
     where lower(email) = lower(new.email) and accepted_at is null and expires_at > now()
  loop
    insert into public.profiles (id, full_name, email, last_workspace_id)
    values (new.id, coalesce(inv.full_name, split_part(new.email, '@', 1)), new.email, inv.workspace_id)
    on conflict (id) do nothing;
    insert into public.memberships (user_id, workspace_id, role, role_id, invited_by)
    values (new.id, inv.workspace_id, inv.role, inv.role_id, inv.invited_by)
    on conflict (user_id, workspace_id) do update set role = excluded.role, role_id = excluded.role_id, is_active = true;
    insert into public.territories (workspace_id, district, rep_id)
    select inv.workspace_id, d, new.id from unnest(inv.territory_districts) d
    on conflict (workspace_id, district) do update set rep_id = excluded.rep_id;
    update public.invitations set accepted_at = now() where id = inv.id;
    if inv.role = 'owner' then
      update public.tenants set primary_owner_id = new.id where id = inv.tenant_id and primary_owner_id is null;
    end if;
  end loop;
  return new;
end $$;

-- 8.4 save_role: one transaction for the role row and its permission set. SECURITY INVOKER: the roles / role_permissions RLS
-- policies and guard triggers (system roles read-only, no escalation, audit) apply exactly as for direct writes.
--   p_perms: [{"key": "leads.read", "scope": "team", "conditions": {...}, "field_mask": ["phone"]}, ...]; keys left out are removed.
--   p_role null = create (needs p_tenant and p_base_role). p_expected_updated_at (update only) is the optimistic check.
create or replace function public.save_role(p_role uuid, p_name text, p_perms jsonb, p_expected_updated_at timestamptz default null,
                                            p_tenant uuid default null, p_base_role public.app_role default null,
                                            p_description text default null)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid := p_role; v_upd timestamptz; v_keys text[]; v_cnt int;
begin
  if p_perms is null or jsonb_typeof(p_perms) <> 'array' then
    raise exception 'permissions must be a JSON array' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_perms) e
              where jsonb_typeof(e) <> 'object' or e ->> 'key' is null or coalesce(e ->> 'scope', '') not in ('all', 'team', 'own', 'none')) then
    raise exception 'every permission needs a key and a scope (all, team, own, none)' using errcode = '22023';
  end if;
  if v_id is null then
    if p_tenant is null or p_base_role is null then
      raise exception 'creating a role needs a tenant and a base role' using errcode = '22023';
    end if;
    insert into public.roles (tenant_id, key, name, description, base_role)
    values (p_tenant, 'custom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), trim(p_name), coalesce(p_description, ''), p_base_role)
    returning id, updated_at into v_id, v_upd;
  else
    update public.roles r
       set name = coalesce(nullif(trim(p_name), ''), r.name), description = coalesce(p_description, r.description)
     where r.id = v_id and (p_expected_updated_at is null or r.updated_at = p_expected_updated_at)
    returning r.updated_at into v_upd;
    if v_upd is null then
      if p_expected_updated_at is not null and exists (select 1 from public.roles r where r.id = v_id and r.updated_at <> p_expected_updated_at) then
        raise exception 'role_conflict: the role changed since it was loaded' using errcode = '40001';
      end if;
      raise exception 'role not found or not allowed' using errcode = '42501';
    end if;
  end if;
  select coalesce(array_agg(e ->> 'key'), '{}') into v_keys from jsonb_array_elements(p_perms) e;
  delete from public.role_permissions rp where rp.role_id = v_id and rp.permission_key <> all (v_keys);
  insert into public.role_permissions (role_id, permission_key, scope, conditions, field_mask)
  select v_id, e ->> 'key', e ->> 'scope', coalesce(e -> 'conditions', '{}'::jsonb),
         coalesce((select array_agg(m) from jsonb_array_elements_text(coalesce(e -> 'field_mask', '[]'::jsonb)) m), '{}')
    from jsonb_array_elements(p_perms) e
  on conflict (role_id, permission_key) do update
    set scope = excluded.scope, conditions = excluded.conditions, field_mask = excluded.field_mask;
  get diagnostics v_cnt = row_count;
  select r.updated_at into v_upd from public.roles r where r.id = v_id;
  return jsonb_build_object('id', v_id, 'updated_at', v_upd, 'permissions', v_cnt);
end $$;
revoke all on function public.save_role(uuid, text, jsonb, timestamptz, uuid, public.app_role, text) from public, anon;
grant execute on function public.save_role(uuid, text, jsonb, timestamptz, uuid, public.app_role, text) to authenticated, service_role;

-- ---------- 9. T018 follow-ups ----------
-- 9.1 admin_workspace_stats gains region_label, created_at (workspace) and the tenant's primary owner display name
drop function if exists public.admin_workspace_stats();
create or replace function public.admin_workspace_stats()
returns table (tenant_id uuid, tenant_name text, tenant_status text, workspace_id uuid, workspace_name text,
               workspace_slug text, members int, leads_total int, leads_30d int, integrations_attention int,
               failed_syncs_24h int, last_activity_at timestamptz,
               region_label text, created_at timestamptz, primary_owner_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select t.id, t.name, t.status, w.id, w.name, w.slug,
         (select count(*)::int from public.memberships m where m.workspace_id = w.id and m.is_active),
         (select count(*)::int from public.leads l where l.workspace_id = w.id and l.deleted_at is null),
         (select count(*)::int from public.leads l where l.workspace_id = w.id and l.deleted_at is null
            and l.created_at > now() - interval '30 days'),
         (select count(*)::int from public.integrations i where i.workspace_id = w.id
            and i.status in ('needs_attention','error')),
         (select count(*)::int from public.sync_runs r where r.workspace_id = w.id and r.status = 'failed'
            and r.started_at > now() - interval '24 hours'),
         greatest((select max(a.created_at) from public.activities a where a.workspace_id = w.id),
                  (select max(l.created_at) from public.leads l where l.workspace_id = w.id)),
         w.region_label, w.created_at,
         (select p.full_name from public.profiles p where p.id = t.primary_owner_id)
    from public.workspaces w join public.tenants t on t.id = w.tenant_id
   order by t.name, w.name;
end $$;
revoke all on function public.admin_workspace_stats() from public, anon;
grant execute on function public.admin_workspace_stats() to authenticated, service_role;

-- 9.2 admin_set_tenant_status takes an optional reason (audited through the tenants trigger)
drop function if exists public.admin_set_tenant_status(uuid, text);
create or replace function public.admin_set_tenant_status(p_tenant uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status not in ('active','suspended','archived') then raise exception 'invalid status' using errcode = '22023'; end if;
  if p_reason is not null and length(trim(p_reason)) > 0 and length(trim(p_reason)) < 8 then
    raise exception 'a reason of at least 8 characters is required' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', coalesce(trim(p_reason), ''), true);
  perform set_config('app.actor_label', 'platform_admin', true);
  perform set_config('app.audit_summary', 'tenant status set to ' || p_status, true);
  update public.tenants set status = p_status where id = p_tenant;
end $$;
revoke all on function public.admin_set_tenant_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_tenant_status(uuid, text, text) to authenticated, service_role;

-- the tenants table must be audited for the status / branding RPCs to leave a trail
do $$
begin
  if not exists (select 1 from pg_trigger g join pg_proc p on p.oid = g.tgfoid
                  where g.tgrelid = 'public.tenants'::regclass and not g.tgisinternal and p.proname = 'audit_row_change') then
    create trigger trg_tenants_audit after insert or update or delete on public.tenants
      for each row execute function public.audit_row_change();
  end if;
end $$;

-- 9.3 connector availability and tenant branding writes with a reason (audited)
create or replace function public.admin_set_connector_availability(p_connector text, p_env text, p_mode text, p_gate text,
                                                                   p_note text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin()
     or not exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.is_active and pa.platform_role = 'super_admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 8 then raise exception 'a reason of at least 8 characters is required' using errcode = '22023'; end if;
  if p_env not in ('production', 'staging', 'demo') or p_mode not in ('disabled', 'sandbox', 'live')
     or p_gate not in ('needs_vendor_approval', 'needs_client_credentials', 'ready') then
    raise exception 'invalid environment, mode or gate' using errcode = '22023';
  end if;
  if not exists (select 1 from public.connector_catalog c where c.id = p_connector) then
    raise exception 'unknown connector' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', trim(p_reason), true);
  perform set_config('app.actor_label', 'platform_admin', true);
  perform set_config('app.audit_summary', format('connector %s %s: %s / %s', p_connector, p_env, p_mode, p_gate), true);
  insert into public.connector_availability as a (connector_id, env, mode, gate_status, note)
  values (p_connector, p_env, p_mode, p_gate, nullif(trim(p_note), ''))
  on conflict (connector_id, env) do update set mode = excluded.mode, gate_status = excluded.gate_status, note = excluded.note;
end $$;
revoke all on function public.admin_set_connector_availability(text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_set_connector_availability(text, text, text, text, text, text) to authenticated, service_role;

-- p_branding keys: brand_name, brand_logo_url, brand_logo_dark_url, brand_favicon_url, brand_primary, brand_accent,
-- email_sender_name, support_email. Only keys present are changed; unknown keys are refused. super_admin and support roles.
create or replace function public.admin_set_tenant_branding(p_tenant uuid, p_branding jsonb, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare b jsonb := coalesce(p_branding, '{}'); v_bad text;
begin
  if not public.is_platform_admin()
     or not exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid() and pa.is_active
                      and pa.platform_role in ('super_admin', 'support')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 8 then raise exception 'a reason of at least 8 characters is required' using errcode = '22023'; end if;
  if jsonb_typeof(b) <> 'object' then raise exception 'branding must be a JSON object' using errcode = '22023'; end if;
  select k into v_bad from jsonb_object_keys(b) k
   where k <> all (array['brand_name', 'brand_logo_url', 'brand_logo_dark_url', 'brand_favicon_url', 'brand_primary',
                         'brand_accent', 'email_sender_name', 'support_email']) limit 1;
  if v_bad is not null then raise exception 'unknown branding field %', v_bad using errcode = '22023'; end if;
  perform set_config('app.audit_reason', trim(p_reason), true);
  perform set_config('app.actor_label', 'platform_admin', true);
  perform set_config('app.audit_summary', 'tenant branding changed', true);
  update public.tenants t set
    brand_name          = case when b ? 'brand_name' then coalesce(nullif(trim(b ->> 'brand_name'), ''), t.brand_name) else t.brand_name end,
    brand_logo_url      = case when b ? 'brand_logo_url' then nullif(trim(b ->> 'brand_logo_url'), '') else t.brand_logo_url end,
    brand_logo_dark_url = case when b ? 'brand_logo_dark_url' then nullif(trim(b ->> 'brand_logo_dark_url'), '') else t.brand_logo_dark_url end,
    brand_favicon_url   = case when b ? 'brand_favicon_url' then nullif(trim(b ->> 'brand_favicon_url'), '') else t.brand_favicon_url end,
    brand_primary       = case when b ? 'brand_primary' then b ->> 'brand_primary' else t.brand_primary end,
    brand_accent        = case when b ? 'brand_accent' then b ->> 'brand_accent' else t.brand_accent end,
    email_sender_name   = case when b ? 'email_sender_name' then nullif(trim(b ->> 'email_sender_name'), '') else t.email_sender_name end,
    support_email       = case when b ? 'support_email' then nullif(trim(b ->> 'support_email'), '') else t.support_email end
   where t.id = p_tenant;
  if not found then raise exception 'unknown tenant' using errcode = '22023'; end if;
end $$;
revoke all on function public.admin_set_tenant_branding(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_set_tenant_branding(uuid, jsonb, text) to authenticated, service_role;

-- 9.4 start_support_session: tenant_id is NOT NULL since 0004 and the 0007 insert did not set it
create or replace function public.start_support_session(p_workspace_id uuid, p_reason text, p_mode text default 'read_only',
                                                        p_minutes int default 30)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_tenant uuid;
begin
  if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_minutes not in (15, 30, 60) then raise exception 'duration must be 15, 30 or 60 minutes' using errcode = '22023'; end if;
  if p_mode not in ('read_only', 'read_write') then raise exception 'invalid mode' using errcode = '22023'; end if;
  select w.tenant_id into v_tenant from public.workspaces w where w.id = p_workspace_id;
  if v_tenant is null then raise exception 'unknown workspace' using errcode = '22023'; end if;
  update public.support_sessions set ended_at = now()
   where admin_id = auth.uid() and ended_at is null;                   -- one open session per admin
  insert into public.support_sessions (admin_id, workspace_id, tenant_id, reason, mode, expires_at)
  values (auth.uid(), p_workspace_id, v_tenant, trim(p_reason), p_mode, now() + make_interval(mins => p_minutes))
  returning id into v_id;
  return v_id;
end $$;

-- 9.5 platform admins read every support session and their own platform_admins row (re-asserted; policies pre-date this file)
drop policy if exists platform_admins_select on public.platform_admins;
create policy platform_admins_select on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_platform_admin()));
drop policy if exists support_sessions_select on public.support_sessions;
create policy support_sessions_select on public.support_sessions for select to authenticated
  using (admin_id = (select auth.uid()) or (select public.is_platform_admin())
         or workspace_id in (select public.member_role_ws_ids('owner')));   -- owners see who accessed their workspace
grant select on public.platform_admins, public.support_sessions to authenticated;

-- ---------- 10. T015 / T014 atomic RPCs ----------
-- merge_accounts: moves contacts, leads, deals and activities of the source onto the target, then soft-deletes the source.
-- SECURITY DEFINER with its own gate (accounts.merge in the workspace, resolved by authz.check), because the rows moved belong
-- to tables whose write permissions the merger may not hold.
create or replace function public.merge_accounts(p_source uuid, p_target uuid, p_v_source int, p_v_target int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.accounts; t public.accounts; n_c int; n_l int; n_d int; n_a int;
begin
  if p_source = p_target then raise exception 'source and target are the same account' using errcode = '22023'; end if;
  select * into s from public.accounts a where a.id = p_source for update;
  select * into t from public.accounts a where a.id = p_target for update;
  if s.id is null or t.id is null or s.deleted_at is not null or t.deleted_at is not null then
    raise exception 'account not found' using errcode = 'P0002'; end if;
  if s.workspace_id <> t.workspace_id then raise exception 'accounts are in different workspaces' using errcode = '42501'; end if;
  if not authz.check(s.workspace_id, 'accounts.merge') then raise exception 'not allowed' using errcode = '42501'; end if;
  if s.version <> p_v_source or t.version <> p_v_target then
    raise exception 'conflict: an account changed since it was loaded' using errcode = '40001'; end if;
  perform set_config('app.audit_summary', 'account merge', true);
  update public.contacts   set account_id = p_target where account_id = p_source and deleted_at is null; get diagnostics n_c = row_count;
  update public.leads      set account_id = p_target where account_id = p_source and deleted_at is null; get diagnostics n_l = row_count;
  update public.deals      set account_id = p_target where account_id = p_source and deleted_at is null; get diagnostics n_d = row_count;
  update public.activities set account_id = p_target where account_id = p_source;                       get diagnostics n_a = row_count;
  update public.accounts   set deleted_at = now() where id = p_source;
  return jsonb_build_object('moved', n_c, 'contacts', n_c, 'leads', n_l, 'deals', n_d, 'activities', n_a);
end $$;
revoke all on function public.merge_accounts(uuid, uuid, int, int) from public, anon;
grant execute on function public.merge_accounts(uuid, uuid, int, int) to authenticated, service_role;

-- move_deal: stage change plus the Won / Lost columns in one statement. SECURITY INVOKER: the deals RLS policies and triggers
-- (won_at / lost_at / stage history / version bump) apply as for a direct update.
--   p_extra: won  -> value_inr, seats, plan, expected_close_on;  lost -> lost_reason (required), competitor
create or replace function public.move_deal(p_id uuid, p_stage uuid, p_expected_version int, p_extra jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare d public.deals; st public.pipeline_stages; x jsonb := coalesce(p_extra, '{}'); v_new public.deals;
begin
  select * into d from public.deals where id = p_id and deleted_at is null;
  if d.id is null then raise exception 'deal not found or not allowed' using errcode = '42501'; end if;
  select * into st from public.pipeline_stages s where s.id = p_stage and s.workspace_id = d.workspace_id;
  if st.id is null then raise exception 'stage not found in this workspace' using errcode = '22023'; end if;
  if st.is_lost and length(trim(coalesce(x ->> 'lost_reason', ''))) = 0 then
    raise exception 'a lost reason is required' using errcode = '22023'; end if;
  update public.deals set
    stage_id          = p_stage,
    value_inr         = case when st.is_won and x ? 'value_inr' then (x ->> 'value_inr')::numeric else value_inr end,
    seats             = case when st.is_won and x ? 'seats' then (x ->> 'seats')::int else seats end,
    plan              = case when st.is_won and x ? 'plan' then x ->> 'plan' else plan end,
    expected_close_on = case when st.is_won and x ? 'expected_close_on' then (x ->> 'expected_close_on')::date else expected_close_on end,
    lost_reason       = case when st.is_lost then trim(x ->> 'lost_reason') when st.is_won then null else lost_reason end,
    competitor        = case when st.is_lost and x ? 'competitor' then nullif(trim(x ->> 'competitor'), '') else competitor end
   where id = p_id and version = p_expected_version and deleted_at is null
  returning * into v_new;
  if v_new.id is null then
    if exists (select 1 from public.deals where id = p_id and deleted_at is null and version <> p_expected_version) then
      raise exception 'conflict: the deal changed since it was loaded' using errcode = '40001'; end if;
    raise exception 'deal not found or not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object('id', v_new.id, 'version', v_new.version, 'stage_id', v_new.stage_id,
                            'won_at', v_new.won_at, 'lost_at', v_new.lost_at);
end $$;
revoke all on function public.move_deal(uuid, uuid, int, jsonb) from public, anon;
grant execute on function public.move_deal(uuid, uuid, int, jsonb) to authenticated, service_role;

-- ---------- 10b. T020 follow-ups: audit_record(), platform read of audit_log, audit.export ----------
-- App-level audit entries (exports, impersonation, privacy actions) written by a signed-in user. The row is stamped here
-- (actor, tenant, support session, label); audit_log stays append-only (no update/delete is granted or added).
create or replace function public.audit_record(p_workspace uuid, p_action text, p_summary text, p_object_table text,
                                               p_object_id text, p_reason text, p_detail jsonb, p_source text,
                                               p_actor_kind text, p_request_id text, p_ip text, p_user_agent text,
                                               p_impersonation boolean) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_tenant uuid; v_ss uuid; v_label text; v_kind text; v_src text; v_ip inet; v_id bigint;
  v_changes jsonb;
begin
  if v_uid is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_workspace is null then
    if not public.is_platform_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  else
    if p_workspace not in (select public.member_ws_ids()) then raise exception 'not allowed' using errcode = '42501'; end if;
    select w.tenant_id into v_tenant from public.workspaces w where w.id = p_workspace;
    select s.id into v_ss from public.support_sessions s
     where s.admin_id = v_uid and s.workspace_id = p_workspace and s.ended_at is null and now() < s.expires_at
     order by s.started_at desc limit 1;
  end if;
  if p_action is null or p_action !~ '^[a-z][a-z0-9_.:-]{0,63}$' then
    raise exception 'invalid audit action' using errcode = '22023'; end if;
  v_label := case when v_ss is not null then 'support' when p_workspace is null then 'platform_admin' else 'user' end;
  v_kind := coalesce(nullif(p_actor_kind, ''), case when v_ss is not null then 'support' when p_workspace is null then 'platform_admin' else 'user' end);
  if v_kind not in ('user', 'api_key', 'system', 'connector', 'agent', 'support', 'platform_admin') then
    raise exception 'invalid actor kind' using errcode = '22023'; end if;
  v_src := coalesce(nullif(p_source, ''), case when v_ss is not null then 'support' else 'ui' end);
  if v_src not in ('ui', 'api', 'connector', 'job', 'agent', 'support') then
    raise exception 'invalid source' using errcode = '22023'; end if;
  begin v_ip := nullif(p_ip, '')::inet; exception when others then v_ip := null; end;
  v_changes := case when p_detail is null or jsonb_typeof(p_detail) <> 'object' then '{}'::jsonb else p_detail end;
  if coalesce(p_impersonation, false) then v_changes := v_changes || '{"impersonation": true}'::jsonb; end if;
  insert into public.audit_log (tenant_id, workspace_id, actor_id, actor_label, action, table_name, row_id, changes,
                                support_session_id, actor_kind, source, request_id, ip, user_agent, reason, summary)
  values (v_tenant, p_workspace, v_uid, v_label, p_action, coalesce(nullif(p_object_table, ''), 'app'), left(p_object_id, 200),
          nullif(v_changes, '{}'::jsonb), v_ss, v_kind, v_src, left(p_request_id, 200), v_ip, left(p_user_agent, 300),
          left(nullif(trim(p_reason), ''), 500), left(p_summary, 300))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.audit_record(uuid, text, text, text, text, text, jsonb, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.audit_record(uuid, text, text, text, text, text, jsonb, text, text, text, text, text, boolean) to authenticated;

-- Platform admins read audit_log across tenants (the policy from 0006 already says so; re-asserted with the grant).
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (workspace_id in (select public.member_role_ws_ids('owner', 'sales_manager'))
         or (select public.is_platform_admin()));
grant select on public.audit_log to authenticated;

-- audit.export: owner only, blocked in support sessions. SQL only (the TS catalogue and generator need a follow-up, see T021 report).
insert into public.permissions (key, resource, action, description, is_pii, platform_only, support_blocked) values
  ('audit.export', 'audit', 'export', 'Export the audit log', false, false, true)
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key, scope)
select r.id, 'audit.export', 'all' from public.roles r where r.tenant_id is null and r.is_system and r.key = 'owner'
on conflict (role_id, permission_key) do nothing;

-- ---------- 11. verify ----------
do $$
begin
  assert (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname in ('wa_numbers', 'payments', 'calendar_events', 'reviews', 'ad_accounts',
                                                        'import_jobs', 'email_identities') and c.relrowsecurity) = 7, '0019: RLS on all seven new tables';
  assert not has_table_privilege('anon', 'public.payments', 'select'), '0019: anon cannot read payments';
  assert exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'conv_channel' and e.enumlabel = 'gbp'), '0019: conv_channel gbp';
  assert not has_function_privilege('anon', 'public.save_role(uuid,text,jsonb,timestamptz,uuid,public.app_role,text)', 'execute'), '0019: save_role not for anon';
end $$;

commit;
