-- pgTAP for 0015_integrations_webhooks_api. Run on the Supabase branch DB (needs Vault).
begin;
select plan(26);

insert into public.tenants (id, slug, name, brand_name) values
  ('10000000-0000-4000-8000-0000000000a1', 'tap-a', 'Tap A', 'Tap A'),
  ('10000000-0000-4000-8000-0000000000b1', 'tap-b', 'Tap B', 'Tap B');
insert into public.workspaces (id, tenant_id, name, slug) values
  ('20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Tap A ws', 'tap-a-ws'),
  ('20000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'Tap B ws', 'tap-b-ws');
insert into auth.users (id, email, email_confirmed_at, aud, role)
select u, 'tap-' || right(u::text, 2) || '@verify.example', now(), 'authenticated', 'authenticated'
  from unnest(array['a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004',
                    'a1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000009']::uuid[]) u;
insert into public.profiles (id, full_name, email)
select id, 'Tap ' || right(id::text, 2), email from auth.users where email like 'tap-%@verify.example' on conflict (id) do nothing;
insert into public.memberships (user_id, workspace_id, role) values
  ('a1000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a1', 'owner'),
  ('a1000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-0000000000a1', 'viewer'),
  ('a1000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-0000000000b1', 'owner');
insert into public.platform_admins (user_id) values ('a1000000-0000-4000-8000-000000000009');
insert into public.support_sessions (admin_id, workspace_id, reason, mode, expires_at) values
  ('a1000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-0000000000a1', 'pgTAP read write support check', 'read_write', now() + interval '30 minutes');
insert into public.leads (id, workspace_id, full_name) values ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a1', 'Consent Lead');
insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via, occurred_at)
  values ('20000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-000000000001', 'ref1', 'whatsapp', 'granted', 'v1', 'manual', now() - interval '2 hours');
insert into public.api_keys (id, workspace_id, name, prefix, key_hash) values
  ('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a1', 'CI key', 'gcrm_live_ab12', 'hash-not-a-secret');
insert into public.webhook_inbox (connector_id, workspace_id, provider_event_id, signature_ok, body) values
  ('whatsapp', '20000000-0000-4000-8000-0000000000a1', 'evt-1', true, '{"secret":"body"}');

create function pg_temp.act(u uuid, a text default 'aal1') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', a)::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $f$;

select ok((select count(*) from public.connector_catalog) >= 25, '22 connectors + csv, email-smtp, resend');
select ok((select count(*) from public.connector_availability) >= 75, 'availability rows for every connector and env');
select is((select mode from public.connector_availability where connector_id = 'whatsapp' and env = 'production'), 'disabled', 'gated connector is disabled in production');
select is((select mode from public.connector_availability where connector_id = 'csv' and env = 'production'), 'live', 'ungated connector is live in production');
select ok((select count(*) from pg_inherits i join pg_class c on c.oid = i.inhparent where c.relname in ('webhook_deliveries', 'api_request_log')) >= 30, 'monthly partitions for deliveries and request log');
select is((select count(*) from pg_class where relkind = 'r' and relname like 'api_request_log_p%' and not relrowsecurity), 0::bigint, 'every partition has RLS enabled');

select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select lives_ok($$insert into public.integrations (workspace_id, provider, label, category, direction, connector_id) values ('20000000-0000-4000-8000-0000000000a1', 'hubspot', 'HubSpot', 'crm', 'both', 'hubspot')$$, 'owner connects an integration');
select is((select mode from public.integrations where provider = 'hubspot'), 'sandbox', 'new connections default to sandbox');
select lives_ok($$insert into public.webhook_endpoints (workspace_id, url, event_types) values ('20000000-0000-4000-8000-0000000000a1', 'https://example.test/hook', '{lead.created}')$$, 'owner adds an https webhook endpoint');
select throws_ok($$insert into public.webhook_endpoints (workspace_id, url) values ('20000000-0000-4000-8000-0000000000a1', 'http://example.test/hook')$$, '23514', null, 'plain http endpoints are rejected');
select is((select name from public.api_keys limit 1), 'CI key', 'owner lists API keys (without the hash)');
select throws_ok($$select key_hash from public.api_keys$$, '42501', null, 'key_hash is not selectable');
select throws_ok($$insert into public.api_keys (workspace_id, name, prefix, key_hash) values ('20000000-0000-4000-8000-0000000000a1', 'x', 'p1', 'h')$$, '42501', null, 'keys are created server-side only');
select lives_ok($$update public.api_keys set revoked_at = now() where id = '70000000-0000-4000-8000-000000000001'$$, 'owner revokes a key');
select throws_ok($$select body from public.webhook_inbox$$, '42501', null, 'inbox bodies are not selectable');
select is((select events from public.v_webhook_inbox_stats where connector_id = 'whatsapp'), 1::bigint, 'owner sees inbox counts');
select ok(public.can_contact('40000000-0000-4000-8000-000000000001', 'whatsapp'), 'consent granted => can_contact true');
reset role;
insert into public.consent_log (workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via, occurred_at)
  values ('20000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-000000000001', 'ref1', 'whatsapp', 'withdrawn', 'v1', 'manual', now() - interval '1 hour');
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select ok(not public.can_contact('40000000-0000-4000-8000-000000000001', 'whatsapp'), 'latest entry withdrawn => can_contact false');

select pg_temp.act('a1000000-0000-4000-8000-000000000004');
select is((select count(*) from public.api_keys), 0::bigint, 'viewer sees no API keys');
select throws_ok($$insert into public.integrations (workspace_id, provider, label, category, direction) values ('20000000-0000-4000-8000-0000000000a1', 'slack', 'Slack', 'automation', 'out')$$, '42501', null, 'viewer cannot connect integrations');
select throws_ok($$insert into public.connector_availability (connector_id, env, mode, gate_status) values ('slack', 'production', 'live', 'ready')$$, '42501', null, 'only super admins change availability');
select pg_temp.act('a1000000-0000-4000-8000-000000000005');
select is((select count(*) from public.webhook_endpoints), 0::bigint, 'other tenant sees no endpoints');
select ok(not public.can_contact('40000000-0000-4000-8000-000000000001', 'whatsapp'), 'other tenant cannot probe consent');
select pg_temp.act('a1000000-0000-4000-8000-000000000009', 'aal2');
select is((select count(*) from public.api_keys), 0::bigint, 'support session (even read_write) never sees API keys');

reset role;
set local role authenticated;
select throws_ok($$select public.vault_put_secret('n', 's')$$, '42501', null, 'authenticated cannot use the Vault wrappers');
reset role;
set local role service_role;
select set_config('tap.sid', public.vault_put_secret('tap:conn:1:token', 'tok-123', 'pgTAP')::text, true);
select is(public.vault_get_secret(current_setting('tap.sid')::uuid), 'tok-123', 'service_role stores and reads a secret');
reset role;

select * from finish();
rollback;
