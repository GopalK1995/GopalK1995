# Database migrations backlog

Items found while building T019 to T030 that need SQL. Nothing here has run on real Supabase. Numbers are the planned migrations.

## 0021 (with T031)
- `mock` connector catalogue row plus availability rows, so the Integrations page lists it per workspace. **Done in 0021 (T031).**
- Unique (workspace_id, connector_id) on `integrations`. **Done in 0021 (T031).**
- `scheduled_jobs` row for `connector.scan`, every 15 minutes. **Done in 0021 (T031).**
- `conversations.status` gains `snoozed`. **Done in 0021 (T031).**
- Notification quiet-hours columns and a `dedupe_key` column (with a unique index per user). **Done in 0021 (T031).**
- Event types: `segment.*`, `audience.exported`, comment and mention events. **Done in 0021 (T031).**
- `ai_policies` table. **Done in 0021 (T031).**
- `can_contact_many(uuid[], purpose)` for batch consent checks. **Done in 0021 (T031).**
- Audit trigger on `audience_segments`. **Done in 0021 (T031).**

## 0022 (with T041)
- 7-day purge of `webhook_inbox` rows whose signature failed (add to the maintenance job).

## 0023 (with T061)
- `queue_set_vt` wrapper for pgmq visibility timeout.
- `api_keys.rate_limit_per_min`.

## Webhooks (T024 follow-ups, optional)
- `webhook_endpoints.options jsonb` to replace the `@pii` and `@filter:<field>=<a|b>` entries now stored in `event_types`. **Done in 0021 (T031).**
- `webhook_endpoints.last_success_at timestamptz`. **Done in 0021 (T031).**
- `public.webhook_bump_failures(p_endpoint uuid, p_ok bool)` for atomic failure counters. **Done in 0021 (T031).**
- A `can(user, ws, perm)` service RPC so the send-time `pii.read` check covers custom roles.

## Custom fields (T030)
- Fix `metadata.validate_custom()`: it rejects any key whose field is archived ("unknown custom field"), even an unchanged stored value. Skip archived keys whose value equals the old row's value (or move retired values aside). Until fixed, retiring a field that holds data blocks later edits to those records' custom values. **Done in 0021 (T031).**
- Optional: `field_defs.version` (the app uses `updated_at` as the concurrency token today). **Done in 0021 (T031).**

## Integration pass (INTEG1)
- Real-session lead and deal mappers read `version` (added by 0014) and `stage_id` joined to `pipeline_stages.key`. `probability`, `potentialValue`, `tags` and `nextAction` have no column and map to 0 or empty.

## T033 needs (custom objects, layouts, saved views)
- Audit triggers (`audit_row_change`) on `records`, `record_links`, `object_types`, `layouts` and `saved_views`. Until then the app writes explicit audit rows (`records.created|updated|deleted|linked|unlinked`, `objects.created|updated|enabled|disabled`, `layouts.saved|deleted`) with ids and field keys only, never values. Saved views are not audited.
- Event types for custom-object records (`record.created`, `record.updated`, `record.deleted`) so webhooks, the activity feed and agents see them; only `metadata.changed` is emitted today (object and layout changes).
- A trigger on `records` that copies `data ->> object_types.primary_field` into `records.title` on insert and update. The app mirrors it on its own writes, but an edit through `<CustomFields/>` (T030 save) changes `data` only, so the stored title can lag; the pages show `data[primary]` first.
- A version bump and `updated_at` trigger on `layouts` (the app bumps `version` itself and uses it as the optimistic token). Optionally `object_types.version` instead of the `updated_at` token.
- A retention job that purges soft-deleted records (`records.deleted_at`) and the `record_links` that point at them; today nothing is ever hard-deleted and links to a deleted record are filtered out when the other end is read.
- `src/lib/notify/urls.ts` (T027) sends `obj:<key>` notifications to `/records/<key>/<id>`; the page lives at `/o/<key>/<id>`. Change the path there, or add a redirect route. The `notifications.url` check (`^/[^/\]`) allows either.
- Confirm `authz.my_grants()` returns the `obj:<key>.read|write|delete` rows of the caller's role (the object-type trigger inserts them into `permissions` and `role_permissions`); the pages rely on it through `loadPrincipal()`.
- Optional: a per-tenant cap on custom objects (`org_admin_policies.max_custom_objects`); only `allow_custom_objects` exists.

## T032 needs (pipelines)
- `pipelines.version int` plus the `bump_version` trigger (or `updated_at`): rename and archive of a pipeline are last-write-wins today; stages are already guarded by `pipeline_stages.version`.
- One RPC `metadata.save_pipeline_stages(p_pipeline, p_stages jsonb)` that applies a whole stage list (inserts, updates, positions, archive) in one transaction. The app writes them one by one: positions are parked at 1000+ first because `(pipeline_id, position)` is unique and not deferrable, so a crash mid-save can leave rows parked above 1000 until the next save. Make that constraint `deferrable initially deferred` in the same change.
- Trigger on `deals` / `leads`: refuse a `stage_id` that is archived or belongs to another pipeline than the row's `pipeline_id` (the repo checks, the database does not), and refuse a `stage_id` update whose stage lists `required_fields` that the row lacks (enforcement for API, import and connector writers; the app enforces it in the move action only).
- Archiving a stage or pipeline that still has records is checked in the app (RLS-limited count). A `before update of archived_at` trigger counting rows would make it exact.
- `public.pipeline_stages.color` has no check constraint; the app accepts only the six `StageColor` tokens and falls back to the outcome's colour otherwise.
- `POST /api/v1/deals/{id}/move` (src/lib/api/crud.ts) looks a stage up by `(tenant_id, key)` with `maybeSingle()`. With two pipelines that use the same key it errors; it must resolve the key inside the deal's `pipeline_id` (the same change T032 made to `deals.move` in the repo).

## T034 needs (CSV / Excel import and export)
No migration was written. Needed before real-mode import works:
- Private bucket and storage RLS (path `<tenant uuid>/<workspace uuid>/<job uuid>/<file>`):
```sql
insert into storage.buckets (id, name, public, file_size_limit)
values ('imports', 'imports', false, 5242880)
on conflict (id) do update set public = false, file_size_limit = 5242880;
drop policy if exists imports_select on storage.objects;
drop policy if exists imports_insert on storage.objects;
create policy imports_select on storage.objects for select to authenticated using (
  bucket_id = 'imports' and (storage.foldername(name))[2]::uuid in (select authz.ws_with('leads.import', 'own')));
create policy imports_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'imports' and (storage.foldername(name))[2]::uuid in (select authz.ws_with('leads.import', 'own')));
-- no update or delete policies: the job (service role) writes the error report
```
- Realtime and audit for `import_jobs` (progress broadcast, history audit):
```sql
create trigger z7_import_jobs_rt after insert or update or delete on public.import_jobs for each row execute function public.realtime_broadcast_row();
create trigger trg_import_jobs_audit after insert or update or delete on public.import_jobs for each row execute function public.audit_row_change();
```
- Audit actions `export.csv` and `import.started` go through `audit_record` (the action pattern already allows them).
- There is no `contacts.export` or `accounts.export`: those exports use `leads.export` plus the object's read permission.
- Leads and contacts read through RLS need `pii.read`; a custom role with `leads.export` but no `pii.read` exports zero rows.

## T035 needs (WhatsApp Business, Cloud API)
No migration was written. Needed before real-mode WhatsApp works (Lawsome DB is at 0021). All idempotent; the app tolerates the optional columns being absent.
```sql
-- 1. Tenant isolation: a phone number belongs to exactly one workspace, platform-wide (wa_numbers only has unique (workspace_id, phone_number_id)).
create unique index if not exists wa_numbers_phone_number_id_unique on public.wa_numbers (phone_number_id);

-- 2. Dedupe inbound messages by the WhatsApp message id (wamid). The connector also checks before insert; this makes it race-proof.
create unique index if not exists messages_external_id_unique on public.messages (tenant_id, external_id) where external_id is not null;

-- 3. Media by reference and failure detail (optional: the connector retries without these columns when they are missing).
alter table public.messages
  add column if not exists attachments  jsonb not null default '[]',   -- [{kind, media_id, mime, sha256, filename, size, bucket, path, status}]
  add column if not exists error_code   text,                           -- vendor code (e.g. 131047) or a block reason (no_consent, window_closed ...)
  add column if not exists error_detail text;                           -- fixed failure label, never message text or a recipient
alter table public.messages drop constraint if exists messages_attachments_array;
alter table public.messages add constraint messages_attachments_array check (jsonb_typeof(attachments) = 'array');

-- 4. Private bucket for inbound media. Path: <tenant uuid>/<workspace uuid>/<connection uuid>/<message uuid>. Written by the service role only.
insert into storage.buckets (id, name, public, file_size_limit)
values ('wa-media', 'wa-media', false, 16777216)
on conflict (id) do update set public = false, file_size_limit = 16777216;
drop policy if exists wa_media_read on storage.objects;
create policy wa_media_read on storage.objects for select to authenticated
  using (bucket_id = 'wa-media' and (storage.foldername(name))[2]::uuid in (select public.member_ws_ids()));
```
Also needed by the integrator:
- The `connector.scan` job (every 15 min) drives the `templates` (every 6 h) and `dispatch` (every 15 min) streams, so sending can be up to 15 minutes late. For prompt sending enqueue `connector.sync` `{connection_id, stream: "dispatch", trigger: "manual"}` (dedupe key `wa-dispatch:<message id>`) right after the inbox inserts a `queued` outbound WhatsApp message, or add an AFTER INSERT trigger on `messages` that does it.
- Confirm the event types `message.received|sent|status` and `consent.changed` are in `public.event_types`.
- `public.audit_record` is granted to `authenticated` only, so the service-role paths (webhook, dispatch) rely on the row-change audit triggers on messages, conversations and consent_log plus the events above. A service-callable audit RPC would let the connector write explicit `whatsapp.*` audit rows.
- One Meta app has ONE callback URL. Manual connections (the tenant's own Meta app) use `/api/hooks/whatsapp/<connection id>` as built. For platform-wide embedded signup a router is needed that maps `entry[].changes[].value.metadata.phone_number_id` to `wa_numbers.integration_id` and forwards to the same pipeline (`parseWebhook` + `connector.webhook.handle`); the signature secret is then `WHATSAPP_APP_SECRET`.
- `consent_log.subject_ref` for a STOP from a number with no lead is the sha256 of the E.164 number; a lead created later for that number is NOT blocked by it (can_contact keys on lead_id). A subject_ref lookup when creating leads would close that.

## T037 needs (Razorpay, tenant payments)
No migration was written. All idempotent; the connector tolerates the optional columns being absent (writes retry without them).
```sql
-- 1. Audit/event types the connector emits (also in src/lib/events/catalog/payment.ts). The catalogue is a superset of the SQL seed, so order does not matter.
insert into public.event_types (type, domain, description, webhook_eligible, agent_eligible) values
  ('payment.created', 'payment', 'A payment link or order was created', true, true),
  ('payment.paid', 'payment', 'A payment was received', true, true),
  ('payment.failed', 'payment', 'A payment attempt failed', true, true),
  ('payment.cancelled', 'payment', 'A payment link was cancelled or expired', true, true),
  ('payment.refunded', 'payment', 'A payment was fully refunded', true, true),
  ('payment.refund_partial', 'payment', 'A payment was partly refunded', true, true),
  ('payment.mismatch', 'payment', 'A payment event did not match the stored amount or account and was not applied', false, true)
on conflict (type) do update set domain = excluded.domain, description = excluded.description,
  webhook_eligible = excluded.webhook_eligible, agent_eligible = excluded.agent_eligible;

-- 2. Optional detail columns on payments (refund total in minor units, vendor failure code). Never a message, card or customer detail.
alter table public.payments
  add column if not exists refunded_paise bigint not null default 0 check (refunded_paise >= 0),
  add column if not exists failure_code   text;
```
Also needed by the integrator:
- Nothing creates a payment link yet from the UI (no page in Owns): a server action should call `createPaymentRequest(deps, conn, gatewayOf(rt, conn, secrets), { dealId, ... })` (src/lib/connectors/razorpay/links.ts) behind `deals.write` plus `integrations.read`, using `razorpayRuntime()` for deps. `src/components/payments/*` has the mode badge and status chip only.
- Connection setting `paid_stage_key` (stage key in the deal's own pipeline, e.g. the hospitality "Booked" stage) decides the stage move on payment; unset = payment recorded, deal untouched. Optional setting `account_id` (acc_...) makes the webhook refuse events for any other Razorpay account. A settings editor for both is not built.
- Webhook URL for the tenant to paste into Razorpay: `/api/hooks/razorpay/<connection id>`; events to tick: payment_link.paid / partially_paid / expired / cancelled, payment.authorized / captured / failed, order.paid, refund.created / processed / failed.
- A connector_availability row for `razorpay` per environment (gate none; test keys work immediately).
- Webhook-driven refund matching relies on the payment entity carrying the CRM reference in `notes` (Razorpay copies payment link and order notes onto the payment). A refund for a payment whose notes lack it and whose link id differs from the stored external id cannot be matched (rejected as unknown_payment).
