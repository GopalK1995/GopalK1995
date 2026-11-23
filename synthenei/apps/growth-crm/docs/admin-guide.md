# Admin guide

For the person who runs this Growth CRM for their organisation — the **workspace owner / admin**. It
describes what is actually built today. Where an action is reserved for the **platform operator** (Synthan
staff), that is called out explicitly; everything else is yours to do.

> **Org vs workspace.** An *organisation* ("org", the `tenants` row) can contain several *workspaces*. A
> workspace is the isolation boundary: members, leads, deals and most settings live inside one workspace.
> Branding applies to the whole org; most other settings apply to the current workspace only. Switch
> workspace from the top bar; your role can differ per workspace.

## 1. First-run setup (`/onboarding`)

New workspaces open on a checklist (`/onboarding`). The steps, and the permission each needs:

| Step | What it does | Needs |
|---|---|---|
| Template | Pick a vertical preset (legal / hospitality / blank) that seeds vocabulary, modules, stages | `config.edit` |
| Branding | Name, logo, brand hue (white-label) | `org.branding` |
| Modules | Turn product areas on/off for this workspace | `config.edit` |
| Pipelines | Lead & deal stages (`/settings/pipelines`) | `pipelines.manage` |
| Fields | Custom fields (`/settings/fields`) | `fields.manage` |
| Team | Invite members (`/settings`) | `members.invite` |
| Integration *(optional)* | Connect a first integration (`/integrations`) | `integrations.manage` |
| Import *(optional)* | Import leads from CSV / Sheets (`/import`) | `leads.import` |

Skip optional steps and return later. The checklist remembers progress.

## 2. Organisation & workspace settings (`/settings`)

`/settings` is a tabbed page; which tabs you see depends on your role:

- **Users & roles** — in demo mode this lists members; in a real workspace it points to
  **Roles & access** (`/settings/roles`, section 3).
- **White-label branding** — org name, logo and the brand-hue slider; **applies to the whole org**. Needs
  `org.branding`.
- **Configuration** — vocabulary (what you call leads/deals/etc.), modules on/off, dashboard tiles. Needs
  `config.edit`. What you can change is bounded by what the platform allows your org
  (`org_admin_policies`).
- **Pipeline stages** — deal/lead stages, probabilities and SLAs (also `/settings/pipelines`). Needs
  `pipelines.manage`.
- **Consent & privacy** — DPDP requests, consent log, retention (section 6).
- **Audit log** — append-only record of writes in this workspace, including platform support sessions
  (section 7). Owners see unmasked actor/IP/PII; other roles see them masked. **No one, including Owners,
  can edit or delete audit rows.**

## 3. Members, roles and access (`/settings/roles`)

There are **six system roles** (templates). Their real grants live in
`src/lib/authz/catalog/system-roles.ts`:

| Role | In one line | Highlights |
|---|---|---|
| **Owner** | Full access: revenue, pipeline, team, branding, billing | everything, incl. `members.manage`, `billing.manage`, `integrations.manage`, `privacy.fulfil`, `org.branding` |
| **Sales Manager** | Team pipeline, assignment, targets, SLAs | team-wide leads/deals, `leads.assign`, `members.invite`/`manage`, `pipelines.manage`, `teams.manage`; **no** billing/branding |
| **Sales Rep** | Own leads, demos, follow-ups | `own`-scoped leads/deals/tasks/inbox, can send WhatsApp/email, read PII |
| **Marketing** | Campaigns, audience, analytics | `campaigns.write`, `segments.write`, `leads.import`, read-only deals/accounts |
| **Data** | Imports, integrations health, backups | `leads.import`/`export`, `data_health.manage`, `backups.manage`, `audience.export` |
| **Viewer** | Read-only dashboards, no personal data | read leads/deals/accounts/campaigns; **no** `pii.read` (personal data masked) |

Scope matters: a grant is `all`, `team` or `own`. A Sales Rep with `leads.read: own` sees only their own
leads plus unassigned leads in their territory; a Sales Manager with `team` sees their team's.

**Inviting members:** with `members.invite`, invite by email and assign a role (and optionally a team). An
org that the platform has allowed custom roles (`org_admin_policies.allow_custom_roles`) can **clone and
edit** a system role into a custom one via `roles.manage`. You can never grant a role more permission than
you hold yourself. Teams (`/settings/teams`, `teams.manage`) drive `team`-scoped visibility and manager
relationships.

> Permissions like `members.manage`, `roles.manage`, `org.admin`, `org.branding`, `integrations.manage`,
> `api_keys.manage`, `webhooks.manage`, `privacy.fulfil`, `leads.export` and `billing.manage` are
> **support-blocked**: a platform support session can never perform them (section 7).

## 4. Integrations (`/integrations`)

Connect the tools your org uses — WhatsApp, Razorpay, Meta/Google/LinkedIn ads, Mailchimp, Gmail/Outlook,
Zoho/HubSpot, Calendly/Cal.com, Slack, OTA channel managers, and more. Needs `integrations.manage` to
connect/disconnect (read-only for `integrations.read`).

Each connector has its own runbook under **`docs/connectors/<id>.md`** (what you must provide, approvals,
sandbox steps, go-live flip, failure modes) with the shared mechanics in `docs/connectors/README.md`. Key
points for an admin:

- **Sandbox vs live.** New connections usually start in **sandbox** and show an amber *"Sandbox: not
  sending to real customers"* chip. Whether a connector can go live is **platform-controlled**
  (`connector_availability`): some connectors need vendor approval (WhatsApp, Meta, Google Ads/Business,
  LinkedIn, Outlook) or platform-registered app credentials (Mailchimp, Slack, Zoho, HubSpot) before a live
  connection is possible. The connector card tells you which state it's in.
- **The status chip is truthful.** "Connected" appears only when credentials exist, the platform has the
  connector live, and your connection is live and healthy. Otherwise you'll see sandbox / needs-attention /
  not-configured, etc.
- **Credentials are never shown back.** Secrets go into an encrypted vault and are never logged or
  returned. A connection that loses its token moves to **needs attention** — reconnect it.
- **Automation (Zapier/Make)** don't store credentials here; you create a scoped **API key**
  (`/settings/api-keys`) and paste it into Zapier/Make. See `docs/connectors/zapier.md` / `make.md` and the
  public API docs at `/docs/api`.

## 5. Billing & subscription (`/settings/billing`)

Needs `billing.read` to view, `billing.manage` to change. Shows your plan, a **seats meter**, and
trial / past-due / cancelled / suspended banners. You can edit GST details, view/download GST invoices
(PDF hidden for drafts), and self-serve subscribe/cancel (Razorpay Subscriptions; test mode until KYC).

- If the org is **read-only** (expired trial / past-due), `billing.manage` is denied **except** the owner
  can still pay their way out of a read-only state.
- A **suspended** org stays blocked; only the platform operator can reactivate it.
- Plan limits (seats, workspaces, API keys, webhooks, AI calls) are enforced; hitting the **seat limit**
  caps `members.invite`. Platform billing is distinct from the Razorpay **payments connector** your org
  uses to charge its own customers.

## 6. Data: import, health & privacy

- **Import & export (`/import`).** CSV/XLSX import with column mapping and dedupe (also fed by the Google
  Sheets connector). Import needs `leads.import`; export needs `leads.export` (support-blocked).
- **Data health (`/data-health`).** "Is the data fresh, complete and backed up?" Shows sync freshness per
  connector (Fresh / Late / Stale / Never), a nightly heartbeat, backup status (daily backup, PITR, full
  dump, **last restore drill** — target every ≤90 days), and row-count drift vs the last heartbeat.
  Running checks needs `data_health.manage`; editing alert rules needs `backups.manage`. Note: Supabase
  exposes no backup-status API, so some rows are written by the integrator's own jobs and some must be
  confirmed in the Supabase dashboard.
- **Consent & privacy (`/settings/privacy` and the `/settings` Privacy tab).** Handle **DPDP Act** requests
  (access / correction / erasure / withdrawal / grievance), due **30 days** after receipt. The consent log
  is append-only; unsubscribe and WhatsApp **STOP** write withdrawals automatically. **Erasure is
  Owner-only** (`privacy.fulfil`) and **never available during a support session**. There is also a
  public, tenant-branded request form at `/privacy/<workspace-slug>` that data principals use directly
  (sends a verification link; nothing is recorded until confirmed). Breach register and retention policies
  live under `/settings/privacy/breaches` and `/settings/privacy/retention`.

## 7. Platform support sessions

Synthan staff (platform admins) **cannot see your business data** by default. To help with a ticket, a
platform admin opens a **time-boxed support session** (≤60 minutes, with a recorded reason) against your
workspace. While it is open:

- A `read_only` session acts as the **Viewer** role; a `read_write` session acts as **Owner minus the
  support-blocked actions** (no export, branding, integrations, erasure, AI toggle, workspace create,
  member/role management, privacy fulfilment, API keys or webhooks).
- The session is **confined to the one workspace** it was opened on and expires automatically.
- Every support action is written to your **audit log**, flagged as a support session with the operator's
  name and the stated reason, so you can see exactly what was done and when.

## 8. Language (English / Tamil)

The product ships English, with Tamil available where it has been human-reviewed. Each member's language
comes from their profile (`en` / `ta`). **Tamil UI is gated**: machine-drafted Tamil strings must be
reviewed by a fluent human before tenants see them, so until that review, Tamil is offered only where it
already exists end-to-end (message templates and some drafts), not across the whole UI. Numbers, dates and
currency format for India (lakh/crore grouping, IST, INR). If you need full Tamil UI for your org, raise it
with the platform operator — it is a review gate, not a missing feature.

## 9. Public API & webhooks (quick pointers)

- **API keys (`/settings/api-keys`, `api_keys.manage`).** Create scoped keys (`sk_live_…` / `sk_test_…`)
  bound to a role; the secret is shown once. Keys call `/api/v1/*` under the **same authorization matrix as
  the UI** (RLS applies). Scopes only narrow a role, never widen it.
- **Outbound webhooks (`/settings/webhooks`, `webhooks.manage`).** Subscribe HTTPS endpoints to event
  types; deliveries are signed (Standard Webhooks), retried with backoff, and an endpoint is **auto-disabled
  after 5 consecutive days of failure** (you're notified). Rotate the secret with a 24-hour overlap; "send
  test event" and manual replay are available.
- **API reference:** `/docs/api` (also `GET /api/v1/openapi.json`).

Both `api_keys.manage` and `webhooks.manage` are support-blocked.
