-- T041 load seed: 50,000 synthetic leads for ONE workspace. NEVER run against the Lawsome production project.
-- Run on a Supabase branch or a scratch database:  psql "$BRANCH_DB_URL" -v ws=<workspace uuid> -v n=50000 -f scripts/load/seed-leads.sql
-- Rows are flagged is_synthetic so they can be removed with:  delete from public.leads where is_synthetic and workspace_id = :'ws';
-- (run that delete only on the scratch database). Status cycles through the lead_status enum; created_at spreads over 365 days.
\set ON_ERROR_STOP on
begin;
insert into public.leads (workspace_id, full_name, email, phone, status, score, created_at, is_synthetic)
select :'ws'::uuid,
       'Load Lead ' || g,
       'load' || g || '@load.invalid',
       '+9190000' || lpad(g::text, 5, '0'),
       (enum_range(null::public.lead_status))[1 + (g % array_length(enum_range(null::public.lead_status), 1))],
       (g * 37) % 100,
       now() - ((g % 365) || ' days')::interval - ((g % 1440) || ' minutes')::interval,
       true
  from generate_series(1, :n) g;
analyze public.leads;
commit;
