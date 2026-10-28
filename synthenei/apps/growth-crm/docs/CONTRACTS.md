# Growth CRM: Shared Contracts

Authoritative for implementation agents. If `BUILD-PLAN.md` and this file disagree, **this file wins**. Task cards (in `docs/batches/batch-0N.md`) cite sections by id (C1 … C18). Read only the sections your card cites. All paths are relative to `synthenei/apps/growth-crm/` unless they start with `/` (repo root `C:\Users\Admin\Documents\GitHub\crm-check`).

---

## C1 Conventions, commands, invariants, known traps

### C1.1 Commands (Windows, Git Bash; system Node is 20, always run through Node 22)
| Purpose | Command |
|---|---|
| install | `npx -y -p node@22 npm ci` |
| typecheck | `npx -y -p node@22 npm run typecheck` |
| lint | `npx -y -p node@22 npm run lint` |
| unit | `npx -y -p node@22 npm run test:unit -- <path-or-glob>` (Vitest; `--run` is implied) |
| build | `NEXT_DIST_DIR=.next-T0NN npx -y -p node@22 npm run build` |
| start (for Cypress) | `NEXT_DIST_DIR=.next-T0NN PORT=32NN npx -y -p node@22 npx next start -p 32NN` (NN = task number mod 100; T013 → 3213) |
| dev | `NEXT_DIST_DIR=.next-T0NN npx -y -p node@22 npx next dev -p 31NN` |
| Cypress E2E | `CYPRESS_BASE_URL=http://localhost:32NN npx -y -p node@22 npx cypress run --e2e --spec "<spec globs>"` |
| Cypress component | `npx -y -p node@22 npx cypress run --component --spec "<spec globs>"` |
| config test (existing) | `npx -y -p node@22 npm run test:config` |
| affected specs | `node scripts/affected-specs.mjs` (prints a comma-separated spec list for your diff) |

Mode for E2E: `CYPRESS_MODE=demo` (server started with `APP_ENV=demo`, no Supabase env) or `CYPRESS_MODE=real` (server started with `APP_ENV=staging` and the staging env from `.env.staging.local`, pointing at the Supabase **branch** DB). Every spec starts with `cy.requireMode('demo' | 'real' | 'any')` and is skipped in the other mode.

### C1.2 Invariants (break one = task fails review)
1. **Demo keeps working.** Demo sessions (`session.demo === true`) never create a Supabase client and never write. Every new write path has a demo branch that returns the standard result with `sub: t('common.demoNotSaved')`. Every new page renders in demo with mock data or a designed empty state.
2. **Edge middleware** (`src/middleware.ts`) and anything it imports: no Node APIs (`fs`, `crypto` from node, `Buffer`), no `next/headers`, no `@supabase/ssr` server client, no DB calls. Web Crypto only.
3. **`"use server"` files export only async functions** (no consts, no types). Put types in a sibling `types.ts`.
4. **Server-only code** (`src/lib/db/service.ts`, vault, connectors, jobs, AI providers) starts with `import "server-only";`. The service-role key is read only in `src/lib/db/service.ts`.
5. **No tenant-specific code.** No string literals `lawsome`, `kaveri`, `shola` outside `src/lib/demo/**`, `src/lib/data/mock/**`, `supabase/seed/**`, `cypress/**` (lint rule `no-tenant-literals`).
6. **No raw colours** in `src/app/**`, `src/components/**`: tokens only (C15). Lint rule `no-raw-colors`.
7. **Every user-visible string** goes through i18n (C14) or tenant vocabulary (`vocabFor(active.tenant)` in `src/lib/vertical.ts`). Never hard-code "Lead", "Law firm", "Guest", "Booking".
8. **Every mutation** (server action, API route, job handler acting for a user) calls `assertCan` (C3) before touching data and relies on RLS as the second line.
9. **Type floor 12 px**, no em dashes in UI copy, no `text-[11px]` (the existing `src/components/ui/badge.tsx` uses 11 px: T007 fixes it).
10. **Owned files only.** Your diff must be a subset of your card's Create + Edit lists.

### C1.3 Known traps in this codebase
- **Shared mock ids across tenants.** Mock datasets reuse ids (`LD-1001`, conversation ids). The c2d562f bug leaked LAWSOME Tamil drafts into Shola Mist because a map was keyed by conversation id only. Any cache, map, memo or React key derived from a record id must also include the workspace id.
- **Vocabulary leaks.** Legal words (law firm, advocate, hearing, practice area) must never render for hospitality tenants and vice versa. Always render nouns from `vocabFor(tenant)` / metadata labels. The vocab-leak Cypress check (C16.5) runs in every gate.
- **Id formats differ by mode.** Demo record ids are strings (`LD-1001`, `acc-…`, `cmp-…`); real ids are uuids. Route params must accept both; never `z.string().uuid()` a route param in code that also serves demo.
- **Tenant id vs uuid.** `Tenant.id` is the **slug** (`tenant_config` RPCs `get_tenant_config(p_tenant text)` take the slug; cookie names `gcrm_cfg_<slug>`). `Tenant.uuid` is the DB id. `Workspace.id` is the slug in demo; real sessions carry the workspace **uuid** in `gcrm_ws` and in `session.memberships[].ws`. `workspaceById()` accepts either.
- **`resolve-pure.ts` reads hard-coded `TENANTS`** (`brandDefaults`, `presetOfTenant`). For DB tenants the preset must come from `tenant_config.config.preset` and brand defaults from the `tenants` row (T006 changes the call sites, not the pure function signature).
- **`pageCtx()` scoping** (`src/lib/data/context.ts`) filters rep data in JS (`scope.leads`). With RLS v2 the DB already scopes; keep the JS filter for demo only.
- **Fixed stage unions** `LeadStage`, `DealStage` (`src/lib/data/types.ts`) are removed only by T032. Until then do not add new stage ids.
- **Enum additions** (`alter type … add value`) cannot be used in the same transaction; put the usage in the next migration file.
- **Server Components cannot set cookies.** `createSupabaseServerClient()` swallows `setAll` errors in RSC; session refresh must happen in a server action or route handler.
- **`npm run test:config`** uses `rm -rf` (bash); run it from Git Bash, not PowerShell.
- **Parallel builds** must use a unique `NEXT_DIST_DIR`, else agents corrupt each other's `.next`.

### C1.4 Git
Branch `feat/T0NN-<slug>` from `origin/build/v1`; merge loop in `BUILD-PLAN.md §5.2`. Never push to `claude/inspiring-fermat-2iwd0p`. Commit messages: `T0NN: <imperative summary>` ending with the attribution trailer the coordinator gives you.

---

## C2 Identity and tenancy types

```ts
// src/lib/tenancy.ts (types owned by T006; demo arrays move to src/lib/demo/tenancy-fixture.ts)
export type PresetId = "legal" | "hospitality" | "blank";
export interface Tenant {
  id: string;            // slug, e.g. "lawsome"
  uuid: string;          // tenants.id
  name: string; product: string; hue: number; monogram: string;
  plan: "Growth" | "Scale" | "Pilot"; seats: number; primaryOwnerId: string;
  status: "active" | "suspended" | "trial"; createdAt: string; supportEmail: string;
  vertical?: PresetId;   // from tenant_config.preset in real mode
  config?: TenantConfigOverrides; // attached per request by requireActive
}
export interface Workspace {
  id: string;            // slug
  uuid: string;          // workspaces.id
  tenantId: string;      // tenant slug
  name: string; region: string; createdAt: string;
  dataset: "tn" | "kerala" | "kaveri" | "wg" | null; // null for real-only workspaces
}
export const workspaceById: (idOrUuid: string) => Workspace | undefined;   // demo fixture lookup (sync)
export async function loadWorkspace(idOrUuid: string): Promise<{ ws: Workspace; tenant: Tenant } | null>; // real: DB (server only)
```
Demo fixture uuids: tenants `10000000-0000-4000-8000-00000000000{1,2,3}` (lawsome, kaveri-demo, shola-mist); workspaces `20000000-0000-4000-8000-00000000000{1,2,3,4}` (lawsome-tn, lawsome-kl, kaveri-cbe, shola-mist-coonoor).

```ts
// src/lib/auth/session.ts (existing, T005 owns)
interface Session { uid: string; name: string; email: string; demo: boolean; platformAdmin: boolean;
                    memberships: { ws: string; role: Role }[]; iat: number }
// cookies: gcrm_session (12 h), gcrm_ws (90 d), gcrm_support (≤ 60 min), gcrm_cfg_<tenantSlug> (demo config)
// src/lib/auth/context.ts (T006 owns)
interface Active { ws: Workspace; tenant: Tenant; role: Role /* base role */; support: SupportSession | null }
```

Principal (built by `loadPrincipal()`, C3):
```ts
export type PrincipalKind = "user" | "api_key" | "connector" | "agent" | "demo";
export interface Principal {
  kind: PrincipalKind; uid: string; demo: boolean;
  tenant: { uuid: string; slug: string; status: "active" | "trial" | "suspended"; trialEndsAt: string | null };
  ws: { uuid: string; slug: string };
  role: { id: string; key: string; base: Role };
  perms: Record<string, Grant>;             // permission key → grant
  teamUserIds: string[];                    // users visible under "team" scope (incl. self)
  attrs: { districts?: string[]; regions?: string[]; languages?: string[] } & Record<string, unknown>;
  support: { mode: "read_only" | "read_write"; expiresAt: string } | null;
  modules: Record<ModuleId, boolean>;       // tenant_config ∩ org_admin_policies.allowed_modules
  policy: OrgAdminPolicy;
}
export interface Grant { scope: Scope; conditions: Condition | null; fieldMask: string[] }
```

---

## C3 Authorization API

### C3.1 Permission catalogue (keys)
Files: `src/lib/authz/catalog/<domain>.ts` each export `PERMISSIONS: PermissionDef[]` (`{ key, resource, action, description, isPii?, platformOnly?, supportBlocked? }`); `src/lib/authz/catalog/index.ts` concatenates. SQL table `permissions` is seeded from these by the generator.

| Domain file | Keys |
|---|---|
| `core.ts` | `dashboard.read`, `myday.read`, `settings.read`, `pii.read`, `records.share`, `comments.write`, `comments.moderate`, `audit.read`, `org.admin`*, `org.branding`*, `config.edit` |
| `sales.ts` | `leads.read`, `leads.create`, `leads.write`, `leads.assign`, `leads.delete`*, `leads.export`*, `leads.import`, `contacts.read`, `contacts.write`, `contacts.delete`*, `accounts.read`, `accounts.write`, `accounts.merge`, `accounts.delete`*, `deals.read`, `deals.write`, `deals.move`, `deals.delete`*, `tasks.read`, `tasks.write`, `tasks.assign`, `activities.read`, `activities.write` |
| `marketing.ts` | `campaigns.read`, `campaigns.write`, `segments.read`, `segments.write`, `audience.export`*, `analytics.read` |
| `inbox.ts` | `inbox.read`, `inbox.reply`, `inbox.assign`, `messages.send_whatsapp`, `messages.send_email` |
| `admin.ts` | `members.invite`*, `members.manage`*, `roles.manage`*, `teams.manage`, `fields.manage`, `objects.manage`, `pipelines.manage`, `layouts.manage`, `views.share`, `notifications.manage` |
| `platform-surfaces.ts` | `integrations.read`, `integrations.manage`*, `webhooks.manage`*, `api_keys.manage`*, `data_health.read`, `data_health.manage`, `backups.manage`, `privacy.fulfil`*, `billing.read`, `billing.manage`*, `ai.use`, `ai.toggle`* |
| `platform.ts` (platformOnly) | `platform.tenants.manage`, `platform.policies.manage`, `platform.support`, `platform.billing`, `platform.read` |
| dynamic | `obj:<objectKey>.read`, `obj:<objectKey>.write`, `obj:<objectKey>.delete` (created when a custom object is created) |

`*` = `supportBlocked: true` (denied in every support session regardless of mode). This reproduces and extends `SUPPORT_BLOCKED` in `src/lib/auth/roles.ts`.

Legacy mapping (T003 keeps `CAN`/`can(action, ctx)` exports working as wrappers): `assignLeads→leads.assign`, `workLeads→leads.write`, `moveDeals→deals.move`, `importCsv→leads.import`, `exportCsv→leads.export`, `editCampaigns→campaigns.write`, `branding→org.branding`, `manageUsers→members.manage`, `connectIntegrations→integrations.manage`, `seePersonalData→pii.read`, `createWorkspace→org.admin`, `editSegments→segments.write`, `editPipeline→pipelines.manage`, `runHealthCheck→data_health.manage`, `editAlertRules→backups.manage`, `erase→privacy.fulfil`, `aiToggle→ai.toggle`, `privacyRequests→privacy.fulfil`.

Page → permission (`PAGE_PERMISSION` in `src/lib/authz/pages.ts`): `/`→`dashboard.read`, `/sales`→`myday.read`, `/leads`→`leads.read`, `/pipeline`→`deals.read`, `/accounts`→`accounts.read`, `/contacts`→`contacts.read`, `/campaigns`→`campaigns.read`, `/audience`→`segments.read`, `/analytics`→`analytics.read`, `/inbox`→`inbox.read`, `/tasks`→`tasks.read`, `/ai`→`ai.use`, `/integrations`→`integrations.read`, `/data-health`→`data_health.read`, `/settings`→`settings.read`, `/o/<key>`→`obj:<key>.read`, `/notifications`,`/profile`,`/forbidden`,`/onboarding`→ always allowed.

System-role seed rule (generator `scripts/gen-authz-seed.mjs` from `PAGE_ACCESS` + `CAN` in the **c2d562f** version of `src/lib/auth/roles.ts`, frozen into `src/lib/authz/catalog/system-roles.ts`): page access `F` → read `all` + resource write `all`; `E` → read `own` + write `own` (rep on `/leads` also gets the territory arm: unassigned leads in `attrs.districts`); `R` → read `all`; `M` → read `all` without `pii.read`; `null` → none. Each `CAN` action true → its key at `all`. `pii.read` = `all` for every role except `viewer`.

### C3.2 TypeScript API (`src/lib/authz/index.ts`, T003)
```ts
export type Scope = "all" | "team" | "own" | "none";           // order: all > team > own > none
export type ObjectType = "lead" | "contact" | "account" | "deal" | "task" | "activity" | "campaign"
  | "segment" | "conversation" | "message" | "integration" | "webhook_endpoint" | "api_key" | `obj:${string}`;
export interface RecordRef { type: ObjectType; id?: string; workspaceId: string; ownerId?: string | null;
  assigneeId?: string | null; attrs?: Record<string, unknown>; sharedWith?: { relation: "owner"|"editor"|"viewer"; subjectType: "user"|"team"|"role"; subjectId: string }[] }
export type DenyReason = "unauthenticated" | "org_suspended" | "org_readonly" | "module_off" | "plan_limit"
  | "support_blocked" | "support_readonly" | "no_permission" | "out_of_scope" | "condition_failed";
export interface Decision { allow: boolean; reason: DenyReason | null; step: 1|2|3|4|5|6|7|8; permission: string; maskedFields: string[] }

export async function loadPrincipal(): Promise<Principal>;            // React cache() per request; demo → from fixture
export function decide(p: Principal, perm: string, rec?: RecordRef, now?: Date): Decision;
export function can(p: Principal, perm: string, rec?: RecordRef): boolean;   // decide().allow
export async function assertCan(perm: string, rec?: RecordRef): Promise<Principal>; // throws AuthzError
export class AuthzError extends Error { constructor(public decision: Decision) }
export function maskRecord<T extends Record<string, unknown>>(p: Principal, type: ObjectType, row: T, piiFields: string[]): T;
export function denyMessageKey(d: Decision): string;                 // i18n key in namespace "errors", e.g. "errors.authz.support_blocked"
export function scopeFilter(p: Principal, perm: string): { scope: Scope; ownerIds: string[] | null }; // for list queries in demo
```
Evaluation order (`decide`), first deny wins:
1 principal missing → `unauthenticated`. 2 `tenant.status==='suspended'` and perm is not `*.read` → `org_suspended`; trial expired and non-read → `org_readonly`. 3 perm's module off (`MODULE_OF_PERMISSION` map in `src/lib/authz/pages.ts`) → `module_off`. 4 support: `supportBlocked` → `support_blocked`; `read_only` and non-read → `support_readonly`. 5 grant missing or `none` → `no_permission`. 6 scope: `all` ok; `team` requires `rec.ownerId ∈ teamUserIds` or `rec.ownerId == null`; `own` requires `ownerId === uid || assigneeId === uid` (or leads territory arm); explicit `sharedWith` match allows read (`viewer`) / write (`editor`,`owner`) regardless; else `out_of_scope`. Without `rec`, scope ≥ own passes (list-level check). 7 conditions false → `condition_failed`. 8 compute `maskedFields` (all PII if no `pii.read`, plus `grant.fieldMask`).

### C3.3 Conditions grammar (TS and SQL implement identically)
```json
{ "all": [ { "field": "record.district", "op": "in", "value": "@principal.attrs.districts" },
           { "field": "now", "op": "between_hours", "value": ["09:00", "20:00"], "tz": "Asia/Kolkata" } ] }
```
Top level `all` or `any` (one level of nesting allowed). `op ∈ eq, neq, in, nin, contains, gte, lte, between_hours, is_true`. `field` prefixes: `record.`, `principal.`, `now`. Values beginning with `@principal.` are resolved. Unknown op, unknown prefix, depth > 2 or > 10 clauses → **false** (fail closed). Validator `validateConditions(json): Issue[]` in `src/lib/authz/conditions.ts`; SQL twin `authz.valid_conditions(jsonb) returns boolean` used in a `check` constraint.

### C3.4 SQL helpers (schema `authz`, `security definer`, `set search_path = ''`, `stable`, execute granted to `authenticated`)
| Signature | Semantics |
|---|---|
| `authz.ws_with(p_perm text, p_min_scope text default 'own') returns setof uuid` | workspaces where caller's grant for `p_perm` ≥ scope; includes live support sessions (read_only → system `viewer` grants minus non-read; read_write → system `owner` grants minus supportBlocked) |
| `authz.ws_with_member(p_perm text, p_min_scope text default 'own') returns setof uuid` | same, real memberships only |
| `authz.team_user_ids(p_ws uuid) returns setof uuid` | self + members of my teams + members of teams under teams I manage (recursive) in `p_ws` |
| `authz.shared_ids(p_type text, p_min_rel text default 'viewer') returns setof uuid` | object ids shared to me / my teams / my role, not expired; rel order owner > editor > viewer |
| `authz.attr(p_ws uuid) returns jsonb` | my `memberships.attributes` |
| `authz.cond_ok(p_ws uuid, p_perm text, p_record jsonb) returns boolean` | evaluates C3.3 |
| `authz.check(p_ws uuid, p_perm text, p_object_type text default null, p_object_id uuid default null) returns boolean` | full decision incl. record lookup |
| `authz.explain(p_ws uuid, p_perm text, p_object_type text default null, p_object_id uuid default null) returns jsonb` | `{allow, step, reason, grant, matched}` |
| `authz.my_grants(p_ws uuid) returns jsonb` | `{role:{id,key,base}, perms:{<key>:{scope,conditions,field_mask}}, team_user_ids:[…], attrs:{…}, support:null|{mode,expires_at}, tenant:{uuid,slug,status,trial_ends_at}, policy:{…}}` (TS `loadPrincipal` maps this 1:1) |

### C3.5 Policy template (0016 generates these; names `<table>_<select|insert|update|delete>`)
```sql
create policy leads_select on public.leads for select to authenticated using (
  deleted_at is null
  and workspace_id in (select authz.ws_with('pii.read','own'))          -- PII tables only; viewers use v_leads_masked
  and (   workspace_id in (select authz.ws_with('leads.read','all'))
       or (workspace_id in (select authz.ws_with('leads.read','team')) and owner_id in (select authz.team_user_ids(workspace_id)))
       or (workspace_id in (select authz.ws_with('leads.read','own'))
           and (owner_id = (select auth.uid())
                or (owner_id is null and district in (select jsonb_array_elements_text(authz.attr(workspace_id)->'districts')))))
       or id in (select authz.shared_ids('lead','viewer'))));
create policy leads_update on public.leads for update to authenticated
  using (<same arms with 'leads.write' and shared rel 'editor'>)
  with check (authz.cond_ok(workspace_id, 'leads.write', to_jsonb(leads.*)));
```
PII tables (base SELECT also requires `pii.read`): `leads`, `contacts`, `activities`, `messages`, `conversations`. Masked views `v_leads_masked`, `v_contacts_masked`, `v_conversations_masked`, `v_messages_masked` (security_barrier, definer, filtered by `authz.ws_with('<res>.read')`).

---

## C4 Database conventions
- Files `supabase/migrations/00NN_<snake>.sql`; one transaction (`begin; … commit;`); idempotent: `create table if not exists`, `alter table … add column if not exists`, `create or replace function`, `drop policy if exists x on t; create policy x …`, `drop trigger if exists`, seeds `on conflict … do update`.
- Every new business table: `id uuid primary key default gen_random_uuid()` (or `bigint generated always as identity` for logs), `tenant_id uuid not null references public.tenants(id) on delete cascade`, `workspace_id uuid not null references public.workspaces(id) on delete cascade` (or nullable if marked org-wide), `created_at timestamptz not null default now()`, trigger `a00_<table>_tenant` using existing `public.set_tenant_from_workspace()`, `alter table … enable row level security` in the same file, index `(workspace_id, created_at desc)` minimum.
- Functions: `security definer` only when needed, always `set search_path = ''`, fully-qualified names, `revoke all on function … from public, anon` then explicit grants.
- Tests: `supabase/tests/00NN_<name>.test.sql` (pgTAP, `begin; select plan(n); … select * from finish(); rollback;`), run by `node scripts/run-pgtap.mjs <file>` (T001 adds) against `SUPABASE_DB_URL` of the **branch** DB.
- Verify block at the end of each migration: `do $$ begin assert (select count(*) from …) …; end $$;`.
- Never `drop table`, `truncate`, `delete` business rows; never `alter column type` on live business columns.

## C5 Database schema (0013+)

<!-- SCHEMA -->

---

## C6 Data access layer (`src/lib/db/**`, T004)
```ts
// src/lib/db/client.ts
export async function dbForRequest(): Promise<SupabaseClient<Database>>;   // user JWT via @supabase/ssr; throws in demo
// src/lib/db/service.ts  (import "server-only")
export function serviceDb(): SupabaseClient<Database>;                     // service role; only jobs, vault, inbound webhooks, bot-user minting
// src/lib/db/errors.ts
export type DbErrorCode = "denied" | "not_found" | "conflict" | "invalid" | "unique" | "error";
export class DbError extends Error { code: DbErrorCode; detail?: string; current?: unknown }
export function mapPgError(e: PostgrestError | null): DbError | null;     // 42501 → denied, PGRST116 → not_found, 23505 → unique, P0409 (raised by move/update RPCs) → conflict, 23514/22P02 → invalid
// src/lib/db/concurrency.ts
export async function updateVersioned<T>(table: string, id: string, expectedVersion: number, patch: Partial<T>): Promise<T>; // .eq("version", expectedVersion); 0 rows → re-read → conflict with current or not_found
// src/lib/db/page.ts
export interface Page<T> { rows: T[]; nextCursor: string | null }       // keyset on (created_at desc, id desc), cursor = base64url(JSON)
// src/lib/db/repo/<entity>.ts : one module per entity
export const leadsRepo: {
  list(ws: string, q: { cursor?: string; limit?: number; filters?: Filter[]; sort?: Sort }): Promise<Page<Lead>>;
  get(ws: string, id: string): Promise<Lead | null>;
  create(ws: string, input: LeadInput): Promise<Lead>;
  update(ws: string, id: string, expectedVersion: number, patch: Partial<LeadInput>): Promise<Lead>;
  softDelete(ws: string, id: string, expectedVersion: number): Promise<void>;
};
// same shape for accounts, contacts, deals (+ move(ws,id,stageKey,expectedVersion,extra)), tasks (+ complete(ids)), activities, campaigns, conversations (+ messages), integrations
// src/lib/db/map.ts : toCamel / toSnake (replaces camel() in src/lib/data/source.ts)
```
Rows carry `version: number` once 0014 is applied. `ws` is always the workspace **uuid**.

## C7 Server action pattern and result shape
```ts
// src/lib/actions/result.ts (T004)
export type ActionResult<T = undefined> =
  | { ok: true; message: string; sub?: string; data?: T }
  | { ok: false; message: string; code: "denied" | "not_found" | "conflict" | "invalid" | "error"; sub?: string;
      issues?: { path: string; message: string }[]; current?: unknown };
export const okResult, failResult;                                   // helpers
export async function runAction<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>>; // maps AuthzError → denied (message via denyMessageKey), DbError → code, logs others
```
Template (every mutation):
```ts
"use server";
export async function assignLeads(ids: string[], ownerId: string): Promise<ActionResult> {
  return runAction(async () => {
    const input = AssignSchema.parse({ ids, ownerId });          // zod; invalid → code "invalid"
    const p = await assertCan("leads.assign");                    // list-level check
    const t = await getTranslations("leads");
    if (p.demo) return { ok: true, message: t("assigned", { n: ids.length }), sub: t("common.demoNotSaved") };
    for (const id of input.ids) {
      const lead = await leadsRepo.get(p.ws.uuid, id);
      if (!lead) return { ok: false, code: "not_found", message: t("notFound") };
      await assertCan("leads.assign", { type: "lead", id, workspaceId: p.ws.uuid, ownerId: lead.ownerId });
    }
    await leadsRepo.assign(p.ws.uuid, input.ids, input.ownerId);   // RLS re-checks; triggers write audit + events
    revalidatePath("/leads");
    return { ok: true, message: t("assigned", { n: ids.length }) };
  });
}
```
Existing per-folder `ActionResult`/`Result` types are replaced by this one in each folder's owning task (UI components accept both `sub` and legacy `detail` until then).

## C8 Event bus and jobs

### C8.1 Envelope and emit
```ts
// src/lib/events/types.ts (T019)
export interface CrmEvent<D = Record<string, unknown>> {
  id: string;                 // events.id as string
  type: string;               // "<domain>.<verb>", e.g. "lead.stage_changed"
  tenantId: string; workspaceId: string;
  objectType: string | null; objectId: string | null;
  actor: { kind: "user" | "api_key" | "system" | "connector" | "agent" | "support"; id: string | null };
  occurredAt: string; version: 1;
  data: D;                    // { changed_fields?: string[]; before?: {...}; after?: {...} } non-PII fields only
}
```
- DB triggers (`events.row_change()`, 0014) emit `<object>.created|updated|deleted` for `leads, deals, accounts, contacts, tasks, activities, conversations, messages, campaigns, memberships`, plus derived: `lead.assigned` (owner_id changed), `lead.stage_changed`, `deal.stage_changed`, `deal.won`, `deal.lost`, `task.completed`, `message.received`.
- App-level emit (non-row events): `await emitEvent({ type, objectType, objectId, data })` in `src/lib/events/emit.ts` → RPC `events.emit(p_type text, p_object_type text, p_object_id uuid, p_data jsonb) returns bigint`.
- Catalogue: `src/lib/events/catalog/<domain>.ts` export `EVENT_TYPES: { type: string; description: string; webhook: boolean; agent: boolean }[]`.

### C8.2 Queues and handlers
Queues (pgmq): `events`, `webhook_out`, `connector_sync`, `connector_inbound`, `notify`, `import`, `maintenance`, `agent` (+ `<q>_dlq`).
```ts
// src/lib/jobs/registry.ts (T019)
export interface JobContext { runId: number; attempt: number; tenantId: string | null; log: Logger; deadline: number; db: SupabaseClient /* service */ }
export type JobHandler<P> = (payload: P, ctx: JobContext) => Promise<"done" | "retry">;
export function registerHandler<P>(queue: QueueName, kind: string, h: JobHandler<P>): void;
// handlers live in src/lib/jobs/handlers/<area>.ts and register on import; src/lib/jobs/handlers/index.ts imports them all
export async function enqueue(queue: QueueName, kind: string, payload: unknown, opts?: { delaySeconds?: number; tenantId?: string }): Promise<number>;
```
Message body: `{ kind: string, tenant_id: string | null, payload: object }`. Fan-out of `events`: the `events` handler routes each event to `webhook_out` (matching endpoints), `notify` (matching rules), `connector_sync` (connector pushes subscribed in `ConnectorDef.pushes[].onEvent`), and `agent` (MVP2: enqueues only if `agent_triggers` rows match).
Tick route: `POST /api/jobs/tick` (`runtime = "nodejs"`, `maxDuration = 300`), auth header `Authorization: Bearer <JOBS_TICK_SECRET>` or Vercel `Authorization: Bearer <CRON_SECRET>`; `GET` allowed for Vercel Cron with the cron secret. Loop: for each queue, `pgmq.read(queue, 60, 20)`; run handler; `pgmq.archive` on `done`; on `retry` or throw leave it (visibility timeout) and if `read_ct > 8` send to `<q>_dlq` + `job_runs.status='dead'`. Per-tenant lock: RPC `jobs.try_lock(p_key text) returns boolean` (`pg_try_advisory_xact_lock`). Stop pulling when `Date.now() > deadline - 30_000` (deadline = start + 240 s). Response: `{ processed, failed, dead, ms }`.

## C9 Connector framework (`src/lib/connectors/**`, T022)
```ts
export type ConnectorId = "csv" | "whatsapp" | "meta-ads" | "razorpay" | "gmail" | "outlook" | "google-ads" | "ga4"
  | "google-business" | "linkedin" | "mailchimp" | "booking-com" | "makemytrip" | "airbnb" | "google-calendar"
  | "google-sheets" | "calendly" | "cal-com" | "zoho-crm" | "hubspot" | "slack" | "zapier" | "make" | "email" | "ical" | "mock";
export interface ConnectorDef {
  id: ConnectorId; name: string; category: "crm"|"messaging"|"email"|"ads"|"analytics"|"scheduling"|"payments"|"automation"|"ota"|"data";
  auth: "oauth2" | "api_key" | "service_account" | "webhook_secret" | "none";
  oauth?: { authorizeUrl: string; tokenUrl: string; scopes: string[]; pkce: boolean; extraAuthParams?: Record<string,string>; clientIdEnv: string; clientSecretEnv: string };
  credentialFields?: { key: string; label: string; secret: boolean; pattern?: string }[]; // api_key/service_account forms
  gate: "none" | "needs_vendor_approval" | "needs_client_credentials";
  sandbox: { supported: boolean; howTo: string };   // i18n key in namespace "connectors"
  streams: { key: string; schedule?: { cron: string; tz: "Asia/Kolkata" }; run(ctx: SyncContext, cursor: unknown): Promise<SyncResult> }[];
  pushes: { key: string; onEvent?: string[]; consentPurpose?: ConsentPurpose; run(ctx: PushContext, input: unknown): Promise<PushResult> }[];
  webhook?: { verify(req: RawRequest, secrets: ConnectionSecrets): Promise<VerifiedWebhook[]>; handle(ctx: InboundContext, evt: VerifiedWebhook): Promise<void> };
  defaultFieldMap: FieldMapSpec[];   // from existing catalog fieldMap entries
}
export interface ConnectionRow { id: string; tenantId: string; workspaceId: string; connectorId: ConnectorId; mode: "sandbox" | "live"; status: IntegrationStatus; settings: Record<string, unknown>; credentialSecretId: string | null; webhookSecretId: string | null; tokenExpiresAt: string | null }
export interface SyncContext { conn: ConnectionRow; secrets(): Promise<ConnectionSecrets>; http: VendorHttp; upsert: Upserter; log: Logger; runId: number; apiBase: string }
export interface SyncResult { cursor: unknown; rowsIn: number; rowsRejected: number; done: boolean }
export interface VendorHttp { json<T>(req: { method: string; url: string; headers?: Record<string,string>; body?: unknown }): Promise<T> } // retries 429/5xx with Retry-After, max 5
export interface Upserter { // dedupe through external_links + match keys; applies integration_field_maps transforms; enforces consent on outbound
  record(target: "lead"|"contact"|"account"|"deal"|"campaign_daily"|"ga4_daily"|"message"|"conversation"|"payment"|"calendar_event"|"review"|`obj:${string}`, externalObject: string, externalId: string, data: Record<string, unknown>): Promise<{ localId: string; created: boolean }>;
}
export type ConnectionSecrets = Record<string, string>;  // from vault; never logged
export function registerConnector(def: ConnectorDef): void;   // src/lib/connectors/registry.ts
```
- Each connector lives in `src/lib/connectors/<id>/index.ts` exporting `default` a `ConnectorDef`; `src/lib/connectors/all.ts` (owned by T022, later by the integrator) imports them.
- Vendor base URLs come from env with defaults (`<ID>_API_BASE`, e.g. `WHATSAPP_API_BASE=https://graph.facebook.com/v21.0`) so tests point them at the mock server `cypress/mock-vendors` (T022 adds a tiny Node mock server started by `cy.task('mockVendor:start', { connector })`).
- Vault: `src/lib/connectors/core/vault.ts`: `putSecret(name, value): Promise<string /*secret id*/>`, `getSecrets(conn): Promise<ConnectionSecrets>` (service RPC `private.get_secret`), `deleteSecret(id)`. Secret names: `conn:<connectionId>:<key>`.
- OAuth routes: `GET /api/oauth/[connector]/start?ws=<uuid>` (requires `integrations.manage`; sets cookie `gcrm_oauth_<connector>` = signed `{state, verifier, ws, conn}` 10 min) → vendor → `GET /api/oauth/[connector]/callback?code&state` → token exchange → vault → `integrations` row `status='connected'` → redirect `/integrations/<connector>?connected=1`.
- Field-map transforms (`src/lib/connectors/core/transforms.ts`): `e164_phone` (libphonenumber-js, default region IN), `lower_email`, `inr_paise_to_rupees`, `micros_to_rupees`, `date_ist`, `stage_key_map` (uses `integration_field_maps.transform` arg JSON), `hash_sha256`, `trim`.
- Consent gate: pushes with `consentPurpose` call RPC `public.can_contact(p_lead uuid, p_purpose consent_purpose)` per contact; skipped contacts counted in `sync_runs.rows_rejected` with reason `no_consent`.
- `sync_runs` row per run: `kind` (`poll|webhook|csv|outbound|manual`), `status`, `rows_in`, `rows_out`, `rows_rejected`, `error` (no PII), `payload_sample` (≤ 2 KB, PII stripped by `stripPii()`).
- UI status chips: `connected`, `sandbox` (amber, "Sandbox: test data only"), `needs_attention`, `error`, `disconnected`, `not_configured`; plus gate chip from `connector_availability.gate_status`.

## C10 Webhooks (inbound and outbound)
Inbound: route `src/app/api/hooks/[connector]/[connection]/route.ts`; `runtime="nodejs"`; read `await req.text()` once; `GET` handles Meta `hub.mode=subscribe&hub.verify_token&hub.challenge` (token = vault `conn:<id>:verify_token` or `META_WEBHOOK_VERIFY_TOKEN`); `POST` → `def.webhook.verify(raw, secrets)` → insert `webhook_inbox` (`on conflict (connector_id, provider_event_id) do nothing`) → `enqueue("connector_inbound", connector, {inboxId})` → `200 {"ok":true}`. Bad signature → `401`, row with `signature_ok=false, body=null`. Verifiers in `src/lib/connectors/verify/<provider>.ts` export `verify(raw: string, headers: Headers, secret: string): boolean` using `crypto.timingSafeEqual`.

Outbound (`src/lib/webhooks/**`, T024): headers `webhook-id: <event id>`, `webhook-timestamp: <unix s>`, `webhook-signature: v1,<base64(HMAC_SHA256(secret, "${id}.${ts}.${body}"))>` (Standard Webhooks; secret format `whsec_<base64>`), `content-type: application/json`, `user-agent: SynthanCRM-Webhooks/1`. Body = `CrmEvent` (C8.1) with `data` expanded by a per-type serializer (`src/lib/webhooks/serializers.ts`) that refetches the object under the endpoint creator's permissions. Timeout 10 s. Success = 2xx. Backoff schedule (seconds): `[30, 120, 600, 3600, 21600, 86400]`, then `dead`. Endpoint auto-disabled when last success > 5 days and ≥ 20 consecutive failures. SSRF: `assertPublicHttpsUrl(url)` from `src/lib/security/ssrf.ts` (T009) at create and before each send.

## C11 Public REST API (`/api/v1`, T025)
- Key format `sk_<live|test>_<8-char prefix>_<32-char base62 secret>`; store `prefix` + `sha256(full key)` hex; shown once.
- Request auth: `Authorization: Bearer <key>` → `authenticateApiKey(req)` in `src/lib/api/auth.ts` → `{ key, principal }`; principal kind `api_key`, uid = `bot_user_id`.
- Responses: list `{ "data": [...], "next_cursor": string | null }`; item `{ "data": {...} }`; errors `application/problem+json` `{ "type": "https://docs.synthan.app/errors/<code>", "title", "status", "detail", "code", "errors"?: [{path,message}] }`; codes `unauthorized(401) forbidden(403) not_found(404) conflict(409) invalid(422) rate_limited(429) error(500)`. Cross-tenant ids → `404`, never `403`.
- Field naming: snake_case; custom fields under `"custom": { "<field_key>": value }`; `"org_id"` alias = `tenant_id`.
- Headers: `Idempotency-Key` (POST/PATCH; 24 h), `X-Request-Id` echoed, `RateLimit-Limit/Remaining/Reset`.
- Routes: `GET|POST /api/v1/leads`, `GET|PATCH|DELETE /api/v1/leads/{id}`, same for `contacts`, `accounts`, `deals` (+ `POST /api/v1/deals/{id}/move {stage_key, expected_version}`), `tasks`, `activities` (GET, POST), `campaigns` (GET), `records/{object_key}` (+ `/{id}`), `pipelines` (GET), `fields?object=` (GET), `webhooks` (GET, POST subscribe `{url, event_types}`, DELETE `/{id}`), `me` (GET), `openapi.json` (GET, public).
- Scopes: `<resource>:read`, `<resource>:write`; key's effective permission = role grant ∩ scope.

## C12 Realtime
- Client: `src/lib/realtime/client.ts` `getRealtime(): SupabaseClient` (browser, anon key, user session; `null` in demo → hooks return inert values).
- Topics: `ws:<wsUuid>:tbl:<table>` (DB broadcast, event `"change"`, payload `{ id: string, op: "INSERT"|"UPDATE"|"DELETE", version: number|null, changed_by: string|null, changed_fields: string[] }`); `ws:<wsUuid>:rec:<objectType>:<id>` (presence + client broadcast `"editing"` `{userId, field}`); `ws:<wsUuid>:board:<pipelineId>` (presence). All channels `{ config: { private: true } }`.
- Presence state: `{ userId, name, initials, color, at }`.
- Hooks (`src/lib/realtime/hooks.ts`): `usePresence(topic): PresenceUser[]`, `useTableChanges(table: string, onChange: (p: ChangePayload) => void): void`, `useEditing(topic): { editors: {userId, field}[]; announce(field: string | null): void }`, `useConnectionState(): "live" | "stale" | "offline"` ("stale" = no heartbeat ack for 30 s).
- Provider: `RealtimeProvider` mounted in `src/components/shell/providers.tsx` with `{ wsUuid, user }`.
- Never put row data in broadcasts; consumers refetch via server action or `router.refresh()`.

## C13 Metadata (custom fields, objects, pipelines, layouts)
```ts
// src/lib/metadata/types.ts (T030)
export type FieldType = "text" | "long_text" | "number" | "money" | "percent" | "date" | "datetime" | "boolean"
  | "select" | "multi_select" | "user" | "lookup" | "phone" | "email" | "url" | "rating";
export interface I18nLabel { en: string; ta?: string }
export interface FieldDef { id: string; objectTypeId: string; key: string; label: I18nLabel; type: FieldType;
  options: { choices?: { key: string; label: I18nLabel; color?: StageColor }[]; lookup?: { objectKey: string }; currency?: "INR"; min?: number; max?: number; precision?: number };
  required: boolean; uniqueInWorkspace: boolean; isPii: boolean; isSearchable: boolean; isFilterable: boolean;
  default: unknown; validation: { regex?: string; maxLength?: number }; help?: I18nLabel; section: string | null;
  position: number; editablePerm: string | null; archivedAt: string | null }
export interface ObjectTypeDef { id: string; key: string; kind: "system" | "custom"; label: { en: { one: string; many: string }; ta?: { one: string; many: string } }; icon: string; primaryField: string; isEnabled: boolean; schemaVersion: number }
export async function getObjectMeta(ws: string, objectKey: string): Promise<{ object: ObjectTypeDef; fields: FieldDef[] }>; // cached per request, tagged by schemaVersion
export function validateCustom(fields: FieldDef[], values: Record<string, unknown>, mode: "create" | "update"): { value: Record<string, unknown>; issues: Issue[] };
```
System object keys: `lead`, `contact`, `account`, `deal`, `task`, `campaign`, `conversation`. Custom values live in the `custom` jsonb column keyed by `FieldDef.key`. Renderer components (`src/components/fields/`): `<FieldInput def value onChange disabled />`, `<FieldValue def value masked />`, `<FieldFilter def value onChange />`, `fieldColumn(def): ColumnDef` (tanstack). Pipelines (`src/lib/metadata/pipelines.ts`, T032): `getPipelines(ws, objectType: "lead"|"deal"|string): Promise<Pipeline[]>`, `Pipeline { id, key, name: I18nLabel, isDefault, stages: Stage[] }`, `Stage { id, key, name: I18nLabel, position, probability, color: StageColor, outcome: "open"|"won"|"lost", slaHours: number|null, requiredFields: string[] }`. Layouts (`src/lib/layouts/types.ts`, T033): `LayoutSpec = { sections: { key: string; title: I18nLabel; columns: 1|2; fields: string[] }[] }` for detail/form; `{ columns: { field: string; width?: number }[] }` for list; `{ title: string; meta: string[]; badge?: string }` for card.

## C14 i18n
- Library `next-intl`; config `src/i18n/request.ts`; locales `["en", "ta"]`; default `en`; locale source: `profiles.language` → cookie `gcrm_locale` → `en`.
- Files `messages/<locale>/<namespace>.json`. Namespaces and owners: `common`, `shell`, `auth`, `errors` (T008); `leads` (T013); `pipeline` (T014); `accounts` (T015); `tasks` (T016); `settingsAccess` (T017); `admin` (T018); `ops` (T019); `audit` (T020); `integrations`, `connectors` (T022); `webhooks` (T024); `api` (T025); `realtime` (T026); `collab` (T027); `inbox` (T028); `campaigns` (T029); `fields` (T030); `pipelinesAdmin` (T032); `objects` (T033); `import` (T034); `ai` (T050); `onboarding` (T051); `privacy` (T052); `billing` (T053); `dashboard` (T054); `dataHealth` (T055); `search` (T056).
- Loader merges all namespace files per locale (`src/i18n/messages.ts` globs `messages/<locale>/*.json`), so adding a namespace needs no shared-file edit.
- Usage: RSC `const t = await getTranslations("leads")`; client `const t = useTranslations("leads")`. Keys are camelCase; ICU plurals.
- Tenant vocabulary: `t` is wrapped by `withVocab(t, vocab)` which replaces `{lead}`, `{leads}`, `{account}`, `{accounts}`, `{deal}`, `{deals}`, `{demo}` placeholders from `vocabFor(tenant)` / `tenant_config.vocabulary.i18n.<locale>`.
- Tamil drafts: every new `ta` key also listed in `messages/ta/_review/<namespace>.json` (`["key1", ...]`); UI Tamil is enabled only when `tenant_config.data.tamilUiReviewed === true`.

## C15 UI tokens, classes and primitives (T007)
Tokens added to `src/styles/tokens.css` (keep all existing ones):
```
--text-12: 12px; --text-13: 13px; --text-14: 14px; --text-15: 15px; --text-19: 19px; --text-22: 22px; --text-26: 26px;
--r-bar: 2px; --r-chip: 4px; --r-control: 8px; --r-round: 9999px;   (--radius-sm → var(--r-chip), --radius-md → var(--r-control))
--info: oklch(0.5 0.1 220); --info-soft: oklch(0.95 0.03 220);
--state-fill: 12%; --state-border: 50%;   used as color-mix(in oklch, var(--danger) 12%, transparent)
--zone-decision-pad: 24px; --zone-work-pad: 16px; --zone-ledger-pad: 8px; --row-ledger: 36px; --row-list: 40px;
--motion-fast: 150ms; --motion-base: 200ms; --ease-out: cubic-bezier(0.2, 0, 0, 1);
```
Tailwind v4 theme (`src/app/globals.css` `@theme`): `text-12 … text-26`, `rounded-bar|chip|control|round`, utilities `.zone-decision`, `.zone-work`, `.zone-ledger`, `.num` (mono + tabular-nums), `.label-caps` (mono 12 px, uppercase, tracking 0.14em, `--ink-3`).
Primitives (`src/components/ui/`): `Button` variants `primary | quiet | ghost | danger` sizes `sm(28px) | md(32px)`, prop `disabledReason?: string` (renders disabled + tooltip); `Chip` (`tone: neutral|accent|info|warn|success|danger`, radius chip); `StatusChip` (`live|stale|offline|connected|sandbox|needs_attention|error|disconnected|not_configured`); `Select`, `Popover`, `Switch`, `Checkbox`, `RadioGroup`, `Sheet`, `Command`, `Kbd`, `Field` (label + control + help + error), `DataTableV2` (tanstack, `zone-ledger` rows), `EmptyState({ title, body, action? })`, `ErrorState({ source, message, retry? })`, `PartialState({ done, total, items })`, `Skeleton` variants `row|card|chart`. Motion helper `src/components/ui/motion.tsx` exports `useSafeMotion()` (reduced-motion aware) and `fadeSlide` preset (200 ms ease-out).
Rules summary (full list `BUILD-PLAN.md §3.2`): type only from the scale, ≥ 12 px, 4.5:1 at 12 px; four radii; one raised surface per screen; hairline separators; state colour full strength for text/lines, 12 % fills; no pill buttons, gradients, glass, card walls, KPI-strip-table-rail layouts, numbered label scaffolding, count-up numbers, em dashes; every screen has empty/loading/error/partial/denied states.

## C16 Testing contract
### C16.1 Layout
`cypress/e2e/<area>/<flow>.cy.ts`, `cypress/component/<area>/<name>.cy.tsx`, unit `src/**/__tests__/<name>.test.ts(x)`, pgTAP `supabase/tests/*.test.sql`, fixtures `cypress/fixtures/<area>/*`.
### C16.2 Custom commands (T002, `cypress/support/commands.ts`)
`cy.requireMode(mode)`, `cy.loginAs(persona)` (demo personas: keys of `PERSONAS` in `src/lib/demo/tenancy-fixture.ts`, e.g. `owner-lawsome`, `rep-lawsome`, `viewer-lawsome`, `owner-shola`, `super`), `cy.loginReal(user)` (real users C16.3, uses `cy.session`), `cy.switchWorkspace(slugOrUuid)`, `cy.getByTestId(id)` (`[data-testid=…]`), `cy.expectToast(textRegex)`, `cy.apiAs(user | apiKey, method, path, body?)`, `cy.dbQuery(sql)` (Cypress task via `SUPABASE_DB_URL` of the branch; read-only helper for assertions), `cy.task('mockVendor:start', {connector})`, `cy.task('signWebhook', {provider, body, secret})`, `cy.secondSession(user, fn)` (opens a second browser context via `cy.origin`-free iframe-less approach: separate `cy.session` + `cy.request`-driven actions).
### C16.3 Real (staging) test identities (created by `cy.task('seedUsers')` from `cypress/tasks/seed-users.ts`, idempotent, refuses to run unless `SUPABASE_URL` contains `SUPABASE_BRANCH_REF`)
| key | email | membership |
|---|---|---|
| `owner_tn` | `qa-owner@synthan.test` | owner lawsome-tn, viewer lawsome-kl |
| `manager_tn` | `qa-manager@synthan.test` | sales_manager lawsome-tn, manages team "TN South" |
| `rep_tn` | `qa-rep@synthan.test` | sales_rep lawsome-tn, districts [Madurai], member of "TN South" |
| `rep2_tn` | `qa-rep2@synthan.test` | sales_rep lawsome-tn, districts [Chennai] |
| `marketing_tn` | `qa-mkt@synthan.test` | marketing lawsome-tn |
| `data_tn` | `qa-data@synthan.test` | data lawsome-tn |
| `viewer_tn` | `qa-viewer@synthan.test` | viewer lawsome-tn |
| `owner_kaveri` | `qa-kaveri@synthan.test` | owner kaveri-cbe |
| `owner_shola` | `qa-shola@synthan.test` | owner shola-mist-coonoor |
| `rep_shola` | `qa-shola-rep@synthan.test` | sales_rep shola-mist-coonoor |
| `custom_tn` | `qa-custom@synthan.test` | custom role "Telecaller" (clone of sales_rep minus `leads.export`, plus condition business hours) |
| `platform` | `qa-platform@synthan.test` | platform admin (TOTP secret generated at seed, kept in `cypress.env.json`, git-ignored) |
Passwords are generated at seed time and written to `cypress.env.json` (git-ignored). Never use these on production.
### C16.4 Unit
Vitest, `environment: "node"` default, `jsdom` for `*.test.tsx`; no network; mock Supabase with `src/test/supabase-mock.ts` (T002).
### C16.5 Always-on checks (every gate)
`cypress/e2e/smoke/personas.cy.ts`, `cypress/e2e/smoke/vocab-leak.cy.ts` (hospitality pages contain none of `law firm|advocate|hearing|practice area`; legal pages contain none of `guest|booking|stay|room`), `cypress/e2e/smoke/no-console-errors.cy.ts`, `cypress/e2e/smoke/no-overflow-390.cy.ts`.

## C17 Environment variables
Validated in `src/lib/env.ts` (T010) with zod; import `env` from there, never `process.env` directly (except `src/lib/env.ts` and `next.config.mjs`).
`APP_ENV` (`production|staging|demo|test`), `APP_BASE_URL`, `NEXT_PUBLIC_APP_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_DB_URL` (scripts/tests only), `SUPABASE_BRANCH_REF` (tests only), `SESSION_SECRET`, `DATA_SOURCE` (`supabase` in real modes), `DEMO_MODE`, `JOBS_TICK_SECRET`, `CRON_SECRET`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_CONFIG_ID`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `MAILCHIMP_CLIENT_ID`, `MAILCHIMP_CLIENT_SECRET`, `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, `CALENDLY_CLIENT_ID`, `CALENDLY_CLIENT_SECRET`, `CALENDLY_WEBHOOK_SIGNING_KEY`, `CHANNEL_MANAGER_API_BASE`, `CHANNEL_MANAGER_PARTNER_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `BILLING_GSTIN`, `BILLING_SAC_CODE`, `ANTHROPIC_API_KEY`, `AI_DEFAULT_MODEL`, and per-connector `<ID>_API_BASE` overrides (`WHATSAPP_API_BASE`, `META_GRAPH_API_BASE`, `GOOGLE_ADS_API_BASE`, `GA4_API_BASE`, `RAZORPAY_API_BASE`, …; defaults are the vendor URLs).
Rules: production boot fails if `DEMO_MODE=1`, or `SESSION_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JOBS_TICK_SECRET` missing. Vendor vars are optional: a connector whose env is missing shows "Not configured by Synthan" and cannot be connected.

## C18 AI gateway (T050; MVP2 agents build on it)
```ts
// src/lib/ai/types.ts
export type ProviderId = "anthropic" | "openai" | "google";
export interface AiRequest { feature: "reply_draft" | "summary" | "next_best_action" | "ask_crm" | "agent"; system: string;
  messages: { role: "user" | "assistant"; content: string }[]; model?: string; maxTokens: number; tools?: AiTool[]; locale: "en" | "ta";
  sourceRefs: { type: string; id: string }[] }
export interface AiResponse { text: string; toolCalls: { name: string; input: unknown }[]; usage: { inputTokens: number; outputTokens: number }; model: string; provider: ProviderId }
export interface AiProvider { id: ProviderId; complete(req: AiRequest, apiKey: string): Promise<AiResponse> }
// src/lib/ai/gateway.ts
export async function aiComplete(p: Principal, req: AiRequest): Promise<AiResponse>; // 1 assertCan("ai.use") 2 feature enabled in ai_policies.features 3 caps (usage_counters) 4 redactPii 5 provider key (BYOK vault else ANTHROPIC_API_KEY) 6 call 7 ai_usage + ai_audit rows 8 usage_bump
// src/lib/ai/models.ts
export const MODELS = { anthropic: { default: "claude-sonnet-5-5", fast: "claude-haiku-4-5-20251001", deep: "claude-opus-5-5" } } as const;
```
Errors: `AiCapError`, `AiDisabledError`, `AiProviderError` → mapped to ActionResult `denied`/`error` with i18n keys `ai.capReached`, `ai.disabled`, `ai.providerError`.
