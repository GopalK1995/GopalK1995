-- T041 list-query plans. Run on the scratch database AFTER seed-leads.sql, as an authenticated user so RLS is included:
--   psql "$BRANCH_DB_URL" -v ws=<workspace uuid> -v uid=<member user uuid> -f scripts/load/explain-lists.sql
-- Target (BUILD-PLAN 2.11): p95 < 150 ms for each list at 50k leads. Look for Sort nodes and Seq Scans on leads.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', :'uid', true);
set local role authenticated;
explain (analyze, buffers) select * from public.leads where workspace_id = :'ws' and deleted_at is null order by created_at desc limit 25;
explain (analyze, buffers) select * from public.leads where workspace_id = :'ws' and deleted_at is null and status = 'new' order by created_at desc limit 25;
explain (analyze, buffers) select * from public.leads where workspace_id = :'ws' and deleted_at is null order by score desc limit 25;
explain (analyze, buffers) select * from public.leads where workspace_id = :'ws' and full_name ilike '%load lead 49%' limit 25;
explain (analyze, buffers) select * from public.deals where workspace_id = :'ws' and deleted_at is null order by created_at desc limit 50;
explain (analyze, buffers) select * from public.activities where workspace_id = :'ws' order by created_at desc limit 50;
rollback;
