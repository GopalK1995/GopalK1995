-- pgTAP for 0023_tenants_update_guard. Run on a Supabase branch DB only: node scripts/run-pgtap.mjs supabase/tests/0023_tenants_update_guard.test.sql
-- Everything happens inside one transaction and is rolled back.
begin;
select plan(11);

insert into public.tenants (id, slug, name, brand_name, plan, status) values
  ('10000000-0000-4000-8000-0000000023a1', 'tap23-a', 'Tap23 A', 'Tap23 A', 'starter', 'active');
insert into auth.users (id, email, email_confirmed_at, aud, role) values
  ('a2300000-0000-4000-8000-000000000001', 'tap23-owner@verify.example', now(), 'authenticated', 'authenticated');
update public.tenants set primary_owner_id = 'a2300000-0000-4000-8000-000000000001' where id = '10000000-0000-4000-8000-0000000023a1';

select ok(not has_column_privilege('authenticated', 'public.tenants', 'plan', 'UPDATE'), 'authenticated has no UPDATE on plan');
select ok(not has_column_privilege('authenticated', 'public.tenants', 'status', 'UPDATE'), 'authenticated has no UPDATE on status');
select ok(not has_column_privilege('authenticated', 'public.tenants', 'trial_ends_at', 'UPDATE'), 'authenticated has no UPDATE on trial_ends_at');
select ok(not has_column_privilege('authenticated', 'public.tenants', 'primary_owner_id', 'UPDATE'), 'authenticated has no UPDATE on primary_owner_id');
select ok(has_column_privilege('authenticated', 'public.tenants', 'brand_name', 'UPDATE'), 'authenticated keeps UPDATE on brand_name');

-- act as the primary owner
select set_config('request.jwt.claims', '{"sub":"a2300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;

select throws_ok($$update public.tenants set plan = 'enterprise' where id = '10000000-0000-4000-8000-0000000023a1'$$, '42501', null, 'owner cannot change plan');
select throws_ok($$update public.tenants set status = 'active', trial_ends_at = now() + interval '5 years' where id = '10000000-0000-4000-8000-0000000023a1'$$, '42501', null, 'owner cannot extend trial');
select throws_ok($$update public.tenants set primary_owner_id = null where id = '10000000-0000-4000-8000-0000000023a1'$$, '42501', null, 'owner cannot reassign ownership');
select lives_ok($$update public.tenants set brand_name = 'Tap23 Renamed', brand_primary = 'oklch(0.5 0.1 200)' where id = '10000000-0000-4000-8000-0000000023a1'$$, 'owner can still edit branding');

-- trigger guard alone (privilege layer bypassed): a direct update by role authenticated must still fail
reset role;
grant update (plan) on public.tenants to authenticated;   -- undone by the rollback below
select set_config('request.jwt.claims', '{"sub":"a2300000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$update public.tenants set plan = 'enterprise' where id = '10000000-0000-4000-8000-0000000023a1'$$, '42501', null, 'trigger blocks plan even if the column were re-granted');

reset role;
select is((select plan from public.tenants where id = '10000000-0000-4000-8000-0000000023a1'), 'starter', 'plan unchanged');

select * from finish();
rollback;
