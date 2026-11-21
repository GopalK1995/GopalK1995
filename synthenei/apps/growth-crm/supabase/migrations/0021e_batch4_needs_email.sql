-- 0021e Batch 4 gate: T038 email needs. Idempotent, additive only.
create table if not exists public.email_suppressions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null check (email = lower(email)),
  reason       text not null check (reason in ('hard_bounce','complaint','unsubscribe','manual')),
  source       text not null,
  lead_id      uuid references public.leads(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (workspace_id, email)
);
create index if not exists email_suppressions_ws_created on public.email_suppressions (workspace_id, created_at desc);
create index if not exists email_suppressions_lead on public.email_suppressions (lead_id) where lead_id is not null;
alter table public.email_suppressions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'email_suppressions' and policyname = 'email_suppressions_select') then
    create policy email_suppressions_select on public.email_suppressions for select to authenticated
      using (workspace_id in (select public.member_ws_ids()));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_email_suppressions_audit' and tgrelid = 'public.email_suppressions'::regclass) then
    create trigger trg_email_suppressions_audit after insert or update or delete on public.email_suppressions
      for each row execute function public.audit_row_change();
  end if;
end $$;
insert into public.event_types (type, domain, description, webhook_eligible, agent_eligible) values
  ('email.bounced', 'email', 'An address hard-bounced and was suppressed', true, true),
  ('email.complained', 'email', 'A recipient reported an email as spam; marketing consent was withdrawn', true, true),
  ('email.unsubscribed', 'email', 'A recipient unsubscribed from email; marketing consent was withdrawn', true, true),
  ('email.suppressed', 'email', 'An address was added to the suppression list by hand', false, true)
on conflict (type) do nothing;
alter table public.message_templates add column if not exists subject text;
alter table public.messages
  add column if not exists subject text,
  add column if not exists error_code text,
  add column if not exists error_detail text;
