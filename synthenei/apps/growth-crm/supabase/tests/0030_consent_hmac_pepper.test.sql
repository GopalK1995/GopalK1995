-- pgTAP for 0030_consent_hmac_pepper + 0031_consent_hmac_backfill (AUD-034). Branch DB only: node scripts/run-pgtap.mjs supabase/tests/0030_consent_hmac_pepper.test.sql
-- One transaction, rolled back. Vault secrets created here vanish with the rollback. Peppers are never selected, only compared by effect.
begin;
select plan(21);

insert into public.tenants (id, slug, name, brand_name) values
  ('10000000-0000-4000-8000-000000003001', 'tap30-a', 'Tap30 A', 'Tap30 A'),
  ('10000000-0000-4000-8000-000000003002', 'tap30-b', 'Tap30 B', 'Tap30 B');
insert into public.workspaces (id, tenant_id, name, slug) values
  ('20000000-0000-4000-8000-000000003001', '10000000-0000-4000-8000-000000003001', 'Tap30 ws a', 'tap30-ws-a'),
  ('20000000-0000-4000-8000-000000003002', '10000000-0000-4000-8000-000000003002', 'Tap30 ws b', 'tap30-ws-b');

-- ---------- pepper: lazy, per tenant, stable, locked down ----------
select is((select count(*) from vault.secrets where name like 'consent_pepper_10000000-0000-4000-8000-00000000300%'), 0::bigint, 'no pepper exists before first use');
select ok(private.subject_hmac('10000000-0000-4000-8000-000000003001', 'a@x.test') like 'h2:%', 'hash carries the h2: marker');
select is(length(private.subject_hmac('10000000-0000-4000-8000-000000003001', 'a@x.test')), 67, 'h2: + 64 hex');
select is(private.subject_hmac('10000000-0000-4000-8000-000000003001', 'a@x.test'), private.subject_hmac('10000000-0000-4000-8000-000000003001', 'a@x.test'), 'same tenant and value give the same hash');
select isnt(private.subject_hmac('10000000-0000-4000-8000-000000003001', 'a@x.test'), private.subject_hmac('10000000-0000-4000-8000-000000003002', 'a@x.test'), 'another tenant gets a different hash for the same value');
select is((select count(*) from vault.secrets where name like 'consent_pepper_10000000-0000-4000-8000-00000000300%'), 2::bigint, 'exactly one pepper per tenant was created');
select ok(private.subject_hmac('10000000-0000-4000-8000-000000003001', 'a@x.test') <> 'h2:' || encode(extensions.digest('a@x.test', 'sha256'), 'hex'), 'the hash is not a plain sha256');
select ok(not has_function_privilege('anon', 'private.tenant_pepper(uuid)', 'execute') and not has_function_privilege('authenticated', 'private.tenant_pepper(uuid)', 'execute') and not has_function_privilege('service_role', 'private.tenant_pepper(uuid)', 'execute'), 'nobody but the definer can execute tenant_pepper');
select ok(not has_function_privilege('authenticated', 'public.suppression_check(uuid, text)', 'execute') and not has_function_privilege('anon', 'public.suppression_add(uuid, text, text, text, uuid)', 'execute') and has_function_privilege('service_role', 'public.suppression_add(uuid, text, text, text, uuid)', 'execute'), 'suppression RPCs are service_role only');

-- ---------- suppressions store only the hash ----------
select is(public.suppression_add('20000000-0000-4000-8000-000000003001', ' Bob@X.test ', 'unsubscribe', 'tap', null), true, 'first add inserts');
select is(public.suppression_add('20000000-0000-4000-8000-000000003001', 'bob@x.test', 'complaint', 'tap', null), false, 'second add (any case) is a no-op');
select is((select count(*) from public.email_suppressions where workspace_id = '20000000-0000-4000-8000-000000003001' and email is null and email_hash like 'h2:%'), 1::bigint, 'the row has a hash and no clear-text address');
select is(public.suppression_check('20000000-0000-4000-8000-000000003001', 'BOB@x.test'), true, 'check finds it case-insensitively');
select is(public.suppression_check('20000000-0000-4000-8000-000000003002', 'bob@x.test'), false, 'check is workspace and tenant scoped');
-- a legacy clear-text row still counts until 0031 runs
insert into public.email_suppressions (tenant_id, workspace_id, email, reason, source) values ('10000000-0000-4000-8000-000000003001', '20000000-0000-4000-8000-000000003001', 'old@x.test', 'unsubscribe', 'legacy');
select is(public.suppression_check('20000000-0000-4000-8000-000000003001', 'old@x.test'), true, 'a legacy clear-text row is still honoured');
select is(public.suppression_add('20000000-0000-4000-8000-000000003001', 'old@x.test', 'manual', 'tap', null), false, 'adding an address that has a legacy row is a no-op');

-- ---------- consent_log: h2 for new rows, all forms found ----------
insert into public.consent_log (id, workspace_id, subject_ref, purpose, action, notice_version, captured_via)
  values (990030, '20000000-0000-4000-8000-000000003001', repeat('ef', 32), 'demo_followup', 'granted', 'v1', 'manual');
select like((select subject_ref from public.consent_log where id = 990030), 'h2:%', 'a new plain sha256 subject_ref is stored as h2:');
select is((select subject_ref from public.consent_log where id = 990030), private.subject_hmac('10000000-0000-4000-8000-000000003001', repeat('ef', 32)), 'it is the tenant HMAC of the value the app sent');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*) from public.consent_log_for_subject('20000000-0000-4000-8000-000000003001', repeat('ef', 32))), 1::bigint, 'lookup by the plain hash finds the h2 row (service role context)');

-- ---------- 0031 backfill (guard trigger is switched off then on again) ----------
alter table public.consent_log disable trigger a05_consent_subject_salt;
insert into public.consent_log (id, workspace_id, subject_ref, purpose, action, notice_version, captured_via)
  values (990031, '20000000-0000-4000-8000-000000003001', repeat('12', 32), 'demo_followup', 'granted', 'v1', 'manual');
alter table public.consent_log enable trigger a05_consent_subject_salt;
\i supabase/migrations/0031_consent_hmac_backfill.sql
select is((select count(*) from public.consent_log where subject_ref = repeat('12', 32)) + (select count(*) from public.email_suppressions where email is not null), 0::bigint, 'backfill leaves no plain sha256 and no clear-text address');
select throws_ok($$update public.consent_log set note = 'tamper' where id = 990030$$, '42501', null, 'consent_log is append-only again after the backfill');

select * from finish();
rollback;
