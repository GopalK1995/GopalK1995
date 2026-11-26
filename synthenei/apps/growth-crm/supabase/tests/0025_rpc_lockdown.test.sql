-- pgTAP for 0025_rpc_lockdown (AUD-056). Run on a Supabase branch DB only: node scripts/run-pgtap.mjs supabase/tests/0025_rpc_lockdown.test.sql
-- Everything happens inside one transaction and is rolled back.
begin;
select plan(28);

insert into public.tenants (id, slug, name, brand_name) values ('10000000-0000-4000-8000-000000002501', 'tap25-a', 'Tap25 A', 'Tap25 A');
insert into public.workspaces (id, tenant_id, name, slug) values ('20000000-0000-4000-8000-000000002501', '10000000-0000-4000-8000-000000002501', 'Tap25 ws', 'tap25-ws');
insert into auth.users (id, email, email_confirmed_at, aud, role) values
  ('25000000-0000-4000-8000-000000000001', 'tap25-owner@verify.example', now(), 'authenticated', 'authenticated'),
  ('25000000-0000-4000-8000-000000000002', 'tap25-viewer@verify.example', now(), 'authenticated', 'authenticated');
insert into public.profiles (id, full_name, email) select id, 'Tap25 ' || right(id::text, 2), email from auth.users where email like 'tap25-%@verify.example' on conflict (id) do nothing;
insert into public.memberships (user_id, workspace_id, role) values
  ('25000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000002501', 'owner'),
  ('25000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000002501', 'viewer');

create function pg_temp.act(u uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
end $f$;

-- ---------- privileges ----------
select ok(not has_function_privilege('anon', 'public.rate_limit_hit(text,integer,integer)', 'execute'), 'anon cannot execute rate_limit_hit');
select ok(not has_function_privilege('authenticated', 'public.rate_limit_hit(text,integer,integer)', 'execute'), 'authenticated cannot execute rate_limit_hit');
select ok(has_function_privilege('service_role', 'public.rate_limit_hit(text,integer,integer)', 'execute'), 'service_role keeps rate_limit_hit (API-key limiter)');
select ok(not has_function_privilege('anon', 'public.auth_throttle_hit(text,text,text,integer,integer)', 'execute')
      and not has_function_privilege('authenticated', 'public.auth_throttle_hit(text,text,text,integer,integer)', 'execute')
      and has_function_privilege('service_role', 'public.auth_throttle_hit(text,text,text,integer,integer)', 'execute'), 'auth_throttle_hit is service only');
select ok(not has_function_privilege('authenticated', 'public.usage_bump(text,bigint,uuid)', 'execute') and has_function_privilege('service_role', 'public.usage_bump(text,bigint,uuid)', 'execute'), 'usage_bump is service only');
select ok(not has_function_privilege('anon', 'public.audit_record(uuid,text,text,text,text,text,jsonb,text,text,text,text,text,boolean)', 'execute'), 'anon cannot execute audit_record');
select ok(not has_function_privilege('authenticated', 'public.audit_record_server(uuid,uuid,text,text,text,text,jsonb,text,text,text,text,text)', 'execute')
      and has_function_privilege('service_role', 'public.audit_record_server(uuid,uuid,text,text,text,text,jsonb,text,text,text,text,text)', 'execute'), 'audit_record_server is service only');
select ok(not has_function_privilege('anon', 'public.emit_event(text,text,uuid,jsonb)', 'execute'), 'anon cannot execute emit_event');

-- ---------- throttle works for the server, with fixed buckets ----------
set local role service_role;
select is(public.auth_throttle_hit('login', 'email', 'Victim@Example.test', 2, 900), true, 'first hit allowed');
select is(public.auth_throttle_hit('login', 'email', '  victim@example.test ', 2, 900), true, 'e-mail is normalised: same bucket, second hit allowed');
select is(public.auth_throttle_hit('login', 'email', 'victim@example.test', 2, 900), false, 'third hit refused');
select throws_ok($$select public.auth_throttle_hit('apikey', 'email', 'x', 2, 900)$$, '22023', null, 'only login and reset kinds exist');
select throws_ok($$select public.auth_throttle_hit('login', 'email', 'x', 100000, 900)$$, '22023', null, 'limit is bounded');
reset role;
select ok(not exists (select 1 from public.rate_limits where bucket like '%victim%'), 'no address is stored in clear in rate_limits');
select ok(exists (select 1 from public.rate_limits where bucket like 'auth:login:email:%'), 'buckets live in the fixed auth: namespace');
set local role anon;
select throws_ok($$select public.rate_limit_hit('login:email:victim@example.test', 1, 900)$$, '42501', null, 'anon cannot poison a bucket');
reset role;

-- ---------- audit_record ----------
select pg_temp.act('25000000-0000-4000-8000-000000000002');
select throws_ok($$select public.audit_record('20000000-0000-4000-8000-000000002501', 'billing.plan_saved', 'viewer', 'billing', null, null, null, 'ui', 'user', null, null, null, false)$$, '42501', null, 'a viewer cannot write a billing audit row');
select throws_ok($$select public.audit_record('20000000-0000-4000-8000-000000002501', 'auth.login.success', 's', 'app', null, null, null, 'ui', 'user', null, null, null, false)$$, '42501', null, 'the auth family is server only');
select throws_ok($$select public.audit_record('20000000-0000-4000-8000-000000002501', 'support.started', 's', 'app', null, null, null, 'ui', 'user', null, null, null, false)$$, '42501', null, 'support.* needs an open support session');
select lives_ok($$select public.audit_record('20000000-0000-4000-8000-000000002501', 'leads.exported', 'forged probe', 'leads', null, null, null, 'support', 'platform_admin', null, '6.6.6.6', 'ua', true)$$, 'a viewer may record a read-type action');
reset role;
select is((select actor_kind || '/' || source from public.audit_log where summary = 'forged probe'), 'user/ui', 'a claimed platform_admin / support kind and source are clamped to user / ui');
select pg_temp.act('25000000-0000-4000-8000-000000000001');
select lives_ok($$select public.audit_record('20000000-0000-4000-8000-000000002501', 'export.csv', 'owner export', 'leads', null, null, '{"rows":3}', 'ui', 'user', 'r1', '10.0.0.1', 'ua', false)$$, 'an owner can still record an export');
reset role;
set local role service_role;
select ok(public.audit_record_server('25000000-0000-4000-8000-000000000001', null, 'auth.login.success', 'Sign-in succeeded', 'auth', null, '{"via":"password"}', 'ui', 'user', 'r2', '10.0.0.2', 'ua') > 0, 'the server path records a login');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'auth.login.success' and actor_label = 'server'), 'the login row is in audit_log');

-- ---------- usage and events ----------
select pg_temp.act('25000000-0000-4000-8000-000000000002');
select throws_ok($$select public.usage_bump('seats_used', 1000000000, '10000000-0000-4000-8000-000000002501')$$, '42501', null, 'a viewer cannot inflate usage');
select throws_ok($$select public.emit_event('payment.captured', null, null, '{"workspace_id":"20000000-0000-4000-8000-000000002501"}')$$, '42501', null, 'a viewer cannot forge a payment event');
select throws_ok($$select public.emit_event('lead.created', null, null, '{"workspace_id":"20000000-0000-4000-8000-000000002501"}')$$, '42501', null, 'a member cannot forge a row event');
reset role;
select pg_temp.act('25000000-0000-4000-8000-000000000001');
select lives_ok($$select public.emit_event('metadata.changed', null, null, '{"workspace_id":"20000000-0000-4000-8000-000000002501","object":"lead"}')$$, 'a client-originated type is still accepted');
reset role;

select * from finish();
rollback;
