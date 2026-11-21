-- Batch 5 gate: event types emitted by T046, T047, T049. Additive, idempotent.
insert into public.event_types (type, domain, description, webhook_eligible, agent_eligible) values
  ('booking.created', 'booking', 'A booking was made or imported (scheduling tool, channel manager or calendar feed)', true, true),
  ('booking.cancelled', 'booking', 'A booking was cancelled (scheduling tool, channel manager or calendar feed)', true, true),
  ('booking.unmatched', 'booking', 'A booking or cancellation came from an email that matches no lead', false, true),
  ('lead.sla_breached', 'lead', 'A lead first-response SLA was breached', true, true)
on conflict (type) do nothing;
