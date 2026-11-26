-- pgTAP for 0026_events_audit_privacy (AUD-032). Run on a Supabase branch DB only: node scripts/run-pgtap.mjs supabase/tests/0026_events_audit_privacy.test.sql
-- Everything happens inside one transaction and is rolled back.
begin;
select plan(19);

insert into public.tenants (id, slug, name, brand_name) values ('10000000-0000-4000-8000-000000002601', 'tap26-a', 'Tap26 A', 'Tap26 A');
insert into public.workspaces (id, tenant_id, name, slug) values ('20000000-0000-4000-8000-000000002601', '10000000-0000-4000-8000-000000002601', 'Tap26 ws', 'tap26-ws');
select public.seed_workspace_defaults('20000000-0000-4000-8000-000000002601') where not exists
  (select 1 from public.pipeline_stages where workspace_id = '20000000-0000-4000-8000-000000002601');
insert into auth.users (id, email, email_confirmed_at, aud, role) values
  ('26000000-0000-4000-8000-000000000001', 'tap26-owner@verify.example', now(), 'authenticated', 'authenticated');
insert into public.profiles (id, full_name, email) select id, 'Tap26 Owner', email from auth.users where email = 'tap26-owner@verify.example' on conflict (id) do nothing;
insert into public.memberships (user_id, workspace_id, role) values ('26000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000002601', 'owner');

-- ---------- event payload allowlist ----------
insert into public.leads (id, workspace_id, full_name, email, phone, city, firm_name) values
  ('40000000-0000-4000-8000-000000002601', '20000000-0000-4000-8000-000000002601', 'Zed Probe', 'zed@example.test', '+910000000001', 'Probeville', 'Probe LLP');
insert into public.tasks (id, workspace_id, lead_id, title) values
  ('50000000-0000-4000-8000-000000002601', '20000000-0000-4000-8000-000000002601', '40000000-0000-4000-8000-000000002601', 'First response: Zed Probe');
select ok(not exists (select 1 from public.events where object_id = '50000000-0000-4000-8000-000000002601' and data::text ilike '%Zed%'), 'task events never carry the title (lead name)');
select ok((select (data -> 'after') ? 'status' from public.events where object_id = '50000000-0000-4000-8000-000000002601' and type = 'task.created'), 'task events still carry status');
select ok(not exists (select 1 from public.events where object_id = '40000000-0000-4000-8000-000000002601' and (data::text ilike '%Probeville%' or data::text ilike '%Probe LLP%' or data::text ilike '%example.test%')), 'lead events carry no name, e-mail, city or firm');
select ok(not exists (select 1 from public.events where object_id = '40000000-0000-4000-8000-000000002601' and (data -> 'after') ?| array['custom', 'city', 'score_factors', 'phone']), 'lead events carry no custom, city, score_factors or phone');
update public.leads set city = 'Elsewhere', score = 7, email = 'zed2@example.test' where id = '40000000-0000-4000-8000-000000002601';
select ok(exists (select 1 from public.events where object_id = '40000000-0000-4000-8000-000000002601' and type = 'lead.updated' and (data -> 'changed_fields') ? 'city' and not ((data -> 'after') ? 'city')), 'an update names the changed field but not its value');
select is((select data -> 'after' ->> 'score' from public.events where object_id = '40000000-0000-4000-8000-000000002601' and type = 'lead.updated' order by id desc limit 1), '7', 'structural values (score) still travel');

-- ---------- audit_log scrub ----------
select ok(not exists (select 1 from public.audit_log where table_name = 'leads' and row_id = '40000000-0000-4000-8000-000000002601' and (changes::text ilike '%Probeville%' or changes::text ilike '%Elsewhere%' or changes::text ilike '%example.test%' or changes::text ilike '%Probe LLP%')), 'audit rows hold no personal values');
select is((select changes -> 'city' ->> 'new' from public.audit_log where table_name = 'leads' and row_id = '40000000-0000-4000-8000-000000002601' and action = 'update' order by id desc limit 1), '[redacted]', 'the field name is kept, the value is redacted');
select is((select changes -> 'score' ->> 'new' from public.audit_log where table_name = 'leads' and row_id = '40000000-0000-4000-8000-000000002601' and action = 'update' order by id desc limit 1), '7', 'structural values stay in the audit row');
select is(private.audit_scrub_value('note', '"hello"'::jsonb), '"[redacted]"'::jsonb, 'free text is redacted');
select is(private.audit_scrub_value('owner_id', '"25000000-0000-4000-8000-000000000001"'::jsonb), '"25000000-0000-4000-8000-000000000001"'::jsonb, 'uuid references are kept');

-- ---------- consent_log append-only ----------
insert into public.consent_log (id, workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via)
  values (990026, '20000000-0000-4000-8000-000000002601', '40000000-0000-4000-8000-000000002601', repeat('ab', 32), 'demo_followup', 'granted', 'v1', 'manual');
select ok(not has_table_privilege('service_role', 'public.consent_log', 'update') and not has_table_privilege('service_role', 'public.consent_log', 'delete') and not has_table_privilege('service_role', 'public.consent_log', 'truncate'), 'service_role has no UPDATE, DELETE or TRUNCATE on consent_log');
select throws_ok($$update public.consent_log set note = 'tamper' where id = 990026$$, '42501', null, 'even the table owner cannot update a consent row (trigger)');
select throws_ok($$delete from public.consent_log where id = 990026$$, '42501', null, 'even the table owner cannot delete a consent row (trigger)');
select throws_ok($$truncate public.consent_log$$, '42501', null, 'even the table owner cannot truncate consent_log (trigger)');

-- ---------- salted subject_ref (the Vault secret exists only inside this transaction) ----------
select vault.create_secret('tap26-test-salt', 'consent_subject_salt');
insert into public.consent_log (id, workspace_id, subject_ref, purpose, action, notice_version, captured_via)
  values (990027, '20000000-0000-4000-8000-000000002601', repeat('cd', 32), 'demo_followup', 'granted', 'v1', 'manual');
select like((select subject_ref from public.consent_log where id = 990027), 'h1:%', 'a new plain sha256 subject_ref is stored salted (h1:)');
select is((select count(*) from public.consent_log where id = 990027 and subject_ref = repeat('cd', 32)), 0::bigint, 'the unsalted value is not stored');
select set_config('request.jwt.claims', '{"sub":"26000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*) from public.consent_log_for_subject('20000000-0000-4000-8000-000000002601', repeat('cd', 32))), 1::bigint, 'consent_log_for_subject finds the salted row by the plain hash');
reset role;
select lives_ok($$delete from public.leads where id = '40000000-0000-4000-8000-000000002601'$$, 'deleting a lead still works: the ON DELETE SET NULL cascade is allowed through');

select * from finish();
rollback;
