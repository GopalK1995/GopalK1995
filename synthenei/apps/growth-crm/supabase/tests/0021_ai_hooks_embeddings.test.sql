-- pgTAP for 0021_ai_hooks_embeddings. Run on the Supabase branch DB: node scripts/run-pgtap.mjs supabase/tests/0021_ai_hooks_embeddings.test.sql
-- One transaction, rolled back. Uses no_plan() so a count error cannot hide a real failure.
-- Sections: structure, backlog items, custom-field fix + parity with src/lib/metadata/__tests__/parity-cases.ts, AI tables, agents, embeddings.
begin;
select no_plan();

insert into public.tenants (id, slug, name, brand_name) values
  ('10000000-0000-4000-8000-0000000000a1', 'tap21-a', 'Tap21 A', 'Tap21 A'),
  ('10000000-0000-4000-8000-0000000000b1', 'tap21-b', 'Tap21 B', 'Tap21 B');
insert into public.workspaces (id, tenant_id, name, slug) values
  ('20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Tap21 A ws', 'tap21-a-ws'),
  ('20000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'Tap21 B ws', 'tap21-b-ws');
-- 01 owner A, 02 rep A, 03 owner B, 04 bot A (kind agent, rep role in ws A), 05 second rep A, 06 bot without membership
insert into auth.users (id, email, email_confirmed_at, aud, role, raw_app_meta_data)
select u, 'tap21-' || right(u::text, 2) || '@verify.example', now(), 'authenticated', 'authenticated',
       case when right(u::text, 2) in ('04', '06') then '{"kind":"agent"}'::jsonb else '{}'::jsonb end
  from unnest(array[
    'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000006']::uuid[]) u;
insert into public.profiles (id, full_name, email)
select id, 'Tap21 ' || right(id::text, 2), email from auth.users where email like 'tap21-%@verify.example' on conflict (id) do nothing;
insert into public.memberships (user_id, workspace_id, role) values
  ('a1000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a1', 'owner'),
  ('a1000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000a1', 'sales_rep'),
  ('a1000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-0000000000b1', 'owner'),
  ('a1000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-0000000000a1', 'sales_rep'),
  ('a1000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-0000000000a1', 'sales_rep');
insert into public.leads (id, workspace_id, full_name, owner_id) values
  ('40000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'Lead unowned', null),
  ('40000000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-0000000000a1', 'Lead of rep', 'a1000000-0000-4000-8000-000000000002');

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
            where n.nspname = 'public' and c.relname in ('ai_providers','ai_policies','ai_usage','ai_audit','agents','agent_triggers','agent_runs','embeddings') and c.relrowsecurity),
          8::bigint, 'RLS enabled on all eight new tables');
select ok(exists (select 1 from pg_extension where extname = 'vector'), 'pgvector is installed');
select ok(exists (select 1 from pg_indexes where tablename = 'embeddings' and indexdef ilike '%hnsw%vector_cosine_ops%'), 'embeddings has an HNSW cosine index');
select ok(exists (select 1 from pgmq.list_queues() q where q.queue_name = 'agent'), 'the agent queue exists');
select ok(not has_column_privilege('authenticated', 'public.ai_providers', 'secret_id', 'select'), 'secret_id is not selectable by clients');
select ok(not has_table_privilege('authenticated', 'public.embeddings', 'insert'), 'embeddings have no client write path');
select ok(not has_table_privilege('authenticated', 'public.ai_usage', 'update') and not has_table_privilege('authenticated', 'public.ai_audit', 'delete'), 'usage and audit are append-only');
select ok(not has_table_privilege('anon', 'public.agents', 'select') and not has_table_privilege('anon', 'public.ai_policies', 'select'), 'anon has no access');
select is((select count(*) from public.tenants t where not exists (select 1 from public.ai_policies p where p.tenant_id = t.id)), 0::bigint, 'every tenant has an ai_policies row');
select is((select features from public.ai_policies where tenant_id = '10000000-0000-4000-8000-0000000000a1'), '{}'::jsonb, 'a new tenant has every AI feature off');
select ok(exists (select 1 from pg_inherits i join pg_class c on c.oid = i.inhparent where c.relname = 'ai_usage'), 'ai_usage is partitioned');

-- ---------- backlog: connectors, jobs, inbox, notifications, events, consent, audit ----------
select is((select count(*) from public.connector_availability where connector_id = 'mock'), 3::bigint, 'mock connector has availability rows for all three envs');
select is((select mode from public.connector_availability where connector_id = 'mock' and env = 'production'), 'disabled', 'mock is disabled in production');
select ok(exists (select 1 from pg_indexes where tablename = 'integrations' and indexname = 'integrations_ws_connector_uq' and indexdef ilike '%unique%'), 'unique (workspace_id, connector_id) on integrations');
select is((select count(*) from public.scheduled_jobs where kind = 'connector.scan' and tenant_id is null and workspace_id is null and cron = '*/15 * * * *' and enabled), 1::bigint, 'connector.scan runs every 15 minutes');
select is((select count(*) from public.event_types where type in ('segment.created','segment.updated','segment.deleted','audience.exported','comment.created','mention.created')), 6::bigint, 'segment, export, comment and mention event types exist');

insert into public.conversations (id, workspace_id, channel, status) values ('c0000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'whatsapp', 'open');
select lives_ok($$update public.conversations set status = 'snoozed' where id = 'c0000000-0000-4000-8000-0000000000a1'$$, 'a conversation can be snoozed');
select throws_ok($$update public.conversations set status = 'paused' where id = 'c0000000-0000-4000-8000-0000000000a1'$$, '23514', null, 'other statuses are still refused');

select lives_ok($$insert into public.notification_prefs (user_id, workspace_id, kind, quiet_from, quiet_to) values ('a1000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000a1', '*', '21:00', '07:00')$$, 'quiet hours are stored with both ends');
select throws_ok($$insert into public.notification_prefs (user_id, workspace_id, kind, quiet_from) values ('a1000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-0000000000a1', '*', '21:00')$$, '23514', null, 'quiet hours need both ends');
select lives_ok($$insert into public.notifications (workspace_id, user_id, kind, dedupe_key) values ('20000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000002', 'mention', 'k1')$$, 'first notification with a dedupe key');
select throws_ok($$insert into public.notifications (workspace_id, user_id, kind, dedupe_key) values ('20000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000002', 'mention', 'k1')$$, '23505', null, 'the same key for the same user is refused');
select lives_ok($$insert into public.notifications (workspace_id, user_id, kind, dedupe_key) values ('20000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000005', 'mention', 'k1')$$, 'the same key for another user is fine');
select lives_ok($$insert into public.notifications (workspace_id, user_id, kind) values ('20000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000002', 'mention'), ('20000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000002', 'mention')$$, 'rows without a key never collide');

insert into public.consent_log (tenant_id, workspace_id, lead_id, subject_ref, purpose, action, notice_version, captured_via)
values ('10000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000a1', repeat('a', 64), 'whatsapp', 'granted', 'v1', 'manual'),
       ('10000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000a2', repeat('b', 64), 'whatsapp', 'granted', 'v1', 'manual'),
       ('10000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-0000000000a2', repeat('b', 64), 'whatsapp', 'withdrawn', 'v1', 'manual');
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select is((select allowed from public.can_contact_many(array['40000000-0000-4000-8000-0000000000a1']::uuid[], 'whatsapp')), true, 'can_contact_many: granted consent');
select is((select allowed from public.can_contact_many(array['40000000-0000-4000-8000-0000000000a2']::uuid[], 'whatsapp')), false, 'can_contact_many: latest action is a withdrawal');
select is((select allowed from public.can_contact_many(array['40000000-0000-4000-8000-0000000000a1']::uuid[], 'marketing_email')), false, 'can_contact_many: no consent for that purpose');
select is((select count(*) from public.can_contact_many(array['40000000-0000-4000-8000-0000000000a1','40000000-0000-4000-8000-0000000000a2','40000000-0000-4000-8000-0000000000ff']::uuid[], 'whatsapp')), 3::bigint, 'can_contact_many answers for every id');
select is((select allowed from public.can_contact_many(array['40000000-0000-4000-8000-0000000000ff']::uuid[], 'whatsapp')), false, 'an unknown lead is not contactable');
reset role;
select pg_temp.act('a1000000-0000-4000-8000-000000000003');
select is((select allowed from public.can_contact_many(array['40000000-0000-4000-8000-0000000000a1']::uuid[], 'whatsapp')), false, 'a lead of another tenant is not contactable');
reset role;
select pg_temp.clear();

insert into public.audience_segments (id, workspace_id, name) values ('50000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'Tap21 segment');
select ok(exists (select 1 from public.audit_log where table_name = 'audience_segments' and row_id = '50000000-0000-4000-8000-0000000000a1' and action = 'insert'), 'audience_segments changes are audited');

-- webhooks
insert into public.webhook_endpoints (id, workspace_id, url, event_types) values
  ('60000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'https://example.test/hook', '{lead.created}');
select is((select options from public.webhook_endpoints where id = '60000000-0000-4000-8000-0000000000a1'), '{}'::jsonb, 'webhook options default to an empty object');
select is(public.webhook_bump_failures('60000000-0000-4000-8000-0000000000a1', false), 1, 'a failure adds one');
select is(public.webhook_bump_failures('60000000-0000-4000-8000-0000000000a1', false), 2, 'failures accumulate');
select is(public.webhook_bump_failures('60000000-0000-4000-8000-0000000000a1', true), 0, 'a success resets the counter');
select ok((select last_success_at is not null from public.webhook_endpoints where id = '60000000-0000-4000-8000-0000000000a1'), 'a success stamps last_success_at');
select is(public.webhook_bump_failures('60000000-0000-4000-8000-0000000000ff', false), null, 'an unknown endpoint returns null');
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.webhook_bump_failures('60000000-0000-4000-8000-0000000000a1', false)$$, '42501', null, 'webhook_bump_failures is service only');
reset role;
select pg_temp.clear();

-- ---------- custom fields: archived keys, version ----------
insert into public.field_defs (object_type_id, key, type) values
  ((select id from public.object_types where tenant_id = '10000000-0000-4000-8000-0000000000a1' and key = 'lead'), 'tier', 'text'),
  ((select id from public.object_types where tenant_id = '10000000-0000-4000-8000-0000000000a1' and key = 'lead'), 'region', 'text');
select is((select version from public.field_defs where key = 'tier' and tenant_id = '10000000-0000-4000-8000-0000000000a1'), 1, 'field_defs.version starts at 1');
update public.field_defs set label = '{"en":"Tier"}' where key = 'tier' and tenant_id = '10000000-0000-4000-8000-0000000000a1';
select is((select version from public.field_defs where key = 'tier' and tenant_id = '10000000-0000-4000-8000-0000000000a1'), 2, 'a change bumps field_defs.version');
update public.field_defs set label = '{"en":"Tier"}' where key = 'tier' and tenant_id = '10000000-0000-4000-8000-0000000000a1';
select is((select version from public.field_defs where key = 'tier' and tenant_id = '10000000-0000-4000-8000-0000000000a1'), 2, 'a no-op update does not bump it');

update public.leads set custom = '{"tier":"gold","region":"south"}' where id = '40000000-0000-4000-8000-0000000000a1';
update public.field_defs set archived_at = now() where key = 'tier' and tenant_id = '10000000-0000-4000-8000-0000000000a1';
select lives_ok($$update public.leads set custom = custom || '{"region":"north"}' where id = '40000000-0000-4000-8000-0000000000a1'$$,
  'editing another key works after a field is retired (the unchanged archived value is kept)');
select is((select custom ->> 'tier' from public.leads where id = '40000000-0000-4000-8000-0000000000a1'), 'gold', 'the retired value is preserved');
select throws_ok($$update public.leads set custom = custom || '{"tier":"silver"}' where id = '40000000-0000-4000-8000-0000000000a1'$$, '23514', 'unknown custom field "tier"', 'a CHANGED value for a retired key is rejected');
select throws_ok($$update public.leads set custom = '{"tier":"new"}' where id = '40000000-0000-4000-8000-0000000000a2'$$, '23514', 'unknown custom field "tier"', 'a NEW value for a retired key is rejected');
select throws_ok($$insert into public.leads (workspace_id, full_name, custom) values ('20000000-0000-4000-8000-0000000000a1', 'x', '{"tier":"gold"}')$$, '23514', 'unknown custom field "tier"', 'an insert cannot use a retired key');
select throws_ok($$update public.leads set custom = custom || '{"nope":1}' where id = '40000000-0000-4000-8000-0000000000a1'$$, '23514', 'unknown custom field "nope"', 'unknown keys are still rejected');
select lives_ok($$update public.leads set custom = custom - 'tier' where id = '40000000-0000-4000-8000-0000000000a1'$$, 'a retired value can be removed');

-- ---------- validator parity with src/lib/metadata/__tests__/parity-cases.ts (rows generated from the TS table) ----------
select is(metadata.check_value(jsonb_populate_record(null::public.field_defs,
            jsonb_build_object('type', c.type, 'options', c.options, 'validation', c.validation)), c.value),
          c.error, 'parity: ' || c.name)
  from (values
  ('text ok', 'text', '{}'::jsonb, '{}'::jsonb, '"hello"'::jsonb, null::text),
  ('text not a string', 'text', '{}'::jsonb, '{}'::jsonb, '5'::jsonb, 'must be text'),
  ('text too long (default 2000)', 'text', '{}'::jsonb, '{}'::jsonb, to_jsonb(repeat('x', 2001)), 'is too long'),
  ('text maxLength', 'text', '{}'::jsonb, '{"maxLength":3}'::jsonb, '"abcd"'::jsonb, 'is too long'),
  ('long_text allows 20000', 'long_text', '{}'::jsonb, '{}'::jsonb, to_jsonb(repeat('x', 20000)), null::text),
  ('text pattern ok', 'text', '{}'::jsonb, '{"pattern":"^[A-Z]{3}$"}'::jsonb, '"ABC"'::jsonb, null::text),
  ('text pattern fails', 'text', '{}'::jsonb, '{"pattern":"^[A-Z]{3}$"}'::jsonb, '"abc"'::jsonb, 'does not match the required pattern'),
  ('email ok', 'email', '{}'::jsonb, '{}'::jsonb, '"a@b.in"'::jsonb, null::text),
  ('email bad', 'email', '{}'::jsonb, '{}'::jsonb, '"a@b"'::jsonb, 'must be an email address'),
  ('phone ok', 'phone', '{}'::jsonb, '{}'::jsonb, '"+919876543210"'::jsonb, null::text),
  ('phone with spaces ok', 'phone', '{}'::jsonb, '{}'::jsonb, '"+91 98765 43210"'::jsonb, null::text),
  ('phone bad', 'phone', '{}'::jsonb, '{}'::jsonb, '"call me"'::jsonb, 'must be a phone number'),
  ('url ok', 'url', '{}'::jsonb, '{}'::jsonb, '"https://example.com/a"'::jsonb, null::text),
  ('url needs http(s)', 'url', '{}'::jsonb, '{}'::jsonb, '"ftp://example.com"'::jsonb, 'must be an http(s) URL'),
  ('number ok', 'number', '{}'::jsonb, '{}'::jsonb, '12.5'::jsonb, null::text),
  ('number as string', 'number', '{}'::jsonb, '{}'::jsonb, '"12"'::jsonb, 'must be a number'),
  ('number below min', 'number', '{}'::jsonb, '{"min":10}'::jsonb, '9'::jsonb, 'is below the minimum'),
  ('number above max', 'number', '{}'::jsonb, '{"max":10}'::jsonb, '11'::jsonb, 'is above the maximum'),
  ('percent bounds', 'percent', '{}'::jsonb, '{}'::jsonb, '101'::jsonb, 'must be between 0 and 100'),
  ('money ok', 'money', '{}'::jsonb, '{}'::jsonb, '150000.5'::jsonb, null::text),
  ('money negative', 'money', '{}'::jsonb, '{}'::jsonb, '-1'::jsonb, 'must not be negative'),
  ('date ok', 'date', '{}'::jsonb, '{}'::jsonb, '"2026-11-02"'::jsonb, null::text),
  ('date wrong shape', 'date', '{}'::jsonb, '{}'::jsonb, '"02/11/2026"'::jsonb, 'must be a date (YYYY-MM-DD)'),
  ('date not on the calendar', 'date', '{}'::jsonb, '{}'::jsonb, '"2026-02-30"'::jsonb, 'is not valid'),
  ('datetime ok', 'datetime', '{}'::jsonb, '{}'::jsonb, '"2026-11-02T09:00:00.000Z"'::jsonb, null::text),
  ('datetime not a string', 'datetime', '{}'::jsonb, '{}'::jsonb, '5'::jsonb, 'must be a date and time'),
  ('boolean ok', 'boolean', '{}'::jsonb, '{}'::jsonb, 'false'::jsonb, null::text),
  ('boolean bad', 'boolean', '{}'::jsonb, '{}'::jsonb, '"true"'::jsonb, 'must be true or false'),
  ('select ok', 'select', '{"choices":[{"key":"hot","label":{"en":"Hot"}},{"key":"cold","label":{"en":"Cold"},"archived":true}]}'::jsonb, '{}'::jsonb, '"hot"'::jsonb, null::text),
  ('select retired choice still valid', 'select', '{"choices":[{"key":"hot","label":{"en":"Hot"}},{"key":"cold","label":{"en":"Cold"},"archived":true}]}'::jsonb, '{}'::jsonb, '"cold"'::jsonb, null::text),
  ('select unknown', 'select', '{"choices":[{"key":"hot","label":{"en":"Hot"}},{"key":"cold","label":{"en":"Cold"},"archived":true}]}'::jsonb, '{}'::jsonb, '"warm"'::jsonb, 'is not one of the listed choices'),
  ('multi_select ok', 'multi_select', '{"choices":[{"key":"hot","label":{"en":"Hot"}},{"key":"cold","label":{"en":"Cold"},"archived":true}]}'::jsonb, '{}'::jsonb, '["hot","cold"]'::jsonb, null::text),
  ('multi_select bad member', 'multi_select', '{"choices":[{"key":"hot","label":{"en":"Hot"}},{"key":"cold","label":{"en":"Cold"},"archived":true}]}'::jsonb, '{}'::jsonb, '["hot","x"]'::jsonb, 'contains a value that is not a listed choice'),
  ('multi_select not a list', 'multi_select', '{"choices":[{"key":"hot","label":{"en":"Hot"}},{"key":"cold","label":{"en":"Cold"},"archived":true}]}'::jsonb, '{}'::jsonb, '"hot"'::jsonb, 'must be a list of choices'),
  ('user ok', 'user', '{}'::jsonb, '{}'::jsonb, '"123e4567-e89b-12d3-a456-426614174000"'::jsonb, null::text),
  ('lookup bad id', 'lookup', '{}'::jsonb, '{}'::jsonb, '"abc"'::jsonb, 'must be a record id'),
  ('rating ok', 'rating', '{}'::jsonb, '{}'::jsonb, '4'::jsonb, null::text),
  ('rating fraction', 'rating', '{}'::jsonb, '{}'::jsonb, '4.5'::jsonb, 'must be a whole number'),
  ('rating range', 'rating', '{}'::jsonb, '{}'::jsonb, '6'::jsonb, 'is outside the rating range'),
  ('null is always fine', 'number', '{}'::jsonb, '{}'::jsonb, 'null'::jsonb, null::text)
) c(name, type, options, validation, value, error);

-- ---------- AI tables: providers, policies ----------
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select lives_ok($$insert into public.ai_providers (tenant_id, provider, default_model, allowed_models) values ('10000000-0000-4000-8000-0000000000a1', 'anthropic', 'm1', '{m1}')$$, 'a tenant admin adds a provider');
select throws_ok($$insert into public.ai_providers (tenant_id, provider, secret_id) values ('10000000-0000-4000-8000-0000000000a1', 'openai', gen_random_uuid())$$, '42501', null, 'a client cannot set secret_id');
select throws_ok($$insert into public.ai_providers (tenant_id, provider) values ('10000000-0000-4000-8000-0000000000a1', 'anthropic')$$, '23505', null, 'one row per tenant and provider');
select is((select has_secret from public.ai_providers where provider = 'anthropic'), false, 'has_secret tells the UI whether BYOK is set without exposing it');
select lives_ok($$update public.ai_policies set monthly_call_cap = 100, features = '{"reply_draft":true}' where tenant_id = '10000000-0000-4000-8000-0000000000a1'$$, 'a tenant admin edits the AI policy');
select is(pg_temp.cnt($$select count(*) from public.ai_policies$$), 1::bigint, 'the owner sees only their tenant policy');
select throws_ok($$delete from public.ai_policies where tenant_id = '10000000-0000-4000-8000-0000000000a1'$$, '42501', null, 'policies cannot be deleted by clients');
reset role;
select pg_temp.act('a1000000-0000-4000-8000-000000000002');
select is(pg_temp.cnt($$select count(*) from public.ai_providers$$), 0::bigint, 'a rep does not see providers');
select is(pg_temp.cnt($$select count(*) from public.ai_policies$$), 1::bigint, 'a rep reads the policy (feature flags)');
select is(pg_temp.cnt($$with u as (update public.ai_policies set monthly_call_cap = 1000000 where tenant_id = '10000000-0000-4000-8000-0000000000a1' returning 1) select count(*) from u$$), 0::bigint, 'a rep cannot change the policy');
reset role;
select pg_temp.act('a1000000-0000-4000-8000-000000000003');
select is(pg_temp.cnt($$select count(*) from public.ai_providers where tenant_id = '10000000-0000-4000-8000-0000000000a1'$$), 0::bigint, 'owner B does not see tenant A providers');
select is(pg_temp.cnt($$select count(*) from public.ai_policies where tenant_id = '10000000-0000-4000-8000-0000000000a1'$$), 0::bigint, 'owner B does not see tenant A policy');
select throws_ok($$insert into public.ai_providers (tenant_id, provider) values ('10000000-0000-4000-8000-0000000000a1', 'google')$$, '42501', null, 'owner B cannot add a provider to tenant A');
reset role;

-- ---------- AI usage, audit, caps ----------
select pg_temp.act('a1000000-0000-4000-8000-000000000002');
select lives_ok($$insert into public.ai_usage (workspace_id, principal_kind, principal_id, feature, provider, model, input_tokens, output_tokens) values ('20000000-0000-4000-8000-0000000000a1', 'user', 'a1000000-0000-4000-8000-000000000002', 'reply_draft', 'anthropic', 'm1', 10, 5)$$, 'a rep records their own usage');
select throws_ok($$insert into public.ai_usage (workspace_id, principal_kind, principal_id, feature, provider, model) values ('20000000-0000-4000-8000-0000000000a1', 'user', 'a1000000-0000-4000-8000-000000000005', 'reply_draft', 'anthropic', 'm1')$$, '42501', null, 'usage cannot be recorded as someone else');
select throws_ok($$insert into public.ai_usage (workspace_id, principal_kind, principal_id, feature, provider, model) values ('20000000-0000-4000-8000-0000000000b1', 'user', 'a1000000-0000-4000-8000-000000000002', 'reply_draft', 'anthropic', 'm1')$$, '42501', null, 'usage cannot be recorded in another tenant workspace');
select throws_ok($$insert into public.ai_usage (workspace_id, principal_kind, principal_id, feature, provider, model) values ('20000000-0000-4000-8000-0000000000a1', 'system', 'a1000000-0000-4000-8000-000000000002', 'reply_draft', 'anthropic', 'm1')$$, '42501', null, 'clients cannot record system usage');
select throws_ok($$update public.ai_usage set input_tokens = 0$$, '42501', null, 'usage is append-only');
select lives_ok($$insert into public.ai_usage (workspace_id, principal_kind, principal_id, feature, provider, model, input_tokens, output_tokens) values ('20000000-0000-4000-8000-0000000000a1', 'user', 'a1000000-0000-4000-8000-000000000002', 'summary', 'anthropic', 'm1', 20, 5)$$, 'second usage row');
select is(pg_temp.cnt($$select count(*) from public.ai_usage$$), 2::bigint, 'a rep reads their own usage');
select is((public.ai_cap_status('10000000-0000-4000-8000-0000000000a1') -> 'usage' ->> 'calls_month')::int, 2, 'ai_cap_status counts this month');
select is((public.ai_cap_status('10000000-0000-4000-8000-0000000000a1') ->> 'allowed')::boolean, true, 'under the cap: allowed');
select throws_ok($$select public.ai_cap_status('10000000-0000-4000-8000-0000000000b1')$$, '42501', null, 'caps of another tenant are refused');
reset role;
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
update public.ai_policies set monthly_call_cap = 2 where tenant_id = '10000000-0000-4000-8000-0000000000a1';
select is(public.ai_cap_status('10000000-0000-4000-8000-0000000000a1') ->> 'reason', 'monthly_calls', 'monthly call cap reached');
update public.ai_policies set monthly_call_cap = null, monthly_token_cap = 40 where tenant_id = '10000000-0000-4000-8000-0000000000a1';
select is(public.ai_cap_status('10000000-0000-4000-8000-0000000000a1') ->> 'reason', 'monthly_tokens', 'monthly token cap reached');
update public.ai_policies set monthly_token_cap = null, per_user_daily_cap = 2 where tenant_id = '10000000-0000-4000-8000-0000000000a1';
select is(public.ai_cap_status('10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000002') ->> 'reason', 'user_daily', 'per-user daily cap reached');
select is((public.ai_cap_status('10000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000005') ->> 'allowed')::boolean, true, 'another user is still under their daily cap');
select is(pg_temp.cnt($$select count(*) from public.ai_usage$$), 2::bigint, 'the admin reads the workspace usage');
reset role;
select pg_temp.act('a1000000-0000-4000-8000-000000000003');
select is(pg_temp.cnt($$select count(*) from public.ai_usage$$), 0::bigint, 'owner B does not see tenant A usage');
reset role;

select pg_temp.act('a1000000-0000-4000-8000-000000000002');
select lives_ok($$insert into public.ai_audit (workspace_id, principal_kind, principal_id, feature, model, prompt_redacted, output_excerpt) values ('20000000-0000-4000-8000-0000000000a1', 'user', 'a1000000-0000-4000-8000-000000000002', 'reply_draft', 'm1', 'hello', 'world')$$, 'a rep writes an audit row for their own call');
select throws_ok($$insert into public.ai_audit (workspace_id, principal_kind, principal_id, feature, model) values ('20000000-0000-4000-8000-0000000000a1', 'user', 'a1000000-0000-4000-8000-000000000005', 'x', 'm1')$$, '42501', null, 'audit rows cannot be written as someone else');
select throws_ok($$delete from public.ai_audit$$, '42501', null, 'audit rows cannot be deleted');
reset role;
select is((select prompt_redacted from public.ai_audit where feature = 'reply_draft'), 'hello', 'store_prompts = redacted keeps the (already redacted) prompt');
update public.ai_policies set store_prompts = 'none' where tenant_id = '10000000-0000-4000-8000-0000000000a1';
select pg_temp.act('a1000000-0000-4000-8000-000000000002');
select lives_ok($$insert into public.ai_audit (workspace_id, principal_kind, principal_id, feature, model, prompt_redacted, output_excerpt) values ('20000000-0000-4000-8000-0000000000a1', 'user', 'a1000000-0000-4000-8000-000000000002', 'summary', 'm1', 'secret text', 'more text')$$, 'second audit row');
reset role;
select ok((select prompt_redacted is null and output_excerpt is null from public.ai_audit where feature = 'summary'), 'store_prompts = none drops prompt and output text');
select pg_temp.act('a1000000-0000-4000-8000-000000000003');
select is(pg_temp.cnt($$select count(*) from public.ai_audit$$), 0::bigint, 'owner B does not see tenant A audit');
reset role;
select pg_temp.clear();

-- ---------- agents ----------
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select lives_ok($$insert into public.agents (id, workspace_id, name, instructions, role_id, bot_user_id, enabled) values
  ('70000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'Follow-up helper', 'Draft follow-ups', '30000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000004', true)$$,
  'an admin creates an agent with a bot user and a role');
select throws_ok($$insert into public.agents (workspace_id, name, role_id, bot_user_id) values
  ('20000000-0000-4000-8000-0000000000a1', 'Human bot', '30000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000005')$$, '23514', null, 'a human user cannot be an agent bot');
select throws_ok($$insert into public.agents (workspace_id, name, role_id, bot_user_id) values
  ('20000000-0000-4000-8000-0000000000a1', 'Owner bot', '30000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000006')$$, '23514', null, 'an agent cannot hold an owner role');
select throws_ok($$insert into public.agents (workspace_id, name, role_id, bot_user_id, enabled) values
  ('20000000-0000-4000-8000-0000000000a1', 'No member', '30000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000006', true)$$, '23514', null, 'an enabled agent needs the bot to hold the role in the workspace');
select lives_ok($$insert into public.agents (workspace_id, name, role_id, bot_user_id, enabled) values
  ('20000000-0000-4000-8000-0000000000a1', 'Parked', '30000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000006', false)$$, 'a disabled agent can be prepared before its bot has a membership');
select throws_ok($$insert into public.agents (workspace_id, name, role_id) values ('20000000-0000-4000-8000-0000000000a1', 'No bot', '30000000-0000-4000-8000-000000000003')$$, '23514', null, 'an agent without a bot user is refused');
select throws_ok($$insert into public.agents (workspace_id, name, bot_user_id) values ('20000000-0000-4000-8000-0000000000a1', 'No role', 'a1000000-0000-4000-8000-000000000004')$$, '23514', null, 'an agent without a role is refused');
select is((select tenant_id from public.agents where id = '70000000-0000-4000-8000-0000000000a1'), '10000000-0000-4000-8000-0000000000a1'::uuid, 'the agent tenant comes from its workspace');
update public.agents set name = 'Follow-up helper v2' where id = '70000000-0000-4000-8000-0000000000a1';
select is((select version from public.agents where id = '70000000-0000-4000-8000-0000000000a1'), 2, 'agent version bumps on change');

select lives_ok($$insert into public.agent_triggers (id, agent_id, kind, event_types) values ('71000000-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-0000000000a1', 'event', '{lead.created}')$$, 'an event trigger on an agent-eligible event');
select lives_ok($$insert into public.agent_triggers (agent_id, kind, event_types) values ('70000000-0000-4000-8000-0000000000a1', 'event', '{lead.*}')$$, 'a domain wildcard trigger');
select throws_ok($$insert into public.agent_triggers (agent_id, kind, event_types) values ('70000000-0000-4000-8000-0000000000a1', 'event', '{webhook.endpoint.disabled}')$$, '23514', null, 'an event that is not agent-eligible is refused');
select throws_ok($$insert into public.agent_triggers (agent_id, kind, event_types) values ('70000000-0000-4000-8000-0000000000a1', 'event', '{}')$$, '23514', null, 'an event trigger needs event types');
select lives_ok($$insert into public.agent_triggers (agent_id, kind, cron) values ('70000000-0000-4000-8000-0000000000a1', 'schedule', '0 9 * * *')$$, 'a schedule trigger');
select throws_ok($$insert into public.agent_triggers (agent_id, kind) values ('70000000-0000-4000-8000-0000000000a1', 'webhook')$$, '23514', null, 'an enabled webhook trigger needs a secret');
select is((select workspace_id from public.agent_triggers where id = '71000000-0000-4000-8000-0000000000a1'), '20000000-0000-4000-8000-0000000000a1'::uuid, 'trigger scope comes from the agent');

select ok(public.agent_enqueue('70000000-0000-4000-8000-0000000000a1', '71000000-0000-4000-8000-0000000000a1', null, '{"why":"test"}') is not null, 'an admin queues a run');
select is(pg_temp.cnt($$select count(*) from public.agent_runs where status = 'queued'$$), 1::bigint, 'the run row is queued');
select throws_ok($$select public.agent_enqueue('70000000-0000-4000-8000-0000000000a1', '71000000-0000-4000-8000-0000000000ff')$$, '22023', null, 'a trigger of another agent is refused');
reset role;
select ok((select count(*) from pgmq.q_agent) >= 1, 'the run message is on the agent queue');

select pg_temp.act('a1000000-0000-4000-8000-000000000002');
select is(pg_temp.cnt($$select count(*) from public.agents$$), 2::bigint, 'a rep (ai.use) reads agents');
select throws_ok($$insert into public.agents (workspace_id, name, role_id, bot_user_id) values ('20000000-0000-4000-8000-0000000000a1', 'Rep agent', '30000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000004')$$, '42501', null, 'a rep cannot create agents');
select throws_ok($$select public.agent_enqueue('70000000-0000-4000-8000-0000000000a1')$$, '42501', null, 'a rep cannot queue a run');
select is(pg_temp.cnt($$select count(*) from public.agent_runs$$), 0::bigint, 'a rep does not see runs');
reset role;
select pg_temp.act('a1000000-0000-4000-8000-000000000003');
select is(pg_temp.cnt($$select count(*) from public.agents$$), 0::bigint, 'owner B does not see tenant A agents');
select is(pg_temp.cnt($$select count(*) from public.agent_triggers$$), 0::bigint, 'owner B does not see tenant A triggers');
select is(pg_temp.cnt($$select count(*) from public.agent_runs$$), 0::bigint, 'owner B does not see tenant A runs');
reset role;

-- the agent acts as its bot user, never as the service role
select pg_temp.act('a1000000-0000-4000-8000-000000000004');
select lives_ok($$insert into public.agent_runs (agent_id, status, started_at) values ('70000000-0000-4000-8000-0000000000a1', 'running', now())$$, 'the bot records a run of its own agent');
select is(pg_temp.cnt($$select count(*) from public.agent_runs$$) >= 2, true, 'the bot reads its runs');
select lives_ok($$update public.agent_runs set status = 'succeeded', finished_at = now() where status = 'running'$$, 'the bot finishes its run');
reset role;
select pg_temp.act('a1000000-0000-4000-8000-000000000005');
select throws_ok($$insert into public.agent_runs (agent_id, status) values ('70000000-0000-4000-8000-0000000000a1', 'running')$$, '42501', null, 'another user cannot write runs of the agent');
reset role;
select pg_temp.clear();

-- a bot whose membership role changes or is switched off takes the agent offline
update public.memberships set is_active = false where user_id = 'a1000000-0000-4000-8000-000000000004' and workspace_id = '20000000-0000-4000-8000-0000000000a1';
select is((select enabled from public.agents where id = '70000000-0000-4000-8000-0000000000a1'), false, 'deactivating the bot membership disables the agent');

-- ---------- embeddings: RLS mirrors the source object ----------
insert into public.embeddings (workspace_id, object_type, object_id, chunk_ix, content_hash, model, embedding) values
  ('20000000-0000-4000-8000-0000000000a1', 'lead', '40000000-0000-4000-8000-0000000000a1', 0, repeat('c', 32), 'embed-test', array_fill(0.1::real, array[1024])::extensions.vector),
  ('20000000-0000-4000-8000-0000000000a1', 'lead', '40000000-0000-4000-8000-0000000000a2', 0, repeat('d', 32), 'embed-test', array_fill(0.2::real, array[1024])::extensions.vector);
select is((select tenant_id from public.embeddings where object_id = '40000000-0000-4000-8000-0000000000a1'), '10000000-0000-4000-8000-0000000000a1'::uuid, 'embedding tenant comes from the workspace');
select throws_ok($$insert into public.embeddings (workspace_id, object_type, object_id, content_hash, model, dims, embedding) values ('20000000-0000-4000-8000-0000000000a1', 'lead', '40000000-0000-4000-8000-0000000000a1', repeat('e', 32), 'm', 768, array_fill(0.1::real, array[1024])::extensions.vector)$$, '23514', null, 'dims must match the vector column');
select throws_ok($$insert into public.embeddings (workspace_id, object_type, object_id, chunk_ix, content_hash, model, embedding) values ('20000000-0000-4000-8000-0000000000a1', 'lead', '40000000-0000-4000-8000-0000000000a1', 0, repeat('c', 32), 'embed-test', array_fill(0.1::real, array[1024])::extensions.vector)$$, '23505', null, 'one row per object, chunk and model');
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select is(pg_temp.cnt($$select count(*) from public.embeddings$$), 2::bigint, 'the owner sees embeddings of every readable lead');
select throws_ok($$insert into public.embeddings (workspace_id, object_type, object_id, content_hash, model, embedding) values ('20000000-0000-4000-8000-0000000000a1', 'lead', '40000000-0000-4000-8000-0000000000a1', repeat('f', 32), 'm', array_fill(0.1::real, array[1024])::extensions.vector)$$, '42501', null, 'clients cannot write embeddings');
reset role;
select pg_temp.act('a1000000-0000-4000-8000-000000000002');
select is(pg_temp.cnt($$select count(*) from public.embeddings$$), 1::bigint, 'a rep sees only the embedding of a lead they can read');
select is(pg_temp.cnt($$select count(*) from public.embeddings where object_id = '40000000-0000-4000-8000-0000000000a1'$$), 0::bigint, 'the unowned lead embedding stays hidden from the rep');
reset role;
select pg_temp.act('a1000000-0000-4000-8000-000000000003');
select is(pg_temp.cnt($$select count(*) from public.embeddings$$), 0::bigint, 'owner B sees no tenant A embeddings');
reset role;

select * from finish();
rollback;
