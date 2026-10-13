# Growth CRM: Supabase backend

| | |
|---|---|
| Project | **Lawsome** · ref `evybdanqxgkjoybrvzru` · region `ap-southeast-1` · Postgres 17 |
| API URL | `https://evybdanqxgkjoybrvzru.supabase.co` |
| Source of truth | `supabase/migrations/` (applied in filename order). `schema.sql` is **generated** from them; do not edit it. |
| Generated types | `supabase/types.ts` (from the live project) |
| Seed | `supabase/seed/seed.sql` (synthetic), `seed/assign_owners.sql`, `seed/reset_demo.sql` |

## 1. Migrations

| File | What it does |
|---|---|
| `0001_core.sql` | Enums and tables (originally tenant-scoped), indexes |
| `0002_triggers.sql` | updated_at, audit (PII masked), signup to profile, lead assignment, first-response task, deal stage history |
| `0003_rls.sql` | RLS on every table, first tenant/role policy set (superseded by 0006) |
| `0004_workspaces.sql` | **Workspace model:** `workspaces`, `memberships`, `platform_admins`, `support_sessions`; `workspace_id` on every business table (tenant_id derived by trigger); unique keys per workspace; roles move from profiles to memberships; RLS helpers |
| `0005_triggers_ws.sql` | Trigger functions rewritten per workspace; membership guard; admin/member exclusivity; audit stamps `workspace_id` + `support_session_id` |
| `0006_rls_ws.sql` | Every policy rewritten per workspace (see section 3) |
| `0007_rpcs.sql` | `submit_lead`, `track_event`, `erase_lead`, `my_workspaces`, `invite_member`, `create_workspace`, `admin_create_tenant`, `start/end_support_session`, `admin_workspace_stats`, `admin_set_tenant_status`, `tenant_branding` |
| `0008_views.sql` | Aggregate views (`v_*`), workspace + role filtered |
| `0009_grants.sql` | anon: intake RPCs only. authenticated: tables (RLS), helpers, app RPCs. Default privileges closed to anon |

**Apply.** Use the Supabase MCP `apply_migration` (one call per file, name = file name without `.sql`). You can also paste the files into the SQL editor in order. Statements that contain `DROP`/`DELETE` (0004, 0007, `reset_demo.sql`) need explicit user confirmation in the MCP. Check what is live with `list_migrations`.

**Local check (no Supabase needed).** You need PG 16+, a stub with the roles `anon`, `authenticated` and `service_role`, `auth.users(id, email, email_confirmed_at)`, `auth.uid()` (from `request.jwt.claim.sub`) and `auth.jwt()` (from `request.jwt.claims`). Apply `0001`..`0009`, then `seed/seed.sql`, with `psql -v ON_ERROR_STOP=1`.

## 2. Tenancy model

```
tenants (white-label org: branding, plan, status, primary_owner_id)
  └─ workspaces (isolation boundary: name, slug, region_label, SLA, business hours, holidays, lead intake)
       ├─ memberships (user × workspace × role)   ← a person can hold different roles in different workspaces
       └─ every business row (workspace_id NOT NULL; tenant_id is filled from the workspace by trigger a00_*_tenant)
platform_admins (Synthan operators; never also members)   support_sessions (audited break-glass, ≤ 60 min)
profiles (one per auth user: full_name, email, phone, language, last_workspace_id; no role)
```

Demo IDs (fixed, from `seed.sql`):

| Tenant | id | Workspace slug | Workspace id |
|---|---|---|---|
| `lawsome` "LAWSOME" | `10000000-0000-4000-8000-000000000001` | `lawsome-tn` "LAWSOME · Tamil Nadu" | `20000000-0000-4000-8000-000000000001` |
| | | `lawsome-kl` "LAWSOME · Kerala pilot" | `20000000-0000-4000-8000-000000000002` |
| `kaveri-demo` "Kaveri LegalTech (demo)" | `10000000-0000-4000-8000-000000000002` | `kaveri-cbe` "Kaveri · Coimbatore" | `20000000-0000-4000-8000-000000000003` |

Branding: LAWSOME `#1D5FBF` / `#0F8B8D`; Kaveri `#0F7B6C` / `#B7791F`.

## 3. RLS model

- RLS is enabled on **every** table. `anon` has **no** table or view privileges at all. It can only execute `submit_lead`, `track_event` and `tenant_branding`.
- Helpers are SECURITY DEFINER with `search_path = ''`. They read `memberships`/`support_sessions` directly, so policies never recurse:
  - `member_ws_ids()`: workspaces where the caller is an active member, plus any workspace with an active support session.
  - `role_ws_ids(variadic app_role[])`: the same, filtered by role. A support session counts as `viewer` (read_only) or `owner` (read_write).
  - `member_role_ws_ids(variadic app_role[])`: real memberships only. This is the "never during support" list: membership/invitation writes, integration and field-map writes, `leads_delete`, `erase_lead`.
  - Boolean forms for the app: `is_member(ws)`, `has_ws_role(ws, roles…)`, `has_member_role(ws, roles…)`, `ws_role(ws)`, `has_active_support_session(ws)`, `is_platform_admin()` (requires JWT `aal = 'aal2'` unless `mfa_required = false`).
- Policies use the uncorrelated form `workspace_id in (select public.role_ws_ids('owner','sales_manager'))`, which Postgres evaluates once per statement.
- Role rules per table are unchanged from the spec: a `sales_rep` sees own leads plus unassigned leads in their territory. A `viewer` gets no rows from `leads`, `contacts`, `activities` or `messages`, and uses `v_leads_masked` plus the aggregate views. Team views (`v_funnel_daily`, `v_pipeline_summary`, `v_campaign_perf`) return 0 rows to reps, and `v_rep_scorecard` returns only the rep's own row.
- Write policies require every referenced row (lead, deal, account, contact, campaign, conversation) to be visible to the caller. This blocks cross-workspace references and stops a rep from forging SLA touches on someone else's lead.
- A platform admin alone opens **only** platform tables: `tenants`, `workspaces`, `memberships`, `profiles`, `platform_admins`, `support_sessions`, `audit_log`. Business tables need an active support session. Every write during a session is stamped `actor_label='support'` and `support_session_id` in `audit_log`. Reads are not row-logged; the session row (who, workspace, reason ≥ 20 chars, mode, start/expiry/end) is the audit record, and workspace owners can read it.
- Views run as the view owner on purpose, so Viewers can read aggregates. Each view filters by workspace membership **and** role inside. The advisor flags them as `security_definer_view`; this is accepted.

## 4. Roles, users and invitations

Self sign-up gives **no access**. A profile and membership are created only from a pending invitation, and only once the email is confirmed (trigger on `auth.users` insert and on `email_confirmed_at` update).

**Deployment settings (Dashboard → Authentication):** disable public sign-ups, keep email confirmation on, and enable TOTP MFA (needed for platform admins).

Invite someone to a workspace from the app. The server action runs as the inviting user:
```ts
const { data } = await supabase.rpc('invite_member', { p_ws: wsId, p_email: email, p_role: 'sales_rep',
                                                        p_full_name: 'Arun Kumar', p_districts: ['Chennai'] });
if (data.status === 'invited') await adminClient.auth.admin.inviteUserByEmail(email); // service role, server only
// data.status === 'member_added' → the user already existed; the workspace appears in their switcher
```
- An owner can invite any role. A sales_manager can invite `sales_rep` or `viewer` only. A platform admin can only seat the **owner** of a workspace that has no active owner (bootstrap).
- From the Dashboard instead: Authentication → Users → Invite user, after inserting the invitation row:
```sql
insert into public.invitations (workspace_id, email, full_name, role, territory_districts)
values ('20000000-0000-4000-8000-000000000001', 'priya@yourfirm.example', 'Priya Raman', 'sales_manager', '{}');
```
- Change a role or deactivate someone (SQL editor, service role):
```sql
update public.memberships set role = 'viewer'  where user_id = '<auth uid>' and workspace_id = '<ws id>';
update public.memberships set is_active = false where user_id = '<auth uid>' and workspace_id = '<ws id>';
```
In the app, a user can never change their own role. A sales_manager can only move people between rep and viewer.

**Make a platform admin (super admin).** Use the SQL editor or service role only; there is deliberately no RPC for this. The account must not hold any membership:
```sql
insert into public.platform_admins (user_id, mfa_required) values ('<auth uid>', true);
```
A platform admin then works through `start_support_session(p_workspace_id, p_reason, p_mode, p_minutes)`, where p_mode is `read_only` or `read_write` and p_minutes is 15, 30 or 60, and closes it with `end_support_session(p_id, p_workspace_id)`. `admin_create_tenant(name, slug, branding jsonb, owner_email, workspace_name)` creates a tenant, its first workspace and the owner seat.

**Demo users.** None are created by SQL; the project has no auth users. To populate owners, invite the demo personas into `lawsome-tn` (owner, sales_manager, three sales_reps, marketing, data, viewer) and run `seed/assign_owners.sql`. It spreads leads by district over the reps and gives deals, tasks and activities to the lead owner.

## 5. Landing intake: `submit_lead` contract

`POST {SUPABASE_URL}/rest/v1/rpc/submit_lead` with headers `apikey: <anon/publishable key>` (and `Authorization: Bearer <anon JWT>` for legacy JWT keys):

| Param | Rule |
|---|---|
| `p_workspace` (required) | workspace slug or id; must have `lead_intake_enabled`, not archived, tenant active (landing: `NEXT_PUBLIC_LEAD_WORKSPACE`, default `lawsome-tn`) |
| `p_full_name` | 2-120 chars |
| `p_email` | ≤ 160, `x@y.zz`; dedupe on `lower(email)` per workspace (repeat submit refreshes last touch + consents) |
| `p_phone` | optional, `+?` 8-15 digits after stripping |
| `p_firm_name` | ≤ 160; creates an `accounts` row only for a new lead |
| `p_role_title` | one of `Managing partner / owner`, `Senior advocate / practice head`, `Associate / lawyer`, `Legal operations / admin`, `Other` |
| `p_city`, `p_practice_area` | ≤ 80 |
| `p_district` | TN districts / Puducherry / Kerala districts, otherwise stored null |
| `p_consent_followup` | **must be true** (else error); `p_consent_whatsapp`, `p_consent_marketing` optional |
| `p_notice_version` | ≤ 20, default `v1` |
| `p_utm` | object; only `source/medium/campaign/term/content` (or `utm_*`) string values kept, 120 chars each; ≤ 2 KB |
| `p_click_ids` | only `gclid/fbclid/li_fat_id/msclkid`; ≤ 1 KB |
| `p_anon_id`, `p_landing_path` | 8-64 chars; ≤ 300 |

Writes `leads` (score and score_factors computed by rule), `consent_log` (one `granted` row per given purpose, `subject_ref = sha256(lower(email))`) and `lead_events` (`form_submit`). It returns only the lead uuid. Errors: `22023` validation (HTTP 400 from PostgREST; the route maps this to 422), `54000` throttle (5 per email per hour, 300 per workspace per 10 min; the route maps this to 429). `track_event(p_workspace, p_anon_id, p_event_name, p_path, p_utm, p_props)` accepts `page_view`, `cta_click`, `form_start`, `tour_play`, `pricing_view` and `demo_booked`, only with a consented `anon_id`.

## 6. Environment variables

| App | Variable | Notes |
|---|---|---|
| growth-crm | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + SSR client (RLS applies) |
| growth-crm | `SUPABASE_SERVICE_ROLE_KEY` | server actions only (inviteUserByEmail); never `NEXT_PUBLIC_` |
| lawsome-landing | `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`), `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_LEAD_WORKSPACE`, `PRIVACY_NOTICE_VERSION`, `LEAD_WEBHOOK_URL`, `CRM_BASE_URL` | see `.env.example` |

Values live in each app's `.env.local` (gitignored). Never commit keys.

## 7. Backups

- Supabase takes daily backups (7-day retention on Free/Pro). They do not cover Storage objects or Edge Functions, and PITR is a paid add-on. There is **no official API to read backup status**.
- So the backup job (nightly `pg_dump` / `supabase db dump` to an offsite bucket, 30-day retention) writes a **heartbeat row** into `backup_checks` (`check_kind = logical_dump`, size, `row_counts`, status). A daily check compares it to `backup_alert_rules`: no success in 26 h, a size drop over 20%, or a restore drill older than 100 days. Quarterly restore drills are logged as `restore_drill`. Rows with `workspace_id is null` are project-wide. `/data-health` reads `v_backup_latest` plus these rows.

## 8. Wiring the UI to Supabase (table → screen)

The UI should always filter by the active workspace (`ws` cookie) **and** rely on RLS. Column names below are snake_case as in `types.ts`.

| Screen | Read from | Notes |
|---|---|---|
| Workspace switcher / shell | `rpc('my_workspaces')` | id, name, slug, tenant, `branding` jsonb, `role`, `via_support_session` |
| `/` Command Center | `v_funnel_daily`, `v_pipeline_summary`, `v_campaign_perf`, `v_rep_scorecard`, `leads` (counts) | won this month = `deals.won_at` |
| `/sales` My day | `leads` (owner_id = me), `tasks` (assignee_id = me), `activities`, `v_rep_scorecard` | |
| `/leads`, `/leads/[id]` | `leads`, `lead_events`, `activities`, `tasks`, `consent_log`, `deals` | lead name = `full_name`, firm = `firm_name`, stage = `status` (+ deal stage, see spec 14 derivation), channel = `first_touch_channel` / `last_touch_channel`, score = `score` + `score_factors` |
| Viewer lists | `v_leads_masked` | no email/phone |
| `/pipeline` | `deals` + `pipeline_stages` (`key`, `label`, `position`, `probability`) + `deal_stage_history` | value = `value_inr`, close = `expected_close_on` |
| `/accounts` | `accounts` (`court_focus[]`, `practice_areas[]`, `size_band`, `lawyers_count`, `customer_status`) | |
| `/campaigns` | `campaigns`, `campaign_daily_metrics` (`spend_inr`, `impressions`, `reach`, `clicks`, `platform_leads`, …), `v_campaign_perf`, `v_campaign_reach_profile` | |
| `/analytics` | `ga4_daily`, `v_funnel_daily` | |
| `/tasks` | `tasks` (`kind`, `priority`, `assignee_id`, `due_at`, `status`) | |
| `/inbox` | `conversations`, `messages`, `message_templates` | showcase |
| `/integrations` | `integrations` (`provider`, `status`, `settings.sample_feed`, `last_sync_at`), `integration_field_maps`, `sync_runs`, `v_sync_freshness` | |
| `/data-health` | `v_backup_latest`, `backup_checks`, `backup_alert_rules` | |
| `/settings` | `memberships` + `profiles`, `invitations`, `workspaces`, `tenants` (branding: primary owner only), `consent_log`, `audit_log`, `rpc('erase_lead')` | |
| `/admin/*` | `rpc('admin_workspace_stats')`, `tenants`, `workspaces`, `memberships`, `support_sessions`, `audit_log`, `rpc('admin_create_tenant' / 'admin_set_tenant_status' / 'start_support_session' / 'end_support_session')` | aggregates only |

Next steps for the UI: replace the mock `DataSource` per screen with these reads (`supabase.from('<table>').select(...).eq('workspace_id', ws)`). Map snake_case to camelCase in the adapter. Derive the funnel stage as spec section 14 describes. Read the role from `my_workspaces()`, not from `profiles`.

## 9. Divergence from the earlier `schema.sql` reference design (commit e7ea52d)

`schema.sql` is now regenerated from the migrations. These are the intentional differences from the hand-written e7ea52d design:
1. **Workspace model** (0004-0009): `workspace_id` on every business table; roles on `memberships`; `profiles` has no role or tenant; region settings live on `workspaces`; new helpers replace `current_tenant_id/current_app_role/has_role`.
2. **FOR ALL write policies split** into insert/update/delete with the role check on INSERT too. In e7ea52d, the USING-only role check let any tenant member, including viewers, insert pipeline stages, territories, campaigns, integrations and similar rows.
3. **Reference visibility** on writes covers more columns than e7ea52d (contacts, campaigns, accounts on activities, ai_insights refs).
4. `conversations` insert is limited to owner/sales_manager or the assigned sales_rep.
5. `submit_lead` adds a utm/click-id key whitelist with value caps, extra utm→channel mappings, a rule-based score, Kerala districts, and a workspace parameter instead of a tenant slug.
6. `deal_stage_change` keeps a provided `stage_entered_at` on insert (imports/seed), and `deal_stage_history` uses it.
7. Trigger functions are not executable by any API role. Default privileges stay closed to `anon` for future objects.
8. Platform admins are a separate identity (trigger), `invite_member` gives admins only an owner-bootstrap path, and branding is editable only by `tenants.primary_owner_id` or a super admin.
