-- pgTAP for 0016_rls_v2. Run on the Supabase branch DB: node scripts/run-pgtap.mjs supabase/tests/0016_rls_v2.test.sql
-- Everything happens inside one transaction and is rolled back.
begin;
select plan(62);

-- ---------- fixture (as postgres) ----------
insert into public.tenants (id, slug, name, brand_name) values
  ('10000000-0000-4000-8000-0000000000c1', 'tap16-a', 'Tap16 A', 'Tap16 A'),
  ('10000000-0000-4000-8000-0000000000d1', 'tap16-b', 'Tap16 B', 'Tap16 B');
insert into public.workspaces (id, tenant_id, name, slug) values
  ('20000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', 'Tap16 A ws', 'tap16-a-ws'),
  ('20000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1', 'Tap16 B ws', 'tap16-b-ws');
insert into auth.users (id, email, email_confirmed_at, aud, role)
select u, 'tap16-' || right(u::text, 2) || '@verify.example', now(), 'authenticated', 'authenticated'
  from unnest(array[
    'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000003',
    'c1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000006',
    'c1000000-0000-4000-8000-000000000007', 'c1000000-0000-4000-8000-000000000008', 'c1000000-0000-4000-8000-000000000009',
    'c1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-00000000000b']::uuid[]) u;
insert into public.profiles (id, full_name, email)
select id, 'Tap16 ' || right(id::text, 2), email from auth.users where email like 'tap16-%@verify.example' on conflict (id) do nothing;
-- 01 owner A, 02 manager A, 03 rep A, 04 viewer A, 05 owner B, 06 data A, 07 platform admin (read_only support),
-- 08 team-scope custom role, 09 platform admin (read_write support), 0a platform admin without session, 0b marketing A
insert into public.memberships (user_id, workspace_id, role) values
  ('c1000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c1', 'owner'),
  ('c1000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000c1', 'sales_manager'),
  ('c1000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-0000000000c1', 'sales_rep'),
  ('c1000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-0000000000c1', 'viewer'),
  ('c1000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-0000000000d1', 'owner'),
  ('c1000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-0000000000c1', 'data'),
  ('c1000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-0000000000c1', 'viewer'),
  ('c1000000-0000-4000-8000-00000000000b', '20000000-0000-4000-8000-0000000000c1', 'marketing');
insert into public.platform_admins (user_id, platform_role) values
  ('c1000000-0000-4000-8000-000000000007', 'super_admin'), ('c1000000-0000-4000-8000-000000000009', 'super_admin'),
  ('c1000000-0000-4000-8000-00000000000a', 'super_admin');
insert into public.territories (workspace_id, district, rep_id) values
  ('20000000-0000-4000-8000-0000000000c1', 'Madurai', 'c1000000-0000-4000-8000-000000000003');
insert into public.support_sessions (admin_id, workspace_id, reason, mode, expires_at) values
  ('c1000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-0000000000c1', 'pgTAP 0016 read only', 'read_only', now() + interval '30 minutes'),
  ('c1000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-0000000000c1', 'pgTAP 0016 read write', 'read_write', now() + interval '30 minutes');
insert into public.teams (id, workspace_id, name, parent_team_id) values
  ('50000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'North', null);
insert into public.team_members (team_id, user_id, is_manager) values
  ('50000000-0000-4000-8000-0000000000c1', 'c1000000-0000-4000-8000-000000000002', true),
  ('50000000-0000-4000-8000-0000000000c1', 'c1000000-0000-4000-8000-000000000008', false);
-- 08 gets a custom role: leads.read at team scope + pii.read
insert into public.roles (id, tenant_id, key, name, base_role) values
  ('60000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1', 'team_reader', 'Team reader', 'viewer');
insert into public.role_permissions (role_id, permission_key, scope) values
  ('60000000-0000-4000-8000-0000000000c1', 'leads.read', 'team'), ('60000000-0000-4000-8000-0000000000c1', 'pii.read', 'all');
update public.memberships set role_id = '60000000-0000-4000-8000-0000000000c1' where user_id = 'c1000000-0000-4000-8000-000000000008';

insert into public.leads (id, workspace_id, full_name, email, district, owner_id) values
  ('40000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'Lead Own', 'own@example.test', 'Madurai', 'c1000000-0000-4000-8000-000000000003'),
  ('40000000-0000-4000-8000-0000000000c2', '20000000-0000-4000-8000-0000000000c1', 'Lead Unassigned', 'un@example.test', 'madurai', null),
  ('40000000-0000-4000-8000-0000000000c3', '20000000-0000-4000-8000-0000000000c1', 'Lead Other', 'ot@example.test', 'Chennai', 'c1000000-0000-4000-8000-000000000002'),
  ('40000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000d1', 'Lead B', 'b@example.test', 'Madurai', null);
insert into public.accounts (id, workspace_id, name, owner_id) values
  ('41000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'Account A', 'c1000000-0000-4000-8000-000000000002'),
  ('41000000-0000-4000-8000-0000000000d1', '20000000-0000-4000-8000-0000000000d1', 'Account B', null);
insert into public.contacts (id, workspace_id, full_name, owner_id) values
  ('42000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'Contact Rep', 'c1000000-0000-4000-8000-000000000003'),
  ('42000000-0000-4000-8000-0000000000c2', '20000000-0000-4000-8000-0000000000c1', 'Contact Mgr', 'c1000000-0000-4000-8000-000000000002');
insert into public.pipeline_stages (id, workspace_id, key, label, position, probability) values
  ('43000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'discovery', 'Discovery', 1, 10);
insert into public.deals (id, workspace_id, name, stage_id, owner_id) values
  ('44000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'Deal Rep', '43000000-0000-4000-8000-0000000000c1', 'c1000000-0000-4000-8000-000000000003'),
  ('44000000-0000-4000-8000-0000000000c2', '20000000-0000-4000-8000-0000000000c1', 'Deal Mgr', '43000000-0000-4000-8000-0000000000c1', 'c1000000-0000-4000-8000-000000000002');
insert into public.tasks (id, workspace_id, title, due_at, assignee_id, created_by) values
  ('45000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'Task Rep', now(), 'c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000002'),
  ('45000000-0000-4000-8000-0000000000c2', '20000000-0000-4000-8000-0000000000c1', 'Task Mgr', now(), 'c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002');
insert into public.activities (id, workspace_id, kind, owner_id) values
  ('46000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'note', 'c1000000-0000-4000-8000-000000000003'),
  ('46000000-0000-4000-8000-0000000000c2', '20000000-0000-4000-8000-0000000000c1', 'note', 'c1000000-0000-4000-8000-000000000002');
insert into public.conversations (id, workspace_id, channel, assignee_id) values
  ('47000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'whatsapp', 'c1000000-0000-4000-8000-000000000003'),
  ('47000000-0000-4000-8000-0000000000c2', '20000000-0000-4000-8000-0000000000c1', 'whatsapp', 'c1000000-0000-4000-8000-000000000002');
insert into public.messages (workspace_id, conversation_id, direction, body) values
  ('20000000-0000-4000-8000-0000000000c1', '47000000-0000-4000-8000-0000000000c1', 'inbound', 'hello');
insert into public.campaigns (id, workspace_id, name, channel, utm_source, utm_medium, utm_campaign) values
  ('48000000-0000-4000-8000-0000000000c1', '20000000-0000-4000-8000-0000000000c1', 'Camp', 'email', 's', 'm', 'c');
insert into public.campaign_daily_metrics (workspace_id, campaign_id, day) values
  ('20000000-0000-4000-8000-0000000000c1', '48000000-0000-4000-8000-0000000000c1', current_date);
insert into public.integrations (workspace_id, provider, label, category, direction) values
  ('20000000-0000-4000-8000-0000000000c1', 'tap16', 'Tap16', 'internal', 'in');

create function pg_temp.act(u uuid, a text default 'aal1') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', a)::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $f$;
create function pg_temp.upd(q text) returns bigint language plpgsql as $f$
declare n bigint; begin execute q; get diagnostics n = row_count; return n; end $f$;

-- ---------- catalogue ----------
select ok(exists (select 1 from public.permissions where key = 'analytics.write'), 'analytics.write exists');
select is((select string_agg(r.key, ',' order by r.key) from public.role_permissions rp join public.roles r on r.id = rp.role_id
            where rp.permission_key = 'analytics.write' and r.tenant_id is null), 'marketing,owner', 'analytics.write seeded for owner and marketing only');
select lives_ok($$select private.rls_v2_swap()$$, 'the policy swap is idempotent');
select ok((select count(*) from pg_policies where schemaname = 'public' and policyname like '%\_select'
            and tablename in ('leads','contacts','accounts','deals','activities','tasks','campaigns','conversations','messages','integrations','pipeline_stages','invitations')) = 12,
          'every managed table has exactly one select policy');
select ok(not exists (select 1 from pg_policies where tablename = 'leads' and policyname in ('leads_select') and qual not like '%authz.ws_with%'), 'leads_select is built on authz.ws_with');
select ok(exists (select 1 from pg_policies where tablename = 'leads' and policyname = 'leads_select' and qual like '%pii.read%'), 'leads_select requires pii.read (viewers use v_leads_masked)');

-- ---------- owner (all scope) ----------
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
select is((select count(*) from public.leads), 3::bigint, 'owner: sees all leads of own workspace, none of tenant B');
select is((select count(*) from public.contacts), 2::bigint, 'owner: contacts');
select is((select count(*) from public.deals), 2::bigint, 'owner: deals');
select is((select count(*) from public.tasks where title like 'Task %'), 2::bigint, 'owner: tasks');
select is((select count(*) from public.activities), 2::bigint, 'owner: activities');
select is((select count(*) from public.conversations), 2::bigint, 'owner: conversations');
select is((select count(*) from public.messages), 1::bigint, 'owner: messages');
select is((select count(*) from public.integrations where provider = 'tap16'), 1::bigint, 'owner: integrations');
select is((select count(*) from public.campaign_daily_metrics), 1::bigint, 'owner: campaign metrics');
select is((select count(*) from public.v_contacts_masked), 2::bigint, 'owner: masked contacts view');
select is((select count(*) from public.v_conversations_masked), 2::bigint, 'owner: masked conversations view');
select is((select count(*) from public.v_messages_masked), 1::bigint, 'owner: masked messages view');
select is(pg_temp.upd($$update public.leads set score = 5 where id = '40000000-0000-4000-8000-0000000000c3'$$), 1::bigint, 'owner: update lead');
select is(pg_temp.upd($$update public.leads set deleted_at = now() where id = '40000000-0000-4000-8000-0000000000c3'$$), 1::bigint, 'owner: soft delete (set deleted_at) works through the client');
select is(pg_temp.upd($$delete from public.leads where id = '40000000-0000-4000-8000-0000000000c3'$$), 1::bigint, 'owner: hard delete lead (member only)');
select throws_ok($$insert into public.leads (workspace_id, full_name, account_id) values ('20000000-0000-4000-8000-0000000000c1', 'X', '41000000-0000-4000-8000-0000000000d1')$$,
  '42501', null, 'owner: cannot reference an account of another tenant');

-- ---------- sales manager ----------
select pg_temp.act('c1000000-0000-4000-8000-000000000002');
select is((select count(*) from public.leads), 2::bigint, 'manager: leads (one deleted above)');
select is(pg_temp.upd($$update public.leads set score = 7 where id = '40000000-0000-4000-8000-0000000000c1'$$), 1::bigint, 'manager: update lead');
select is(pg_temp.upd($$delete from public.leads where id = '40000000-0000-4000-8000-0000000000c1'$$), 0::bigint, 'manager: cannot delete leads (owner only)');
select lives_ok($$insert into public.pipeline_stages (workspace_id, key, label, position, probability) values ('20000000-0000-4000-8000-0000000000c1', 'proposal', 'Proposal', 2, 60)$$,
  'manager: can manage pipeline stages');

-- ---------- sales rep (own scope + territory) ----------
select pg_temp.act('c1000000-0000-4000-8000-000000000003');
select is((select count(*) from public.leads), 2::bigint, 'rep: own lead + unassigned lead in own district (case-insensitive)');
select is((select count(*) from public.contacts), 1::bigint, 'rep: own contact only');
select is((select count(*) from public.deals), 1::bigint, 'rep: own deal only');
select is((select count(*) from public.tasks where title like 'Task %'), 1::bigint, 'rep: assigned task only (system-created follow-ups excluded)');
select is((select count(*) from public.activities), 1::bigint, 'rep: own activity');
select is((select count(*) from public.conversations), 1::bigint, 'rep: assigned conversation');
select is((select count(*) from public.accounts), 1::bigint, 'rep: accounts readable');
select is((select count(*) from public.campaign_daily_metrics), 0::bigint, 'rep: no campaign metrics');
select is((select count(*) from public.v_leads_masked), 0::bigint, 'rep: masked lead view is for all-scope readers');
select is(pg_temp.upd($$update public.leads set score = 9 where id = '40000000-0000-4000-8000-0000000000c1'$$), 1::bigint, 'rep: update own lead');
select throws_ok($$insert into public.leads (workspace_id, full_name, owner_id) values ('20000000-0000-4000-8000-0000000000c1', 'Y', 'c1000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'rep: cannot create a lead owned by someone else');
select lives_ok($$insert into public.leads (workspace_id, full_name, owner_id) values ('20000000-0000-4000-8000-0000000000c1', 'Z', 'c1000000-0000-4000-8000-000000000003')$$,
  'rep: can create an own lead');
select is(pg_temp.upd($$update public.deals set name = 'x' where id = '44000000-0000-4000-8000-0000000000c2'$$), 0::bigint, 'rep: cannot update the manager deal');
select throws_ok($$insert into public.campaigns (workspace_id, name, channel, utm_source, utm_medium, utm_campaign) values ('20000000-0000-4000-8000-0000000000c1', 'n', 'email', 's', 'm', 'c')$$,
  '42501', null, 'rep: cannot create campaigns');
select is((select (public.my_grants('20000000-0000-4000-8000-0000000000c1') -> 'perms' -> 'leads.read' ->> 'territory')::boolean), true, 'my_grants: rep leads.read carries territory');

-- ---------- viewer ----------
select pg_temp.act('c1000000-0000-4000-8000-000000000004');
select is((select count(*) from public.leads), 0::bigint, 'viewer: no raw leads (no pii.read)');
select is((select count(*) from public.v_leads_masked), 3::bigint, 'viewer: masked leads (all but the deleted one)');
select is((select count(*) from public.contacts), 0::bigint, 'viewer: no contacts');
select is((select count(*) from public.deals), 2::bigint, 'viewer: deals readable');
select is((select count(*) from public.activities), 0::bigint, 'viewer: no activities (pii)');
select throws_ok($$insert into public.tasks (workspace_id, title, due_at, assignee_id) values ('20000000-0000-4000-8000-0000000000c1', 't', now(), 'c1000000-0000-4000-8000-000000000004')$$,
  '42501', null, 'viewer: cannot create tasks');

-- ---------- marketing, data, team-scope custom role ----------
select pg_temp.act('c1000000-0000-4000-8000-00000000000b');
select lives_ok($$insert into public.campaigns (workspace_id, name, channel, utm_source, utm_medium, utm_campaign) values ('20000000-0000-4000-8000-0000000000c1', 'mk', 'email', 's', 'm', 'c2')$$, 'marketing: can create campaigns');
select pg_temp.act('c1000000-0000-4000-8000-000000000006');
select is((select count(*) from public.integrations where provider = 'tap16'), 1::bigint, 'data: reads integrations (own scope)');
select pg_temp.act('c1000000-0000-4000-8000-000000000008');
select is((select count(*) from public.leads), 0::bigint, 'team-scope custom role: lead owners outside the team are hidden');

-- ---------- other tenant, support sessions, platform admin ----------
select pg_temp.act('c1000000-0000-4000-8000-000000000005');
select is((select count(*) from public.leads where workspace_id = '20000000-0000-4000-8000-0000000000c1'), 0::bigint, 'owner of tenant B: no leads of tenant A');
select pg_temp.act('c1000000-0000-4000-8000-000000000007', 'aal2');
select is((select count(*) from public.leads), 0::bigint, 'support read_only: acts as viewer, no raw leads');
select is((select count(*) from public.v_leads_masked), 3::bigint, 'support read_only: masked leads');
select throws_ok($$insert into public.leads (workspace_id, full_name) values ('20000000-0000-4000-8000-0000000000c1', 'S')$$, '42501', null, 'support read_only: no writes');
select pg_temp.act('c1000000-0000-4000-8000-000000000009', 'aal2');
select is((select count(*) from public.leads), 3::bigint, 'support read_write: acts as owner');
select is(pg_temp.upd($$delete from public.leads where id = '40000000-0000-4000-8000-0000000000c1'$$), 0::bigint, 'support read_write: cannot hard delete (member only)');
select throws_ok($$insert into public.integrations (workspace_id, provider, label, category, direction) values ('20000000-0000-4000-8000-0000000000c1', 'x', 'x', 'internal', 'in')$$,
  '42501', null, 'support read_write: cannot manage integrations (support blocked)');
select pg_temp.act('c1000000-0000-4000-8000-00000000000a', 'aal2');
select is((select count(*) from public.leads), 0::bigint, 'platform admin without session: no business data');
reset role;

-- ---------- sharing and my_grants ----------
insert into public.relationship_tuples (workspace_id, object_type, object_id, relation, subject_type, subject_id) values
  ('20000000-0000-4000-8000-0000000000c1', 'lead', '40000000-0000-4000-8000-0000000000c1', 'viewer', 'user', 'c1000000-0000-4000-8000-000000000008');
select pg_temp.act('c1000000-0000-4000-8000-000000000008');
select is((select count(*) from public.leads), 1::bigint, 'team-scope role: a viewer share opens exactly the shared lead');
reset role;
update public.org_admin_policies set max_seats = 1, allowed_modules = array['inbox'] where tenant_id = '10000000-0000-4000-8000-0000000000c1';
select pg_temp.act('c1000000-0000-4000-8000-000000000001');
select ok((public.my_grants('20000000-0000-4000-8000-0000000000c1') -> 'policy' -> 'capped') ? 'members.invite', 'my_grants: seat cap reached lists members.invite as capped');
select ok((public.my_grants('20000000-0000-4000-8000-0000000000c1') -> 'policy' -> 'modules_off') ? 'analytics', 'my_grants: modules outside allowed_modules are listed as off');
select ok(not ((public.my_grants('20000000-0000-4000-8000-0000000000c1') -> 'policy' -> 'modules_off') ? 'inbox'), 'my_grants: allowed module is not off');
reset role;

select * from finish();
rollback;
