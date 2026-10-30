-- pgTAP for 0018_collab_realtime. Run on the Supabase branch DB: node scripts/run-pgtap.mjs supabase/tests/0018_collab_realtime.test.sql
-- Everything happens inside one transaction and is rolled back.
begin;
select plan(59);

-- ---------- fixture (as postgres) ----------
insert into public.tenants (id, slug, name, brand_name) values
  ('10000000-0000-4000-8000-0000000000a8', 'tap18-a', 'Tap18 A', 'Tap18 A'),
  ('10000000-0000-4000-8000-0000000000b8', 'tap18-b', 'Tap18 B', 'Tap18 B');
insert into public.workspaces (id, tenant_id, name, slug) values
  ('20000000-0000-4000-8000-0000000000a8', '10000000-0000-4000-8000-0000000000a8', 'Tap18 A ws', 'tap18-a-ws'),
  ('20000000-0000-4000-8000-0000000000b8', '10000000-0000-4000-8000-0000000000b8', 'Tap18 B ws', 'tap18-b-ws');
insert into auth.users (id, email, email_confirmed_at, aud, role)
select u, 'tap18-' || right(u::text, 2) || '@verify.example', now(), 'authenticated', 'authenticated'
  from unnest(array[
    'a8000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000002', 'a8000000-0000-4000-8000-000000000003',
    'a8000000-0000-4000-8000-000000000004', 'a8000000-0000-4000-8000-000000000005']::uuid[]) u;
insert into public.profiles (id, full_name, email)
select id, 'Tap18 ' || right(id::text, 2), email from auth.users where email like 'tap18-%@verify.example' on conflict (id) do nothing;
-- 01 owner A, 02 manager A (comments.moderate), 03 rep A, 04 viewer A, 05 owner B
insert into public.memberships (user_id, workspace_id, role) values
  ('a8000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a8', 'owner'),
  ('a8000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000a8', 'sales_manager'),
  ('a8000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-0000000000a8', 'sales_rep'),
  ('a8000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-0000000000a8', 'viewer'),
  ('a8000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-0000000000b8', 'owner');
insert into public.leads (id, workspace_id, full_name, owner_id) values
  ('40000000-0000-4000-8000-0000000000a8', '20000000-0000-4000-8000-0000000000a8', 'Lead Rep', 'a8000000-0000-4000-8000-000000000003'),
  ('40000000-0000-4000-8000-0000000000a9', '20000000-0000-4000-8000-0000000000a8', 'Lead Mgr', 'a8000000-0000-4000-8000-000000000002');

create function pg_temp.act(u uuid, a text default 'aal1') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', a)::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $f$;
create function pg_temp.clear() returns void language sql as $f$
  select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true), set_config('role', 'postgres', true) $f$;
create function pg_temp.upd(q text) returns bigint language plpgsql as $f$
declare n bigint; begin execute q; get diagnostics n = row_count; return n; end $f$;

-- ---------- structure ----------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname in ('comments','notifications','notification_prefs','notification_rules','follows') and c.relrowsecurity),
          5::bigint, 'RLS enabled on all five new tables');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'), 'notifications are published to supabase_realtime');
select ok(exists (select 1 from pg_trigger where tgname = 'z7_leads_rt' and not tgisinternal), 'leads broadcast trigger installed');
select ok(exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'realtime_ws_members_select'), 'realtime select policy exists');
select ok(exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'realtime_ws_members_insert'), 'realtime insert policy exists');

-- ---------- comments ----------
select pg_temp.act('a8000000-0000-4000-8000-000000000001');
select lives_ok($$insert into public.comments (workspace_id, object_type, object_id, body) values
  ('20000000-0000-4000-8000-0000000000a8', 'lead', '40000000-0000-4000-8000-0000000000a9', 'First note')$$, 'owner comments on a lead');
select lives_ok($$insert into public.comments (id, workspace_id, object_type, object_id, body, mentions) values
  ('c8000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a8', 'lead', '40000000-0000-4000-8000-0000000000a9', 'Please look @manager', array['a8000000-0000-4000-8000-000000000002']::uuid[])$$,
  'owner mentions a user who can read the record');
select throws_ok($$insert into public.comments (workspace_id, object_type, object_id, body, mentions) values
  ('20000000-0000-4000-8000-0000000000a8', 'lead', '40000000-0000-4000-8000-0000000000a9', 'x', array['a8000000-0000-4000-8000-000000000005']::uuid[])$$,
  '42501', 'mention_not_allowed%', 'a mention of a user outside the workspace is rejected with a reason');
select throws_ok($$insert into public.comments (workspace_id, object_type, object_id, body, author_id) values
  ('20000000-0000-4000-8000-0000000000a8', 'lead', '40000000-0000-4000-8000-0000000000a9', 'forged', 'a8000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'author must be the caller');
select throws_ok($$insert into public.comments (workspace_id, object_type, object_id, body) values
  ('20000000-0000-4000-8000-0000000000a8', 'lead', '40000000-0000-4000-8000-0000000000a9', '')$$, '23514', null, 'empty body rejected');
select throws_ok($$insert into public.comments (workspace_id, object_type, object_id, body, parent_id) values
  ('20000000-0000-4000-8000-0000000000a8', 'lead', '40000000-0000-4000-8000-0000000000a8', 'reply', 'c8000000-0000-4000-8000-000000000001')$$,
  '23514', null, 'a reply must stay on the same record');
select lives_ok($$insert into public.comments (workspace_id, object_type, object_id, body, parent_id) values
  ('20000000-0000-4000-8000-0000000000a8', 'lead', '40000000-0000-4000-8000-0000000000a9', 'reply', 'c8000000-0000-4000-8000-000000000001')$$, 'reply on the same record');
select is((select count(*) from public.comments), 3::bigint, 'owner reads all comments');
select is(pg_temp.upd($$update public.comments set body = 'edited' where id = 'c8000000-0000-4000-8000-000000000001'$$), 1::bigint, 'author edits within 15 minutes');
select ok((select edited_at is not null from public.comments where id = 'c8000000-0000-4000-8000-000000000001'), 'edit stamps edited_at');
select throws_ok($$update public.comments set object_id = '40000000-0000-4000-8000-0000000000a8' where id = 'c8000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'only body, mentions and deleted_at are writable');
select is((select count(*) from public.follows where object_id = '40000000-0000-4000-8000-0000000000a9'), 1::bigint, 'the author follows the record she commented on');
reset role;
select ok((select count(*) from public.follows where object_id = '40000000-0000-4000-8000-0000000000a9') = 2, 'the mentioned user follows the record too');
select ok((select count(*) from public.events where type = 'comment.created') >= 3, 'comment.created events are emitted');
select ok((select count(*) from public.events where type = 'mention.created') = 1, 'mention.created event is emitted');

select pg_temp.act('a8000000-0000-4000-8000-000000000003');
select is((select count(*) from public.comments where object_id = '40000000-0000-4000-8000-0000000000a9'), 0::bigint, 'rep cannot read comments on a lead she cannot read');
select lives_ok($$insert into public.comments (workspace_id, object_type, object_id, body) values
  ('20000000-0000-4000-8000-0000000000a8', 'lead', '40000000-0000-4000-8000-0000000000a8', 'rep note')$$, 'rep comments on her own lead');
select throws_ok($$insert into public.comments (workspace_id, object_type, object_id, body) values
  ('20000000-0000-4000-8000-0000000000a8', 'lead', '40000000-0000-4000-8000-0000000000a9', 'sneak')$$, '42501', null, 'rep cannot comment on a lead she cannot read');
select pg_temp.act('a8000000-0000-4000-8000-000000000004');
select throws_ok($$insert into public.comments (workspace_id, object_type, object_id, body) values
  ('20000000-0000-4000-8000-0000000000a8', 'lead', '40000000-0000-4000-8000-0000000000a9', 'viewer note')$$, '42501', null, 'viewer has no comments.write');
select pg_temp.act('a8000000-0000-4000-8000-000000000005');
select is((select count(*) from public.comments), 0::bigint, 'other tenant reads no comments');
reset role;

-- edit window and moderation
select pg_temp.clear();
update public.comments set created_at = now() - interval '20 minutes' where body = 'rep note';
select pg_temp.act('a8000000-0000-4000-8000-000000000003');
select is(pg_temp.upd($$update public.comments set body = 'too late' where body = 'rep note'$$), 0::bigint, 'author cannot edit after 15 minutes');
select is(pg_temp.upd($$delete from public.comments where body = 'rep note'$$), 0::bigint, 'author cannot delete after 15 minutes');
select lives_ok($$insert into public.comments (workspace_id, object_type, object_id, body) values ('20000000-0000-4000-8000-0000000000a8', 'lead', '40000000-0000-4000-8000-0000000000a8', 'rep note 2')$$, 'rep writes another comment');
select is(pg_temp.upd($$delete from public.comments where body = 'rep note 2'$$), 1::bigint, 'author deletes her own recent comment');
select pg_temp.act('a8000000-0000-4000-8000-000000000002');
select is(pg_temp.upd($$delete from public.comments where body = 'rep note'$$), 1::bigint, 'moderator (comments.moderate) removes any comment');
select is(pg_temp.upd($$delete from public.comments where id = 'c8000000-0000-4000-8000-000000000001'$$), 1::bigint, 'moderator removes a thread root (replies cascade)');
reset role;

-- ---------- notifications ----------
select pg_temp.act('a8000000-0000-4000-8000-000000000002');
select is((select count(*) from public.notifications where kind = 'mention'), 1::bigint, 'mentioned manager has a mention notification');
select ok((select count(*) from public.notifications) >= 1, 'followers are notified of new comments');
select is(pg_temp.upd($$update public.notifications set read_at = now() where kind = 'mention'$$), 1::bigint, 'user marks a notification read');
select throws_ok($$update public.notifications set title = '{}' where kind = 'mention'$$, '42501', null, 'only read_at is writable by the user');
select throws_ok($$insert into public.notifications (workspace_id, user_id, kind) values ('20000000-0000-4000-8000-0000000000a8', 'a8000000-0000-4000-8000-000000000002', 'x')$$,
  '42501', null, 'users cannot create notifications');
select pg_temp.act('a8000000-0000-4000-8000-000000000003');
select is((select count(*) from public.notifications where kind = 'mention'), 0::bigint, 'a user never reads someone else notifications');
select pg_temp.act('a8000000-0000-4000-8000-000000000002');
select lives_ok($$insert into public.notification_prefs (user_id, workspace_id, kind, channels, digest) values
  ('a8000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000a8', 'mention', '{in_app,email}', 'hourly')$$, 'user sets own preferences');
select throws_ok($$insert into public.notification_prefs (user_id, workspace_id, kind) values
  ('a8000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-0000000000a8', 'mention')$$, '42501', null, 'preferences of others cannot be written');
select throws_ok($$insert into public.notification_prefs (user_id, workspace_id, kind, channels) values
  ('a8000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000a8', 'x', '{carrier_pigeon}')$$, '23514', null, 'unknown channel rejected');
select lives_ok($$insert into public.follows (user_id, object_type, object_id) values ('a8000000-0000-4000-8000-000000000002', 'lead', '40000000-0000-4000-8000-0000000000a8')$$, 'user follows a record');
select throws_ok($$insert into public.follows (user_id, object_type, object_id) values ('a8000000-0000-4000-8000-000000000003', 'lead', '40000000-0000-4000-8000-0000000000a8')$$,
  '42501', null, 'cannot make someone else follow a record');
select pg_temp.act('a8000000-0000-4000-8000-000000000001');
select lives_ok($$insert into public.notification_rules (workspace_id, event_type, recipients) values ('20000000-0000-4000-8000-0000000000a8', 'lead.created', '["owner","followers"]')$$, 'owner writes a notification rule');
select pg_temp.act('a8000000-0000-4000-8000-000000000003');
select throws_ok($$insert into public.notification_rules (workspace_id, event_type) values ('20000000-0000-4000-8000-0000000000a8', 'lead.created')$$, '42501', null, 'rep cannot write notification rules');
select is((select count(*) from public.notification_rules), 0::bigint, 'rep cannot read notification rules');

-- ---------- activity feed ----------
select ok(not exists (select 1 from public.v_activity_feed f where f.object_type = 'lead' and f.object_id not in (select id from public.leads)),
          'activity feed only lists events of records the rep can read');
select ok(exists (select 1 from public.v_activity_feed f where f.object_type = 'lead' and f.object_id = '40000000-0000-4000-8000-0000000000a8'),
          'the rep sees the events of her own lead');
reset role;

-- ---------- realtime ----------
select pg_temp.clear();
insert into realtime.messages (topic, extension, payload, event, private) values
  ('ws:20000000-0000-4000-8000-0000000000a8:tbl:leads', 'broadcast', '{}', 'x', true);
select pg_temp.act('a8000000-0000-4000-8000-000000000003');
select set_config('realtime.topic', 'ws:20000000-0000-4000-8000-0000000000a8:rec:lead:1', true);
select ok((select count(*) from realtime.messages) >= 1, 'members can read their workspace topics');
select lives_ok($$insert into realtime.messages (topic, extension, payload, event, private) values ('ws:20000000-0000-4000-8000-0000000000a8:board:1', 'presence', '{}', 'x', true)$$,
  'members can send on their workspace topics');
select set_config('realtime.topic', 'ws:20000000-0000-4000-8000-0000000000b8:rec:lead:1', true);
select is((select count(*) from realtime.messages), 0::bigint, 'other workspace topics are invisible');
select throws_ok($$insert into realtime.messages (topic, extension, payload, event, private) values ('ws:20000000-0000-4000-8000-0000000000b8:board:1', 'presence', '{}', 'x', true)$$,
  '42501', null, 'cannot send on another workspace topic');
select set_config('realtime.topic', 'lobby', true);
select is((select count(*) from realtime.messages), 0::bigint, 'non-workspace topics are denied (and do not error)');
reset role;

-- broadcast payload is id-only
select pg_temp.clear();
delete from realtime.messages;
update public.leads set city = 'Madurai' where id = '40000000-0000-4000-8000-0000000000a8';
select ok(exists (select 1 from realtime.messages where topic = 'ws:20000000-0000-4000-8000-0000000000a8:tbl:leads' and payload ->> 'id' = '40000000-0000-4000-8000-0000000000a8'
                    and payload ->> 'op' = 'UPDATE' and payload -> 'changed_fields' ? 'city'), 'row change is broadcast with id, op and changed field names');
select ok(not exists (select 1 from realtime.messages where payload ? 'full_name' or payload ? 'email' or payload ? 'new' or payload ? 'old'), 'the broadcast payload carries no row data');

select ok(exists (select 1 from public.event_types where type = 'lead.exported'), 'lead.exported event type registered');

-- ---------- queue_health ----------
select ok((public.queue_health() -> 'oldest_age_s') ? 'events', 'queue_health lists the events queue');
select is(((public.queue_health() ->> 'failed_1h')::int), 0, 'queue_health: no failed jobs');
select pg_temp.clear();
insert into public.job_runs (queue, kind, status) values ('events', 'x', 'failed'), ('events', 'x', 'dead'), ('events', 'x', 'succeeded');
select is(((public.queue_health() ->> 'failed_1h')::int), 2, 'queue_health counts failed and dead job runs of the last hour');
select pg_temp.act('a8000000-0000-4000-8000-000000000001');
select throws_ok($$select public.queue_health()$$, '42501', null, 'queue_health is service-role only');
reset role;

select * from finish();
rollback;
