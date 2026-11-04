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
