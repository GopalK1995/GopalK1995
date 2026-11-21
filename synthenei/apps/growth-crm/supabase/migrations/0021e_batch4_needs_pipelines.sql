-- 0021e Batch 4 gate: T032 pipelines needs (additive part only). Idempotent.
-- Skipped on purpose: save_pipeline_stages RPC, deferrable position constraint, deals/leads stage triggers, stage colour check.
alter table public.pipelines add column if not exists version int not null default 1;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'z9_pipelines_version' and tgrelid = 'public.pipelines'::regclass) then
    create trigger z9_pipelines_version before update on public.pipelines for each row execute function public.bump_version();
  end if;
end $$;
