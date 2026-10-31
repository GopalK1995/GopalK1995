-- pgTAP for 0013_authz_core. Run on the Supabase branch DB: node scripts/run-pgtap.mjs supabase/tests/0013_authz_core.test.sql
-- (or `supabase test db`). Everything happens inside one transaction and is rolled back.
begin;
select plan(73);

-- ---------- fixture (as postgres) ----------
insert into public.tenants (id, slug, name, brand_name) values
  ('10000000-0000-4000-8000-0000000000a1', 'tap-a', 'Tap A', 'Tap A'),
  ('10000000-0000-4000-8000-0000000000b1', 'tap-b', 'Tap B', 'Tap B');
insert into public.workspaces (id, tenant_id, name, slug) values
  ('20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Tap A ws', 'tap-a-ws'),
  ('20000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1', 'Tap B ws', 'tap-b-ws');
insert into auth.users (id, email, email_confirmed_at, aud, role)
select u, 'tap-' || right(u::text, 2) || '@verify.example', now(), 'authenticated', 'authenticated'
  from unnest(array[
    'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000006',
    'a1000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000009',
    'a1000000-0000-4000-8000-00000000000a']::uuid[]) u;
insert into public.profiles (id, full_name, email)
select id, 'Tap ' || right(id::text, 2), email from auth.users where email like 'tap-%@verify.example'
on conflict (id) do nothing;
-- 01 owner A, 02 manager A, 03 rep A, 04 viewer A, 05 owner B, 06 data A, 07 platform super_admin, 08 custom-role holder A,
-- 09 platform super_admin #2, 0a platform 'support' admin
insert into public.memberships (user_id, workspace_id, role) values
  ('a1000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a1', 'owner'),
  ('a1000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000a1', 'sales_manager'),
  ('a1000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-0000000000a1', 'sales_rep'),
  ('a1000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-0000000000a1', 'viewer'),
  ('a1000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-0000000000b1', 'owner'),
  ('a1000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-0000000000a1', 'data'),
  ('a1000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-0000000000a1', 'viewer');
insert into public.platform_admins (user_id, platform_role) values
  ('a1000000-0000-4000-8000-000000000007', 'super_admin'),
  ('a1000000-0000-4000-8000-000000000009', 'super_admin'),
  ('a1000000-0000-4000-8000-00000000000a', 'support');
insert into public.territories (workspace_id, district, rep_id) values
  ('20000000-0000-4000-8000-0000000000a1', 'Madurai', 'a1000000-0000-4000-8000-000000000003');
insert into public.leads (id, workspace_id, full_name, district) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a1', 'Lead Own', 'Madurai'),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000a1', 'Lead Unassigned', 'Madurai'),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-0000000000a1', 'Lead Other', 'Chennai');
update public.leads set owner_id = 'a1000000-0000-4000-8000-000000000003' where id = '40000000-0000-4000-8000-000000000001';
update public.leads set owner_id = null where id = '40000000-0000-4000-8000-000000000002';
update public.leads set owner_id = 'a1000000-0000-4000-8000-000000000002' where id = '40000000-0000-4000-8000-000000000003';
insert into public.support_sessions (admin_id, workspace_id, reason, mode, expires_at) values
  ('a1000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-0000000000a1', 'pgTAP read only support check', 'read_only', now() + interval '30 minutes'),
  ('a1000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-0000000000a1', 'pgTAP read write support check', 'read_write', now() + interval '30 minutes');
-- teams: T1 (manager 02, member 06) > T2 (member 03)
insert into public.teams (id, workspace_id, name, parent_team_id) values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000a1', 'Sales North', null);
insert into public.teams (id, workspace_id, name, parent_team_id) values
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000a1', 'Sales Madurai', '50000000-0000-4000-8000-000000000001');
insert into public.team_members (team_id, user_id, is_manager) values
  ('50000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', true),
  ('50000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000006', false),
  ('50000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', false);
-- custom role in tenant A: leads.read/leads.write at all, write only for the member's own districts
insert into public.roles (id, tenant_id, key, name, base_role) values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a1', 'district_writer', 'District writer', 'sales_rep');
insert into public.role_permissions (role_id, permission_key, scope, conditions) values
  ('60000000-0000-4000-8000-000000000001', 'leads.read', 'all', '{}'),
  ('60000000-0000-4000-8000-000000000001', 'leads.write', 'all',
   '{"all":[{"field":"record.district","op":"in","value":"@principal.attrs.districts"}]}');
update public.memberships set role_id = '60000000-0000-4000-8000-000000000001', attributes = '{"districts":["Madurai"]}'
 where user_id = 'a1000000-0000-4000-8000-000000000008';
-- tuples: viewer share of lead 3 to rep 03 (live) and an expired one on lead 1 to viewer 04
insert into public.relationship_tuples (workspace_id, object_type, object_id, relation, subject_type, subject_id) values
  ('20000000-0000-4000-8000-0000000000a1', 'lead', '40000000-0000-4000-8000-000000000003', 'viewer', 'user', 'a1000000-0000-4000-8000-000000000003');
insert into public.relationship_tuples (workspace_id, object_type, object_id, relation, subject_type, subject_id, expires_at) values
  ('20000000-0000-4000-8000-0000000000a1', 'lead', '40000000-0000-4000-8000-000000000001', 'viewer', 'user', 'a1000000-0000-4000-8000-000000000004', now() - interval '1 hour');

create function pg_temp.act(u uuid, a text default 'aal1') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', a)::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $f$;

-- ---------- catalogue and system roles (as postgres) ----------
select is((select count(*) from public.roles where tenant_id is null and is_system), 6::bigint, 'six system roles');
select is((select count(*) from public.permissions), 75::bigint, 'permission catalogue seeded');
select is((select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id
            where r.key = 'viewer' and r.tenant_id is null and rp.permission_key = 'pii.read'), 0::bigint, 'viewer has no pii.read');
select is((select scope from public.role_permissions rp join public.roles r on r.id = rp.role_id
            where r.key = 'sales_rep' and r.tenant_id is null and rp.permission_key = 'leads.write'), 'own', 'rep writes own leads only');
select is((select count(*) from public.permissions p where p.support_blocked and p.key in
            ('leads.export','org.branding','integrations.manage','privacy.fulfil','ai.toggle','org.admin','members.manage')), 7::bigint,
          'every SUPPORT_BLOCKED action maps to a support_blocked permission');
select is((select r.key from public.memberships m join public.roles r on r.id = m.role_id
            where m.user_id = 'a1000000-0000-4000-8000-000000000003'), 'sales_rep', 'membership role_id backfilled/synced from the enum');
select is((select attributes->'districts' from public.memberships where user_id = 'a1000000-0000-4000-8000-000000000008'),
          '["Madurai"]'::jsonb, 'attributes jsonb stored');
select is((select attributes->'districts' from public.memberships where user_id = 'a1000000-0000-4000-8000-000000000003'), '["Madurai"]'::jsonb, 'territories feed memberships.attributes.districts (trigger)');
select is((select count(*) from public.org_admin_policies), (select count(*) from public.tenants), 'one org policy row per tenant (trigger)');

-- ---------- conditions grammar (pure functions) ----------
select ok(authz.valid_conditions('{}'), 'empty conditions are valid');
select ok(authz.valid_conditions('{"all":[{"field":"record.x","op":"eq","value":1}]}'), 'simple clause valid');
select ok(not authz.valid_conditions('{"all":[{"field":"record.x","op":"regex","value":"a"}]}'), 'unknown operator invalid');
select ok(not authz.valid_conditions('{"all":[{"field":"env.x","op":"eq","value":"a"}]}'), 'unknown field prefix invalid');
select ok(not authz.valid_conditions('{"all":[{"all":[{"all":[]}]}]}'), 'depth over 2 invalid');
select ok(authz.eval_node('{"all":[{"field":"record.n","op":"gte","value":5},{"field":"record.n","op":"lte","value":9}]}', '{"n":7}', '{}', now()), 'gte and lte');
select ok(not authz.eval_node('{"all":[{"field":"record.n","op":"gte","value":5}]}', '{"n":4}', '{}', now()), 'gte false');
select ok(authz.eval_node('{"any":[{"field":"record.s","op":"eq","value":"a"},{"field":"record.s","op":"eq","value":"b"}]}', '{"s":"b"}', '{}', now()), 'any');
select ok(authz.eval_node('{"all":[{"field":"record.s","op":"nin","value":["x","y"]}]}', '{"s":"z"}', '{}', now()), 'nin');
select ok(authz.eval_node('{"all":[{"field":"record.tags","op":"contains","value":"vip"}]}', '{"tags":["a","vip"]}', '{}', now()), 'contains on arrays');
select ok(authz.eval_node('{"all":[{"field":"record.ok","op":"is_true"}]}', '{"ok":true}', '{}', now()), 'is_true');
select ok(authz.eval_node('{"all":[{"field":"now","op":"between_hours","value":["09:00","20:00"],"tz":"Asia/Kolkata"}]}', '{}', '{}', timestamptz '2026-01-05 10:00:00+05:30'), 'between_hours inside the window');
select ok(not authz.eval_node('{"all":[{"field":"now","op":"between_hours","value":["09:00","20:00"],"tz":"Asia/Kolkata"}]}', '{}', '{}', timestamptz '2026-01-05 23:00:00+05:30'), 'between_hours outside the window');
select ok(not authz.eval_node('{"all":[{"field":"record.s","op":"bogus","value":"a"}]}', '{"s":"a"}', '{}', now()), 'unknown operator evaluates to false (fail closed)');
select ok(not authz.eval_node('{"all":[{"field":"record.missing","op":"eq","value":"a"}]}', '{}', '{}', now()), 'missing field evaluates to false');
select throws_ok($$insert into public.role_permissions (role_id, permission_key, scope, conditions) values
  ('60000000-0000-4000-8000-000000000001', 'leads.delete', 'all', '{"all":[{"field":"record.x","op":"nope","value":1}]}')$$,
  '23514', null, 'check constraint rejects invalid conditions');

-- ---------- ws_with per role ----------
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select is((select count(*) from authz.ws_with('leads.assign', 'all')), 1::bigint, 'owner: leads.assign at all in own workspace only');
select pg_temp.act('a1000000-0000-4000-8000-000000000003');
select is((select count(*) from authz.ws_with('leads.read', 'all')), 0::bigint, 'rep: no leads.read at scope all');
select is((select count(*) from authz.ws_with('leads.read', 'own')), 1::bigint, 'rep: leads.read at scope own');
select is((select count(*) from authz.ws_with('leads.export', 'own')), 0::bigint, 'rep: no leads.export');
select pg_temp.act('a1000000-0000-4000-8000-000000000004');
select is((select count(*) from authz.ws_with('leads.write', 'own')), 0::bigint, 'viewer: no leads.write');
select is((select count(*) from authz.ws_with('leads.read', 'all')), 1::bigint, 'viewer: leads.read (masked) at all');
select pg_temp.act('a1000000-0000-4000-8000-000000000005');
select is((select count(*) from authz.ws_with('leads.read', 'all') w where w = '20000000-0000-4000-8000-0000000000a1'), 0::bigint, 'owner of tenant B sees nothing in tenant A');

-- ---------- team_user_ids recursion ----------
select pg_temp.act('a1000000-0000-4000-8000-000000000002');
select is((select count(*) from authz.team_user_ids('20000000-0000-4000-8000-0000000000a1')), 3::bigint, 'manager of T1 sees self, T1 members and the child team T2 members');
select pg_temp.act('a1000000-0000-4000-8000-000000000003');
select is((select count(*) from authz.team_user_ids('20000000-0000-4000-8000-0000000000a1')), 1::bigint, 'member of the child team sees only herself');
select pg_temp.act('a1000000-0000-4000-8000-000000000006');
select is((select count(*) from authz.team_user_ids('20000000-0000-4000-8000-0000000000a1')), 2::bigint, 'non-manager member sees team mates but not the child team');

-- ---------- shared_ids and expiry ----------
select pg_temp.act('a1000000-0000-4000-8000-000000000003');
select is((select count(*) from authz.shared_ids('lead', 'viewer')), 1::bigint, 'rep sees the live viewer share');
select is((select count(*) from authz.shared_ids('lead', 'editor')), 0::bigint, 'viewer share is not editor');
select pg_temp.act('a1000000-0000-4000-8000-000000000004');
select is((select count(*) from authz.shared_ids('lead', 'viewer')), 0::bigint, 'expired share is ignored');
reset role;
select throws_ok($$insert into public.relationship_tuples (workspace_id, object_type, object_id, relation, subject_type, subject_id)
  values ('20000000-0000-4000-8000-0000000000b1', 'lead', '40000000-0000-4000-8000-000000000001', 'viewer', 'user', 'a1000000-0000-4000-8000-000000000005')$$,
  '23514', null, 'a tuple cannot point at an object of another workspace');

-- ---------- check / explain (RBAC + ReBAC + ABAC) ----------
select pg_temp.act('a1000000-0000-4000-8000-000000000003');
select ok(authz.check('20000000-0000-4000-8000-0000000000a1', 'leads.read', 'lead', '40000000-0000-4000-8000-000000000001'), 'rep reads own lead');
select ok(authz.check('20000000-0000-4000-8000-0000000000a1', 'leads.read', 'lead', '40000000-0000-4000-8000-000000000002'), 'rep reads unassigned lead in own territory');
select ok(not authz.check('20000000-0000-4000-8000-0000000000a1', 'leads.write', 'lead', '40000000-0000-4000-8000-000000000002'), 'rep cannot write the unassigned lead');
select ok(authz.check('20000000-0000-4000-8000-0000000000a1', 'leads.read', 'lead', '40000000-0000-4000-8000-000000000003'), 'rep reads a lead shared with her');
select ok(not authz.check('20000000-0000-4000-8000-0000000000a1', 'leads.write', 'lead', '40000000-0000-4000-8000-000000000003'), 'viewer share does not allow writes');
select ok(not authz.check('20000000-0000-4000-8000-0000000000a1', 'leads.assign'), 'rep cannot assign leads');
select is(authz.explain('20000000-0000-4000-8000-0000000000a1', 'leads.assign')->>'reason', 'no_grant', 'explain gives the reason');
select pg_temp.act('a1000000-0000-4000-8000-000000000008');
select ok(authz.check('20000000-0000-4000-8000-0000000000a1', 'leads.write', 'lead', '40000000-0000-4000-8000-000000000001'), 'custom role: condition district in my districts passes');
select ok(not authz.check('20000000-0000-4000-8000-0000000000a1', 'leads.write', 'lead', '40000000-0000-4000-8000-000000000003'), 'custom role: condition fails for another district');
select ok(authz.cond_ok('20000000-0000-4000-8000-0000000000a1', 'leads.write', '{"district":"Madurai"}'), 'cond_ok true');
select ok(not authz.cond_ok('20000000-0000-4000-8000-0000000000a1', 'leads.write', '{"district":"Chennai"}'), 'cond_ok false');

-- ---------- support sessions (overlay) ----------
select pg_temp.act('a1000000-0000-4000-8000-000000000007', 'aal2');
select is((select count(*) from authz.ws_with('leads.read', 'all')), 1::bigint, 'read_only support acts as viewer: reads');
select is((select count(*) from authz.ws_with('leads.write', 'own')), 0::bigint, 'read_only support cannot write');
select pg_temp.act('a1000000-0000-4000-8000-000000000009', 'aal2');
select is((select count(*) from authz.ws_with('leads.write', 'all')), 1::bigint, 'read_write support acts as owner: writes');
select is((select count(*) from authz.ws_with('leads.export', 'own')), 0::bigint, 'read_write support: supportBlocked permission denied');
select is((select count(*) from authz.ws_with_member('leads.write', 'own')), 0::bigint, 'ws_with_member never counts a support session');

-- ---------- RLS on the new tables ----------
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select lives_ok($$insert into public.roles (tenant_id, key, name, base_role) values ('10000000-0000-4000-8000-0000000000a1', 'qa_lead', 'QA lead', 'sales_rep')$$, 'owner creates a custom role in own tenant');
select throws_ok($$insert into public.roles (tenant_id, key, name, base_role) values ('10000000-0000-4000-8000-0000000000b1', 'qa_lead', 'QA lead', 'sales_rep')$$, '42501', null, 'owner cannot create a role in another tenant');
select lives_ok($$update public.roles set name = 'Hacked owner' where tenant_id is null and key = 'owner'$$, 'update of a system role is accepted but matches no row');
select is((select name from public.roles where tenant_id is null and key = 'owner'), 'Owner', 'system roles are read-only (RLS)');
select pg_temp.act('a1000000-0000-4000-8000-000000000002');
select throws_ok($$insert into public.roles (tenant_id, key, name, base_role) values ('10000000-0000-4000-8000-0000000000a1', 'mgr_made', 'Manager made', 'sales_rep')$$, '42501', null, 'manager without roles.manage cannot create a role');
select throws_ok($$update public.memberships set role_id = '60000000-0000-4000-8000-000000000001' where user_id = 'a1000000-0000-4000-8000-000000000004'$$, '42501', null, 'custom roles need roles.manage');
select ok(not authz.role_within_caller('20000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-000000000001'), 'manager cannot hand out the owner role (more permissions than held)');
select pg_temp.act('a1000000-0000-4000-8000-000000000004');
select is((select count(*) from public.permissions), 75::bigint, 'authenticated reads the catalogue');
select throws_ok($$insert into public.permissions (key, resource, action) values ('x.y', 'x', 'y')$$, '42501', null, 'authenticated cannot write the catalogue');
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select lives_ok($$update public.memberships set role_id = '60000000-0000-4000-8000-000000000001' where user_id = 'a1000000-0000-4000-8000-000000000004'$$, 'owner assigns a custom role');
select is((select role::text from public.memberships where user_id = 'a1000000-0000-4000-8000-000000000004'), 'sales_rep', 'enum role follows the custom role base_role');
select throws_ok($$update public.memberships set role_id = '60000000-0000-4000-8000-000000000001' where user_id = 'a1000000-0000-4000-8000-000000000001'$$, '42501', null, 'nobody changes their own role');

-- ---------- org admin policy (super admin only, audited, gates custom roles) ----------
select pg_temp.act('a1000000-0000-4000-8000-00000000000a', 'aal2');
select throws_ok($$select public.admin_set_org_admin_policy('10000000-0000-4000-8000-0000000000a1', '{"allow_custom_roles":false}', 'support admin must be refused')$$, '42501', null, 'only super_admin may set org policies');
select pg_temp.act('a1000000-0000-4000-8000-000000000007', 'aal2');
select throws_ok($$select public.admin_set_org_admin_policy('10000000-0000-4000-8000-0000000000a1', '{"allow_custom_roles":false}', 'x')$$, '22023', null, 'a reason is required');
select lives_ok($$select public.admin_set_org_admin_policy('10000000-0000-4000-8000-0000000000a1', '{"allow_custom_roles":false}', 'tighten tenant for pgTAP')$$, 'super_admin sets the policy');
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select throws_ok($$insert into public.roles (tenant_id, key, name, base_role) values ('10000000-0000-4000-8000-0000000000a1', 'after_policy', 'After policy', 'sales_rep')$$, '42501', null, 'allow_custom_roles = false blocks role creation');

-- ---------- anon ----------
reset role;
set local role anon;
select throws_ok($$select count(*) from public.roles$$, '42501', null, 'anon cannot read roles');
select throws_ok($$select count(*) from authz.ws_with('leads.read')$$, '42501', null, 'anon cannot execute authz helpers');
reset role;

select * from finish();
rollback;
