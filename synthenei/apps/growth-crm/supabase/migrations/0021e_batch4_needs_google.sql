-- 0021e Batch 4 gate: T039 Google needs (additive part only). Idempotent.
-- Skipped on purpose (not additive): the ga4_daily primary key swap, and the connector_catalog / connector_availability updates.
alter table public.ga4_daily add column if not exists campaign text not null default '';
create index if not exists ga4_daily_ws_day on public.ga4_daily (workspace_id, day);
