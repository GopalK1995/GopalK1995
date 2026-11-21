-- 0021e Batch 4 gate: T033 custom objects needs (additive part only). Idempotent.
-- Skipped on purpose: audit triggers on records / record_links / object_types / layouts / saved_views (audit_row_change would store
-- records.data values, and the app already writes explicit value-free audit rows), the layouts version trigger (the app bumps it
-- itself, a trigger would double-bump the optimistic token), and the soft-delete purge job (it deletes data).
insert into public.event_types (type, domain, description, webhook_eligible, agent_eligible) values
  ('record.created', 'record', 'A custom-object record was created', true, true),
  ('record.updated', 'record', 'A custom-object record was updated', true, true),
  ('record.deleted', 'record', 'A custom-object record was deleted', true, true)
on conflict (type) do nothing;
create or replace function public.records_mirror_title() returns trigger
language plpgsql security definer set search_path = '' as $f$
declare v_pf text; v_t text;
begin
  select o.primary_field into v_pf from public.object_types o where o.id = new.object_type_id;
  if v_pf is not null then
    v_t := nullif(btrim(new.data ->> v_pf), '');
    if v_t is not null then new.title := left(v_t, 300); end if;
  end if;
  return new;
end $f$;
revoke all on function public.records_mirror_title() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'a30_records_title' and tgrelid = 'public.records'::regclass) then
    create trigger a30_records_title before insert or update of data on public.records
      for each row execute function public.records_mirror_title();
  end if;
end $$;
