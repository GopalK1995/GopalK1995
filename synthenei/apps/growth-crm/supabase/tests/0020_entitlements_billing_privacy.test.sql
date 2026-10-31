-- pgTAP for 0020_entitlements_billing_privacy. Run on the Supabase branch DB: node scripts/run-pgtap.mjs supabase/tests/0020_entitlements_billing_privacy.test.sql
-- Everything happens inside one transaction and is rolled back. Real concurrency of usage_bump needs two sessions (see README).
begin;
select plan(49);

insert into public.tenants (id, slug, name, brand_name) values
  ('10000000-0000-4000-8000-0000000000e0', 'tap20-a', 'Tap20 A', 'Tap20 A'),
  ('10000000-0000-4000-8000-0000000000f0', 'tap20-b', 'Tap20 B', 'Tap20 B');
insert into public.workspaces (id, tenant_id, name, slug) values
  ('20000000-0000-4000-8000-0000000000e0', '10000000-0000-4000-8000-0000000000e0', 'Tap20 A ws', 'tap20-a-ws'),
  ('20000000-0000-4000-8000-0000000000f0', '10000000-0000-4000-8000-0000000000f0', 'Tap20 B ws', 'tap20-b-ws');
insert into auth.users (id, email, email_confirmed_at, aud, role)
select u, 'tap20-' || right(u::text, 2) || '@verify.example', now(), 'authenticated', 'authenticated'
  from unnest(array[
    'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
    'e0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000005']::uuid[]) u;
insert into public.profiles (id, full_name, email)
select id, 'Tap20 ' || right(id::text, 2), email from auth.users where email like 'tap20-%@verify.example' on conflict (id) do nothing;
-- 01 owner A, 02 rep A, 03 owner B, 04 platform super_admin, 05 platform billing
insert into public.memberships (user_id, workspace_id, role) values
  ('e0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000e0', 'owner'),
  ('e0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000e0', 'sales_rep'),
  ('e0000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-0000000000f0', 'owner');
insert into public.platform_admins (user_id, mfa_required, platform_role) values
  ('e0000000-0000-4000-8000-000000000004', false, 'super_admin'), ('e0000000-0000-4000-8000-000000000005', false, 'billing');
insert into public.leads (id, workspace_id, full_name) values ('40000000-0000-4000-8000-0000000000e0', '20000000-0000-4000-8000-0000000000e0', 'Lead E');

create function pg_temp.act(u uuid, a text default 'aal1') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', a)::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $f$;
create function pg_temp.clear() returns void language sql as $f$
  select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true), set_config('role', 'postgres', true) $f$;
create function pg_temp.cnt(q text) returns bigint language plpgsql as $f$
declare n bigint; begin execute q into n; return n; end $f$;

-- ---------- structure ----------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname in ('plans','tenant_subscriptions','invoice_series','invoices','usage_counters','privacy_requests','retention_policies') and c.relrowsecurity),
          7::bigint, 'RLS enabled on all seven new tables');
select ok(to_regclass('public.ai_policies') is null, 'ai_policies is left to 0021');
select ok((select count(*) from information_schema.columns where table_name = 'tenants' and column_name in ('trial_ends_at','data_region','dpo_contact','privacy_response_days')) = 4, 'tenants has the new columns');
select is((select data_region from public.tenants where id = '10000000-0000-4000-8000-0000000000e0'), 'ap-southeast-1', 'data_region defaults to ap-southeast-1');
select ok((select trial_ends_at from public.tenants where id = '10000000-0000-4000-8000-0000000000e0') > now() + interval '13 days', 'a new tenant gets a 14 day trial');
select is((select plan_id || '/' || status from public.tenant_subscriptions where tenant_id = '10000000-0000-4000-8000-0000000000e0'), 'trial/trial', 'a new tenant starts on the trial plan');
select ok(exists (select 1 from public.plans where id = 'manual') and exists (select 1 from public.plans where id = 'trial'), 'trial and manual plans are seeded');
select is((select count(*) from public.tenants t where not exists (select 1 from public.tenant_subscriptions s where s.tenant_id = t.id)), 0::bigint, 'every tenant has a subscription');
select ok(not has_table_privilege('authenticated', 'public.usage_counters', 'insert') and not has_table_privilege('authenticated', 'public.invoice_series', 'select'), 'usage and series are not client-writable');

-- ---------- usage ----------
select pg_temp.act('e0000000-0000-4000-8000-000000000001');
select is(public.usage_bump('ai_calls', 1), 1::bigint, 'first bump');
select is(public.usage_bump('ai_calls', 4), 5::bigint, 'bumps accumulate in one atomic upsert');
select is(public.usage_bump('ai_calls', 2, '10000000-0000-4000-8000-0000000000e0'), 7::bigint, 'explicit own tenant works');
select throws_ok($$select public.usage_bump('ai_calls', 1, '10000000-0000-4000-8000-0000000000f0')$$, '42501', null, 'bumping another tenant is refused');
select throws_ok($$select public.usage_bump('AI Calls', 1)$$, '22023', null, 'bad metric names are refused');
select throws_ok($$select public.usage_bump('ai_calls', 0)$$, '22023', null, 'non-positive increments are refused');
select throws_ok($$insert into public.usage_counters (tenant_id, metric, period, count) values ('10000000-0000-4000-8000-0000000000e0', 'x', current_date, 1)$$, '42501', null, 'direct inserts into usage_counters are refused');
select is(pg_temp.cnt($$select count from public.usage_counters where metric = 'ai_calls'$$), 7::bigint, 'the owner reads the meter');
select throws_ok($$select public.usage_set('10000000-0000-4000-8000-0000000000e0', 'storage_bytes', 10)$$, '42501', null, 'usage_set is service only');
select ok((public.tenant_entitlements('10000000-0000-4000-8000-0000000000e0') -> 'usage' ->> 'ai_calls')::int = 7, 'tenant_entitlements reports usage');
select throws_ok($$select public.tenant_entitlements('10000000-0000-4000-8000-0000000000f0')$$, '42501', null, 'entitlements of another tenant are refused');
reset role;
select pg_temp.act('e0000000-0000-4000-8000-000000000002');
select is(pg_temp.cnt($$select count(*) from public.usage_counters$$), 0::bigint, 'a sales rep (no billing.read) does not see usage');
select is(pg_temp.cnt($$select count(*) from public.tenant_subscriptions$$), 0::bigint, 'a sales rep does not see the subscription');
reset role;
select pg_temp.act('e0000000-0000-4000-8000-000000000003');
select is(pg_temp.cnt($$select count(*) from public.usage_counters where tenant_id = '10000000-0000-4000-8000-0000000000e0'$$), 0::bigint, 'owner B cannot see tenant A usage');
select is(pg_temp.cnt($$select count(*) from public.tenant_subscriptions where tenant_id = '10000000-0000-4000-8000-0000000000e0'$$), 0::bigint, 'owner B cannot see tenant A subscription');
select is(pg_temp.cnt($$select count(*) from public.plans$$) >= 2, true, 'plans are readable by signed-in users');
select is(pg_temp.cnt($$with u as (update public.tenant_subscriptions set plan_id = 'manual' where tenant_id = '10000000-0000-4000-8000-0000000000f0' returning 1) select count(*) from u$$), 0::bigint, 'a tenant owner cannot change their own plan');
reset role;

-- ---------- billing (platform roles) ----------
select pg_temp.act('e0000000-0000-4000-8000-000000000005');
select lives_ok($$update public.tenant_subscriptions set plan_id = 'manual', status = 'manual' where tenant_id = '10000000-0000-4000-8000-0000000000e0'$$, 'platform billing role changes a subscription');
select lives_ok($$insert into public.invoices (tenant_id, period_start, period_end, amount_paise, gst_paise, sac_code, status) values ('10000000-0000-4000-8000-0000000000e0', '2026-10-01', '2026-10-31', 100000, 18000, '998314', 'issued')$$, 'billing role issues an invoice');
select ok((select number from public.invoices where tenant_id = '10000000-0000-4000-8000-0000000000e0' limit 1) ~ '^INV/[0-9]{2}-[0-9]{2}/000001$', 'invoice number follows the GST series');
select ok((select number from public.invoices where tenant_id = '10000000-0000-4000-8000-0000000000e0' limit 1) like 'INV/__-__/%', 'invoice number carries the financial year');
select lives_ok($$insert into public.invoices (tenant_id, period_start, period_end, amount_paise, sac_code, status) values ('10000000-0000-4000-8000-0000000000e0', '2026-11-01', '2026-11-30', 1, '998314', 'draft')$$, 'second invoice');
select ok(exists (select 1 from public.invoices where number ~ '/000002$'), 'the series is sequential');
select throws_ok($$update public.invoices set amount_paise = 5 where number ~ '/000001$'$$, '23514', null, 'an issued invoice is immutable');
select throws_ok($$delete from public.invoices where number ~ '/000001$'$$, '23514', null, 'an issued invoice cannot be deleted');
reset role;
select pg_temp.act('e0000000-0000-4000-8000-000000000001');
select is(pg_temp.cnt($$select count(*) from public.invoices$$) >= 1, true, 'the owner (billing.read) sees their invoices');
select throws_ok($$insert into public.invoices (tenant_id, period_start, period_end, amount_paise, sac_code) values ('10000000-0000-4000-8000-0000000000e0', '2026-12-01', '2026-12-31', 1, '998314')$$, '42501', null, 'a tenant cannot write invoices');
reset role;
select pg_temp.act('e0000000-0000-4000-8000-000000000003');
select is(pg_temp.cnt($$select count(*) from public.invoices where tenant_id = '10000000-0000-4000-8000-0000000000e0'$$), 0::bigint, 'owner B cannot see tenant A invoices');
reset role;

-- ---------- privacy requests ----------
select pg_temp.clear();
select pg_temp.act('e0000000-0000-4000-8000-000000000001');
select lives_ok($$insert into public.privacy_requests (id, workspace_id, subject_ref, lead_id, kind) values
  ('d0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000e0', repeat('a', 64), '40000000-0000-4000-8000-0000000000e0', 'access')$$, 'owner logs a privacy request');
select is((select (due_at::date - received_at::date) from public.privacy_requests where id = 'd0000000-0000-4000-8000-000000000001'), 30, 'due date defaults to 30 days');
reset role;
update public.tenants set privacy_response_days = 15 where id = '10000000-0000-4000-8000-0000000000e0';
select pg_temp.act('e0000000-0000-4000-8000-000000000001');
select lives_ok($$insert into public.privacy_requests (id, workspace_id, subject_ref, kind) values
  ('d0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000e0', repeat('b', 64), 'erasure')$$, 'second request');
select is((select (due_at::date - received_at::date) from public.privacy_requests where id = 'd0000000-0000-4000-8000-000000000002'), 15, 'due date follows the tenant setting');
select throws_ok($$insert into public.privacy_requests (workspace_id, subject_ref, kind) values ('20000000-0000-4000-8000-0000000000e0', 'alice@example.com', 'access')$$, '23514', null, 'only a hash is accepted as subject_ref');
select lives_ok($$update public.privacy_requests set status = 'completed' where id = 'd0000000-0000-4000-8000-000000000001'$$, 'request completed');
select ok((select completed_at is not null and handled_by = 'e0000000-0000-4000-8000-000000000001' from public.privacy_requests where id = 'd0000000-0000-4000-8000-000000000001'), 'completion stamps completed_at and handler');
select throws_ok($$delete from public.privacy_requests where id = 'd0000000-0000-4000-8000-000000000002'$$, '42501', null, 'privacy requests cannot be deleted by clients');
reset role;
select pg_temp.act('e0000000-0000-4000-8000-000000000002');
select is(pg_temp.cnt($$select count(*) from public.privacy_requests$$), 0::bigint, 'a sales rep does not see privacy requests');
reset role;
select pg_temp.act('e0000000-0000-4000-8000-000000000003');
select is(pg_temp.cnt($$select count(*) from public.privacy_requests$$), 0::bigint, 'owner B does not see tenant A privacy requests');
select lives_ok($$insert into public.retention_policies (tenant_id, object_type, days, action) values ('10000000-0000-4000-8000-0000000000f0', 'lead', 730, 'anonymise')$$, 'owner sets a retention policy');
select throws_ok($$insert into public.retention_policies (tenant_id, object_type, days, action) values ('10000000-0000-4000-8000-0000000000e0', 'lead', 730, 'delete')$$, '42501', null, 'owner B cannot set tenant A retention');
reset role;

select * from finish();
rollback;
