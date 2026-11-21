# Supabase advisors after T041 (21 Nov 2026, Lawsome evybdanqxgkjoybrvzru)

Every remaining item with its reason. Counts are from `get_advisors`: performance re-run after 0022; security as of the run before 0022f (0022f removes 3 anon and 3 authenticated items, see below; not re-run).

## Fixed by 0022
| Item | Before | After | Migration |
|---|---|---|---|
| Unindexed foreign keys (performance) | 56 (40 base tables plus partitions of `events`) | 0 | `0022_fk_indexes` |
| Trigger-only SECURITY DEFINER functions callable via `/rest/v1/rpc` (`comments_after_insert`, `comments_guard`, `realtime_broadcast_row`) | 3 anon + 3 authenticated warnings | 0 expected | `0022f_revoke_trigger_fn_execute` |
| `auth_rls_initplan` | 0 flagged | n/a | nothing to fix: policies already use `(select ...)` and `authz.ws_with()` set-returning helpers |
| `duplicate_index` | 0 flagged | n/a | |

## Remaining, performance
| Item | Count | Why it stays |
|---|---|---|
| `unused_index` (INFO) | 416 | The database has had no real traffic (145 leads, 31 deals) so no index has been used; 56 of these are the indexes just added. Dropping any of them now would be a guess. Re-check after 30 days of production traffic; candidates then are the per-partition `events_*` pair (cannot be dropped individually: they cascade from the parent), and single-column `*_fk` indexes that a composite index now covers. Nothing dropped. |
| `multiple_permissive_policies` (WARN) on `connector_availability`, `invoices`, `plans`, `retention_policies`, `tenant_subscriptions` | 5 | Each has a `*_select` policy plus a `*_write` policy defined FOR ALL, so SELECT evaluates two policies. Tables hold a handful of rows; the fix (split `*_write` into insert/update/delete) is a policy rewrite with no measurable gain. Revisit if any of them grows. |

## Remaining, security
| Item | Count | Why it stays |
|---|---|---|
| `rls_enabled_no_policy` (INFO) | 67 | Deliberate deny-all: partitions (`events_*`, `ai_usage_*`, `api_request_log_*`, `webhook_deliveries_*`), `idempotency_keys`, `rate_limits`, `oauth_states`, `invoice_series`, `private.settings`. They are written only by SECURITY DEFINER functions or the service role; with RLS on and no policy, `anon` and `authenticated` get nothing. Adding policies would open them. |
| `security_definer_view` (ERROR) | 11 (`v_sync_freshness`, `v_funnel_daily`, `v_campaign_perf`, `v_campaign_reach_profile`, `v_pipeline_summary`, `v_rep_scorecard`, `v_leads_masked`, `v_backup_latest`, `v_messages_masked`, `v_contacts_masked`, `v_conversations_masked`) | Known and designed: the `*_masked` views implement PII masking by reading the base table as owner and applying `pii.read` inside the view; the report views filter by `member_ws_ids()` inside the view. Switching them to `security_invoker` would apply the caller's table RLS, which for masked views defeats the masking (a role without `pii.read` could not read the row at all). 0021b already made them read-only. Revisit per view in T061 if the owner prefers invoker views with a masking function. |
| `extension_in_public`: `pg_net` | 1 | Supabase installs `pg_net` in `public` and the job tick calls `net.http_post`; moving it needs drop and recreate of the extension and re-wiring of `private.tick()`. Not additive, so not done. |
| `anon_security_definer_function_executable` | 4 after 0022f (7 before) | `rate_limit_hit`, `submit_lead`, `tenant_branding`, `track_event` are the intentional public surface (lead form, branding by domain, anonymous tracking, rate limiter). Each validates its input and writes only to its own tables. |
| `authenticated_security_definer_function_executable` | 42 after 0022f (45 before) | Intentional RPC surface for signed-in users. Three groups: (1) helpers used inside RLS policies and so must be callable by the caller: `is_member`, `member_ws_ids`, `member_tenant_ids`, `owner_tenant_ids`, `has_ws_role`, `has_member_role`, `ws_role`, `role_ws_ids`, `member_role_ws_ids`, `co_member_ids`, `is_platform_admin`, `has_active_support_session`; (2) app RPCs that check authorization inside the body (`my_grants`, `my_workspaces`, `can_contact`, `can_contact_many`, `emit_event`, `audit_record`, `invite_member`, `create_workspace`, `merge_accounts`, `erase_lead`, `get_tenant_config`, `get_tenant_config_history`, `tenant_entitlements`, `usage_bump`, `ai_cap_status`, `agent_enqueue`, `end_support_session`, `start_support_session`, `track_event`, `submit_lead`, `rate_limit_hit`, `tenant_branding`); (3) platform-admin RPCs that raise `not allowed` unless `is_platform_admin()` (`admin_*`, `seed_hospitality_booking`). Revoking any of them breaks the app; the rest is covered by the pgTAP suites 0013 to 0020. |
| Leaked-password protection and MFA options (Auth settings) | not reported by the MCP advisor | Dashboard settings, not SQL. Owner action, listed in the runbook (T061). |

## Gate-4 items skipped on purpose and still open after T041
- `ga4_daily` primary key swap (`... workspace_id ... campaign`): table holds 4,320 rows, so the swap was not applied (task rule: only if empty). The store falls back to the old key.
- T039 `connector_catalog` updates for `ga4`, `google-sheets`, `google-ads` (auth kind, gate, sandbox flag) are UPDATEs of existing rows. The inserts the task allowed are all no-ops: all 26 catalogue rows and all 78 `connector_availability` rows (26 connectors x 3 envs, including whatsapp, meta-ads, razorpay, resend, email-smtp, mailchimp) already exist.
- DB enforcement of stage `required_fields` on deals and leads: the app's rule depends on values supplied with the move (the Won form supplies value, quantity and close date; some fields live on the linked lead), so a column-based trigger would refuse legitimate moves. Needs a design decision. The archived-stage guard and the stage-archive guard are done (0022c).
- Webhook inbox 7-day purge of signature-failed rows (backlog "0022"): deletes data, so not added; `private.maintenance()` still purges all inbox rows at 30 days.
- `private.purge_soft_deleted(p_days)` and a DISABLED `scheduled_jobs` row `maintenance.purge_soft_deleted` exist (0022d). Nothing runs it: the app has no handler for that kind yet, and `private.maintenance` does not call it. To turn on: register the handler, then set `enabled = true`.
- Audit triggers `trg_{records,record_links,object_types,layouts,saved_views}_audit` now exist (0022b) and use a value-free function. The app still also writes its own explicit `records.*` audit rows, so each record write has two audit rows (the trigger row has field names only). Drop the app-side rows later if the duplication is unwanted.
- Not run: `scripts/load/**` (50k-lead seeding must not touch this project; run it on a Supabase branch), the pgTAP file `supabase/tests/0022_perf_hardening.test.sql`, Cypress, `next build`.
