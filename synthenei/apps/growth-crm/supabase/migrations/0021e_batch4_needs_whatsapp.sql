-- 0021e Batch 4 gate: T035 WhatsApp needs. Idempotent, additive only.
create unique index if not exists wa_numbers_phone_number_id_unique on public.wa_numbers (phone_number_id);
create unique index if not exists messages_external_id_unique on public.messages (tenant_id, external_id) where external_id is not null;
alter table public.messages
  add column if not exists attachments  jsonb not null default '[]',
  add column if not exists error_code   text,
  add column if not exists error_detail text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'messages_attachments_array' and conrelid = 'public.messages'::regclass) then
    alter table public.messages add constraint messages_attachments_array check (jsonb_typeof(attachments) = 'array');
  end if;
end $$;
insert into storage.buckets (id, name, public, file_size_limit)
values ('wa-media', 'wa-media', false, 16777216)
on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'wa_media_read') then
    create policy wa_media_read on storage.objects for select to authenticated
      using (bucket_id = 'wa-media' and (storage.foldername(name))[2]::uuid in (select public.member_ws_ids()));
  end if;
end $$;
