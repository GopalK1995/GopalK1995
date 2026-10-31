-- 0020 entitlements, billing and privacy (BUILD-PLAN 2.8) + T018 usage meters + T012 privacy_requests.
--   plans (global), tenant_subscriptions, invoices (+ GST number series per financial year), usage_counters + usage_bump(),
--   privacy_requests (due date defaults to received_at + the tenant's response days, 30 unless configured), retention_policies,
--   tenants + trial_ends_at / data_region / dpo_contact / privacy_response_days.
-- ai_policies belongs to 0021 (T031) and is NOT created here.
-- Forward-only and idempotent. Requires 0019. RLS on every table.
begin;

-- ---------- 1. tenants ----------
alter table public.tenants
  add column if not exists trial_ends_at        timestamptz,
  add column if not exists data_region          text not null default 'ap-southeast-1',
  add column if not exists dpo_contact          jsonb,
  add column if not exists privacy_response_days int not null default 30;
alter table public.tenants drop constraint if exists tenants_privacy_response_days_check;
alter table public.tenants add constraint tenants_privacy_response_days_check check (privacy_response_days between 1 and 90);
alter table public.tenants drop constraint if exists tenants_dpo_contact_check;
alter table public.tenants add constraint tenants_dpo_contact_check check (dpo_contact is null or jsonb_typeof(dpo_contact) = 'object');
-- new tenants start a 14 day trial; existing tenants keep trial_ends_at null
alter table public.tenants alter column trial_ends_at set default now() + interval '14 days';

-- ---------- 2. helper: platform role check for RLS ----------
create or replace function authz.platform_role_in(variadic p_roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() and exists (select 1 from public.platform_admins pa
          where pa.user_id = auth.uid() and pa.is_active and pa.platform_role = any(p_roles))
$$;
revoke all on function authz.platform_role_in(text[]) from public, anon;
grant execute on function authz.platform_role_in(text[]) to authenticated, service_role;

-- ---------- 3. Tables ----------
create table if not exists public.plans (
  id                  text primary key check (id ~ '^[a-z][a-z0-9_-]{1,30}$'),
  name                text not null,
  price_paise_monthly bigint not null default 0 check (price_paise_monthly >= 0),
  price_paise_yearly  bigint not null default 0 check (price_paise_yearly >= 0),
  limits              jsonb not null default '{}' check (jsonb_typeof(limits) = 'object'),   -- seats, workspaces, ai_calls, api_rpm, webhooks, custom_objects; absent = unlimited
  modules             text[] not null default '{}',
  is_public           boolean not null default false,
  created_at          timestamptz not null default now()
);

create table if not exists public.tenant_subscriptions (
  tenant_id                uuid primary key references public.tenants(id) on delete cascade,
  plan_id                  text not null references public.plans(id),
  status                   text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'cancelled', 'manual')),
  seats                    int check (seats is null or seats >= 0),
  trial_ends_at            timestamptz,
  current_period_end       timestamptz,
  provider                 text,
  provider_subscription_id text,
  gstin                    text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  billing_address          jsonb check (billing_address is null or jsonb_typeof(billing_address) = 'object'),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists tenant_subscriptions_plan on public.tenant_subscriptions (plan_id);

-- GST invoice numbers: one gapless series per financial year (April to March, IST), issuer-wide
create table if not exists public.invoice_series (
  fy       text primary key check (fy ~ '^[0-9]{2}-[0-9]{2}$'),
  last_seq int not null default 0
);

create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  tenant_id     uuid not null references public.tenants(id) on delete restrict,   -- invoices outlive nothing: a tenant with invoices cannot be purged by accident
  period_start  date not null,
  period_end    date not null,
  amount_paise  bigint not null check (amount_paise >= 0),
  gst_paise     bigint not null default 0 check (gst_paise >= 0),
  sac_code      text not null check (sac_code ~ '^[0-9]{4,8}$'),
  status        text not null default 'draft' check (status in ('draft', 'issued', 'paid', 'void')),
  pdf_path      text,
  issued_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (period_end >= period_start)
);
create index if not exists invoices_tenant on public.invoices (tenant_id, period_start desc);

create table if not exists public.usage_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  metric    text not null check (metric ~ '^[a-z][a-z0-9_.]{1,40}$'),
  period    date not null,                        -- first day of the IST month
  count     bigint not null default 0 check (count >= 0),
  primary key (tenant_id, metric, period)
);

create table if not exists public.privacy_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  subject_ref   text not null check (subject_ref ~ '^[a-f0-9]{32,128}$'),    -- hash of the data principal's identifier, never the identifier
  lead_id       uuid references public.leads(id) on delete set null,
  kind          text not null check (kind in ('access', 'correction', 'erasure', 'withdrawal', 'grievance')),
  received_at   timestamptz not null default now(),
  due_at        timestamptz not null,
  status        text not null default 'received' check (status in ('received', 'in_progress', 'completed', 'rejected')),
  handled_by    uuid references public.profiles(id) on delete set null,
  export_path   text,
  notes         text check (notes is null or length(notes) <= 4000),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists privacy_requests_ws_status on public.privacy_requests (workspace_id, status, due_at);
create index if not exists privacy_requests_tenant on public.privacy_requests (tenant_id);
create index if not exists privacy_requests_lead on public.privacy_requests (lead_id) where lead_id is not null;
create index if not exists privacy_requests_handled_by on public.privacy_requests (handled_by) where handled_by is not null;

create table if not exists public.retention_policies (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  object_type text not null check (object_type ~ '^[a-z][a-z0-9_:]{1,50}$'),
  days        int not null check (days between 1 and 3650),
  action      text not null check (action in ('anonymise', 'delete')),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, object_type)
);

-- ---------- 4. Triggers ----------
-- due_at defaults to received_at + the tenant's response window (30 days unless the tenant configured another)
create or replace function private.privacy_request_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.received_at := coalesce(new.received_at, now());
    if new.due_at is null then
      new.due_at := new.received_at + make_interval(days => coalesce(
        (select t.privacy_response_days from public.tenants t where t.id = new.tenant_id), 30));
    end if;
  end if;
  if new.status in ('completed', 'rejected') and (tg_op = 'INSERT' or old.status not in ('completed', 'rejected')) then
    new.completed_at := coalesce(new.completed_at, now());
    if (select auth.uid()) is not null then new.handled_by := coalesce(new.handled_by, (select auth.uid())); end if;
  end if;
  return new;
end $$;
drop trigger if exists a50_privacy_request_defaults on public.privacy_requests;
create trigger a50_privacy_request_defaults before insert or update on public.privacy_requests
  for each row execute function private.privacy_request_defaults();

-- invoice numbers and immutability
create or replace function private.next_invoice_number(p_on date default (now() at time zone 'Asia/Kolkata')::date) returns text
language plpgsql security definer set search_path = '' as $$
declare v_y int := extract(year from p_on)::int - case when extract(month from p_on) < 4 then 1 else 0 end; v_fy text; v_n int;
begin
  v_fy := lpad((v_y % 100)::text, 2, '0') || '-' || lpad(((v_y + 1) % 100)::text, 2, '0');
  insert into public.invoice_series as s (fy, last_seq) values (v_fy, 1)
  on conflict (fy) do update set last_seq = s.last_seq + 1 returning s.last_seq into v_n;
  return 'INV/' || v_fy || '/' || lpad(v_n::text, 6, '0');
end $$;
revoke all on function private.next_invoice_number(date) from public, anon, authenticated;

create or replace function private.invoices_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.number := coalesce(new.number, private.next_invoice_number());
    if new.status <> 'draft' then new.issued_at := coalesce(new.issued_at, now()); end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'issued invoices cannot be deleted; void them' using errcode = '23514'; end if;
    return old;
  end if;
  if old.status <> 'draft' and (new.number is distinct from old.number or new.tenant_id is distinct from old.tenant_id
       or new.amount_paise is distinct from old.amount_paise or new.gst_paise is distinct from old.gst_paise
       or new.sac_code is distinct from old.sac_code or new.period_start is distinct from old.period_start
       or new.period_end is distinct from old.period_end) then
    raise exception 'an issued invoice is immutable; void it and issue a new one' using errcode = '23514';
  end if;
  if old.status = 'void' and new.status <> 'void' then raise exception 'a void invoice stays void' using errcode = '23514'; end if;
  if old.status = 'draft' and new.status <> 'draft' then new.issued_at := coalesce(new.issued_at, now()); end if;
  return new;
end $$;
drop trigger if exists a50_invoices_guard on public.invoices;
create trigger a50_invoices_guard before insert or update or delete on public.invoices
  for each row execute function private.invoices_guard();

-- every new tenant starts on the trial plan
create or replace function private.tenant_subscription_default() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.tenant_subscriptions (tenant_id, plan_id, status, trial_ends_at)
  values (new.id, 'trial', 'trial', new.trial_ends_at) on conflict (tenant_id) do nothing;
  return null;
end $$;
drop trigger if exists trg_tenants_subscription on public.tenants;
create trigger trg_tenants_subscription after insert on public.tenants
  for each row execute function private.tenant_subscription_default();

do $$
declare t text;
begin
  foreach t in array array['tenant_subscriptions', 'invoices', 'privacy_requests', 'retention_policies'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at()', t);
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I
                    for each row execute function public.audit_row_change()', t);
  end loop;
  drop trigger if exists a00_privacy_requests_tenant on public.privacy_requests;
  create trigger a00_privacy_requests_tenant before insert or update of workspace_id, tenant_id on public.privacy_requests
    for each row execute function public.set_tenant_from_workspace();
end $$;

-- ---------- 5. Seeds ----------
-- Placeholder plans: prices are the owner's decision (BUILD-PLAN 7.1) and stay 0 until set. 'manual' = invoiced outside the product.
insert into public.plans (id, name, price_paise_monthly, price_paise_yearly, limits, modules, is_public) values
  ('trial',  'Trial',  0, 0, '{"seats":5,"workspaces":1,"ai_calls":200,"api_rpm":60,"webhooks":3,"custom_objects":3}', '{}', false),
  ('manual', 'Manual (invoiced)', 0, 0, '{}', '{}', false)
on conflict (id) do nothing;
-- tenants that exist today are managed manually
insert into public.tenant_subscriptions (tenant_id, plan_id, status)
select t.id, 'manual', 'manual' from public.tenants t on conflict (tenant_id) do nothing;

-- ---------- 6. RPCs ----------
create or replace function public.usage_bump(p_metric text, p_n bigint default 1, p_tenant uuid default null) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare v_tenant uuid := p_tenant; v_n bigint; v_period date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
begin
  if p_metric is null or p_metric !~ '^[a-z][a-z0-9_.]{1,40}$' then raise exception 'invalid metric' using errcode = '22023'; end if;
  if p_n is null or p_n < 1 or p_n > 1000000000 then raise exception 'invalid increment' using errcode = '22023'; end if;
  if (select auth.uid()) is not null then
    if v_tenant is null then
      select distinct x into v_tenant from public.member_tenant_ids() x;     -- exactly one tenant, else the caller must say which
      if (select count(distinct x) from public.member_tenant_ids() x) <> 1 then
        raise exception 'tenant is required' using errcode = '22023'; end if;
    elsif v_tenant not in (select public.member_tenant_ids()) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  elsif v_tenant is null then
    raise exception 'tenant is required' using errcode = '22023';
  end if;
  -- one atomic upsert: concurrent bumps add up, none is lost
  insert into public.usage_counters as u (tenant_id, metric, period, count) values (v_tenant, p_metric, v_period, p_n)
  on conflict (tenant_id, metric, period) do update set count = u.count + excluded.count
  returning u.count into v_n;
  return v_n;
end $$;
revoke all on function public.usage_bump(text, bigint, uuid) from public, anon;
grant execute on function public.usage_bump(text, bigint, uuid) to authenticated, service_role;

-- gauges such as storage bytes: set, not add (service role only)
create or replace function public.usage_set(p_tenant uuid, p_metric text, p_value bigint) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_metric is null or p_metric !~ '^[a-z][a-z0-9_.]{1,40}$' or p_value is null or p_value < 0 then
    raise exception 'invalid usage value' using errcode = '22023'; end if;
  insert into public.usage_counters as u (tenant_id, metric, period, count)
  values (p_tenant, p_metric, date_trunc('month', now() at time zone 'Asia/Kolkata')::date, p_value)
  on conflict (tenant_id, metric, period) do update set count = excluded.count;
end $$;
revoke all on function public.usage_set(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.usage_set(uuid, text, bigint) to service_role;

-- plan limits overlaid with the org admin policy, plus this month's usage
create or replace function public.tenant_entitlements(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.tenant_subscriptions; p public.plans; o public.org_admin_policies; v_limits jsonb;
begin
  if (select auth.uid()) is not null and not (p_tenant in (select public.member_tenant_ids()) or public.is_platform_admin()) then
    raise exception 'not allowed' using errcode = '42501'; end if;
  select * into s from public.tenant_subscriptions x where x.tenant_id = p_tenant;
  if s.tenant_id is null then return null; end if;
  select * into p from public.plans x where x.id = s.plan_id;
  select * into o from public.org_admin_policies x where x.tenant_id = p_tenant;
  v_limits := p.limits;
  if o.max_seats is not null then v_limits := v_limits || jsonb_build_object('seats', o.max_seats); end if;
  if o.max_workspaces is not null then v_limits := v_limits || jsonb_build_object('workspaces', o.max_workspaces); end if;
  return jsonb_build_object(
    'plan', p.id, 'status', s.status, 'trial_ends_at', s.trial_ends_at, 'seats', s.seats, 'limits', v_limits,
    'modules', to_jsonb(coalesce(o.allowed_modules, p.modules)),
    'usage', coalesce((select jsonb_object_agg(u.metric, u.count) from public.usage_counters u
                        where u.tenant_id = p_tenant and u.period = date_trunc('month', now() at time zone 'Asia/Kolkata')::date), '{}'::jsonb));
end $$;
revoke all on function public.tenant_entitlements(uuid) from public, anon;
grant execute on function public.tenant_entitlements(uuid) to authenticated, service_role;

-- ---------- 7. RLS ----------
alter table public.plans                enable row level security;
alter table public.tenant_subscriptions enable row level security;
alter table public.invoice_series       enable row level security;   -- service only: no policy, no grant
alter table public.invoices             enable row level security;
alter table public.usage_counters       enable row level security;
alter table public.privacy_requests     enable row level security;
alter table public.retention_policies   enable row level security;

drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans for select to authenticated using (true);
drop policy if exists plans_write on public.plans;
create policy plans_write on public.plans for all to authenticated
  using ((select authz.platform_role_in('super_admin', 'billing'))) with check ((select authz.platform_role_in('super_admin', 'billing')));

drop policy if exists tenant_subscriptions_select on public.tenant_subscriptions;
create policy tenant_subscriptions_select on public.tenant_subscriptions for select to authenticated
  using (tenant_id in (select authz.tenant_ids_with('billing.read', 'own')) or (select public.is_platform_admin()));
drop policy if exists tenant_subscriptions_write on public.tenant_subscriptions;
create policy tenant_subscriptions_write on public.tenant_subscriptions for all to authenticated
  using ((select authz.platform_role_in('super_admin', 'billing'))) with check ((select authz.platform_role_in('super_admin', 'billing')));

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select to authenticated
  using (tenant_id in (select authz.tenant_ids_with('billing.read', 'own')) or (select public.is_platform_admin()));
drop policy if exists invoices_write on public.invoices;
create policy invoices_write on public.invoices for all to authenticated
  using ((select authz.platform_role_in('super_admin', 'billing'))) with check ((select authz.platform_role_in('super_admin', 'billing')));

drop policy if exists usage_counters_select on public.usage_counters;
create policy usage_counters_select on public.usage_counters for select to authenticated
  using (tenant_id in (select authz.tenant_ids_with('billing.read', 'own')) or (select public.is_platform_admin()));
-- usage is written only by usage_bump() / usage_set()

-- privacy requests: privacy.fulfil in the workspace, real members only; no delete (the register is kept)
select private.rls_table('privacy_requests', null, array['privacy.fulfil'], null, null, null,
                         array['privacy.fulfil'], null, null, null, null, true, false);
-- retention policy: tenants where the caller holds privacy.fulfil
drop policy if exists retention_policies_select on public.retention_policies;
create policy retention_policies_select on public.retention_policies for select to authenticated
  using (tenant_id in (select authz.tenant_ids_with('privacy.fulfil', 'own')) or (select public.is_platform_admin()));
drop policy if exists retention_policies_write on public.retention_policies;
create policy retention_policies_write on public.retention_policies for all to authenticated
  using (tenant_id in (select authz.tenant_ids_with('privacy.fulfil', 'all')))
  with check (tenant_id in (select authz.tenant_ids_with('privacy.fulfil', 'all')));

-- ---------- 8. Grants ----------
revoke all on public.plans, public.tenant_subscriptions, public.invoice_series, public.invoices, public.usage_counters,
  public.privacy_requests, public.retention_policies from anon, authenticated;
grant select, insert, update, delete on public.plans, public.tenant_subscriptions, public.invoices to authenticated;
grant select on public.usage_counters to authenticated;
grant select, insert, update on public.privacy_requests to authenticated;
grant select, insert, update, delete on public.retention_policies to authenticated;
grant select, insert, update, delete on public.plans, public.tenant_subscriptions, public.invoice_series, public.invoices,
  public.usage_counters, public.privacy_requests, public.retention_policies to service_role;

-- ---------- 9. verify ----------
do $$
begin
  assert (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname in ('plans', 'tenant_subscriptions', 'invoice_series', 'invoices', 'usage_counters',
                                                        'privacy_requests', 'retention_policies') and c.relrowsecurity) = 7, '0020: RLS on all seven new tables';
  assert not exists (select 1 from public.tenants t where not exists (select 1 from public.tenant_subscriptions s where s.tenant_id = t.id)),
    '0020: every tenant has a subscription row';
  assert not has_table_privilege('authenticated', 'public.usage_counters', 'insert'), '0020: usage is written by usage_bump only';
  assert not has_function_privilege('authenticated', 'public.usage_set(uuid,text,bigint)', 'execute'), '0020: usage_set is service only';
end $$;

commit;
