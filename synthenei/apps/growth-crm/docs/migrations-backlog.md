# Database migrations backlog

Items found while building T019 to T030 that need SQL. Nothing here has run on real Supabase. Numbers are the planned migrations.

## Applied at gate 4 (21 Nov 2026, Lawsome, migrations 0021e_batch4_needs_*)
Done: T035 (wa_numbers phone unique, messages attachments/error columns, `wa-media` bucket + policy), T036 (0021c, already applied), T037 (payment event types, payments columns), T038 (email_suppressions + audit trigger, email event types, subject/error columns), T039 (ga4_daily.campaign and workspace/day index only), T034 (`imports` bucket + storage policies, import_jobs realtime + audit triggers), T033 (record.* event types, records title-mirror trigger), T032 (pipelines.version + bump trigger).
Skipped on purpose, still open: ga4_daily primary key swap and the connector_catalog / connector_availability updates (T039, change existing rows or constraints); audit triggers on records, record_links, object_types, layouts, saved_views (audit_row_change stores records.data values; the app writes value-free audit rows itself); layouts version trigger (app bumps version itself); soft-delete purge job (deletes data); save_pipeline_stages RPC, deferrable position constraint, deals/leads stage-guard triggers, stage colour check (T032: behaviour change, needs design); Tamil `imports` namespace.

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

## Applied by T041 (21 Nov 2026, Lawsome, migrations 0022*)
Done: 0022_fk_indexes (40 FK indexes), 0022b (value-free audit triggers on records, record_links, object_types, layouts, saved_views; layouts version trigger), 0022c (deferrable stage positions, colour check, archived-stage and archive guards, `save_pipeline_stages` RPC), 0022d (`private.purge_soft_deleted` plus a DISABLED scheduled_jobs row), 0022e (list composite indexes), 0022f (revoke EXECUTE on 3 trigger functions), 0022g (trigram search indexes). Still open: ga4_daily key swap (4,320 rows), T039 catalogue UPDATEs, DB enforcement of stage required_fields, webhook_inbox failed-signature purge. Details in docs/gates/advisors.md.

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

## T036 needs (Meta Lead Ads, Instagram DMs, Ads Insights)
No migration was written. Needed before real-mode Meta works. All idempotent. Ad account details reuse the existing `ad_accounts` table (platform `meta`); campaigns reuse `campaigns` (`external_ids->>'meta'`); metrics reuse `campaign_daily_metrics` (0019 columns `integration_id`, `external_campaign_id`).
```sql
-- 1. Tenant isolation: a Facebook Page / Instagram account belongs to exactly one workspace, platform-wide.
create table if not exists public.meta_assets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid references public.integrations(id) on delete set null,   -- null = released (connection disconnected / re-selected)
  platform       text not null check (platform in ('facebook_page', 'instagram')),
  external_id    text not null,
  name           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint meta_assets_asset_unique unique (platform, external_id)
);
create index if not exists meta_assets_workspace on public.meta_assets (workspace_id);
create index if not exists meta_assets_integration on public.meta_assets (integration_id);
alter table public.meta_assets enable row level security;
-- Read for members of the workspace; writes are service role only (the connector).
drop policy if exists meta_assets_read on public.meta_assets;
create policy meta_assets_read on public.meta_assets for select to authenticated using (workspace_id in (select public.member_ws_ids()));

-- 2. Dedupe Instagram DMs by the message id (mid). Shared with T035 (same index; skip if already applied).
create unique index if not exists messages_external_id_unique on public.messages (tenant_id, external_id) where external_id is not null;

-- 3. Lookups used by the webhook path.
create index if not exists leads_ig_igsid on public.leads (workspace_id, (external_ids->>'instagram_igsid')) where external_ids ? 'instagram_igsid';
create index if not exists campaigns_meta_external on public.campaigns (workspace_id, (external_ids->>'meta')) where external_ids ? 'meta';
```
Also needed by the integrator:
- Webhooks: the per-connection URL `/api/hooks/meta-ads/<connection id>` works for a tenant's own Meta app. One platform Meta app has ONE callback URL: a router that maps `entry[].changes[].value.page_id` (leadgen) / `entry[].id` (instagram) to `meta_assets.integration_id` and forwards to the same pipeline is needed for the shared app (signature secret = `META_APP_SECRET`). Until then the callback URL of the app must be `/api/hooks/meta-ads/<connection id>` (one connection per app).
- UI for selection: call `listMetaAssets` / `selectMetaAssets` (src/lib/connectors/meta-ads/assets.ts) from a server action (permission `integrations.manage`) after the OAuth callback returns `connected=1`; show the returned `verifyToken` once. Until the selection runs no stream or webhook does anything.
- Inbox: `channelFor("instagram")` should be live when a meta-ads connection with an Instagram account is connected; show `messages.error_code` (`window_closed`, `text_too_long`, `empty_text`, `no_recipient`) with the `metaAds` strings (`block.*`). The dispatcher takes queued Instagram messages every 15 min; enqueue `connector.sync {connection_id, stream: "dispatch"}` after an insert for prompt sending.
- Connection settings (`integrations.settings`, no editor yet): `consent_rules` ([{source: "field"|"checkbox", key, purpose}]) and `fx_to_inr` ({"USD": rate}) for non-INR ad accounts. Without a rate those rows are rejected, never converted with a guessed rate.
- Facebook Login for Business needs a `config_id` on the authorize URL; the OAuth start route has no per-connector env hook, so it is not sent (classic Facebook Login scopes are used).
- Offline conversions (`ads_management`, `deal.won` / booking paid) are not built: `connector.push` fan-out only routes lead-scoped events, and the card's permission is optional (docs/META-PERMISSIONS.md).
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

## T038 needs (Email outbound + Mailchimp)
No migration was written. All idempotent. The connector tolerates the optional columns being absent (writes retry without them) and a missing suppression table (reads as empty with a logged warning; unsubscribes and complaints still hold through `consent_log`, which is what `can_contact` reads).
```sql
-- 1. Suppression list: hard bounces, spam complaints, unsubscribes, manual. One row per address per workspace. Written by the service role only.
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
alter table public.email_suppressions enable row level security;
drop policy if exists email_suppressions_select on public.email_suppressions;
create policy email_suppressions_select on public.email_suppressions for select to authenticated
  using (workspace_id in (select public.member_ws_ids()));
-- no insert/update/delete policy: only the service role (webhooks, jobs, the public unsubscribe endpoint) writes.
drop trigger if exists trg_email_suppressions_audit on public.email_suppressions;
create trigger trg_email_suppressions_audit after insert or update or delete on public.email_suppressions
  for each row execute function public.audit_row_change();   -- 'email' is masked as [pii] by the generic function

-- 2. Event types the connector emits (also in src/lib/events/catalog/email.ts).
insert into public.event_types (type, domain, description, webhook_eligible, agent_eligible) values
  ('email.bounced', 'email', 'An address hard-bounced and was suppressed', true, true),
  ('email.complained', 'email', 'A recipient reported an email as spam; marketing consent was withdrawn', true, true),
  ('email.unsubscribed', 'email', 'A recipient unsubscribed from email; marketing consent was withdrawn', true, true),
  ('email.suppressed', 'email', 'An address was added to the suppression list by hand', false, true)
on conflict (type) do update set domain = excluded.domain, description = excluded.description,
  webhook_eligible = excluded.webhook_eligible, agent_eligible = excluded.agent_eligible;

-- 3. Subject lines (without them the subject is read from a "Subject: ..." first line of the body, else a generic one) and the
--    failure columns shared with T035 (messages.error_code / error_detail).
alter table public.message_templates add column if not exists subject text;
alter table public.messages
  add column if not exists subject text,
  add column if not exists error_code text,
  add column if not exists error_detail text;
-- Idempotent campaign recording: one stored message per provider message id (the connector also checks before inserting).
create unique index if not exists messages_tenant_external_uidx on public.messages (tenant_id, external_id) where external_id is not null;
```
Also needed by the integrator:
- Env: `EMAIL_UNSUBSCRIBE_SECRET` (32+ random chars) and `APP_BASE_URL` MUST be set before any tenant email goes out; without them every send is blocked as `no_unsubscribe` (mail that cannot be opted out of is never sent). Others: `RESEND_API_BASE` (stubs), `RESEND_API_KEY` + `EMAIL_FROM` + `EMAIL_REPLY_TO` (platform system mail only), `MAILCHIMP_CLIENT_ID` / `MAILCHIMP_CLIENT_SECRET` / `MAILCHIMP_API_BASE`.
- `connector_availability` rows for `resend`, `email-smtp` (gate none) and `mailchimp` (gate needs_client_credentials until the Mailchimp app exists) per environment; catalogue rows if the Integrations list is DB-driven.
- Platform system mail: `setEmailSender(platformEmailSender(process.env))` from `src/lib/connectors/email/platform.ts` replaces the stub in `src/lib/notify/email.ts` (not in T038's Owns).
- Inbox: `channelFor("email")` in `inbox/_lib/channel.ts` should return `{ id: "email", live: true }` when a `resend` or `email-smtp` connection is connected; queued email rows are then sent by the `dispatch` stream within 5 minutes (or enqueue `connector.sync` for stream `dispatch` on insert).
- Campaign sends: a server action should call `enqueueEmailCampaign({ connection_id, template_id, lead_ids, campaign_key }, tenantId)` (`src/lib/connectors/email/jobs.ts`) behind `messages.send_email`. Consent is decided per recipient at send time.
- Resend webhook: in Resend add `<APP_BASE_URL>/api/hooks/resend/<connection id>` (shown on /settings/email) with delivered, bounced, complained events, then paste the `whsec_` secret on that page.
## T039 needs (Google Analytics 4, Google Ads, Google Sheets import)
No migration was written. All idempotent. The connectors tolerate every item below being absent: GA4 writes fall back to the table as it is today (campaign dropped, rows merged per key); Ads and Sheets need nothing new.
```sql
-- 1. Catalogue alignment: 0015 seeded GA4 as a service-account connector and Sheets / Ads / GA4 without a sandbox. T039 ships all three as OAuth
--    connectors with a Showcase (mock) gateway. GA4 and Sheets need no vendor approval to connect (Google OAuth app verification is a separate owner task).
update public.connector_catalog set auth_kind = 'oauth2', gate = 'none', sandbox_supported = true where id = 'ga4';
update public.connector_catalog set gate = 'none', sandbox_supported = true where id = 'google-sheets';
update public.connector_catalog set sandbox_supported = true where id = 'google-ads';   -- gate stays needs_vendor_approval: "Needs Google Ads developer token (basic access)"
-- availability: re-derive for the three rows with the 0015 rule (live where nothing external is needed, sandbox elsewhere, disabled in production when gated)
insert into public.connector_availability (connector_id, env, mode, gate_status, note)
select c.id, e.env,
       case when c.gate = 'none' and e.env <> 'demo' then 'live' when e.env = 'production' then 'disabled' when c.sandbox_supported then 'sandbox' else 'disabled' end,
       case c.gate when 'none' then 'ready' else c.gate end, null
  from public.connector_catalog c cross join (values ('production'), ('staging'), ('demo')) e(env)
 where c.id in ('ga4', 'google-sheets', 'google-ads')
on conflict (connector_id, env) do update set mode = excluded.mode, gate_status = excluded.gate_status;

-- 2. ga4_daily: the campaign dimension and a workspace-safe key. Today the primary key is (tenant_id, day, channel_group, source_medium, device_category, city, landing_page):
--    two workspaces of one tenant would overwrite each other and the campaign is lost. The store tries the new key first and falls back to the old one.
alter table public.ga4_daily add column if not exists campaign text not null default '';
alter table public.ga4_daily drop constraint if exists ga4_daily_pkey;
alter table public.ga4_daily add constraint ga4_daily_pkey primary key (tenant_id, workspace_id, day, channel_group, source_medium, device_category, city, landing_page, campaign);
create index if not exists ga4_daily_ws_day on public.ga4_daily (workspace_id, day);   -- the per-window replace deletes by workspace + day range
```
Also needed by the integrator:
- OAuth: one Google Cloud OAuth client for all three connectors (env `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`); authorised redirect URIs `<app>/api/oauth/ga4/callback`, `/api/oauth/google-ads/callback`, `/api/oauth/google-sheets/callback` (also in `OAUTH_REDIRECT_URIS` when that list is used). Scopes: `analytics.readonly`, `adwords`, `spreadsheets.readonly`: sensitive scopes, so the Google OAuth app needs verification before more than 100 test users can connect.
- Google Ads: env `GOOGLE_ADS_DEVELOPER_TOKEN` (the connector is `not_configured` without it; test accounts work with a test-level token, live accounts need basic access). Optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID` for a platform manager account. The API version in the URL is `GOOGLE_ADS_API_VERSION` (default in code `v21`): update it when Google sunsets a version.
- Server actions (not in Owns, no UI built), each behind `integrations.manage` and, for Sheets, also `leads.import` plus the object's write permission (`leads.write` / `contacts.write` / `accounts.write`): `listGa4Properties` / `selectGa4Property` (src/lib/connectors/google/ga4/select.ts), `listAdsCustomers` / `selectAdsCustomer` (ads/select.ts), `listSheetTabs` / `previewSheet` / `startSheetImport` (sheets/select.ts, with `supabaseImportPort(db)` from sheets/import-supabase.ts). Build the deps with `requestRuntime(audit)` and the actor from the session. After `startSheetImport` enqueue `connector.sync {connection_id, stream: "import", trigger: "manual"}` for prompt import. Until a property / customer / sheet is chosen no stream does anything.
- Sheets column mapping: the field-mapping editor edits `integration_field_maps` rows with `external_object = 'Row'`, `external_field` = column header, `local_table` = leads | contacts | accounts, `local_column` = the CRM field (or `custom.<key>`). `startSheetImport` also stores the resolved mapping in the connection's saved configuration (credential bundle key `sheet_config`), so the editor is optional.
- Non-INR Ads accounts: connection setting `fx_to_inr` ({"USD": rate}) as for Meta; without a rate those rows are rejected, never converted with a guessed rate.
- Showcase: the sandbox token `google-mock-token` (or `APP_ENV=demo` without credentials) serves sample data, never in production. Showcase Ads campaigns are `is_synthetic`; Showcase sheet imports flag leads `is_synthetic`.
## T044 needs (LinkedIn Lead Gen Forms + Ads analytics)
No migration was written. Needed before real-mode LinkedIn works. Idempotent and additive. Ad account details reuse the existing `ad_accounts` table (platform `linkedin`); campaigns reuse `campaigns` (channel `linkedin`, `external_ids->>'linkedin'`); metrics reuse `campaign_daily_metrics` (0019 columns `integration_id`, `external_campaign_id`).
```sql
-- 1. Tenant isolation: a LinkedIn ad account belongs to exactly one workspace, platform-wide.
create table if not exists public.linkedin_assets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid references public.integrations(id) on delete set null,   -- null = released (connection disconnected / re-selected)
  platform       text not null check (platform in ('linkedin_ad_account')),
  external_id    text not null,
  name           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint linkedin_assets_asset_unique unique (platform, external_id)
);
create index if not exists linkedin_assets_workspace on public.linkedin_assets (workspace_id);
create index if not exists linkedin_assets_integration on public.linkedin_assets (integration_id);
alter table public.linkedin_assets enable row level security;
-- Read for members of the workspace; writes are service role only (the connector).
drop policy if exists linkedin_assets_read on public.linkedin_assets;
create policy linkedin_assets_read on public.linkedin_assets for select to authenticated using (workspace_id in (select public.member_ws_ids()));

-- 2. Lookup used when a lead is matched back to a LinkedIn campaign.
create index if not exists campaigns_linkedin_external on public.campaigns (workspace_id, (external_ids->>'linkedin')) where external_ids ? 'linkedin';
```
Also needed by the integrator:
- UI for selection: call `listLinkedInAccounts` / `selectLinkedInAccount` (src/lib/connectors/linkedin/assets.ts) from a server action (permission `integrations.manage`, deps from `requestRuntime(audit)`) after the OAuth callback returns `connected=1`. Until the selection runs no stream does anything.
- Env: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` (the connector is `not_configured` without them); optional `LINKEDIN_API_BASE`, `LINKEDIN_API_VERSION`. A `connector_availability` row for `linkedin` per environment (seeded `needs_vendor_approval` by 0015).
- Connection settings (`integrations.settings`, no editor yet): `consent_rules` ([{source: "field"|"checkbox", key, purpose}]; `field` key is the form field name, `checkbox` key is LinkedIn's consent id) and `fx_to_inr` ({"USD": rate}) for non-INR ad accounts. There are no default consent rules: nothing is granted without one.
- Lead Sync webhook (push) is not wired: it needs LinkedIn's separate approval and a LinkedIn signature scheme (HMAC with the client secret) in the T023 receiver. Polling covers the gap; `handleLeadResponse` (linkedin/leads.ts) is the function a webhook consumer would call.


## T047 needs (Calendly + Cal.com bookings)
No migration was written. Uses existing tables only: `calendar_events` (0019), `tasks`, `notifications` (0018), `memberships`, `leads`. All idempotent.
```sql
-- 1. Event types the connectors emit (also in src/lib/events/catalog/booking.ts). The catalogue is a superset of the SQL seed.
insert into public.event_types (type, domain, description, webhook_eligible, agent_eligible) values
  ('booking.created', 'booking', 'A booking was made through a connected scheduling tool', true, true),
  ('booking.cancelled', 'booking', 'A booking was cancelled in a connected scheduling tool', true, true),
  ('booking.unmatched', 'booking', 'A booking or cancellation came from an email that matches no lead', false, true)
on conflict (type) do update set domain = excluded.domain, description = excluded.description,
  webhook_eligible = excluded.webhook_eligible, agent_eligible = excluded.agent_eligible;

-- 2. Catalogue rows: Calendly is connected with a personal access token (api_key), not OAuth, so no platform client id is needed.
update public.connector_catalog set auth_kind = 'api_key', gate = 'none' where id = 'calendly';  
-- plus a connector_availability row for 'calendly' and 'cal-com' per environment (gate none).
```
Also needed by the integrator:
- Server actions behind `integrations.manage`: after `connectWithCredentials`, call `subscribeCalendly` / `subscribeCalcom` (src/lib/connectors/calendly|calcom/api.ts) with `webhookUrlFor(APP_BASE_URL, connectorId, connectionId)` and the decrypted bundle, then `saveState` (writes `integrations.health.booking_webhook`, which REPLACES `health`: merge first if another writer uses it). Show `subscriptionState(conn.health)` with the `calendly` namespace string at its `messageKey`: `state_needs_paid_plan` tells the client that Calendly webhooks need a paid plan. Prefill the signing key / webhook secret with `newSigningKey()`. On disconnect call `unsubscribeCalendly` / `unsubscribeCalcom` with the stored subscription id.
- Webhook URLs: `/api/hooks/calendly/<connection id>` and `/api/hooks/cal-com/<connection id>`.
- Optional connection setting `display_timezone` (IANA name) controls how a start time is printed in notifications; default `Asia/Kolkata`.
- A calendar page linked from the unmatched-booking notification (`/calendar`) should list `calendar_events` rows with a null `object_id` so the owner can link them to a lead.

## T045 needs (Google Business Profile connector + reviews reply UI)
No migration was written. All idempotent and additive. Reviews work on the 0019 `reviews` table as it is (its trigger enforces the reply state machine and the named approver). The optional columns below make the UI richer; the store falls back to the 0019 shape when they are missing. The daily stream needs the new table.
```sql
-- 1. Catalogue: the connector ships with a Showcase gateway and a sandbox how-to (gate stays needs_vendor_approval).
update public.connector_catalog set sandbox_supported = true where id = 'google-business';
insert into public.connector_availability (connector_id, env, mode, gate_status, note)
select c.id, e.env, case when e.env = 'production' then 'disabled' when c.sandbox_supported then 'sandbox' else 'disabled' end, c.gate, null
  from public.connector_catalog c cross join (values ('production'), ('staging'), ('demo')) e(env)
 where c.id = 'google-business'
on conflict (connector_id, env) do update set mode = excluded.mode, gate_status = excluded.gate_status;

-- 2. reviews: optional columns (who/what drafted the reply, why a post failed, a reply that already exists on Google).
alter table public.reviews add column if not exists reply_source text check (reply_source is null or reply_source in ('ai', 'template', 'human'));
alter table public.reviews add column if not exists reply_error text check (reply_error is null or reply_error in ('credentials', 'rejected'));
alter table public.reviews add column if not exists external_reply text check (external_reply is null or length(external_reply) <= 4096);
alter table public.reviews add column if not exists external_reply_at timestamptz;

-- 3. gbp_daily: daily Business Profile performance per listing. Counts are nullable: null = Google did not report it, never 0.
create table if not exists public.gbp_daily (
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  integration_id     uuid not null references public.integrations(id) on delete cascade,
  location_id        text not null,
  day                date not null,
  impressions_search integer check (impressions_search is null or impressions_search >= 0),
  impressions_maps   integer check (impressions_maps is null or impressions_maps >= 0),
  call_clicks        integer check (call_clicks is null or call_clicks >= 0),
  website_clicks     integer check (website_clicks is null or website_clicks >= 0),
  direction_requests integer check (direction_requests is null or direction_requests >= 0),
  conversations      integer check (conversations is null or conversations >= 0),
  bookings           integer check (bookings is null or bookings >= 0),
  food_orders        integer check (food_orders is null or food_orders >= 0),
  source             text not null default 'api' check (source in ('api', 'mock')),
  imported_at        timestamptz not null default now(),
  primary key (workspace_id, integration_id, day)
);
create index if not exists gbp_daily_tenant on public.gbp_daily (tenant_id);
alter table public.gbp_daily enable row level security;
-- reads need analytics.read (same rule as 0021d); writes are service role only (the sync job). Mirror the 0021d private.rls_table call:
-- its signature is the source of truth.
```
Also needed by the integrator:
- OAuth: the same Google client as T039 (`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`); add the redirect URI `<app>/api/oauth/google-business/callback`. Scope `https://www.googleapis.com/auth/business.manage` (sensitive; part of Google's OAuth app verification). **Vendor gate:** Google gives the Business Profile APIs (Account Management, Business Information, Performance, v4 reviews) to approved applications only (an access request per Cloud project). Until granted the connector stays `needs_vendor_approval`: Showcase and fixtures work, a live connection is refused by Google.
- Env (names only, all optional, unset = Google's hosts): `GBP_ACCOUNTS_API_BASE`, `GBP_INFO_API_BASE`, `GBP_PERFORMANCE_API_BASE`, `GBP_REVIEWS_API_BASE` (stubs / Cypress).
- Server actions (not in Owns, no page built): `listGbpLocations` / `selectGbpLocation` (behind `integrations.manage`); `draftReply` / `submitForApproval` / `decideReply` / `postApprovedReply` (behind `inbox.reply`; the code only requires a signed-in person and stamps them as the approver, so the action decides who may approve). All exported from `src/lib/connectors/google/business-profile/index.ts`. Build `ReplyDeps` with `{ rt: requestRuntime(audit), store: supabaseGbpStore(serviceDb()) }` (scoped by tenant and workspace); pass an AI-backed `ReplyDrafter` as `drafter` when a provider is chosen (default is a rule-based template). Mount `<ReviewsPanel>` from `src/components/reviews` (props: reviews, actions wrapping the four server actions, canReply, canApprove) on the inbox reviews view, and pass `CYPRESS_GBP_REVIEWS_PATH` to the spec.
- i18n: namespace `reviews` is registered (en final, ta machine draft in `_review.json`); `google-business.sandbox` added to integrations.json.
## T049 needs (Slack alerts, Zapier, Make)
No migration was written. Idempotent and additive. Slack and the two automation apps add no tables: the Slack channel, alert switches and team live in the connection's Vault bundle; Zapier and Make use the existing REST API keys (T025) and `/api/v1/webhooks` REST hooks (T024).
```sql
-- 1. SLA breach alert. The event type is not emitted by anything yet (see "Also needed"); registering it lets webhooks and Slack subscribe once it is.
insert into public.event_types (type, domain, description, webhook_eligible, agent_eligible) values
  ('lead.sla_breached', 'lead', 'A lead first-response SLA was breached', true, true)
on conflict (type) do nothing;

-- 2. Catalogue alignment: Zapier and Make hold no credentials of their own (the tenant pastes a scoped API key into the vendor app), and neither has a sandbox.
update public.connector_catalog set auth_kind = 'none', sandbox_supported = false where id in ('zapier', 'make');
```
Also needed by the integrator:
- Slack app (owner step): create one Slack app for the platform, add the bot scopes `chat:write`, `channels:read`, `groups:read`, `channels:join`, set the redirect URL `<app>/api/oauth/slack/callback` (also in `OAUTH_REDIRECT_URIS` when that list is used), and copy the client id / secret / signing secret into `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`. A private or workspace-installed app needs no Slack review; the public Slack App Directory listing is a separate owner step.
- `connector_availability` for `slack` per environment: 0015 seeds it `needs_client_credentials`; move it to `live` / `ready` once the env vars are set (sandbox stays available for the Showcase).
- Import line in `src/lib/jobs/handlers/index.ts` is added by this task (`@/lib/connectors/slack/jobs`): it registers the `slack.alert` handler (queue `connector_sync`) and the event fan-out extension. Confirm the `connector_sync` queue consumer runs it.
- Server actions (not in Owns, no UI built), each behind `integrations.manage`, deps from `requestRuntime(audit)` and the actor from the session: `listSlackChannels`, `selectSlackChannel` (channel, alert switches, `includeNames`, `locale`; call it again to change the switches), `sendSlackTest` (src/lib/connectors/slack/assets.ts). Call `listSlackChannels` after the OAuth callback returns `connected=1`; until a channel is selected no alert is sent.
- SLA breached: nothing emits `lead.sla_breached` yet. The first-response due time is written by the 0002 trigger into a task; a scheduled scan (or `pg_cron`) that emits the event once per breached lead is a small separate task. Until then the alert switch exists and stays silent.
- Slack Events API (optional, for instant revocation): the connection URL is `/api/hooks/slack/<connection id>`; Slack's URL verification handshake (`url_verification` challenge) is not answered by the T023 receiver, so subscribe to `tokens_revoked` / `app_uninstalled` only after the receiver answers the challenge. Without it a revoked token is still caught on the next alert post (the connection goes to `needs_attention`).
- Optional later: `notification_rules.channels` accepts only in_app, email, whatsapp, push (0018 check). Adding `'slack'` there would let owners route per-rule; T049 routes by the four alert switches on the connection instead.
- Zapier (owner step): `integrations/zapier-app` needs `npm install` + `zapier validate` + `zapier push` with a Zapier account; Make: import `integrations/make-app` with the Make Apps extension. Both are untested against the vendors.
## T042 needs (Gmail + Google Calendar)
No migration was written. Everything below is idempotent and additive. The connectors need NO new table or column: Calendar uses `calendar_events` (0019), Gmail uses `conversations` + `messages` (channel `email`).
```sql
-- 1. Catalogue alignment: both connectors ship with a Showcase (mock) gateway. Calendar needs no vendor approval (sensitive scope; Google OAuth app verification is a separate owner task).
--    Gmail stays gated (restricted scope).
update public.connector_catalog set sandbox_supported = true, gate = 'none' where id = 'google-calendar';
update public.connector_catalog set sandbox_supported = true where id = 'gmail';
-- 2. Availability: Calendar live where nothing external is needed. Gmail NEVER live by default: sandbox in staging/demo, disabled in production until the platform admin
--    enables it (only while the Google OAuth app is in testing, or after CASA).
insert into public.connector_availability (connector_id, env, mode, gate_status, note)
values ('google-calendar', 'production', 'live', 'ready', null), ('google-calendar', 'staging', 'live', 'ready', null), ('google-calendar', 'demo', 'sandbox', 'ready', null),
       ('gmail', 'production', 'disabled', 'needs_vendor_approval', 'Restricted scope: testing mode (max 100 named test users) until CASA completes'),
       ('gmail', 'staging', 'sandbox', 'needs_vendor_approval', null), ('gmail', 'demo', 'sandbox', 'needs_vendor_approval', null)
on conflict (connector_id, env) do update set mode = excluded.mode, gate_status = excluded.gate_status, note = excluded.note;
-- 3. Optional index for the contact lookup (lower-case email per workspace); skip if 0022 already covers it.
create index if not exists leads_ws_lower_email on public.leads (workspace_id, lower(email)) where email is not null;
create index if not exists contacts_ws_lower_email on public.contacts (workspace_id, lower(email)) where email is not null;
```
Also needed by the integrator:
- OAuth: same Google client as T039 (`GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`); add redirect URIs `<app>/api/oauth/google-calendar/callback` and `/api/oauth/gmail/callback`. Scopes: `calendar.events` (sensitive); `gmail.readonly` (RESTRICTED) + `gmail.send` (sensitive). Env: `GOOGLE_OAUTH_APP_MODE` (`testing` or `production`; Gmail is `not_configured` while unset), `GOOGLE_OAUTH_CASA_COMPLETE` (`true` only after Google verified the app), optional `GOOGLE_CALENDAR_API_BASE`, `GMAIL_API_BASE`. In testing mode each Gmail user must be listed as a test user in the Google Cloud console (max 100) and Google expires test-mode refresh tokens after 7 days (the connection then shows needs_attention: Reconnect).
- Callback routing: the generic `/api/oauth/[connector]/callback` calls core `completeOAuth`, which keeps ONE grant per connection. For `google-calendar` and `gmail` call `connectGoogleUser(rt, actor, connector, tokens, { email, flags })` (src/lib/connectors/google/calendar/grants.ts) instead, so each user's own grant is kept beside the first. For `gmail` pass `flags: { gmail_opt_in: <iso time> }`. The Gmail start route must take its scopes from `startGmailConnect(rt, actor, optIn)` (gmail/start.ts; empty scopes = closed) and refuse when it returns `ok: false`. Without that wiring the runtime still refuses: a Gmail connection without the `gmail_opt_in` stamp never reads or sends (checked on every sync and send).
- Server actions (not in Owns, no UI built): `startGmailConnect` (behind `integrations.manage`), `createCalendarEvent` (behind `activities.write`; calendar/actions.ts; demos, meetings and room holds linked to a record), `sendGmailReply` (behind `inbox.reply` plus consent; gmail/send.ts). UI gate state: `gmailGate(env, optedIn)` returns `{ open, reasons, mode }`; strings in namespace `gmail`.
- Room holds: CRM rows in `calendar_events` with status `tentative` linked to a custom object (`obj:<key>`) go to Google as tentative events stamped `crm_kind=room_hold`; any unlinked CRM row (integration_id null, not cancelled) is pushed to the primary user's calendar by the push stream.


## T043 needs (Outlook / Microsoft 365 connector)
No migration was written, nothing was applied. All idempotent and additive. Mail lands in `conversations` / `messages` (channel `email`, both have `workspace_id`) and the calendar in `calendar_events` (0019), so no new table is needed.
```sql
-- 1. Catalogue: the connector ships with a Showcase gateway and a sandbox how-to; the gate is now publisher verification (0015 seeded needs_client_credentials).
update public.connector_catalog set sandbox_supported = true, gate = 'needs_vendor_approval' where id = 'outlook';
insert into public.connector_availability (connector_id, env, mode, gate_status, note)
select c.id, e.env, case when e.env = 'production' then 'disabled' when c.sandbox_supported then 'sandbox' else 'disabled' end, c.gate, null
  from public.connector_catalog c cross join (values ('production'), ('staging'), ('demo')) e(env)
 where c.id = 'outlook'
on conflict (connector_id, env) do update set mode = excluded.mode, gate_status = excluded.gate_status;

-- 2. One conversation per mail thread of a connection (the store reads then inserts and treats a unique violation as "already there").
--    external_thread_id is written as 'outlook:<connection id>:<Graph conversationId>' so two connections never collide.
create unique index if not exists conversations_ws_channel_thread
  on public.conversations (workspace_id, channel, external_thread_id) where external_thread_id is not null;
-- messages(tenant_id, external_id) is already unique (0021c / 0021e): a redelivered Graph message is a no-op.
```
Also needed by the integrator:
- Entra ID: register ONE multi-tenant app (accounts in any organizational directory), redirect URI `<app>/api/oauth/outlook/callback`, delegated permissions `offline_access`, `User.Read`, `Mail.Read`, `Mail.Send`, `Calendars.Read`, a client secret. Env names only: `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`, `MICROSOFT_GRAPH_API_BASE` (stub / Cypress; unset = Microsoft). `APP_BASE_URL` must be a public https URL for Graph to deliver notifications (unset or localhost = polling only, reported as `no_public_url`).
- Webhook receiver: already wired by T043 (one-line `graph` scheme + `outlook` mapping in `verify/index.ts`, and the `validationToken` handshake branch in `verify/receive.ts`). Nothing for the integrator to add there. The per-connection `clientState` is stored in the Vault as the connection's webhook secret (`webhook_secret`).
- Admin-consent route (not in Owns): `buildAdminConsentUrl` / `parseAdminConsentReturn` in `microsoft/consent.ts` are pure. The integrator adds a route that stores a one-time state (like `oauth_states`), redirects an owner to the link, and on return (`admin_consent=True&tenant=<guid>&state=..`) shows "approved for your organization" and audits it. The existing `/api/oauth/outlook/callback` has no `code` on that return, so it must not be reused for it.
- Server actions (not in Owns): `sendOutlookMail` (behind `inbox.reply`; consent purpose per tenant policy) and `subscribeOutlook` (behind `integrations.manage`; call after connecting and from a "Repair notifications" button). On disconnect call `dropSubscriptions` with the `subscriptions` cursor (best effort).
- Jobs: streams `inbox`, `sent`, `calendar`, `subscriptions` are scheduled by the generic connector tick; `subscriptions` must run at least hourly (Graph mail/event subscriptions last under 71 h).
- i18n: `outlook.sandbox` added to `integrations.json` (en only; Tamil not drafted).

## T046 needs (OTA via channel manager + iCal fallback)
No migration was written, nothing was applied. All idempotent and additive. The code reads and writes `booking` records (0019 seed), `external_links` (0015), `integrations`, `notifications`, `memberships` as they are; the two new tables are needed for the iCal feeds and the export tokens.
```sql
-- 1. Catalogue: the two connectors. `ical` is generic (no approval); `channel-manager` is generic until the partner is chosen (B-6).
insert into public.connector_catalog (id, name, category, auth_kind, verticals, gate, sandbox_supported, docs_url) values
  ('ical', 'Calendar feeds (iCal)', 'ota', 'api_key', '{hospitality}', 'none', false, null),
  ('channel-manager', 'Channel manager', 'ota', 'api_key', '{hospitality}', 'needs_vendor_approval', true, null)
on conflict (id) do update set name = excluded.name, category = excluded.category, auth_kind = excluded.auth_kind, verticals = excluded.verticals,
  gate = excluded.gate, sandbox_supported = excluded.sandbox_supported;
insert into public.connector_availability (connector_id, env, mode, gate_status, note)
select c.id, e.env,
       case when c.id = 'ical' then 'live' when e.env = 'production' then 'disabled' else 'sandbox' end,
       case when c.id = 'ical' then 'ready' else c.gate end, null
  from public.connector_catalog c cross join (values ('production'), ('staging'), ('demo')) e(env)
 where c.id in ('ical', 'channel-manager')
on conflict (connector_id, env) do update set mode = excluded.mode, gate_status = excluded.gate_status;

-- 2. iCal import feeds: one row per calendar link. The URL is a bearer secret (Airbnb / Booking.com links), so it lives in the Vault
--    (url_secret_id), never in a column; url_host is for display only. Written by the service role (jobs, server actions).
create table if not exists public.ical_feeds (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  property_key   text not null check (length(property_key) between 1 and 80),          -- becomes booking.room
  source         text not null check (source in ('airbnb', 'booking_com', 'other')),
  label          text not null default '' check (length(label) <= 80),
  timezone       text,
  url_secret_id  uuid not null,
  url_host       text,
  last_hash      text,
  failures       integer not null default 0 check (failures >= 0),
  last_error     text check (last_error is null or length(last_error) <= 60),
  last_ok_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists ical_feeds_conn on public.ical_feeds (integration_id);
create index if not exists ical_feeds_ws on public.ical_feeds (workspace_id, created_at desc);
alter table public.ical_feeds enable row level security;
drop policy if exists ical_feeds_select on public.ical_feeds;
create policy ical_feeds_select on public.ical_feeds for select to authenticated using (workspace_id in (select authz.ws_with('integrations.read', 'all')));
revoke all on public.ical_feeds from anon, authenticated;
grant select (id, tenant_id, workspace_id, integration_id, property_key, source, label, timezone, url_host, failures, last_error, last_ok_at, created_at) on public.ical_feeds to authenticated;   -- never url_secret_id
grant select, insert, update, delete on public.ical_feeds to service_role;

-- 3. iCal export tokens: only the SHA-256 of the token is stored (the plaintext is shown once at creation). One token per property
--    (and optionally per channel). Looked up by hash from the public route with the service role.
create table if not exists public.ical_export_tokens (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  property_key    text not null check (length(property_key) between 1 and 80),
  exclude_source  text check (exclude_source is null or exclude_source in ('airbnb', 'booking_com', 'other')),
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_fetched_at timestamptz,
  revoked_at      timestamptz
);
create index if not exists ical_export_tokens_ws on public.ical_export_tokens (workspace_id, created_at desc);
alter table public.ical_export_tokens enable row level security;
drop policy if exists ical_export_tokens_select on public.ical_export_tokens;
create policy ical_export_tokens_select on public.ical_export_tokens for select to authenticated using (workspace_id in (select authz.ws_with('integrations.manage', 'all')));
revoke all on public.ical_export_tokens from anon, authenticated;
grant select (id, tenant_id, workspace_id, property_key, exclude_source, created_at, last_fetched_at, revoked_at) on public.ical_export_tokens to authenticated;   -- never token_hash
grant select, insert, update on public.ical_export_tokens to service_role;
-- both tables also need the a00_<table>_tenant trigger (public.set_tenant_from_workspace()) and the audit trigger, like the other 0019 tables.

-- 4. Booking object: the extra fields the connectors fill (the first six seeded fields are already there). Stored in records.data under
--    these keys whether or not a field_def exists; the field_defs make them visible and filterable. Fold into metadata.seed_hospitality_booking()
--    so new hospitality tenants get them; this one-off covers the existing ones.
insert into public.field_defs (tenant_id, object_type_id, key, label, type, options, required, is_filterable, is_pii, section, position)
select o.tenant_id, o.id, f.key, jsonb_build_object('en', f.label), f.type, f.options::jsonb, false, f.filterable, f.pii, 'stay', f.pos
  from public.object_types o
  cross join (values
    ('status',            'Status',            'select', '{"choices":[{"key":"confirmed","label":"Confirmed"},{"key":"cancelled","label":"Cancelled"}]}', true,  false, 7),
    ('entry',             'Entry',             'select', '{"choices":[{"key":"reservation","label":"Reservation"},{"key":"block","label":"Calendar block"}]}', true,  false, 8),
    ('ota_channel',       'Channel',           'text',   '{}', true,  false, 9),
    ('external_ref',      'Channel reference', 'text',   '{}', false, false, 10),
    ('total_amount',      'Total',             'money',  '{}', false, false, 11),
    ('currency',          'Currency',          'text',   '{}', false, false, 12),
    ('commission_amount', 'Commission',        'money',  '{}', false, false, 13),
    ('guest_name',        'Guest',             'text',   '{}', false, true,  14)
  ) f(key, label, type, options, filterable, pii, pos)
 where o.key = 'booking'
on conflict (object_type_id, key) do nothing;
-- origin and source_version are internal bookkeeping and get no field.
-- The source_ota select has no "other channel" choice: a channel the CRM does not know is stored with source_ota = null and the raw name in ota_channel.
-- Add an {"key":"other_ota","label":"Other channel"} choice if the owner wants those filterable, then map unknowns to it in channelToSource().

-- 5. Event types used (already in src/lib/events/catalog/booking.ts from T047): booking.created, booking.cancelled. Their SQL description says
--    "scheduling tool"; widen it so OTA bookings read correctly in webhooks and the agent catalogue.
update public.event_types set description = 'A booking was made or imported (scheduling tool, channel manager or calendar feed)' where type = 'booking.created';
update public.event_types set description = 'A booking was cancelled (scheduling tool, channel manager or calendar feed)' where type = 'booking.cancelled';
```
Also needed by the integrator (none of this is in T046's Owns):
- **Webhook scheme**: add `"channel-manager": "standard"` to `SCHEME_OF` in `src/lib/connectors/verify/index.ts` (T023) so `/api/hooks/channel-manager/<connection id>` is verified (Standard Webhooks, secret = the connection's `webhook_secret`); until then the receiver answers 404 and only the 15-minute pull works. Replace with the partner's own scheme once B-6 is decided. The webhook body shape is in `src/lib/connectors/channel-manager/generic.ts`.
- **Route** `src/app/api/ical/[token]/route.ts` (GET only): apply the platform per-IP rate limit, then `handleFeedRequest(icalServiceDeps(), params.token)` from `src/lib/connectors/ical` (`icalServiceDeps` is in `ical/runtime.ts`); relay status, headers and body unchanged; any other method is 405. The path shown to the owner is `exportPath(token)` on the deployment's base URL.
- **Server actions behind `integrations.manage`** (assertCan first, then the signed-in user's actor for audit): connect the `ical` connection with `connectWithCredentials(... "ical", {})` (no fields); `addFeed`, `removeFeed`, `createExportToken`, `revokeExportToken` from `src/lib/connectors/ical/manage.ts` with `IcalDeps` from `icalServiceDeps(workspaceId)` but `audit` replaced by the user's `audit(actorFromPrincipal(p), ...)`, so the action fails when the audit row cannot be written. A settings screen lists feeds (label, source, property, `failures`, `last_ok_at`) and tokens; the new token URL is shown once.
- **System audit**: `ical/runtime.ts` writes the `ical.feed_failing` row through `audit_record` with `p_actor_kind = 'connector'` and no user; confirm 0014's RPC accepts that for the service role, otherwise the row is logged and skipped (the notification, `integrations.last_error` and the sync run still record it).
- **Env** (names only): `CHANNEL_MANAGER_API_BASE` (the partner's https base; unset = the adapter refuses to call out, sandbox fixtures still work). The channel-manager sandbox token is `cm-fixture-token` (refused when `APP_ENV=production`).
- **Booking object**: workspaces without the hospitality preset have no `booking` object; the sync then fails with "no Booking object" (not a credential problem). `seed_hospitality_booking` is the fix.
- **Timezone**: the iCal connection reads the optional connection setting `timezone` (IANA name) and falls back to UTC; each feed can carry its own. Set it from the workspace's configured zone when the connection is created.
- **Cypress gate** (specs written, not run): `connectors/ical-import.cy.ts` needs `CYPRESS_ICAL_TOKEN` and the route above; `connectors/channel-manager-fixture.cy.ts` needs `CYPRESS_CM_CONNECTION` plus a pre-signed body and headers.
- **Owner decision (B-6)**: which channel manager (STAAH, eZee, AxisRooms ...); sandbox and partner agreement; then one adapter implementing `ChannelManager` (four methods) replaces `generic.ts` in `channelManagerServiceRuntime()`.
