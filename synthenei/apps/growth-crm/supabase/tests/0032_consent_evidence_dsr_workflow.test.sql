-- pgTAP for 0032_consent_evidence_dsr_workflow (AUD-063, AUD-064). Branch DB only: node scripts/run-pgtap.mjs supabase/tests/0032_consent_evidence_dsr_workflow.test.sql
-- One transaction, rolled back. NOT run by the agent that wrote it (no branch database was available): UNVERIFIED until it is.
begin;
select plan(36);

insert into public.tenants (id, slug, name, brand_name) values
  ('10000000-0000-4000-8000-000000003201', 'tap32-a', 'Tap32 A', 'Tap32 A'),
  ('10000000-0000-4000-8000-000000003202', 'tap32-b', 'Tap32 B', 'Tap32 B');
insert into public.workspaces (id, tenant_id, name, slug, lead_intake_enabled) values
  ('20000000-0000-4000-8000-000000003201', '10000000-0000-4000-8000-000000003201', 'Tap32 ws a', 'tap32-ws-a', true),
  ('20000000-0000-4000-8000-000000003202', '10000000-0000-4000-8000-000000003202', 'Tap32 ws b', 'tap32-ws-b', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- ---------- shape ----------
select has_table('public', 'notice_versions', 'notice_versions exists');
select has_table('public', 'privacy_tokens', 'privacy_tokens exists');
select has_column('public', 'consent_log', 'notice_sha256', 'consent_log has notice_sha256');
select has_column('public', 'consent_log', 'form_id', 'consent_log has form_id');
select has_column('public', 'consent_log', 'ip_hash', 'consent_log has ip_hash');
select has_column('public', 'consent_log', 'ua_class', 'consent_log has ua_class');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'submit_lead'), 1::bigint, 'exactly one submit_lead overload (no PGRST203 ambiguity)');
select ok(has_function_privilege('anon', 'public.submit_lead(text, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text, jsonb, jsonb, text, text, text, text, text)', 'execute'), 'anon can still call submit_lead');
select ok(not has_table_privilege('authenticated', 'public.privacy_tokens', 'select') and not has_table_privilege('anon', 'public.privacy_tokens', 'select'), 'privacy_tokens is service role only');
select ok(not has_function_privilege('authenticated', 'public.privacy_token_use(text, text, uuid, timestamptz, boolean)', 'execute') and has_function_privilege('service_role', 'public.privacy_token_use(text, text, uuid, timestamptz, boolean)', 'execute'), 'privacy_token_use is service role only');

-- ---------- notice_versions: append-only, hash-keyed ----------
insert into public.notice_versions (tenant_id, text_sha256, version, text_snapshot)
  values ('10000000-0000-4000-8000-000000003201', repeat('a1', 32), 'v2', 'Notice v2 text');
select throws_ok($$update public.notice_versions set text_snapshot = 'edited' where text_sha256 = repeat('a1', 32)$$, '42501', null, 'a published notice cannot be edited');
select throws_ok($$delete from public.notice_versions where text_sha256 = repeat('a1', 32)$$, '42501', null, 'a published notice cannot be deleted');
select throws_ok($$insert into public.notice_versions (tenant_id, text_sha256, version, text_snapshot) values ('10000000-0000-4000-8000-000000003201', 'nothex', 'v3', 'x')$$, '23514', null, 'the hash must be 64 hex chars');

-- ---------- submit_lead: evidence, unbundled consent, flags follow the log ----------
select public.submit_lead('tap32-ws-a', 'Eve One', 'eve@tap32.test', null, 'Tap Firm', 'Associate / lawyer', null, null, null,
  true, false, false, 'v2', '{}'::jsonb, '{}'::jsonb, null, '/lp', 'lawsome-landing/demo-form@v2', repeat('cd', 32), 'mobile');
select is((select count(*) from public.consent_log where lead_id = (select id from public.leads where email = 'eve@tap32.test')), 1::bigint, 'one consent row: demo follow-up only (marketing was not given)');
select is((select notice_sha256 from public.consent_log where lead_id = (select id from public.leads where email = 'eve@tap32.test')), repeat('a1', 32), 'the row cites the hash of the registered notice text');
select is((select notice_version from public.consent_log where lead_id = (select id from public.leads where email = 'eve@tap32.test')), 'v2', 'and its version label');
select is((select form_id || '|' || ip_hash || '|' || ua_class from public.consent_log where lead_id = (select id from public.leads where email = 'eve@tap32.test')), 'lawsome-landing/demo-form@v2|' || repeat('cd', 32) || '|mobile', 'form id, address hash and ua class are stored');
select is((select consent_marketing from public.leads where email = 'eve@tap32.test'), false, 'marketing flag is false: not bundled');

select public.submit_lead('tap32-ws-a', 'Eve Two', 'eve2@tap32.test', null, 'Tap Firm', 'Associate / lawyer', null, null, null,
  true, false, false, 'does-not-exist', '{}'::jsonb, '{}'::jsonb, null, '/lp', 'bad form id!', 'not-a-hash', 'toaster');
select is((select notice_version from public.consent_log where lead_id = (select id from public.leads where email = 'eve2@tap32.test')), 'v2', 'an unknown notice label falls back to the newest published version');
select is((select form_id is null and ip_hash is null and ua_class is null from public.consent_log where lead_id = (select id from public.leads where email = 'eve2@tap32.test')), true, 'malformed evidence is dropped, not stored');
select throws_ok($$select public.submit_lead('tap32-ws-a', 'No Consent', 'nc@tap32.test', null, null, null, null, null, null, false, false, false)$$, '22023', null, 'demo follow-up consent is still required for the demo request');

select public.submit_lead('tap32-ws-b', 'Nina Plain', 'nina@tap32.test', null, 'Other Firm', 'Associate / lawyer', null, null, null, true, false, false, 'v9');
select is((select notice_sha256 is null and notice_version = 'v9' from public.consent_log where lead_id = (select id from public.leads where email = 'nina@tap32.test')), true, 'a tenant with no published notice keeps the label and no hash');
select is((select notice_sha256 from public.consent_log where lead_id = (select id from public.leads where email = 'nina@tap32.test')), null, 'and another tenant never borrows this tenant''s notice hash');

-- marketing granted, then withdrawn through the log: the flag follows
select public.submit_lead('tap32-ws-a', 'Eve One', 'eve@tap32.test', null, null, null, null, null, null, true, false, true, 'v2');
select is((select consent_marketing from public.leads where email = 'eve@tap32.test'), true, 'a granted marketing row switches the flag on');
insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via)
  select workspace_id, id, repeat('ee', 32), 'marketing_email', 'withdrawn', 'v2', 'request' from public.leads where email = 'eve@tap32.test';
select is((select consent_marketing from public.leads where email = 'eve@tap32.test'), false, 'a withdrawn row switches it off (the trigger, not the app)');
-- PRIV-012: a repeat submission without marketing must not re-open what was withdrawn
select public.submit_lead('tap32-ws-a', 'Eve One', 'eve@tap32.test', null, null, null, null, null, null, true, false, false, 'v2');
select is((select consent_marketing from public.leads where email = 'eve@tap32.test'), false, 'a repeat submit without the marketing box leaves the withdrawn flag alone');
select is((select count(*) from public.consent_flag_mismatches('20000000-0000-4000-8000-000000003201')), 0::bigint, 'reconciliation: flags equal consent_log');
update public.leads set consent_whatsapp = true where email = 'eve@tap32.test';
select is((select count(*) from public.consent_flag_mismatches('20000000-0000-4000-8000-000000003201')), 0::bigint, 'a flag with no log row for its purpose is not compared');
insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via)
  select workspace_id, id, repeat('ee', 32), 'whatsapp', 'withdrawn', 'v2', 'manual' from public.leads where email = 'eve@tap32.test';
select is((select consent_whatsapp from public.leads where email = 'eve@tap32.test'), false, 'whatsapp withdrawal clears its flag');
-- force a divergence behind the trigger's back and see it reported
alter table public.consent_log disable trigger consent_log_flag_sync;
insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via)
  select workspace_id, id, repeat('ee', 32), 'demo_followup', 'withdrawn', 'v2', 'manual' from public.leads where email = 'eve@tap32.test';
alter table public.consent_log enable trigger consent_log_flag_sync;
select is((select purpose from public.consent_flag_mismatches('20000000-0000-4000-8000-000000003201')), 'demo_followup', 'reconciliation names the diverged purpose');

-- ---------- tokens: single use, hash at rest ----------
select is((public.privacy_token_use(repeat('01', 32), 'verify', '20000000-0000-4000-8000-000000003201', now() + interval '1 hour', true))->>'ok', 'true', 'a verification link registers and is spent on first use');
select is((public.privacy_token_use(repeat('01', 32), 'verify', '20000000-0000-4000-8000-000000003201', now() + interval '1 hour', true))->>'reason', 'used', 'a replay is refused');
select is((public.privacy_token_use(repeat('01', 32), 'status', '20000000-0000-4000-8000-000000003201'))->>'reason', 'scope', 'a token cannot be used for another purpose');
select is((public.privacy_token_peek(repeat('02', 32), 'verify', '20000000-0000-4000-8000-000000003201'))->>'state', 'fresh', 'peek of an unseen token says fresh and writes nothing');
select is((select count(*) from public.privacy_tokens where token_hash = repeat('02', 32)), 0::bigint, 'peek did not register it');
select is((public.privacy_token_use(repeat('03', 32), 'verify', '20000000-0000-4000-8000-000000003201', now() - interval '1 minute', true))->>'reason', 'expired', 'an expired link is refused');

select * from finish();
rollback;
