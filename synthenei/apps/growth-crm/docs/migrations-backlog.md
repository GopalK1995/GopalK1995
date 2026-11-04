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
