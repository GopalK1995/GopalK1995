-- pgTAP for 0017_metadata. Run on the Supabase branch DB: node scripts/run-pgtap.mjs supabase/tests/0017_metadata.test.sql
-- Everything happens inside one transaction and is rolled back.
begin;
select plan(70);

-- ---------- fixture (as postgres) ----------
insert into public.tenants (id, slug, name, brand_name) values
  ('10000000-0000-4000-8000-0000000000e1', 'tap17-a', 'Tap17 A', 'Tap17 A'),
  ('10000000-0000-4000-8000-0000000000f1', 'tap17-b', 'Tap17 B', 'Tap17 B');
insert into public.workspaces (id, tenant_id, name, slug) values
  ('20000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1', 'Tap17 A ws', 'tap17-a-ws'),
  ('20000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', 'Tap17 B ws', 'tap17-b-ws');
insert into auth.users (id, email, email_confirmed_at, aud, role)
select u, 'tap17-' || right(u::text, 2) || '@verify.example', now(), 'authenticated', 'authenticated'
  from unnest(array[
    'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003',
    'e1000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000005']::uuid[]) u;
insert into public.profiles (id, full_name, email)
select id, 'Tap17 ' || right(id::text, 2), email from auth.users where email like 'tap17-%@verify.example' on conflict (id) do nothing;
-- 01 owner A, 02 manager A, 03 rep A, 04 viewer A, 05 owner B
insert into public.memberships (user_id, workspace_id, role) values
  ('e1000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000e1', 'owner'),
  ('e1000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000e1', 'sales_manager'),
  ('e1000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-0000000000e1', 'sales_rep'),
  ('e1000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-0000000000e1', 'viewer'),
  ('e1000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-0000000000f1', 'owner');
insert into public.pipeline_stages (workspace_id, key, label, position, probability, max_days, is_won, is_lost) values
  ('20000000-0000-4000-8000-0000000000e1', 'discovery', 'Discovery', 1, 10, 14, false, false),
  ('20000000-0000-4000-8000-0000000000e1', 'won', 'Won', 2, 100, 999, true, false);

create function pg_temp.act(u uuid, a text default 'aal1') returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', a)::text, true);
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $f$;
create function pg_temp.upd(q text) returns bigint language plpgsql as $f$
declare n bigint; begin execute q; get diagnostics n = row_count; return n; end $f$;

-- ---------- defaults created by triggers ----------
select is((select count(*) from public.object_types where tenant_id = '10000000-0000-4000-8000-0000000000e1' and kind = 'system'), 7::bigint, 'new tenant gets the seven system object types');
select is((select count(*) from public.pipelines where workspace_id = '20000000-0000-4000-8000-0000000000e1' and is_default), 2::bigint, 'new workspace gets a default lead and deal pipeline');
select is((select count(*) from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
            where p.workspace_id = '20000000-0000-4000-8000-0000000000e1' and p.object_type = 'lead'), 6::bigint, 'lead pipeline has the six lead stages');
select is((select count(*) from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
            where p.workspace_id = '20000000-0000-4000-8000-0000000000e1' and p.object_type = 'deal'), 2::bigint, 'legacy stage inserts land in the default deal pipeline');
select is((select outcome from public.pipeline_stages where workspace_id = '20000000-0000-4000-8000-0000000000e1' and key = 'won' and
            pipeline_id = (select id from public.pipelines where workspace_id = '20000000-0000-4000-8000-0000000000e1' and object_type = 'deal')),
          'won', 'is_won maps to outcome won');
select is((select name ->> 'en' from public.pipeline_stages where workspace_id = '20000000-0000-4000-8000-0000000000e1' and key = 'discovery'), 'Discovery', 'stage name derived from label');
select is((select count(*) from public.v_pipeline_summary where workspace_id = '20000000-0000-4000-8000-0000000000e1'), 0::bigint, 'view is filtered by role (postgres has no membership)');
select throws_ok($$insert into public.pipeline_stages (workspace_id, pipeline_id, key, label, position, probability)
  values ('20000000-0000-4000-8000-0000000000e1', (select id from public.pipelines where workspace_id = '20000000-0000-4000-8000-0000000000e1' and object_type = 'deal'), 'discovery', 'Dup', 9, 1)$$,
  '23505', null, 'stage keys are unique per pipeline');
select lives_ok($$insert into public.pipeline_stages (workspace_id, pipeline_id, key, label, position, probability)
  values ('20000000-0000-4000-8000-0000000000e1', (select id from public.pipelines where workspace_id = '20000000-0000-4000-8000-0000000000e1' and object_type = 'lead'), 'discovery', 'Same key other pipeline', 9, 1)$$,
  'the same key may exist in another pipeline');

-- ---------- lead / deal stage sync ----------
insert into public.leads (id, workspace_id, full_name, status, owner_id) values
  ('40000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', 'Lead Q', 'qualified', 'e1000000-0000-4000-8000-000000000003');
select is((select s.key from public.leads l join public.pipeline_stages s on s.id = l.stage_id where l.id = '40000000-0000-4000-8000-0000000000e1'), 'qualified', 'legacy status write sets the stage');
update public.leads set stage_id = (select s.id from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id
                                      where p.workspace_id = '20000000-0000-4000-8000-0000000000e1' and p.object_type = 'lead' and s.key = 'converted')
 where id = '40000000-0000-4000-8000-0000000000e1';
select is((select status::text from public.leads where id = '40000000-0000-4000-8000-0000000000e1'), 'converted', 'moving the stage updates the derived status bucket');
update public.leads set status = 'nurturing' where id = '40000000-0000-4000-8000-0000000000e1';
select is((select s.key from public.leads l join public.pipeline_stages s on s.id = l.stage_id where l.id = '40000000-0000-4000-8000-0000000000e1'), 'nurturing', 'changing status moves the stage');
insert into public.deals (id, workspace_id, name, stage_id) values
  ('44000000-0000-4000-8000-0000000000e1', '20000000-0000-4000-8000-0000000000e1', 'Deal', (select id from public.pipeline_stages where workspace_id = '20000000-0000-4000-8000-0000000000e1' and key = 'discovery'
     and pipeline_id = (select id from public.pipelines where workspace_id = '20000000-0000-4000-8000-0000000000e1' and object_type = 'deal')));
select ok((select pipeline_id from public.deals where id = '44000000-0000-4000-8000-0000000000e1') =
          (select id from public.pipelines where workspace_id = '20000000-0000-4000-8000-0000000000e1' and object_type = 'deal'), 'deal pipeline follows its stage');

-- ---------- RLS enabled everywhere ----------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname in ('object_types','field_defs','records','record_links','pipelines','layouts','saved_views') and c.relrowsecurity),
          7::bigint, 'RLS enabled on all seven new tables');
set local role anon;
select throws_ok($$select count(*) from public.object_types$$, '42501', null, 'anon has no access to object_types');
reset role;

-- ---------- custom object types and fields (owner) ----------
select pg_temp.act('e1000000-0000-4000-8000-000000000001');
select is((select count(*) from public.object_types), 7::bigint, 'member reads own tenant object types only');
select lives_ok($$insert into public.object_types (tenant_id, key, kind, label) values ('10000000-0000-4000-8000-0000000000e1', 'booking', 'custom', '{"en":{"one":"Booking","many":"Bookings"}}')$$, 'owner creates a custom object type');
select lives_ok($$insert into public.field_defs (object_type_id, key, type, label, required) values
  ((select id from public.object_types where key = 'booking'), 'guests', 'number', '{"en":"Guests"}', true)$$, 'owner defines a field (tenant derived from the object type)');
select lives_ok($$insert into public.field_defs (object_type_id, key, type, options) values
  ((select id from public.object_types where key = 'booking'), 'room', 'select', '{"choices":[{"key":"deluxe"},{"key":"suite"}]}')$$, 'select field with choices');
select ok(exists (select 1 from public.permissions where key = 'obj:booking.read') and exists (select 1 from public.permissions where key = 'obj:booking.delete'), 'custom object type registers its permissions');
select ok((select schema_version from public.object_types where key = 'booking') >= 3, 'schema_version bumps with each field change');
select is((select json_schema -> 'properties' -> 'room' -> 'enum' ->> 0 from public.object_types where key = 'booking'), 'deluxe', 'json_schema compiled from the field definitions');
select lives_ok($$insert into public.field_defs (object_type_id, key, type) values ((select id from public.object_types where key = 'lead'), 'budget', 'money')$$, 'owner adds a money field to leads');
select lives_ok($$insert into public.field_defs (object_type_id, key, type, unique_in_workspace) values ((select id from public.object_types where key = 'lead'), 'ref_no', 'text', true)$$, 'unique field');
select lives_ok($$insert into public.field_defs (object_type_id, key, type, required, "default") values ((select id from public.object_types where key = 'lead'), 'tier', 'rating', false, '3')$$, 'rating field with default');

-- custom-field validation trigger on the system tables
select lives_ok($$update public.leads set custom = '{"budget": 1200, "ref_no": "R-1"}' where id = '40000000-0000-4000-8000-0000000000e1'$$, 'valid custom values are accepted');
select throws_ok($$update public.leads set custom = '{"nope": 1}' where id = '40000000-0000-4000-8000-0000000000e1'$$, '23514', null, 'unknown custom field rejected');
select throws_ok($$update public.leads set custom = '{"budget": "lots"}' where id = '40000000-0000-4000-8000-0000000000e1'$$, '23514', null, 'wrong type rejected');
select throws_ok($$update public.leads set custom = '{"budget": -5}' where id = '40000000-0000-4000-8000-0000000000e1'$$, '23514', null, 'negative money rejected');
select throws_ok($$update public.leads set custom = '{"tier": 9}' where id = '40000000-0000-4000-8000-0000000000e1'$$, '23514', null, 'rating out of range rejected');
select throws_ok($$update public.leads set custom = '[1]' where id = '40000000-0000-4000-8000-0000000000e1'$$, '23514', null, 'custom must be an object');
select lives_ok($$insert into public.leads (id, workspace_id, full_name, custom) values ('40000000-0000-4000-8000-0000000000e2', '20000000-0000-4000-8000-0000000000e1', 'Lead 2', '{"ref_no": "R-2"}')$$, 'second lead with a different unique value');
select is((select custom ->> 'tier' from public.leads where id = '40000000-0000-4000-8000-0000000000e2'), '3', 'default applied on insert');
select throws_ok($$update public.leads set custom = '{"ref_no": "R-1"}' where id = '40000000-0000-4000-8000-0000000000e2'$$, '23505', null, 'unique_in_workspace enforced');
select lives_ok($$update public.field_defs set required = true where object_type_id = (select id from public.object_types where key = 'lead') and key = 'budget'$$, 'make a field required');
select throws_ok($$insert into public.leads (workspace_id, full_name) values ('20000000-0000-4000-8000-0000000000e1', 'No budget')$$, '23514', null, 'required custom field enforced on insert');
select lives_ok($$update public.field_defs set archived_at = now() where key = 'budget'$$, 'archive the required field');
select throws_ok($$update public.leads set custom = '{"budget": 5}' where id = '40000000-0000-4000-8000-0000000000e1'$$, '23514', null, 'archived fields are no longer accepted');

-- records of the custom object
select lives_ok($$insert into public.records (workspace_id, object_type_id, title, data, owner_id) values
  ('20000000-0000-4000-8000-0000000000e1', (select id from public.object_types where key = 'booking'), 'Booking 1', '{"guests": 2, "room": "suite"}', 'e1000000-0000-4000-8000-000000000001')$$, 'owner creates a record');
select throws_ok($$insert into public.records (workspace_id, object_type_id, title, data, owner_id) values
  ('20000000-0000-4000-8000-0000000000e1', (select id from public.object_types where key = 'booking'), 'Bad', '{"guests": 2, "room": "penthouse"}', 'e1000000-0000-4000-8000-000000000001')$$, '23514', null, 'record data validated against choices');
select throws_ok($$insert into public.records (workspace_id, object_type_id, title, data) values
  ('20000000-0000-4000-8000-0000000000e1', (select id from public.object_types where key = 'booking'), 'Missing', '{"room": "suite"}')$$, '23514', null, 'record required field enforced');
select throws_ok($$insert into public.records (workspace_id, object_type_id, title, data) values
  ('20000000-0000-4000-8000-0000000000e1', (select id from public.object_types where key = 'lead'), 'System type', '{}')$$, '23514', null, 'records only hold custom object types');
select is((select count(*) from public.records), 1::bigint, 'owner reads the record');
select ok(authz.check('20000000-0000-4000-8000-0000000000e1', 'obj:booking.read', 'obj:booking', (select id from public.records limit 1)), 'authz.check resolves custom objects through obj:<key>.read');
select is(authz.object_table('obj:booking'), 'records', 'object_table maps custom objects to records');
select is(authz.object_perm('obj:booking', 'write'), 'obj:booking.write', 'object_perm maps custom objects');
select lives_ok($$insert into public.record_links (workspace_id, from_type, from_id, to_type, to_id, relation) values
  ('20000000-0000-4000-8000-0000000000e1', 'obj:booking', (select id from public.records limit 1), 'lead', '40000000-0000-4000-8000-0000000000e1', 'for')$$, 'owner links a record to a lead');
select is((select count(*) from public.record_links), 1::bigint, 'owner reads the link');
select lives_ok($$insert into public.layouts (workspace_id, object_type_id, kind, spec) values
  (null, (select id from public.object_types where key = 'lead'), 'detail', '{"sections":[]}')$$, 'owner writes an org-wide layout');
select lives_ok($$insert into public.pipelines (workspace_id, object_type, key, name) values ('20000000-0000-4000-8000-0000000000e1', 'booking', 'bookings', '{"en":"Bookings"}')$$, 'owner creates a pipeline');
select lives_ok($$insert into public.saved_views (workspace_id, object_type_id, owner_id, name, visibility) values
  ('20000000-0000-4000-8000-0000000000e1', (select id from public.object_types where key = 'lead'), 'e1000000-0000-4000-8000-000000000001', 'Everyone', 'workspace')$$, 'owner shares a view');

-- ---------- other roles ----------
select pg_temp.act('e1000000-0000-4000-8000-000000000002');
select is((select count(*) from public.records), 1::bigint, 'manager reads custom records (default grants)');
select throws_ok($$insert into public.object_types (tenant_id, key, kind) values ('10000000-0000-4000-8000-0000000000e1', 'blocked', 'custom')$$, '42501', null, 'manager cannot create object types');
select lives_ok($$insert into public.pipelines (workspace_id, object_type, key, name) values ('20000000-0000-4000-8000-0000000000e1', 'deal', 'enterprise', '{"en":"Enterprise"}')$$, 'manager manages pipelines');
select pg_temp.act('e1000000-0000-4000-8000-000000000003');
select is((select count(*) from public.records), 0::bigint, 'rep has no custom-object grants');
select is((select count(*) from public.object_types), 8::bigint, 'rep reads the tenant object types (seven system and one custom)');
select is((select count(*) from public.field_defs), 5::bigint, 'rep reads field definitions (including archived ones)');
select throws_ok($$insert into public.field_defs (object_type_id, key, type) values ((select id from public.object_types where key = 'lead'), 'sneaky', 'text')$$, '42501', null, 'rep cannot define fields');
select throws_ok($$insert into public.pipelines (workspace_id, object_type, key, name) values ('20000000-0000-4000-8000-0000000000e1', 'deal', 'rep', '{}')$$, '42501', null, 'rep cannot create pipelines');
select throws_ok($$insert into public.layouts (workspace_id, object_type_id, kind) values (null, (select id from public.object_types where key = 'lead'), 'list')$$, '42501', null, 'rep cannot write layouts');
select is((select count(*) from public.layouts), 1::bigint, 'rep reads the org-wide layout');
select lives_ok($$insert into public.saved_views (workspace_id, object_type_id, owner_id, name, visibility) values
  ('20000000-0000-4000-8000-0000000000e1', (select id from public.object_types where key = 'lead'), 'e1000000-0000-4000-8000-000000000003', 'Mine', 'private')$$, 'rep saves a private view');
select throws_ok($$insert into public.saved_views (workspace_id, object_type_id, owner_id, name, visibility) values
  ('20000000-0000-4000-8000-0000000000e1', (select id from public.object_types where key = 'lead'), 'e1000000-0000-4000-8000-000000000003', 'Shared', 'workspace')$$, '42501', null, 'rep cannot share a view without views.share');
select is((select count(*) from public.saved_views), 2::bigint, 'rep sees the workspace view and her own');
select pg_temp.act('e1000000-0000-4000-8000-000000000004');
select is((select count(*) from public.saved_views), 1::bigint, 'viewer sees the workspace view but not the private one');
select pg_temp.act('e1000000-0000-4000-8000-000000000005');
select is((select count(*) from public.object_types where tenant_id = '10000000-0000-4000-8000-0000000000e1'), 0::bigint, 'other tenant: no object types');
select is((select count(*) from public.records), 0::bigint, 'other tenant: no records');
select is((select count(*) from public.pipelines where workspace_id = '20000000-0000-4000-8000-0000000000e1'), 0::bigint, 'other tenant: no pipelines');
reset role;

-- ---------- platform switches ----------
update public.org_admin_policies set allow_custom_objects = false where tenant_id = '10000000-0000-4000-8000-0000000000e1';
select pg_temp.act('e1000000-0000-4000-8000-000000000001');
select throws_ok($$insert into public.object_types (tenant_id, key, kind) values ('10000000-0000-4000-8000-0000000000e1', 'blocked2', 'custom')$$, '42501', null, 'allow_custom_objects=false blocks custom object types');
reset role;
update public.org_admin_policies set max_custom_fields = 1 where tenant_id = '10000000-0000-4000-8000-0000000000e1';
select throws_ok($$insert into public.field_defs (object_type_id, key, type) values ((select id from public.object_types where key = 'lead' and tenant_id = '10000000-0000-4000-8000-0000000000e1'), 'over', 'text')$$, '23514', null, 'max_custom_fields cap enforced');

select * from finish();
rollback;
