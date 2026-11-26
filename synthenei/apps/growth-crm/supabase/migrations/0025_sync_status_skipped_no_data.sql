-- AUD-028: honest sync status. NOT APPLIED by the build agents; the owner applies it.
-- The app already works without it: a 'skipped' run is stored as 'partial' (reason in `error`) and a 'no_data' account status as
-- 'partial' until this migration is applied. Idempotent.

-- 1. sync_runs.status enum gets 'skipped' (a stream that did not run: needs approval, no account selected, sandbox).
--    ALTER TYPE ... ADD VALUE cannot be used in the same transaction as its first use; this file only adds it.
alter type public.sync_status add value if not exists 'skipped';

-- 2. social_accounts.last_sync_status gets 'no_data' (Meta answered, nothing to show).
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.social_accounts'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%last_sync_status%';
  if c is not null then execute format('alter table public.social_accounts drop constraint %I', c); end if;
  alter table public.social_accounts add constraint social_accounts_last_sync_status_check
    check (last_sync_status is null or last_sync_status in ('ok','partial','no_data','error','needs_attention'));
end $$;
