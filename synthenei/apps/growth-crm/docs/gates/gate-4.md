# Critique & test gate 4 (T031 to T040, T071)

Run 21 Nov 2026 on `origin/build/v1` at 17983e9 plus this gate's commits. Database: Lawsome (evybdanqxgkjoybrvzru), real Supabase, no local DB.

## Passed
- `tsc --noEmit`: clean.
- `eslint .`: 0 errors, 99 warnings (unused args, tenant-slug literals; not new work).
- Vitest: 119 files, 1646 tests, all passed on the first run (fields.test.tsx did not flake).
- Migrations applied to the real DB, all idempotent and additive, each also in `supabase/migrations/`: 0021e_batch4_needs_whatsapp, _payments, _email, _google, _imports, _custom_objects, _pipelines, _email_fk_index. The repo was missing 0021c_t036_meta_assets.sql (applied earlier); it is now committed.
- Post-apply check: private buckets `imports` and `wa-media` with their storage policies, `email_suppressions` (RLS on, select policy, audit trigger), 14 new event types, triggers `a30_records_title`, `z9_pipelines_version`, `z7_import_jobs_rt`, `trg_import_jobs_audit`.
- Advisors, security: identical before and after (67 INFO rls-no-policy, 11 security-definer views, 1 pg_net in public, 7 anon and 45 authenticated SECURITY DEFINER functions). No new findings.
- Advisors, performance: one new finding fixed (unindexed FK `email_suppressions.tenant_id`, index added). Remaining new items are `unused_index` INFO on three brand-new indexes (email_suppressions_lead, email_suppressions_ws_created, ga4_daily_ws_day); expected until there is traffic.
- Wiring already in place from T040 and T071: nav entries (Import, Pipelines, Email sending, Custom fields, objects, layouts, Social), PAGE_PERMISSION entries (/import, /settings/pipelines, objects, layouts, fields, email; /o/* per object; /analytics/social through /analytics), i18n namespaces en and ta registered for whatsapp, metaAds, razorpay, email, google, social, objects, fields, webhooks. Nothing needed fixing.

## Skipped migration blocks (not additive or ambiguous; need an owner or design decision)
- T039: `ga4_daily` primary key swap (drops and re-adds the PK); `connector_catalog` / `connector_availability` updates (rewrite existing rows). Until done the store falls back to the old key and the campaign dimension collapses.
- T033: audit triggers on records, record_links, object_types, layouts, saved_views (generic `audit_row_change` would store `records.data` values; the app already writes value-free audit rows); layouts version trigger (the app bumps it itself, a trigger would double-bump); soft-delete purge job (deletes data).
- T032: `save_pipeline_stages` RPC, deferrable `(pipeline_id, position)` constraint, deals/leads stage-guard triggers, stage colour check, archive-with-records trigger.
- Backlog 0022 and 0023 items (webhook_inbox purge, queue_set_vt, api_keys.rate_limit_per_min) belong to T041 and T061.

## Failed
Nothing failed in typecheck, lint or unit tests.

## Unverified (not exercised)
- Cypress and `next build` were not run (outside this gate's scope). Cypress specs for T032 to T040 and T071 are written but never executed.
- pgTAP files (0021, 0021d and earlier) were not run against the DB.
- The BUILD-PLAN gate 4 exercise list (second pipeline move with required fields, custom object roundtrip, CSV import with dedupe and the 20k-row timing, WhatsApp inbound and sandbox send, Meta leadgen, Razorpay paid fixture, email send and unsubscribe, GA4 and Ads mock syncs, custom field UI-API roundtrip) was not driven end to end; only unit-level fixtures exist.
- Critique items not checked live: consent enforcement on every outbound path, PII in `sync_runs.payload_sample`, `needs_attention` on token refresh failure, legal vs hospitality vocabulary parity, pipeline-refactor regressions in metrics and charts (they still read keys `won` and `lost`), UI of the settings editors.
- No connector has run against a vendor (Meta, WhatsApp, Razorpay, Resend, SMTP, Mailchimp, Google); Graph and Google field names are from memory.
- `supabase/types.ts` not regenerated for the new tables and columns.

## Open follow-ups from the task docs
Server actions or UI missing:
- T036: selection after OAuth (`listMetaAssets` / `selectMetaAssets`), `consent_rules` and `fx_to_inr` editors.
- T037: action calling `createPaymentRequest`; settings editor for `paid_stage_key` and `account_id`.
- T038: compose and send action in inbox and lead page, `enqueueEmailCampaign` action behind `messages.send_email`, `setEmailSender(platformEmailSender(env))` in `src/lib/notify/email.ts`.
- T039: `listGa4Properties` / `selectGa4Property`, `listAdsCustomers` / `selectAdsCustomer`, `listSheetTabs` / `previewSheet` / `startSheetImport`, sheet column-mapping screen, `fx_to_inr` editor.
- T035: embedded-signup button, template list, per-message failure display, webhook URL helper; enqueue `dispatch` on insert for prompt sends.
- T034: `ExportButton` not wired into any list; `cypress/fixtures/import/accounts.xlsx` missing.
- T040: no deal or contact detail page (CustomFields mount waits); layout `showComments` / `showRelated` not applied; custom columns on the lead list only; no UI to create a lead or account layout.
- T033: layouts only for custom objects; no CSV import or export for custom objects.
- T032: no lead stage-move action (required fields on lead stages not enforced); no UI to create a deal in a second pipeline; `/api/v1/deals/{id}/move` must resolve the stage inside the deal's pipeline (src/lib/api/crud.ts).
- T031: notify code should write `dedupe_key` and the quiet-hours columns, webhooks should use `options` and `webhook_bump_failures`; add `segment.*` types to the TS event catalogue.
- Inbox `channelFor` for whatsapp, instagram and email stays not-live until connections exist.

i18n: `pipelines-strings.ts` is not a namespace (`pipelinesAdmin`); Tamil `imports.json` missing (falls back to English); all Tamil drafts await the B-9 reviewer.

Env and owner: META_APP_ID / META_APP_SECRET, WHATSAPP_*, EMAIL_UNSUBSCRIBE_SECRET and APP_BASE_URL (email is blocked without them), GOOGLE_OAUTH_*, GOOGLE_ADS_DEVELOPER_TOKEN, Razorpay keys; connector_availability rows for whatsapp, meta-ads, razorpay, resend, email-smtp, mailchimp; Meta and Google app review, Google Ads basic access; platform webhook routers for shared Meta and WhatsApp apps.
