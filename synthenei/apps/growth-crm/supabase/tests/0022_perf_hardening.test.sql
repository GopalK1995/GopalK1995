-- pgTAP for 0022* (T041). NOT RUN. Run on a Supabase branch DB: node scripts/run-pgtap.mjs supabase/tests/0022_perf_hardening.test.sql
-- One transaction, rolled back.
begin;
select plan(14);

-- ---------- structure ----------
select has_index('public', 'events', 'events_tenant_id_fk_idx', '0022: FK index on partitioned events parent');
select has_index('public', 'layouts', 'layouts_tenant_id_fk_idx', '0022: FK index layouts.tenant_id');
select has_index('public', 'leads', 'leads_ws_status_created', '0022e: leads list composite index');
select has_function('public', 'audit_row_change_redacted', '0022b: value-free audit trigger function');
select is((select count(*)::int from pg_trigger where tgname = 'trg_records_audit' and not tgisinternal), 1, '0022b: records audit trigger');
select is((select count(*)::int from pg_trigger where tgname = 'z9_layouts_version' and not tgisinternal), 1, '0022b: layouts version trigger');
select is((select condeferrable and condeferred from pg_constraint where conname = 'pipeline_stages_pipeline_position'), true, '0022c: stage position unique is deferrable initially deferred');
select has_function('public', 'save_pipeline_stages', array['uuid', 'jsonb'], '0022c: save_pipeline_stages RPC');
select is((select count(*)::int from public.scheduled_jobs where kind = 'maintenance.purge_soft_deleted' and enabled), 0, '0022d: purge job exists only disabled');
select is((select has_function_privilege('anon', 'public.realtime_broadcast_row()', 'execute')), false, '0022f: anon cannot execute trigger function');

-- ---------- behaviour (as postgres, RLS bypassed) ----------
insert into public.tenants (id, slug, name, brand_name) values ('10000000-0000-4000-8000-0000000000f1', 'tap22-a', 'Tap22 A', 'Tap22 A');
insert into public.workspaces (id, tenant_id, name, slug) values ('20000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', 'Tap22 ws', 'tap22-ws');
insert into public.object_types (id, tenant_id, key, kind, label) values ('30000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', 'tap22obj', 'custom', '{"en":"T"}');
insert into public.field_defs (tenant_id, object_type_id, key, type) values ('10000000-0000-4000-8000-0000000000f1', '30000000-0000-4000-8000-0000000000f1', 'secret', 'text');
insert into public.records (id, tenant_id, workspace_id, object_type_id, data)
values ('40000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f1', '30000000-0000-4000-8000-0000000000f1', '{"secret":"TOPSECRET-VALUE"}');
update public.records set data = '{"secret":"TOPSECRET-CHANGED"}' where id = '40000000-0000-4000-8000-0000000000f1';

select is((select count(*)::int from public.audit_log where table_name = 'records' and row_id = '40000000-0000-4000-8000-0000000000f1'), 2, '0022b: records insert and update audited');
select is((select count(*)::int from public.audit_log where table_name = 'records' and changes::text like '%TOPSECRET%'), 0, '0022b: audit rows never contain record values');
select is((select changes->'data_keys' from public.audit_log where table_name = 'records' and action = 'update' and row_id = '40000000-0000-4000-8000-0000000000f1'), '["secret"]'::jsonb, '0022b: changed data keys are listed');

select * from finish();
rollback;
