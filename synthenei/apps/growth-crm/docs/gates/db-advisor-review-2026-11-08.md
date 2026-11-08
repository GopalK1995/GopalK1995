# DB security advisor review, 2026-11-08

Project "Lawsome" (evybdanqxgkjoybrvzru), migrations 0001-0021 applied, dummy data.
Method: read-only. `get_advisors(security)`, catalog queries (pg_class reloptions, grants, `has_*_privilege`, `information_schema.columns.is_updatable`), `pg_get_functiondef`. No DDL, no writes, no impersonation. The write-through-view finding (F1) is established from definitions and privileges, not exercised, so it should be confirmed in a pgTAP test inside a rolled-back transaction before and after the fix.

Advisor totals: 11 ERROR security_definer_view, 7 WARN anon-executable SECURITY DEFINER, 45 WARN authenticated-executable SECURITY DEFINER, 1 WARN extension_in_public (pg_net), 67 INFO rls_enabled_no_policy.

Verdict key: **LEAK** = real exploitable hole, **FIX** = should change, **OK** = fine by design.

## Summary table (prioritised)

| # | Item | Verdict | Priority |
|---|------|---------|----------|
| F1 | Masked/sync views are owner-run, auto-updatable, and `authenticated` holds INSERT/UPDATE/DELETE on them: RLS and role checks on the base tables can be bypassed for writes | **LEAK** | P0 |
| F2 | `audit_record` lets any workspace member forge `actor_kind` (`system`, `support`, `platform_admin`, ...) and `source` | **FIX** | P1 |
| F3 | `rate_limit_hit` callable by anon and authenticated with arbitrary bucket names: bucket exhaustion DoS (e.g. lock out another user's login throttle) and table bloat | **FIX** | P1 |
| F4 | `usage_bump` lets any tenant member inflate or burn their own tenant's metered counters (any metric name) | **FIX** | P2 |
| F5 | `agent_enqueue` does not verify `p_event` belongs to the agent's workspace | **FIX** | P2 |
| F6 | `emit_event` lets any member emit any event type into own workspace, which can trigger automations, agents and webhooks | **FIX** | P2 |
| F7 | `v_backup_latest` shows platform-level rows (`workspace_id is null`) to any owner/manager/data user of any workspace | **FIX** | P3 |
| F8 | `ai_cap_status(p_tenant, p_user)` lets a member read another member's daily call count in their own tenant | **FIX** (minor) | P3 |
| F9 | Trigger functions and helper functions carry default PUBLIC/anon EXECUTE (`comments_*`, `realtime_broadcast_row`, 9 `private.*` triggers) | **FIX** (hygiene) | P3 |
| F10 | `pg_net` installed in `public` | **FIX** (hygiene) | P4 |
| F11 | Tenant-existence oracles (`get_tenant_config`, `authz.explain` reasons) for authenticated users | OK (accept) | - |
| A | 11 security_definer_view ERRORs: tenant filtering inside every definition is correct, no cross-tenant read | OK for reads, see F1 for writes | - |
| B | Remaining ~40 SECURITY DEFINER functions | OK, each checked below | - |
| C | 0021: `agent_enqueue`, `ai_cap_status`, `can_contact_many` | see F5, F8; `can_contact_many` OK | - |
| D | 67 rls_enabled_no_policy tables | OK, service-only by design, verified | - |

## (a) The 11 security_definer_view ERRORs

None of the 11 is `security_invoker`; all carry `security_barrier=true` only, so they run as the view owner (postgres, BYPASSRLS). `anon` has no privileges on any view. Read isolation depends entirely on the filter written inside each definition:

| View | Filter inside definition | Cross-tenant read? | Updatable by authenticated? |
|------|--------------------------|--------------------|-----------------------------|
| v_funnel_daily | `workspace_id in role_ws_ids(owner,sales_manager,marketing,data,viewer)` | No | No (aggregate) |
| v_campaign_perf | `allowed` CTE of `role_ws_ids(...)` applied to every base scan | No | No |
| v_campaign_reach_profile | reads `v_campaign_perf` | No | No |
| v_pipeline_summary | `s.workspace_id in role_ws_ids(...)` | No | No |
| v_rep_scorecard | `role_ws_ids(owner,sales_manager,viewer)` or own row via `member_ws_ids()` | No | No |
| v_leads_masked | `authz.ws_with('leads.read','all')`, deleted_at null, PII masked | No | **YES** (status, score, owner_id, city, district, firm_name, role_title, ...) |
| v_contacts_masked | `authz.ws_with('contacts.read','all')` | No | **YES** |
| v_conversations_masked | `authz.ws_with('inbox.read','all')` | No | **YES** |
| v_messages_masked | `authz.ws_with('inbox.read','all')` | No | **YES** |
| v_sync_freshness | `role_ws_ids(owner,sales_manager,marketing,data)` | No | **YES** (status, label, last_sync_at) |
| v_backup_latest | `role_ws_ids(...)` or global rows for any such user | Platform rows only (F7) | No |

Read verdict: no tenant A user can read tenant B rows through any of them. The `security_invoker` views (`v_crm_*`, `v_activity_feed`, `v_job_runs_tenant`, `v_webhook_inbox_stats`) are not flagged and rely on base-table RLS, which is correct.

Note on the masked views: they must stay owner-run. Their purpose is to give roles without `pii.read` a masked projection while the base table is restricted; switching them to `security_invoker` would break that or force base-table SELECT. So the advisor ERROR for these 5 is a **known-and-accepted** pattern once F1 is fixed, and should be recorded as an accepted exception in the gate doc.

### F1 (LEAK, P0): write-through-view bypasses RLS and permission checks

Evidence:
- `information_schema.views.is_updatable = YES` for v_leads_masked, v_contacts_masked, v_conversations_masked, v_messages_masked, v_sync_freshness (single-table, no aggregate/distinct, no `WITH CHECK OPTION`).
- `has_table_privilege('authenticated', <view>, 'INSERT'/'UPDATE'/'DELETE')` is true for every `v_*` view except `v_webhook_inbox_stats` (default privileges in Supabase grant ALL on new public objects).
- Because the view runs as postgres, the write executes with RLS bypassed on the base table; the only gate is the view's own `WHERE` (a read permission).

Consequences (by inspection):
- Any user with `leads.read` at scope `all` (for example a `viewer`) can `UPDATE` lead status, score, owner_id and `DELETE` leads in their workspace through `v_leads_masked`, though the `leads` write/delete policies would refuse them. Hard delete skips the soft-delete and erasure path.
- Any user with `inbox.read` can `UPDATE` and `DELETE` rows of `messages` through `v_messages_masked` even though `messages` has no UPDATE or DELETE policy at all (immutable by design) and `conversations` through v_conversations_masked. This breaks the message-immutability guarantee.
- Same for contacts and integrations status. Workspace isolation still holds (the workspace filter limits rows), so this is within-tenant privilege escalation and integrity loss, not cross-tenant. Base-table triggers (version, audit) still fire but do not restore the permission check.
- Not verified: whether `INSERT` succeeds (NOT NULL base columns not exposed by the view likely make it fail for leads/messages, but not guaranteed for every view).

Proposed SQL (text only, for a later migration):

```sql
-- 1. Views are read-only for every API role.
revoke insert, update, delete, truncate, references, trigger
  on public.v_activity_feed, public.v_backup_latest, public.v_campaign_perf,
     public.v_campaign_reach_profile, public.v_contacts_masked, public.v_conversations_masked,
     public.v_crm_accounts, public.v_crm_campaign_days, public.v_crm_campaigns, public.v_crm_deals,
     public.v_crm_leads, public.v_crm_tasks, public.v_funnel_daily, public.v_job_runs_tenant,
     public.v_leads_masked, public.v_messages_masked, public.v_pipeline_summary,
     public.v_rep_scorecard, public.v_sync_freshness
  from anon, authenticated, public;
-- 2. Make future views safe by default (run as the migration owner role).
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;
-- 3. Belt and braces: block auto-update on the owner-run views (INSTEAD OF no-op not needed once revoked),
--    and add a pgTAP assertion: select is(has_table_privilege('authenticated','public.v_leads_masked','UPDATE'), false);
```

Caution for step 2: the default-privileges change also affects future base tables if they rely on default grants; check `0001` grant conventions and adjust per-table grants explicitly (RLS tables already get explicit grants in migrations).

## (b) SECURITY DEFINER functions executable by anon / authenticated

All 52 distinct functions have `search_path=""` set. Helper functions used inside RLS policies must stay executable by `authenticated` (the policy runs as the caller), so revoking those would break RLS: they are "OK by design". The `authz` schema functions are not in the advisor list (schema not exposed by PostgREST).

### Exposed to anon (7 in advisor)

| Function | Internal check | search_path | Verdict / action |
|----------|----------------|-------------|------------------|
| submit_lead | Resolves workspace by slug/id, requires `lead_intake_enabled`, tenant active, validates and length-limits all fields, whitelists UTM keys, requires follow-up consent, throttles 5/email/hour and 300/workspace/10 min. Tenant comes from caller by design (public form) but only intake-enabled workspaces. | `""` | OK by design. Keep anon. Revoke from `authenticated` is optional (logged-in users have no reason to call it): FIX-minor |
| track_event | Same workspace resolution, event allow-list, anon_id length, per-anon flood limit (rotatable by attacker, so funnel can be polluted) | `""` | OK by design (public analytics). Accept pollution risk, document it. |
| tenant_branding | Returns only branding columns of active tenants by slug/domain; includes `support_email` and `is_demo` | `""` | OK by design (login page theming) |
| rate_limit_hit | None: any bucket string, any limit | `""` | **FIX** (F3) |
| comments_after_insert, comments_guard, realtime_broadcast_row | Trigger functions; not callable as RPC (error "trigger functions can only be called as triggers") but exposed via PUBLIC EXECUTE | `""` | **FIX** hygiene (F9) |

### Exposed to authenticated (45 in advisor) and anon-less

| Function | Internal check | Verdict |
|----------|----------------|---------|
| admin_create_tenant, admin_set_tenant_config, admin_set_tenant_status, admin_workspace_stats | `is_platform_admin()` (aal2 enforced inside it per BUILD-PLAN) | OK |
| admin_set_connector_availability, admin_set_org_admin_policy | platform admin and `super_admin`, reason >= 8 chars | OK |
| admin_set_tenant_branding | platform admin, super_admin or support, whitelisted keys, reason | OK |
| start_support_session / end_support_session | platform admin only to start; end is scoped to `admin_id = auth.uid()` | OK |
| create_workspace | tenant owner or platform admin; tenant id from caller but verified | OK |
| invite_member | owner, or sales_manager limited to rep/viewer, role-within-caller check, platform-admin first-owner path | OK |
| erase_lead | workspace owner of the lead's workspace | OK |
| merge_accounts | same-workspace check, `authz.check('accounts.merge')`, optimistic version | OK |
| seed_hospitality_booking | platform admin or tenant owner | OK |
| get_tenant_config, get_tenant_config_history | tenant member or platform admin (existence oracle only, F11) | OK |
| tenant_entitlements | tenant member or platform admin | OK |
| can_contact, can_contact_many | membership of the lead's workspace (`member_ws_ids()`); other-tenant ids return false; 50 000 id cap; `auth.uid() is null` bypass is service-role only because anon has no EXECUTE | OK |
| my_workspaces, my_grants, ws_role, is_member, has_member_role, has_ws_role, role_ws_ids, member_ws_ids, member_tenant_ids, member_role_ws_ids, owner_tenant_ids, co_member_ids, is_platform_admin, has_active_support_session | All derive from `auth.uid()`; parameters (ws id) only ever answer "is the caller X in ws" | OK by design (needed by RLS policies) |
| authz.* (check, explain, my_grants, attr, cond_ok, record_ok, shared_ids, team_user_ids, ws_with, ws_with_member, tenant_ids_with, org_allows, platform_role_in, can_manage_roles, role_within_caller, is_agent_bot, is_bot_user, in_my_districts) | Caller-relative; `explain` takes a workspace id from the caller but only evaluates the caller's own grants (leaks only "unknown workspace" vs "not a member"). `is_bot_user(p_user)` reveals whether any uuid is an agent user | OK (F11) |
| audit_record | Membership of `p_workspace`, action regex, but caller-supplied `p_actor_kind`, `p_source`, `p_impersonation`, `p_summary` | **FIX** (F2) |
| usage_bump | Member of `p_tenant` (or sole tenant); any metric name and increment up to 1e9 | **FIX** (F4) |
| emit_event | Membership of workspace; any type matching regex | **FIX** (F6) |
| agent_enqueue, ai_cap_status | see (c) | F5, F8 |
| rate_limit_hit | see anon table | **FIX** (F3) |
| submit_lead, track_event, tenant_branding | see anon table | OK |

No function was found that takes a tenant/workspace id from the caller without verifying membership, other than the intentional public-intake pair (`submit_lead`, `track_event`) and `rate_limit_hit` (no tenant concept) and `authz.explain` (read-only oracle).

### F2: audit_record actor spoofing (P1)

A workspace member can write `actor_kind in ('system','api_key','connector','agent','support','platform_admin')` and `source in ('api','connector','job','agent','support')`, plus arbitrary `summary`/`detail`. `actor_id` is still `auth.uid()`, so attribution survives, but dashboards and compliance exports that filter on `actor_kind`/`support_session_id` can be polluted, and a support/platform entry can be faked by a tenant user.

```sql
-- inside public.audit_record, after v_kind / v_src are computed:
if v_ss is null and not public.is_platform_admin() then
  if v_kind <> 'user' then raise exception 'actor kind not allowed' using errcode = '42501'; end if;
  if v_src not in ('ui','api') then raise exception 'source not allowed' using errcode = '42501'; end if;
  p_impersonation := false;
end if;
```
(Ship as `create or replace function` with the full body from 0021/T021 plus the block above, keeping `set search_path = ''` and the existing grant to authenticated only.)

### F3: rate_limit_hit (P1)

Callers choose the bucket, so a malicious anon can call `rate_limit_hit('tap:login:<victim email or IP>', 1, 86400)` repeatedly and push the victim's login throttle over its limit (lockout), and can create unlimited bucket rows. The app already calls it server-side (login throttle, API per-key limit), where the service-role client is available.

```sql
revoke execute on function public.rate_limit_hit(text,integer,integer) from anon, authenticated, public;
grant  execute on function public.rate_limit_hit(text,integer,integer) to service_role;
```
Requires updating `supabase/tests/0014_event_bus_jobs_audit.test.sql` lines 98-104 and BUILD-PLAN 2.x row (line ~322, "granted to anon + authenticated") and confirming the login action calls it with the service client. If login must stay anon-callable, instead make the function derive the bucket prefix server-side (allow only `tap:` prefixes with a hashed suffix) and cap `p_limit` at 100 for non-service callers, and add a cleanup job for old windows.

### F4: usage_bump (P2)

Any member can inflate usage (burning the tenant's AI/plan caps and corrupting billing) or pre-fill other metrics. Consumers are server-side (`aiComplete` step 8).

```sql
revoke execute on function public.usage_bump(text,bigint,uuid) from authenticated, anon, public;
grant  execute on function public.usage_bump(text,bigint,uuid) to service_role;
```
Adjust `0020` pgTAP tests that call it as an authenticated user to run as service_role.

### F6 and F5

```sql
-- F6: in events.emit (or public.emit_event wrapper), reject reserved namespaces for end users:
-- if auth.uid() is not null and p_type ~ '^(lead|deal|agent|billing|system|support|consent)\.' then raise exception 'reserved event type' using errcode='42501'; end if;
-- (use the actual allow-list from src/lib/events/catalog/*.ts; "record.<obj>.*" stays allowed)

-- F5: in public.agent_enqueue, after the trigger check:
-- if p_event is not null and not exists (select 1 from public.events e where e.id = p_event and e.workspace_id = a.workspace_id) then
--   raise exception 'event does not belong to the agent workspace' using errcode = '22023'; end if;
```

### F9: trigger and internal function EXECUTE hygiene (P3)

```sql
revoke execute on function public.comments_after_insert(), public.comments_guard(), public.realtime_broadcast_row()
  from anon, authenticated, public;
revoke execute on function private.agent_child_scope(), private.agent_triggers_guard(), private.agents_guard(),
  private.agents_membership_drift(), private.ai_audit_policy(), private.invoices_guard(),
  private.privacy_request_defaults(), private.tenant_ai_policy_default(), private.tenant_subscription_default()
  from anon, authenticated, public;
-- triggers still fire: trigger invocation does not check EXECUTE for the invoking role.
-- also optional: revoke submit_lead from authenticated (public intake only).
```
Then re-run `get_advisors` expecting anon_security_definer to drop from 7 to 3 (submit_lead, track_event, tenant_branding).

### F10 / F8 / F7

```sql
-- F10 (check no objects depend on public.pg_net references first):
-- create schema if not exists extensions; alter extension pg_net set schema extensions;

-- F8: in ai_cap_status, ignore p_user unless caller can manage AI:
--   v_user := case when p_user is null or p_user = (select auth.uid()) then (select auth.uid())
--                  when authz.ws_with_member('ai.toggle','all') is not empty ... then p_user
--                  else (select auth.uid()) end;
--   (service role, auth.uid() is null, keeps the current behaviour)

-- F7: v_backup_latest: show workspace_id is null rows only to platform admins:
--   ... and ((workspace_id is null and public.is_platform_admin()) or workspace_id in (select role_ws_ids(...)))
```

## (c) 0021 functions

| Function | Finding |
|----------|---------|
| agent_enqueue | Membership plus `ai.toggle` scope all verified for authenticated; `auth.uid() is null` skips the check (service role / worker only, anon has no EXECUTE); trigger-belongs-to-agent verified. Gap: `p_event` not tied to the agent's workspace (F5). `p_input` arbitrary jsonb is passed to the worker. |
| ai_cap_status | Tenant membership enforced (`not allowed` otherwise, covered by pgTAP). `p_user` is caller-controlled so a member can read a colleague's daily count (F8, same tenant only). |
| can_contact_many | Membership filter by workspace, unknown ids return false, other-tenant ids return false (pgTAP line 88), 50 000 cap. OK. |

## (d) The 67 rls_enabled_no_policy tables

List: `private.settings`, `ai_usage_default` + 16 monthly `ai_usage_p2026xx/p2027xx`, 12 `api_request_log_p*`, `events_default` + 15 `events_p*`... (all partition children), 15 `webhook_deliveries_p*`, plus `idempotency_keys`, `invoice_series`, `oauth_states`, `rate_limits`.

Verified by catalog query:
- No table in `public`/`private`/`authz`/`events`/`metadata` has RLS disabled (query returned zero rows).
- None of the 67 holds any table grant for `anon` or `authenticated` (query returned zero rows), and `anon` has no table grants anywhere in `public`/`private`.
- Partition children carry no grants by design: access goes through the parent tables (`ai_usage`, `events`, `api_request_log`, `webhook_deliveries`) which have their own tenant policies, and through service-role workers for the singletons (`rate_limits`, `idempotency_keys`, `oauth_states`, `invoice_series`, `private.settings`).

Verdict: fine by design, service-only. Optional hygiene: add an explicit `-- service-only` comment migration, or a restrictive `using (false)` policy on the six non-partition tables to silence the INFO lint. Policy `using(true)` found only on reference catalogs (`permissions`, `event_types`, `connector_catalog`, `connector_availability`, `plans`, SELECT to authenticated): fine, global non-tenant data. (If `connector_availability.note` can hold tenant-sensitive text, revisit.)

## Suggested migration order

1. 0022_views_readonly (F1) and pgTAP asserting no write privilege on any `v_*` view: ship first.
2. 0023_rpc_hardening (F2, F3, F4, F9) with updated tests and BUILD-PLAN line 322 note.
3. 0024_agent_event_guards (F5, F6, F8, F7, F10).
4. Record the 5 owner-run masked/sync views as accepted exceptions in the gate doc so the 11 ERRORs are explained, not silently ignored.
