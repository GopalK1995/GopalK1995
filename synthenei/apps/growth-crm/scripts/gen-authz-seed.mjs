#!/usr/bin/env node
// Growth CRM: system-role seed generator (task T001, BUILD-PLAN 2.1, CONTRACTS C3.1).
//
//   node scripts/gen-authz-seed.mjs            regenerate the GENERATED block inside supabase/migrations/0013_authz_core.sql
//                                              from src/lib/authz/catalog/system-roles.ts
//   node scripts/gen-authz-seed.mjs --check    exit 1 if the 0013 block or system-roles.ts is out of date ("generator diff = 0")
//   node scripts/gen-authz-seed.mjs --freeze   rewrite system-roles.ts (and the 0013 block) from the LEGACY matrix (PAGE_ACCESS + CAN
//                                              in src/lib/auth/roles.ts at c2d562f) using the rules below. Only meaningful while
//                                              roles.ts still defines CAN as functions (T003 later derives roles.ts from the catalog).
//   node scripts/gen-authz-seed.mjs --verify   prove the seed reproduces CAN, PAGE_ACCESS and SUPPORT_BLOCKED exactly
//
// Needs Node >= 22.6 for type stripping: npx -y -p node@22 node scripts/gen-authz-seed.mjs --check
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_TS = join(root, "src/lib/authz/catalog/system-roles.ts");
const ROLES_TS = join(root, "src/lib/auth/roles.ts");
const MIGRATION = join(root, "supabase/migrations/0013_authz_core.sql");
const BEGIN = "-- BEGIN GENERATED: system roles (scripts/gen-authz-seed.mjs). Do not edit by hand.";
const END = "-- END GENERATED";
const mode = process.argv[2] ?? "";

const ROLE_KEYS = ["owner", "sales_manager", "sales_rep", "marketing", "data", "viewer"];
const ROLE_ID = (i) => `30000000-0000-4000-8000-00000000000${i + 1}`;
const RANK = { none: 0, own: 1, team: 2, all: 3 };

// ---------------------------------------------------------------- catalogue (CONTRACTS C3.1 + events.read)
const STAR = new Set(["org.admin", "org.branding", "leads.delete", "leads.export", "contacts.delete", "accounts.delete", "deals.delete",
  "audience.export", "members.invite", "members.manage", "roles.manage", "integrations.manage", "webhooks.manage", "api_keys.manage",
  "privacy.fulfil", "billing.manage", "ai.toggle"]);
const CATALOGUE = [
  "dashboard.read", "myday.read", "settings.read", "pii.read", "records.share", "comments.write", "comments.moderate", "audit.read", "org.admin", "org.branding", "config.edit", "events.read",
  "leads.read", "leads.create", "leads.write", "leads.assign", "leads.delete", "leads.export", "leads.import", "contacts.read", "contacts.write", "contacts.delete",
  "accounts.read", "accounts.write", "accounts.merge", "accounts.delete", "deals.read", "deals.write", "deals.move", "deals.delete", "tasks.read", "tasks.write", "tasks.assign", "activities.read", "activities.write",
  "campaigns.read", "campaigns.write", "segments.read", "segments.write", "audience.export", "analytics.read",
  "inbox.read", "inbox.reply", "inbox.assign", "messages.send_whatsapp", "messages.send_email",
  "members.invite", "members.manage", "roles.manage", "teams.manage", "fields.manage", "objects.manage", "pipelines.manage", "layouts.manage", "views.share", "notifications.manage",
  "integrations.read", "integrations.manage", "webhooks.manage", "api_keys.manage", "data_health.read", "data_health.manage", "backups.manage", "privacy.fulfil", "billing.read", "billing.manage", "ai.use", "ai.toggle",
  "platform.tenants.manage", "platform.policies.manage", "platform.support", "platform.billing", "platform.read",
];
const permissionSeed = () => CATALOGUE.map((key) => {
  const i = key.indexOf(".");
  const platform = key.startsWith("platform.");
  const resource = platform ? "platform" : key.slice(0, i);
  const action = key.slice(i + 1);
  const human = `${action.replace(/[._]/g, " ")} ${resource.replace(/_/g, " ")}`;
  return { key, resource, action, description: human.charAt(0).toUpperCase() + human.slice(1),
    isPii: key === "pii.read", platformOnly: platform, supportBlocked: STAR.has(key) };
});

// ---------------------------------------------------------------- derivation rules
// Page access codes (roles.ts): F full, E own/assigned, R read, M masked read, null none.
// F => read all + write all; E => read own + write own; R => read all; M => read all, no pii.read (viewer has none).
const PAGE_RULES = {
  "/": { read: ["dashboard.read"], write: [] },
  "/sales": { read: ["myday.read"], write: [] },
  "/leads": { read: ["leads.read", "activities.read"], write: ["leads.create", "leads.write", "activities.write"] },
  "/pipeline": { read: ["deals.read"], write: ["deals.write"] },
  "/accounts": { read: ["accounts.read", "contacts.read"], write: ["accounts.write", "contacts.write"] },
  "/campaigns": { read: ["campaigns.read"], write: ["campaigns.write"] },
  "/audience": { read: ["segments.read"], write: ["segments.write"] },
  "/analytics": { read: ["analytics.read"], write: [] },
  "/inbox": { read: ["inbox.read"], write: ["inbox.reply"] },
  "/tasks": { read: ["tasks.read"], write: ["tasks.write"] },
  "/ai": { read: ["ai.use"], write: [] },
  "/integrations": { read: ["integrations.read"], write: [] },
  "/data-health": { read: ["data_health.read"], write: [] },
  "/settings": { read: ["settings.read"], write: [] },
};
// CONTRACTS C3.1 legacy mapping; second element = page whose access code narrows the scope (E => own).
const CAN_RULES = {
  assignLeads: ["leads.assign", "/leads"], workLeads: ["leads.write", "/leads"], moveDeals: ["deals.move", "/pipeline"],
  importCsv: ["leads.import", null], exportCsv: ["leads.export", null], editCampaigns: ["campaigns.write", "/campaigns"],
  branding: ["org.branding", null], manageUsers: ["members.manage", null], connectIntegrations: ["integrations.manage", null],
  seePersonalData: ["pii.read", null], createWorkspace: ["org.admin", null], editSegments: ["segments.write", "/audience"],
  editPipeline: ["pipelines.manage", null], runHealthCheck: ["data_health.manage", null], editAlertRules: ["backups.manage", null],
  erase: ["privacy.fulfil", null], aiToggle: ["ai.toggle", null], privacyRequests: ["privacy.fulfil", null],
};
// New-capability defaults with no legacy equivalent (NOT part of the CAN/PAGE_ACCESS reproduction). Settings tabs and
// 0006 policies guided them: audit tab = owner+manager, users tab = invite/teams, config tab = owner.
const EXTRAS = {
  owner: [], // owner gets every non-platform permission, see ownerAll()
  sales_manager: ["audit.read", "events.read", "records.share", "comments.write", "comments.moderate", "members.invite", "teams.manage", "views.share",
    "tasks.assign", "inbox.assign", "accounts.merge", "messages.send_whatsapp", "messages.send_email"],
  sales_rep: ["comments.write", "messages.send_whatsapp", "messages.send_email"],
  marketing: ["comments.write"],
  data: ["comments.write", "events.read", "audience.export"],
  viewer: [],
};
// 0006 differences from the page rule: contacts are personal data (rep sees own, viewer none).
const OVERRIDES = { sales_rep: { "contacts.read": "own" }, viewer: { "contacts.read": null } };

const ownerAll = () => CATALOGUE.filter((k) => !k.startsWith("platform."));

function derive(role, PAGE_ACCESS, CAN) {
  const g = {};
  const code = (page) => PAGE_ACCESS[page]?.[role] ?? null;
  for (const [page, rule] of Object.entries(PAGE_RULES)) {
    const a = code(page);
    if (!a) continue;
    for (const k of rule.read) g[k] = a === "E" ? "own" : "all";
    if (a === "F" || a === "E") for (const k of rule.write) g[k] = a === "E" ? "own" : "all";
  }
  for (const [action, [perm, page]] of Object.entries(CAN_RULES)) {
    if (!CAN[action](role) || g[perm]) continue;
    g[perm] = page && code(page) === "E" ? "own" : "all";
  }
  if (role === "owner") for (const k of ownerAll()) g[k] = g[k] ?? "all";
  for (const k of EXTRAS[role]) g[k] = g[k] ?? "all";
  for (const [k, v] of Object.entries(OVERRIDES[role] ?? {})) { if (v === null) delete g[k]; else g[k] = v; }
  return Object.fromEntries(Object.entries(g).sort(([a], [b]) => a.localeCompare(b)));
}

// ---------------------------------------------------------------- io
async function loadSeed() { return import(pathToFileURL(SEED_TS).href); }
async function loadLegacy() { return import(pathToFileURL(ROLES_TS).href); }

function renderSeedTs(legacy) {
  const { PAGE_ACCESS, CAN, ROLE_LABEL, ROLE_BLURB, SUPPORT_BLOCKED } = legacy;
  const roles = ROLE_KEYS.map((key, i) => ({ id: ROLE_ID(i), key, name: ROLE_LABEL[key], description: ROLE_BLURB[key], baseRole: key, grants: derive(key, PAGE_ACCESS, CAN) }));
  const pages = Object.fromEntries(Object.keys(PAGE_ACCESS).map((p) => [p, Object.fromEntries(ROLE_KEYS.map((r) => [r, PAGE_ACCESS[p][r]]))]));
  const j = (v) => JSON.stringify(v, null, 2);
  return `// GENERATED by scripts/gen-authz-seed.mjs --freeze from the legacy matrix (PAGE_ACCESS + CAN in src/lib/auth/roles.ts @ c2d562f).
// Data only, no imports: T003 derives roles.ts CAN/PAGE_ACCESS from this file; the 0013 migration seed is generated from it.
// Edit the rules in scripts/gen-authz-seed.mjs, then re-run --freeze. Absent permission = deny.
export type SeedScope = "all" | "team" | "own";
export type SeedAccess = "F" | "E" | "R" | "M" | null;
export type SeedRoleKey = "owner" | "sales_manager" | "sales_rep" | "marketing" | "data" | "viewer";
export interface SeedPermission { key: string; resource: string; action: string; description: string; isPii: boolean; platformOnly: boolean; supportBlocked: boolean }
export interface SeedRole { id: string; key: SeedRoleKey; name: string; description: string; baseRole: SeedRoleKey; grants: Record<string, SeedScope> }

export const PERMISSION_SEED: SeedPermission[] = ${j(permissionSeed())};

export const SYSTEM_ROLES: SeedRole[] = ${j(roles)};

/** Legacy page matrix (F full, E own, R read, M masked). */
export const PAGE_ACCESS_SEED: Record<string, Record<SeedRoleKey, SeedAccess>> = ${j(pages)};

/** Legacy CAN action -> permission key (CONTRACTS C3.1). */
export const CAN_PERMISSION: Record<string, string> = ${j(Object.fromEntries(Object.entries(CAN_RULES).map(([a, [p]]) => [a, p])))};

/** Legacy SUPPORT_BLOCKED actions; their permissions carry supportBlocked = true. */
export const SUPPORT_BLOCKED_ACTIONS: string[] = ${j([...SUPPORT_BLOCKED])};
`;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
function renderSql(seed) {
  const perms = seed.PERMISSION_SEED.map((p) => `  (${q(p.key)}, ${q(p.resource)}, ${q(p.action)}, ${q(p.description)}, ${p.isPii}, ${p.platformOnly}, ${p.supportBlocked})`).join(",\n");
  const roles = seed.SYSTEM_ROLES.map((r) => `  (${q(r.id)}::uuid, null::uuid, ${q(r.key)}, ${q(r.name)}, ${q(r.description)}, ${q(r.baseRole)}::public.app_role, true)`).join(",\n");
  const rows = [];
  for (const r of seed.SYSTEM_ROLES) for (const [k, scope] of Object.entries(r.grants)) rows.push(`  (${q(r.id)}::uuid, ${q(k)}, ${q(scope)})`);
  return `${BEGIN}
insert into public.permissions (key, resource, action, description, is_pii, platform_only, support_blocked) values
${perms}
on conflict (key) do update set resource = excluded.resource, action = excluded.action, description = excluded.description,
  is_pii = excluded.is_pii, platform_only = excluded.platform_only, support_blocked = excluded.support_blocked;

insert into public.roles (id, tenant_id, key, name, description, base_role, is_system) values
${roles}
on conflict (id) do update set key = excluded.key, name = excluded.name, description = excluded.description,
  base_role = excluded.base_role, is_system = true;

insert into public.role_permissions (role_id, permission_key, scope) values
${rows.join(",\n")}
on conflict (role_id, permission_key) do update set scope = excluded.scope;
${END}`;
}

function spliceMigration(block) {
  const sql = readFileSync(MIGRATION, "utf8");
  const a = sql.indexOf(BEGIN), b = sql.indexOf(END);
  if (a < 0 || b < 0) throw new Error("GENERATED markers missing in 0013_authz_core.sql");
  return sql.slice(0, a) + block + sql.slice(b + END.length);
}

// ---------------------------------------------------------------- verify
function verify(seed, legacy) {
  const errs = [];
  const { PAGE_ACCESS, CAN, SUPPORT_BLOCKED } = legacy;
  const by = Object.fromEntries(seed.SYSTEM_ROLES.map((r) => [r.key, r]));
  const permBy = Object.fromEntries(seed.PERMISSION_SEED.map((p) => [p.key, p]));
  for (const role of ROLE_KEYS) {
    const g = by[role].grants;
    for (const k of Object.keys(g)) if (!permBy[k]) errs.push(`${role}: grant for unknown permission ${k}`);
    // 1. CAN reproduced
    for (const [action, [perm]] of Object.entries(CAN_RULES)) {
      const has = !!g[perm] && RANK[g[perm]] > 0;
      if (has !== CAN[action](role)) errs.push(`CAN.${action}(${role}) = ${CAN[action](role)} but seed grants ${perm} = ${g[perm] ?? "none"}`);
    }
    // 2. PAGE_ACCESS reproduced: stored matrix equals legacy, and the read scope matches the code
    for (const [page, rule] of Object.entries(PAGE_RULES)) {
      const a = PAGE_ACCESS[page][role];
      if (seed.PAGE_ACCESS_SEED[page]?.[role] !== a) errs.push(`PAGE_ACCESS[${page}][${role}] seed ${seed.PAGE_ACCESS_SEED[page]?.[role]} != legacy ${a}`);
      for (const k of rule.read) {
        const want = !a ? undefined : a === "E" ? "own" : "all";
        const ov = OVERRIDES[role] && k in OVERRIDES[role] ? (OVERRIDES[role][k] ?? undefined) : want;
        const extra = EXTRAS[role].includes(k) || role === "owner";
        if (g[k] !== ov && !extra) errs.push(`${role} ${page}: ${k} = ${g[k]} expected ${ov}`);
      }
    }
    // 3. pii.read: every role except viewer
    if ((g["pii.read"] === "all") !== (role !== "viewer")) errs.push(`${role}: pii.read mismatch`);
    // 4. seed is exactly what the rules derive (no hand edits)
    const again = derive(role, PAGE_ACCESS, CAN);
    if (JSON.stringify(again) !== JSON.stringify(g)) errs.push(`${role}: grants differ from derive(legacy)`);
  }
  for (const p of Object.keys(PAGE_ACCESS)) if (!PAGE_RULES[p]) errs.push(`page ${p} has no rule`);
  // 5. SUPPORT_BLOCKED
  for (const a of SUPPORT_BLOCKED) if (!permBy[CAN_RULES[a][0]]?.supportBlocked) errs.push(`SUPPORT_BLOCKED ${a} -> ${CAN_RULES[a][0]} not support_blocked`);
  for (const a of Object.keys(CAN)) if (!CAN_RULES[a]) errs.push(`CAN.${a} missing from CAN_RULES`);
  return errs;
}

// ---------------------------------------------------------------- main
if (mode === "--freeze") {
  const legacy = await loadLegacy();
  writeFileSync(SEED_TS, renderSeedTs(legacy));
  console.log("wrote", SEED_TS);
  const seed = await loadSeed();
  writeFileSync(MIGRATION, spliceMigration(renderSql(seed)));
  console.log("updated GENERATED block in", MIGRATION);
} else if (mode === "--verify" || mode === "--check") {
  const seed = await loadSeed();
  const legacy = await loadLegacy();
  const errs = verify(seed, legacy);
  if (mode === "--check") {
    const want = spliceMigration(renderSql(seed));
    if (readFileSync(MIGRATION, "utf8") !== want) errs.push("0013_authz_core.sql GENERATED block is stale (run the generator)");
    if (readFileSync(SEED_TS, "utf8") !== renderSeedTs(legacy)) errs.push("system-roles.ts differs from --freeze output (legacy matrix changed or file edited)");
  }
  if (errs.length) { console.error(errs.join("\n")); console.error(`FAIL: ${errs.length} difference(s)`); process.exit(1); }
  const n = seed.SYSTEM_ROLES.reduce((s, r) => s + Object.keys(r.grants).length, 0);
  console.log(`OK: ${seed.PERMISSION_SEED.length} permissions, ${seed.SYSTEM_ROLES.length} system roles, ${n} role_permission rows; CAN, PAGE_ACCESS and SUPPORT_BLOCKED reproduced, diff = 0`);
} else if (mode === "") {
  const seed = await loadSeed();
  writeFileSync(MIGRATION, spliceMigration(renderSql(seed)));
  console.log("updated GENERATED block in", MIGRATION);
} else { console.error("unknown flag", mode); process.exit(2); }
