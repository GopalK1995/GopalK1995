-- 0022d (T041): soft-delete retention for custom-object records (T033 need).
-- Adds the purge FUNCTION and a scheduled_jobs row that is DISABLED. Nothing is deleted by this migration and nothing runs until an owner
-- enables the row (and the app registers a `maintenance.purge_soft_deleted` handler that calls private.purge_soft_deleted).
-- Additive and idempotent.

create or replace function private.purge_soft_deleted(p_days int default 90)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_links int := 0; v_records int := 0;
begin
  if p_days is null or p_days < 30 then raise exception 'retention must be at least 30 days' using errcode = '22023'; end if;
  with doomed as (select id from public.records where deleted_at is not null and deleted_at < now() - make_interval(days => p_days)),
       dl as (delete from public.record_links l using doomed d
               where l.from_id = d.id or l.to_id = d.id returning 1)
  select count(*) into v_links from dl;
  with dr as (delete from public.records where deleted_at is not null and deleted_at < now() - make_interval(days => p_days) returning 1)
  select count(*) into v_records from dr;
  return jsonb_build_object('records', v_records, 'record_links', v_links);
end $$;
revoke all on function private.purge_soft_deleted(int) from public, anon, authenticated;

insert into public.scheduled_jobs (tenant_id, workspace_id, kind, cron, tz, payload, enabled)
select null, null, 'maintenance.purge_soft_deleted', '30 3 * * *', 'Asia/Kolkata', '{"retention_days": 90}'::jsonb, false
 where not exists (select 1 from public.scheduled_jobs where kind = 'maintenance.purge_soft_deleted' and tenant_id is null and workspace_id is null);
