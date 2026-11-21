-- 0022g (T041): pg_trgm GIN indexes for global search (BUILD-PLAN 2.10). pg_trgm is already installed (records_title_trgm uses it).
-- Additive, idempotent, plain CREATE INDEX (small tables).
create index if not exists leads_full_name_trgm on public.leads using gin (full_name gin_trgm_ops);
create index if not exists leads_firm_name_trgm on public.leads using gin (firm_name gin_trgm_ops);
create index if not exists accounts_name_trgm on public.accounts using gin (name gin_trgm_ops);
create index if not exists contacts_full_name_trgm on public.contacts using gin (full_name gin_trgm_ops);
