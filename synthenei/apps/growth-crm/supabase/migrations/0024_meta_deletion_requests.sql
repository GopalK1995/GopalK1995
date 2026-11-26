-- 0024_meta_deletion_requests.sql  (AUD-088 / PRIV-002, BLOCKER)
-- Meta requires a data-deletion callback: POST /api/meta/data-deletion receives a signed_request, we record a request here and give
-- Meta a confirmation code + a public status URL (GET /legal/data-deletion/status?code=<code>).
-- Written by the service role only (the route), so RLS is enabled with NO client policies and all client privileges are revoked.
-- Idempotent: safe to re-run. NOT applied by the fix agent; the owner applies it.
--
-- status values:
--   received        request recorded, no matching connection found yet (an operator must match and erase; see the runbook)
--   disconnected    a matching connection was disconnected and its stored credentials dropped; stored metrics still to be erased
--   completed       all stored data for that Meta user has been erased (set by the operator or a later erasure job)
--
-- ROLLBACK: drop table if exists public.meta_deletion_requests;

create table if not exists public.meta_deletion_requests (
  id                uuid primary key default gen_random_uuid(),
  confirmation_code text not null unique,
  meta_user_id      text not null,
  status            text not null default 'received' check (status in ('received', 'disconnected', 'completed')),
  requested_at      timestamptz not null default now(),
  completed_at      timestamptz,
  check (completed_at is null or status = 'completed')
);

create index if not exists meta_deletion_requests_user_idx on public.meta_deletion_requests (meta_user_id, requested_at desc);

alter table public.meta_deletion_requests enable row level security;
alter table public.meta_deletion_requests force row level security;
revoke all on public.meta_deletion_requests from anon, authenticated;
-- No policies on purpose: only the service role (which bypasses RLS) reads and writes this table.
