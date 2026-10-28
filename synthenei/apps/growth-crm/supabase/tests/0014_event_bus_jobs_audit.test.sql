-- pgTAP for 0014_event_bus_jobs_audit. Run on the Supabase branch DB (needs pgmq, pg_cron, pg_net, Vault).
begin;
select plan(45);

-- ---------- fixture (as postgres) ----------
insert into public.tenants (id, slug, name, brand_name) values
  ('10000000-0000-4000-8000-0000000000a1', 'tap-a', 'Tap A', 'Tap A'),
  ('10000000-0000-4000-8000-0000000000b1', 'tap-b', 'Tap B', 'Tap B'),
  ('10000000-0000-4000-8000-0000000000c1', 'tap-del', 'Tap Del', 'Tap Del');
insert into public.workspaces (id, tenant_id, name, slug) values
  ('20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Tap A ws', 'tap-a-ws'),
  ('20000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'Tap B ws', 'tap-b-ws'),
  ('20000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', 'Tap Del ws', 'tap-del-ws');
insert into auth.users (id, email, email_confirmed_at, aud, role)
select u, 'tap-' || right(u::text, 2) || '@verify.example', now(), 'authenticated', 'authenticated'
  from unnest(array['a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004',
                    'a1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000007']::uuid[]) u;
insert into public.profiles (id, full_name, email)
select id, 'Tap ' || right(id::text, 2), email from auth.users where email like 'tap-%@verify.example' on conflict (id) do nothing;
insert into public.memberships (user_id, workspace_id, role) values
  ('a1000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a1', 'owner'),
  ('a1000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-0000000000a1', 'viewer'),
  ('a1000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-0000000000b1', 'owner'),
  ('a1000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-0000000000c1', 'owner');

create function pg_temp.act(u uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $f$;

-- ---------- structure ----------
select ok((select count(*) from pg_inherits i join pg_class c on c.oid = i.inhparent where c.relname = 'events') >= 16, 'events partitions (months + default)');
select ok((select count(*) from pgmq.list_queues()) >= 16, '8 queues + 8 dead-letter queues');
select ok((select count(*) from public.event_types) >= 40, 'event types seeded');
select is((select count(*) from cron.job where jobname in ('gcrm_tick', 'gcrm_maintenance')), 2::bigint, 'tick and maintenance cron jobs present');
select lives_ok($$select private.tick()$$, 'tick is a no-op while tick_url is unset');
select lives_ok($$insert into private.settings (key, value) values ('tick_url', 'https://example.invalid/api/jobs/tick')$$, 'tick_url can be set');
select lives_ok($$select private.tick()$$, 'tick without the Vault secret does not call out and does not fail');
select lives_ok($$select private.maintenance()$$, 'maintenance runs');

-- ---------- row triggers write events (and enqueue) ----------
insert into public.leads (id, workspace_id, full_name, email, district) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a1', 'Event Lead', 'event@example.test', 'Madurai');
select is((select count(*) from public.events where type = 'lead.created' and object_id = '40000000-0000-4000-8000-000000000001'), 1::bigint, 'lead.created emitted');
select ok((select count(*) from pgmq.read('events', 0, 1000)) >= 1, 'event enqueued on the events queue (outbox in the same transaction)');
select ok(not ((select data from public.events where type = 'lead.created' and object_id = '40000000-0000-4000-8000-000000000001') ? 'email'
          or (select data::text from public.events where type = 'lead.created' and object_id = '40000000-0000-4000-8000-000000000001') like '%Event Lead%'),
  'event payload carries no PII fields');
update public.leads set owner_id = 'a1000000-0000-4000-8000-000000000001' where id = '40000000-0000-4000-8000-000000000001';
select is((select count(*) from public.events where type = 'lead.assigned' and object_id = '40000000-0000-4000-8000-000000000001'), 1::bigint, 'lead.assigned derived event');
select is((select count(*) from public.events where type = 'lead.updated' and object_id = '40000000-0000-4000-8000-000000000001'), 1::bigint, 'lead.updated emitted with changed_fields');
select ok((select data->'changed_fields' from public.events where type = 'lead.updated' and object_id = '40000000-0000-4000-8000-000000000001') ? 'owner_id', 'changed_fields lists owner_id');
update public.leads set deleted_at = now() where id = '40000000-0000-4000-8000-000000000001';
select is((select count(*) from public.events where type = 'lead.deleted' and object_id = '40000000-0000-4000-8000-000000000001'), 1::bigint, 'soft delete emits lead.deleted');
select is((select actor_kind from public.events where type = 'lead.created' limit 1), 'system', 'actor_kind system outside a user session');

-- ---------- versions ----------
insert into public.leads (id, workspace_id, full_name) values ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000a1', 'Version Lead');
select is((select version from public.leads where id = '40000000-0000-4000-8000-000000000002'), 1, 'new rows start at version 1');
update public.leads set city = 'Madurai' where id = '40000000-0000-4000-8000-000000000002';
select is((select version from public.leads where id = '40000000-0000-4000-8000-000000000002'), 2, 'a real change bumps the version');
update public.leads set city = 'Madurai' where id = '40000000-0000-4000-8000-000000000002';
select is((select version from public.leads where id = '40000000-0000-4000-8000-000000000002'), 2, 'a no-op update keeps the version');

-- ---------- events RLS and emit ----------
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select ok((select count(*) from public.events where workspace_id = '20000000-0000-4000-8000-0000000000a1') > 0, 'owner (events.read) sees workspace events');
select lives_ok($$select events.emit('consent.changed', 'lead', '40000000-0000-4000-8000-000000000002', '{}')$$, 'member emits an app-level event');
select throws_ok($$select events.emit('consent.changed', null, null, '{"workspace_id":"20000000-0000-4000-8000-0000000000b1"}')$$, '42501', null, 'cannot emit into a workspace you are not in');
select throws_ok($$select events.emit('Bad Type!', null, null, '{"workspace_id":"20000000-0000-4000-8000-0000000000a1"}')$$, '22023', null, 'invalid event type rejected');
select throws_ok($$insert into public.events (tenant_id, workspace_id, type) values ('10000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'x.y')$$, '42501', null, 'no direct insert into events');
select pg_temp.act('a1000000-0000-4000-8000-000000000004');
select is((select count(*) from public.events), 0::bigint, 'viewer without events.read sees no events');
select pg_temp.act('a1000000-0000-4000-8000-000000000005');
select is((select count(*) from public.events where workspace_id = '20000000-0000-4000-8000-0000000000a1'), 0::bigint, 'owner of another tenant sees none of these events');
reset role;

-- ---------- audit log: append-only ----------
select ok((select count(*) from public.audit_log where source is not null and summary is not null) > 0, 'audit rows carry source and summary');
select throws_ok($$update public.audit_log set summary = 'tampered'$$, '42501', null, 'audit_log update raises');
select throws_ok($$delete from public.audit_log$$, '42501', null, 'audit_log delete raises');
select throws_ok($$truncate public.audit_log$$, '42501', null, 'audit_log truncate raises');
set local role service_role;
select throws_ok($$delete from public.audit_log$$, '42501', null, 'service_role cannot delete audit_log either');
reset role;
select set_config('request.jwt.claim.sub', '', true);   -- back to a service-style session (auth.uid() null)
insert into public.platform_admins (user_id) values ('a1000000-0000-4000-8000-000000000007');
insert into public.support_sessions (id, admin_id, workspace_id, reason, mode, expires_at) values
  ('70000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-0000000000a1', 'pgTAP audit cascade check session', 'read_only', now() + interval '30 minutes');
insert into public.audit_log (tenant_id, workspace_id, action, table_name, support_session_id, summary)
  values ('10000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', 'insert', 'probe', '70000000-0000-4000-8000-000000000001', 'probe row');
select lives_ok($$delete from public.support_sessions where id = '70000000-0000-4000-8000-000000000001'$$, 'FK set-null cascade (depth > 1) is the one allowed audit_log update');
select is((select support_session_id from public.audit_log where summary = 'probe row'), null::uuid, 'probe audit row kept, session reference nulled');

-- ---------- rate limits ----------
select is(public.rate_limit_hit('tap:login:1.2.3.4', 2, 60), true, 'first hit allowed');
select is(public.rate_limit_hit('tap:login:1.2.3.4', 2, 60), true, 'second hit allowed');
select is(public.rate_limit_hit('tap:login:1.2.3.4', 2, 60), false, 'third hit over the limit');
select is(public.rate_limit_hit('tap:login:other', 2, 60), true, 'buckets are independent');
select throws_ok($$select public.rate_limit_hit('', 2, 60)$$, '22023', null, 'invalid bucket rejected');
set local role anon;
select lives_ok($$select public.rate_limit_hit('tap:anon', 5, 60)$$, 'anon may call rate_limit_hit (login throttling)');
select throws_ok($$select count(*) from public.rate_limits$$, '42501', null, 'anon cannot read rate_limits');
reset role;

-- ---------- jobs, idempotency, scheduled jobs ----------
insert into public.job_runs (queue, kind, tenant_id, status, error) values
  ('events', 'fanout', '10000000-0000-4000-8000-0000000000a1', 'failed', 'secret internals'),
  ('events', 'fanout', '10000000-0000-4000-8000-0000000000b1', 'succeeded', null);
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select is((select count(*) from public.v_job_runs_tenant), 1::bigint, 'tenant owner sees only own tenant job runs via the view');
select throws_ok($$select error from public.job_runs$$, '42501', null, 'job error text is not selectable by tenants');
select throws_ok($$select count(*) from public.idempotency_keys$$, '42501', null, 'idempotency_keys is service-only');
select lives_ok($$insert into public.scheduled_jobs (workspace_id, kind, cron) values ('20000000-0000-4000-8000-0000000000a1', 'report', '0 9 * * *')$$, 'owner schedules a job');
select pg_temp.act('a1000000-0000-4000-8000-000000000004');
select throws_ok($$insert into public.scheduled_jobs (workspace_id, kind, cron) values ('20000000-0000-4000-8000-0000000000a1', 'report', '0 9 * * *')$$, '42501', null, 'viewer cannot schedule jobs');
reset role;

select * from finish();
rollback;
