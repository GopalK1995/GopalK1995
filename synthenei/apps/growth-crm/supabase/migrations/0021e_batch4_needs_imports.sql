-- 0021e Batch 4 gate: T034 import needs. Idempotent, additive only.
insert into storage.buckets (id, name, public, file_size_limit)
values ('imports', 'imports', false, 5242880)
on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'imports_select') then
    create policy imports_select on storage.objects for select to authenticated using (
      bucket_id = 'imports' and (storage.foldername(name))[2]::uuid in (select authz.ws_with('leads.import', 'own')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'imports_insert') then
    create policy imports_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'imports' and (storage.foldername(name))[2]::uuid in (select authz.ws_with('leads.import', 'own')));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'z7_import_jobs_rt' and tgrelid = 'public.import_jobs'::regclass) then
    create trigger z7_import_jobs_rt after insert or update or delete on public.import_jobs for each row execute function public.realtime_broadcast_row();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_import_jobs_audit' and tgrelid = 'public.import_jobs'::regclass) then
    create trigger trg_import_jobs_audit after insert or update or delete on public.import_jobs for each row execute function public.audit_row_change();
  end if;
end $$;
