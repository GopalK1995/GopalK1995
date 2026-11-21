-- 0022e (T041): composite indexes for the main list queries, from EXPLAIN on the real (small) data with enable_seqscan off.
-- Each removes a Sort node at scale (workspace filter + order by in one index). Additive, idempotent, plain CREATE INDEX (small tables).
create index if not exists leads_ws_status_created on public.leads (workspace_id, status, created_at desc) where deleted_at is null;
create index if not exists deals_ws_created on public.deals (workspace_id, created_at desc) where deleted_at is null;
create index if not exists activities_ws_created on public.activities (workspace_id, created_at desc);
create index if not exists conversations_ws_last_message on public.conversations (workspace_id, last_message_at desc);
create index if not exists tasks_ws_status_due on public.tasks (workspace_id, status, due_at);
