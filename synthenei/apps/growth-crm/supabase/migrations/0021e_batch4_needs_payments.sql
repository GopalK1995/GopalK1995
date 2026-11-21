-- 0021e Batch 4 gate: T037 Razorpay needs. Idempotent, additive only.
insert into public.event_types (type, domain, description, webhook_eligible, agent_eligible) values
  ('payment.created', 'payment', 'A payment link or order was created', true, true),
  ('payment.paid', 'payment', 'A payment was received', true, true),
  ('payment.failed', 'payment', 'A payment attempt failed', true, true),
  ('payment.cancelled', 'payment', 'A payment link was cancelled or expired', true, true),
  ('payment.refunded', 'payment', 'A payment was fully refunded', true, true),
  ('payment.refund_partial', 'payment', 'A payment was partly refunded', true, true),
  ('payment.mismatch', 'payment', 'A payment event did not match the stored amount or account and was not applied', false, true)
on conflict (type) do nothing;
alter table public.payments
  add column if not exists refunded_paise bigint not null default 0 check (refunded_paise >= 0),
  add column if not exists failure_code   text;
