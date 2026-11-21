-- 0021e Batch 4 gate: covering index for the email_suppressions.tenant_id foreign key (advisor finding). Idempotent.
create index if not exists email_suppressions_tenant on public.email_suppressions (tenant_id);
