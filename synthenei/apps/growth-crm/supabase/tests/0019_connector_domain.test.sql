-- pgTAP for 0019_connector_domain. Run on the Supabase branch DB: node scripts/run-pgtap.mjs supabase/tests/0019_connector_domain.test.sql
-- Everything happens inside one transaction and is rolled back.
begin;
select plan(95);

-- ---------- fixture (as postgres) ----------
insert into public.tenants (id, slug, name, brand_name) values
  ('10000000-0000-4000-8000-0000000000c9', 'tap19-a', 'Tap19 A', 'Tap19 A'),
  ('10000000-0000-4000-8000-0000000000d9', 'tap19-b', 'Tap19 B', 'Tap19 B');
insert into public.workspaces (id, tenant_id, name, slug) values
  ('20000000-0000-4000-8000-0000000000c9', '10000000-0000-4000-8000-0000000000c9', 'Tap19 A ws', 'tap19-a-ws'),
  ('20000000-0000-4000-8000-0000000000d9', '10000000-0000-4000-8000-0000000000d9', 'Tap19 B ws', 'tap19-b-ws');
select public.seed_workspace_defaults('20000000-0000-4000-8000-0000000000c9') where not exists
  (select 1 from public.pipeline_stages where workspace_id = '20000000-0000-4000-8000-0000000000c9');
insert into auth.users (id, email, email_confirmed_at, aud, role)
select u, 'tap19-' || right(u::text, 2) || '@verify.example', now(), 'authenticated', 'authenticated'
  from unnest(array[
    'c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000003',
    'c9000000-0000-4000-8000-000000000004', 'c9000000-0000-4000-8000-000000000005', 'c9000000-0000-4000-8000-000000000006']::uuid[]) u;
insert into public.profiles (id, full_name, email)
select id, 'Tap19 ' || right(id::text, 2), email from auth.users where email like 'tap19-%@verify.example' on conflict (id) do nothing;
-- 01 owner A, 02 second owner A, 03 manager A, 04 rep A, 05 owner B, 06 platform super admin
insert into public.memberships (user_id, workspace_id, role) values
  ('c9000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c9', 'owner'),
  ('c9000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-0000000000c9', 'sales_manager'),
  ('c9000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-0000000000c9', 'sales_rep'),
  ('c9000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-0000000000d9', 'owner');
insert into public.platform_admins (user_id, mfa_required, platform_role) values ('c9000000-0000-4000-8000-000000000006', false, 'super_admin');
update public.tenants set primary_owner_id = 'c9000000-0000-4000-8000-000000000001' where id = '10000000-0000-4000-8000-0000000000c9';

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
            where n.nspname = 'public' and c.relname in ('wa_numbers','payments','calendar_events','reviews','ad_accounts','import_jobs','email_identities') and c.relrowsecurity),
          7::bigint, 'RLS enabled on all seven connector tables');
select ok(exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'conv_channel' and e.enumlabel in ('instagram')), 'conv_channel has instagram');
select ok(exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'conv_channel' and e.enumlabel = 'sms'), 'conv_channel has sms');
select ok(exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'conv_channel' and e.enumlabel = 'gbp'), 'conv_channel has gbp');
select ok(exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'msg_status' and e.enumlabel = 'pending_template'), 'msg_status has pending_template');
select ok((select count(*) from information_schema.columns where table_name = 'message_templates' and column_name in ('provider_template_id','status','components','integration_id','rejected_reason')) = 5, 'message_templates extended');
select ok((select count(*) from information_schema.columns where table_name = 'campaign_daily_metrics' and column_name in ('integration_id','external_campaign_id','source')) = 3, 'campaign_daily_metrics extended');
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.territories'::regclass and c.contype in ('u','p')
                   and (select array_agg(a.attname::text order by a.attname) from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k) = array['district','workspace_id']),
          'territories (workspace_id, district) is unique');
select ok(not has_table_privilege('anon', 'public.payments', 'select') and not has_table_privilege('anon', 'public.wa_numbers', 'select'), 'anon has no table access');

-- ---------- seed checks (T017) ----------
select ok((select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id
            where r.tenant_id is null and r.key = 'owner' and rp.permission_key in ('roles.manage','members.invite','teams.manage') and rp.scope = 'all') = 3, 'owner holds roles.manage, members.invite, teams.manage');
select ok((select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id
            where r.tenant_id is null and r.key = 'sales_manager' and rp.permission_key in ('members.manage','members.invite','teams.manage') and rp.scope <> 'none') = 3, 'sales_manager holds members.manage, members.invite, teams.manage');
select ok(not exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id
            where r.tenant_id is null and r.key = 'sales_manager' and rp.permission_key = 'roles.manage' and rp.scope <> 'none'), 'sales_manager does not hold roles.manage');
select ok(exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id
            where r.tenant_id is null and r.key = 'owner' and rp.permission_key = 'audit.export'), 'owner holds audit.export');

-- ---------- connector tables: isolation and write rights ----------
select pg_temp.act('c9000000-0000-4000-8000-000000000001');
select lives_ok($$insert into public.wa_numbers (workspace_id, waba_id, phone_number_id, display_number) values
  ('20000000-0000-4000-8000-0000000000c9', 'waba1', 'pn1', '+910000000001')$$, 'owner adds a WhatsApp number');
select lives_ok($$insert into public.ad_accounts (workspace_id, platform, external_id) values ('20000000-0000-4000-8000-0000000000c9', 'meta', 'act_1')$$, 'owner adds an ad account');
select lives_ok($$insert into public.email_identities (workspace_id, provider, domain) values ('20000000-0000-4000-8000-0000000000c9', 'resend', 'mail.example.com')$$, 'owner adds an email identity');
select lives_ok($$insert into public.payments (workspace_id, provider, external_id, amount_paise) values ('20000000-0000-4000-8000-0000000000c9', 'razorpay', 'pay_1', 150000)$$, 'owner records a payment');
select lives_ok($$insert into public.calendar_events (workspace_id, starts_at, ends_at, title) values ('20000000-0000-4000-8000-0000000000c9', now(), now() + interval '1 hour', 'Demo')$$, 'owner adds a calendar event');
select lives_ok($$insert into public.reviews (id, workspace_id, rating, review_text, author_name) values ('b9000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c9', 5, 'Great', 'A')$$, 'owner adds a review');
select lives_ok($$insert into public.import_jobs (workspace_id, object_type) values ('20000000-0000-4000-8000-0000000000c9', 'lead')$$, 'owner starts an import job');
select is(pg_temp.cnt($$select count(*) from public.payments$$), 1::bigint, 'tenant_id is derived from the workspace (row visible and counted)');
select throws_ok($$insert into public.payments (workspace_id, provider, amount_paise) values ('20000000-0000-4000-8000-0000000000c9', 'razorpay', -1)$$, '23514', null, 'negative amounts are rejected');
select throws_ok($$insert into public.wa_numbers (workspace_id, waba_id, phone_number_id, display_number) values
  ('20000000-0000-4000-8000-0000000000d9', 'w', 'p', '+91')$$, '42501', null, 'owner A cannot write into workspace B');
reset role;
select pg_temp.act('c9000000-0000-4000-8000-000000000005');
select is(pg_temp.cnt($$select count(*) from (select 1 from public.wa_numbers union all select 1 from public.payments union all select 1 from public.ad_accounts
  union all select 1 from public.email_identities union all select 1 from public.calendar_events union all select 1 from public.reviews union all select 1 from public.import_jobs) x$$),
  0::bigint, 'owner B sees none of workspace A connector rows');
reset role;
select pg_temp.act('c9000000-0000-4000-8000-000000000004');
select throws_ok($$insert into public.wa_numbers (workspace_id, waba_id, phone_number_id, display_number) values
  ('20000000-0000-4000-8000-0000000000c9', 'w2', 'p2', '+92')$$, '42501', null, 'a sales rep cannot add WhatsApp numbers');
select is(pg_temp.cnt($$select count(*) from public.email_identities$$), 0::bigint, 'a sales rep does not see email identities');
reset role;
select pg_temp.act('c9000000-0000-4000-8000-000000000001');

-- reviews: human approval
select lives_ok($$update public.reviews set reply_draft = 'Thanks', reply_status = 'draft' where id = 'b9000000-0000-4000-8000-000000000001'$$, 'review reply drafted');
select throws_ok($$update public.reviews set reply_status = 'posted' where id = 'b9000000-0000-4000-8000-000000000001'$$, '23514', null, 'a draft cannot jump to posted');
select lives_ok($$update public.reviews set reply_status = 'pending_approval' where id = 'b9000000-0000-4000-8000-000000000001'$$, 'review reply submitted');
select lives_ok($$update public.reviews set reply_status = 'approved', reply_approved_by = 'c9000000-0000-4000-8000-000000000004' where id = 'b9000000-0000-4000-8000-000000000001'$$, 'review reply approved');
select is((select reply_approved_by from public.reviews where id = 'b9000000-0000-4000-8000-000000000001'), 'c9000000-0000-4000-8000-000000000001'::uuid, 'the approver is the caller, not the client-supplied value');
select throws_ok($$update public.reviews set reply_draft = 'Edited after approval' where id = 'b9000000-0000-4000-8000-000000000001'$$, '23514', null, 'an approved reply cannot be edited');
reset role;

-- ---------- hospitality preset ----------
select is((select count(*) from public.object_types where tenant_id = '10000000-0000-4000-8000-0000000000c9' and key = 'booking'), 0::bigint, 'no booking object before the preset is set');
insert into public.tenant_config (tenant_id, config) values ('10000000-0000-4000-8000-0000000000c9', '{"v":"1","preset":"legal"}') on conflict (tenant_id) do update set config = excluded.config;
select is((select count(*) from public.object_types where tenant_id = '10000000-0000-4000-8000-0000000000c9' and key = 'booking'), 0::bigint, 'legal preset does not seed booking');
update public.tenant_config set config = '{"v":"1","preset":"hospitality"}' where tenant_id = '10000000-0000-4000-8000-0000000000c9';
select is((select count(*) from public.object_types where tenant_id = '10000000-0000-4000-8000-0000000000c9' and key = 'booking' and kind = 'custom'), 1::bigint, 'hospitality preset seeds the booking object');
select is((select count(*) from public.field_defs f join public.object_types o on o.id = f.object_type_id where o.tenant_id = '10000000-0000-4000-8000-0000000000c9' and o.key = 'booking'), 6::bigint, 'booking has six fields');
update public.tenant_config set config = '{"v":"1","preset":"hospitality","x":1}' where tenant_id = '10000000-0000-4000-8000-0000000000c9';
select is((select count(*) from public.field_defs f join public.object_types o on o.id = f.object_type_id where o.tenant_id = '10000000-0000-4000-8000-0000000000c9' and o.key = 'booking'), 6::bigint, 'seeding is idempotent');
select is((select count(*) from public.object_types where tenant_id = '10000000-0000-4000-8000-0000000000d9' and key = 'booking'), 0::bigint, 'another tenant is untouched');
select ok(exists (select 1 from public.permissions where key = 'obj:booking.read'), 'booking permissions exist (object type trigger)');

-- ---------- last owner ----------
select pg_temp.clear();
insert into public.memberships (user_id, workspace_id, role) values ('c9000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000c9', 'owner');
select lives_ok($$update public.memberships set role = 'viewer' where user_id = 'c9000000-0000-4000-8000-000000000002' and workspace_id = '20000000-0000-4000-8000-0000000000c9'$$, 'one of two owners can be demoted');
select throws_ok($$update public.memberships set role = 'viewer' where user_id = 'c9000000-0000-4000-8000-000000000001' and workspace_id = '20000000-0000-4000-8000-0000000000c9'$$, '23514', 'last_owner%', 'the last owner cannot be demoted');
select throws_ok($$update public.memberships set is_active = false where user_id = 'c9000000-0000-4000-8000-000000000001' and workspace_id = '20000000-0000-4000-8000-0000000000c9'$$, '23514', 'last_owner%', 'the last owner cannot be deactivated');
select throws_ok($$delete from public.memberships where user_id = 'c9000000-0000-4000-8000-000000000001' and workspace_id = '20000000-0000-4000-8000-0000000000c9'$$, '23514', 'last_owner%', 'the last owner cannot be deleted');
select lives_ok($$update public.memberships set attributes = '{"districts":["Madurai"]}' where user_id = 'c9000000-0000-4000-8000-000000000001' and workspace_id = '20000000-0000-4000-8000-0000000000c9'$$, 'other updates to the last owner are fine');

-- ---------- invite_member with a custom role + save_role ----------
select pg_temp.act('c9000000-0000-4000-8000-000000000001');
select lives_ok($$select public.save_role(null, 'Front desk', '[{"key":"leads.read","scope":"own"},{"key":"inbox.read","scope":"team"}]'::jsonb, null,
  '10000000-0000-4000-8000-0000000000c9', 'sales_rep', 'Desk')$$, 'owner creates a custom role atomically');
select is((select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.tenant_id = '10000000-0000-4000-8000-0000000000c9' and r.name = 'Front desk'), 2::bigint, 'the role has its two permissions');
select lives_ok($$select public.save_role((select id from public.roles where tenant_id = '10000000-0000-4000-8000-0000000000c9' and name = 'Front desk'), 'Front desk 2',
  '[{"key":"leads.read","scope":"own"}]'::jsonb, (select updated_at from public.roles where tenant_id = '10000000-0000-4000-8000-0000000000c9' and name = 'Front desk'))$$, 'update with the current timestamp works');
select is((select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.tenant_id = '10000000-0000-4000-8000-0000000000c9' and r.name = 'Front desk 2'), 1::bigint, 'permissions left out were removed');
select throws_ok($$select public.save_role((select id from public.roles where tenant_id = '10000000-0000-4000-8000-0000000000c9' and name = 'Front desk 2'), 'X',
  '[]'::jsonb, now() - interval '1 day')$$, '40001', 'role_conflict%', 'a stale timestamp is a conflict');
select throws_ok($$select public.save_role((select id from public.roles where is_system and key = 'viewer'), 'Hack', '[]'::jsonb)$$, '42501', null, 'system roles cannot be saved');
select lives_ok($$select public.invite_member('20000000-0000-4000-8000-0000000000c9', 'desk@example.test', 'viewer', 'Desk', '{}',
  (select id from public.roles where tenant_id = '10000000-0000-4000-8000-0000000000c9' and name = 'Front desk 2'))$$, 'owner invites with a custom role');
select is((select role_id from public.invitations where lower(email) = 'desk@example.test'), (select id from public.roles where tenant_id = '10000000-0000-4000-8000-0000000000c9' and name = 'Front desk 2'), 'the invitation keeps role_id');
select is((select role::text from public.invitations where lower(email) = 'desk@example.test'), 'sales_rep', 'the invitation role is the base role of the custom role');
reset role;
select pg_temp.act('c9000000-0000-4000-8000-000000000003');
select throws_ok($$select public.save_role(null, 'Mgr role', '[]'::jsonb, null, '10000000-0000-4000-8000-0000000000c9', 'viewer')$$, '42501', null, 'a sales manager cannot create roles');
select throws_ok($$select public.invite_member('20000000-0000-4000-8000-0000000000c9', 'desk2@example.test', 'viewer', null, '{}',
  (select id from public.roles where tenant_id = '10000000-0000-4000-8000-0000000000c9' and name = 'Front desk 2'))$$, '42501', null, 'a sales manager cannot assign a custom role');
select lives_ok($$select public.invite_member('20000000-0000-4000-8000-0000000000c9', 'desk3@example.test', 'viewer')$$, 'the 3-argument call still works');
reset role;
-- acceptance applies the invited role (a signup has no JWT subject)
select pg_temp.clear();
insert into auth.users (id, email, email_confirmed_at, aud, role) values ('c9000000-0000-4000-8000-0000000000f1', 'desk@example.test', now(), 'authenticated', 'authenticated');
select is((select m.role_id from public.memberships m where m.user_id = 'c9000000-0000-4000-8000-0000000000f1' and m.workspace_id = '20000000-0000-4000-8000-0000000000c9'),
          (select id from public.roles where tenant_id = '10000000-0000-4000-8000-0000000000c9' and name = 'Front desk 2'), 'accepting the invitation applies the custom role');

-- ---------- platform admin surfaces ----------
select pg_temp.act('c9000000-0000-4000-8000-000000000006');
select ok((select count(*) from public.admin_workspace_stats() where workspace_id = '20000000-0000-4000-8000-0000000000c9') = 1, 'admin_workspace_stats returns the workspace');
select is((select primary_owner_name from public.admin_workspace_stats() where workspace_id = '20000000-0000-4000-8000-0000000000c9'), 'Tap19 01', 'primary owner display name is returned');
select ok((select created_at from public.admin_workspace_stats() where workspace_id = '20000000-0000-4000-8000-0000000000c9') is not null, 'workspace created_at is returned');
select lives_ok($$select public.admin_set_tenant_status('10000000-0000-4000-8000-0000000000d9', 'suspended', 'billing overdue notice')$$, 'status change with a reason');
select throws_ok($$select public.admin_set_tenant_status('10000000-0000-4000-8000-0000000000d9', 'active', 'short')$$, '22023', null, 'a too-short reason is refused');
select lives_ok($$select public.admin_set_tenant_status('10000000-0000-4000-8000-0000000000d9', 'active')$$, 'status change without a reason is still accepted');
select lives_ok($$select public.admin_set_connector_availability('slack', 'staging', 'sandbox', 'ready', 'tested', 'enable for the pilot')$$, 'connector availability change with a reason');
select throws_ok($$select public.admin_set_connector_availability('slack', 'staging', 'sandbox', 'ready', null, '')$$, '22023', null, 'connector change needs a reason');
select throws_ok($$select public.admin_set_connector_availability('nope', 'staging', 'sandbox', 'ready', null, 'a valid reason')$$, '22023', null, 'unknown connector refused');
select lives_ok($$select public.admin_set_tenant_branding('10000000-0000-4000-8000-0000000000d9', '{"brand_name":"Renamed B","brand_primary":"#112233"}', 'rebrand per request')$$, 'branding change with a reason');
select is((select brand_name from public.tenants where id = '10000000-0000-4000-8000-0000000000d9'), 'Renamed B', 'branding was applied');
select throws_ok($$select public.admin_set_tenant_branding('10000000-0000-4000-8000-0000000000d9', '{"slug":"x"}', 'rebrand per request')$$, '22023', null, 'unknown branding key refused');
select lives_ok($$select public.start_support_session('20000000-0000-4000-8000-0000000000c9', 'Investigating the failed sync reported by the owner', 'read_only', 15)$$, 'start_support_session fills tenant_id');
select is((select tenant_id from public.support_sessions where admin_id = 'c9000000-0000-4000-8000-000000000006' limit 1), '10000000-0000-4000-8000-0000000000c9'::uuid, 'support session carries the tenant');
select ok(pg_temp.cnt($$select count(*) from public.support_sessions$$) >= 1, 'a platform admin reads support sessions');
select is(pg_temp.cnt($$select count(*) from public.platform_admins where user_id = 'c9000000-0000-4000-8000-000000000006'$$), 1::bigint, 'a platform admin reads their own platform_admins row');
reset role;
select pg_temp.act('c9000000-0000-4000-8000-000000000001');
select throws_ok($$select public.admin_set_tenant_branding('10000000-0000-4000-8000-0000000000c9', '{"brand_name":"x"}', 'owner trying it')$$, '42501', null, 'a tenant owner cannot call the admin branding RPC');
reset role;
select ok(exists (select 1 from public.audit_log where table_name = 'tenants' and reason = 'billing overdue notice'), 'tenant status change was audited with its reason');
select ok(exists (select 1 from public.audit_log where table_name = 'connector_availability' and reason = 'enable for the pilot'), 'connector change was audited with its reason');

-- ---------- merge_accounts and move_deal ----------
insert into public.accounts (id, workspace_id, name) values
  ('ac000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c9', 'Src Co'),
  ('ac000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000c9', 'Tgt Co');
insert into public.contacts (id, workspace_id, full_name, account_id) values ('cc000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c9', 'Contact One', 'ac000000-0000-4000-8000-000000000001');
insert into public.deals (id, workspace_id, name, account_id, stage_id, owner_id)
select 'de000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000c9', 'Deal One', 'ac000000-0000-4000-8000-000000000001', s.id, 'c9000000-0000-4000-8000-000000000001'
  from public.pipeline_stages s where s.workspace_id = '20000000-0000-4000-8000-0000000000c9' order by s.position limit 1;
select pg_temp.act('c9000000-0000-4000-8000-000000000004');
select throws_ok($$select public.merge_accounts('ac000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000002', 1, 1)$$, '42501', null, 'a sales rep cannot merge accounts');
reset role;
select pg_temp.act('c9000000-0000-4000-8000-000000000001');
select throws_ok($$select public.merge_accounts('ac000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000002', 99, 1)$$, '40001', null, 'a stale source version is a conflict');
select is((select (public.merge_accounts('ac000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000002',
  (select version from public.accounts where id = 'ac000000-0000-4000-8000-000000000001'), (select version from public.accounts where id = 'ac000000-0000-4000-8000-000000000002')) ->> 'contacts')::int),
  1, 'merge moves the contact');
reset role;
select is((select account_id from public.deals where id = 'de000000-0000-4000-8000-000000000001'), 'ac000000-0000-4000-8000-000000000002'::uuid, 'merge moves the deal');
select ok((select deleted_at from public.accounts where id = 'ac000000-0000-4000-8000-000000000001') is not null, 'merge soft-deletes the source');
select pg_temp.act('c9000000-0000-4000-8000-000000000001');
select throws_ok($$select public.move_deal('de000000-0000-4000-8000-000000000001', (select id from public.pipeline_stages where workspace_id = '20000000-0000-4000-8000-0000000000c9' and is_lost), 1, '{}')$$, '22023', null, 'losing a deal needs a reason');
select throws_ok($$select public.move_deal('de000000-0000-4000-8000-000000000001', (select id from public.pipeline_stages where workspace_id = '20000000-0000-4000-8000-0000000000c9' and is_won), 77, '{}')$$, '40001', null, 'a stale deal version is a conflict');
select ok((public.move_deal('de000000-0000-4000-8000-000000000001', (select id from public.pipeline_stages where workspace_id = '20000000-0000-4000-8000-0000000000c9' and is_won),
  (select version from public.deals where id = 'de000000-0000-4000-8000-000000000001'), '{"value_inr": 90000, "seats": 12}') ->> 'won_at') is not null, 'move to Won sets won_at in the same statement');
select is((select value_inr from public.deals where id = 'de000000-0000-4000-8000-000000000001'), 90000::numeric, 'move to Won wrote value_inr');
reset role;

-- ---------- audit_record ----------
select pg_temp.act('c9000000-0000-4000-8000-000000000001');
select ok(public.audit_record('20000000-0000-4000-8000-0000000000c9', 'leads.exported', 'export 10 rows', 'leads', null, 'month end', '{"rows":10}', 'ui', null, 'req-1', '10.0.0.1', 'ua', false) > 0, 'a member records an audit entry');
select throws_ok($$select public.audit_record('20000000-0000-4000-8000-0000000000d9', 'leads.exported', 's', 'leads', null, null, null, null, null, null, null, null, false)$$, '42501', null, 'a non-member is denied');
select throws_ok($$select public.audit_record('20000000-0000-4000-8000-0000000000c9', 'Bad Action!', 's', 'leads', null, null, null, null, null, null, null, null, false)$$, '22023', null, 'a malformed action is rejected');
select throws_ok($$select public.audit_record(null, 'x.y', 's', null, null, null, null, null, null, null, null, null, false)$$, '42501', null, 'a non-admin cannot write a platform-level entry');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'leads.exported' and actor_id = 'c9000000-0000-4000-8000-000000000001' and tenant_id = '10000000-0000-4000-8000-0000000000c9' and request_id = 'req-1'), 'the entry is stamped with actor and tenant');
set local role anon;
select throws_ok($$select public.audit_record('20000000-0000-4000-8000-0000000000c9', 'leads.exported', 's', 'leads', null, null, null, null, null, null, null, null, false)$$, '42501', null, 'anon cannot call audit_record');
reset role;
select pg_temp.act('c9000000-0000-4000-8000-000000000001');
select throws_ok($$delete from public.audit_log where action = 'leads.exported'$$, '42501', null, 'audit rows stay append-only (no delete grant)');
reset role;
select throws_ok($$delete from public.audit_log where action = 'leads.exported'$$, '42501', null, 'audit rows stay append-only even for the table owner');
select pg_temp.act('c9000000-0000-4000-8000-000000000006');
select ok(pg_temp.cnt($$select count(*) from public.audit_log where tenant_id = '10000000-0000-4000-8000-0000000000c9'$$) >= 1, 'a platform admin reads audit_log across tenants');
select ok(public.audit_record(null, 'platform.viewed', 's', null, null, 'support review', null, null, null, null, null, null, false) > 0, 'a platform admin records a platform-level entry');
reset role;

select * from finish();
rollback;
