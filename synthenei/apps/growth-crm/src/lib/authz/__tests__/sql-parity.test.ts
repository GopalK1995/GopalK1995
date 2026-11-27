// AUD-115 / SEC-014: the permission model exists twice (TS catalogue + engine, SQL seed). This suite loads the SQL seed from
// the migrations (0013 generated block, then every later seed statement) and fails when a permission, role, grant or scope
// differs from SYSTEM_ROLES / the TS catalogue / systemGrants(), and when the page matrix, the support-blocked flags or the
// "manager grants only below" rule drift from the grants. There is NO allow-list for grants: change both sides together.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../catalog";
import { PAGE_ACCESS_SEED, PERMISSION_SEED, SYSTEM_ROLES } from "../catalog/system-roles";
import { MANAGER_SCOPE } from "../role-hierarchy";
import { systemGrants } from "../system-grants";
import { PAGE_PERMISSION } from "../pages";

const DIR = resolve(process.cwd(), "supabase/migrations");
const read = (f: string) => readFileSync(resolve(DIR, f), "utf8").split("\r").join("");
const files = readdirSync(DIR).filter((f) => /^\d{4}.*\.sql$/.test(f)).sort();
const BEGIN = "-- BEGIN GENERATED: system roles", END = "-- END GENERATED";

type Perm = { resource: string; action: string; isPii: boolean; platformOnly: boolean; supportBlocked: boolean };
const sqlPerms = new Map<string, Perm>();
const sqlRoles = new Map<string, { key: string; base: string }>(); // id -> role
const sqlGrants = new Map<string, Map<string, string>>(); // role key -> perm -> scope

const permRow = /\(\s*'([a-z_.]+)',\s*'([a-z_.]+)',\s*'([a-z_.]+)',\s*'(?:[^']|'')*',\s*(true|false),\s*(true|false),\s*(true|false)\s*\)/g;
function loadPermRows(sql: string) {
  for (const m of sql.matchAll(permRow)) sqlPerms.set(m[1], { resource: m[2], action: m[3], isPii: m[4] === "true", platformOnly: m[5] === "true", supportBlocked: m[6] === "true" });
}
function grant(role: string, perm: string, scope: string) {
  if (!sqlGrants.has(role)) sqlGrants.set(role, new Map());
  sqlGrants.get(role)!.set(perm, scope);
}

// Files that INSERT into role_permissions and how this test reads them. A new migration that seeds system grants and is not
// listed here fails "every seeding migration is understood": add its rows to the loader below.
const SEEDERS = new Set(["0013_authz_core.sql", "0016_rls_v2.sql", "0017_metadata.sql", "0019_connector_domain.sql", "0033_authz_ts_sql_parity.sql"]);
// 0017 seeds per custom-object type (obj:<key>.*) and 0019 save_role writes custom roles: neither touches system roles' fixed catalogue.
const DYNAMIC = new Set(["0017_metadata.sql"]);

const baseSql = read("0013_authz_core.sql");
const a = baseSql.indexOf(BEGIN), b = baseSql.indexOf(END);
const block = baseSql.slice(a, b);
loadPermRows(block);
for (const m of block.matchAll(/\('([0-9a-f-]{36})'::uuid, null::uuid, '(\w+)', '(?:[^']|'')*', '(?:[^']|'')*', '(\w+)'::public\.app_role, true\)/g)) sqlRoles.set(m[1], { key: m[2], base: m[3] });
for (const m of block.matchAll(/\('([0-9a-f-]{36})'::uuid, '([a-z_.]+)', '(\w+)'\)/g)) grant(sqlRoles.get(m[1])!.key, m[2], m[3]);

// Later seed statements: "insert into public.permissions ... values (...)" and "select r.id, '<perm>', <scope> from public.roles r where ... r.key in (...)".
for (const f of files.filter((x) => x > "0013" && SEEDERS.has(x) && !DYNAMIC.has(x))) {
  const sql = read(f);
  for (const stmt of sql.split(/insert into public\.permissions/).slice(1)) loadPermRows(stmt.slice(0, stmt.indexOf(";")));
  for (const m of sql.matchAll(/select r\.id, '([a-z_.]+)', (?:'(\w+)'|case r\.key when 'sales_rep' then 'own' else 'all' end)\s+from public\.roles r\s+where r\.tenant_id is null and r\.is_system and r\.key (?:in \(([^)]*)\)|= '(\w+)')/g)) {
    const keys = (m[3] ?? m[4]).split(",").map((s) => s.trim().replace(/'/g, ""));
    for (const k of keys) grant(k, m[1], m[2] ?? (k === "sales_rep" ? "own" : "all"));
  }
}

describe("SQL seed (0013 + later migrations) vs TS catalogue and SYSTEM_ROLES", () => {
  it("every migration that seeds role_permissions is understood by this test", () => {
    const seeding = files.filter((f) => /insert into public\.role_permissions/.test(read(f)));
    const unknown = seeding.filter((f) => !SEEDERS.has(f));
    expect(unknown, `new migration(s) seed role_permissions: teach sql-parity.test.ts about them: ${unknown.join(", ")}`).toEqual([]);
  });

  it("permission catalogue: same keys and the same pii / platform / support-blocked flags", () => {
    expect([...sqlPerms.keys()].sort()).toEqual(PERMISSION_SEED.map((p) => p.key).sort());
    for (const p of PERMISSION_SEED) {
      const s = sqlPerms.get(p.key)!;
      expect({ k: p.key, resource: s.resource, action: s.action, isPii: s.isPii, platformOnly: s.platformOnly, supportBlocked: s.supportBlocked })
        .toEqual({ k: p.key, resource: p.resource, action: p.action, isPii: p.isPii, platformOnly: p.platformOnly, supportBlocked: p.supportBlocked });
    }
  });

  it("TS catalogue (catalog/*.ts) lists exactly the seeded permissions with the same flags", () => {
    expect(PERMISSIONS.map((p) => p.key).sort()).toEqual([...sqlPerms.keys()].sort());
    for (const def of PERMISSIONS) {
      const s = sqlPerms.get(def.key)!;
      expect({ k: def.key, pii: !!def.isPii, platform: !!def.platformOnly, blocked: !!def.supportBlocked })
        .toEqual({ k: def.key, pii: s.isPii, platform: s.platformOnly, blocked: s.supportBlocked });
    }
  });

  it("the six system roles have the same ids, keys and base roles", () => {
    expect([...sqlRoles.entries()].map(([id, r]) => [id, r.key, r.base]).sort())
      .toEqual(SYSTEM_ROLES.map((r) => [r.id, r.key, r.baseRole]).sort());
  });

  it.each(SYSTEM_ROLES.map((r) => r.key))("role_permissions of %s equal SYSTEM_ROLES (permission and scope)", (role) => {
    const sql = Object.fromEntries([...(sqlGrants.get(role) ?? new Map<string, string>()).entries()].sort(([x], [y]) => x.localeCompare(y)));
    const ts = Object.fromEntries(Object.entries(SYSTEM_ROLES.find((r) => r.key === role)!.grants).sort(([x], [y]) => x.localeCompare(y)));
    expect(sql).toEqual(ts);
  });

  it.each(SYSTEM_ROLES.map((r) => r.key))("systemGrants(%s) is SYSTEM_ROLES, with the territory flag only on own-scope leads.read (as my_grants)", (role) => {
    const g = systemGrants(role);
    const seed = SYSTEM_ROLES.find((r) => r.key === role)!.grants;
    expect(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.scope]))).toEqual(seed);
    for (const [k, v] of Object.entries(g)) expect(!!v.territory, `${role} ${k}`).toBe(k === "leads.read" && v.scope === "own");
  });

  it("every grant names a seeded permission and owner holds every non-platform permission at scope all", () => {
    for (const r of SYSTEM_ROLES) for (const k of Object.keys(r.grants)) expect(sqlPerms.has(k), `${r.key} ${k}`).toBe(true);
    const owner = SYSTEM_ROLES.find((r) => r.key === "owner")!.grants;
    for (const k of sqlPerms.keys()) if (!k.startsWith("platform.")) expect(owner[k], `owner ${k}`).toBe("all");
    for (const r of SYSTEM_ROLES) for (const k of Object.keys(r.grants)) expect(k.startsWith("platform."), `${r.key} ${k}`).toBe(false);
  });
});

// Page matrix versus the grants. Independent rule table (the page letter must follow from what the role really holds).
const PAGE_RULES: Record<string, { read: string[]; write: string[] }> = {
  "/": { read: ["dashboard.read"], write: [] },
  "/sales": { read: ["myday.read"], write: [] },
  "/leads": { read: ["leads.read", "activities.read"], write: ["leads.create", "leads.write", "activities.write"] },
  "/pipeline": { read: ["deals.read"], write: ["deals.write"] },
  "/accounts": { read: ["accounts.read", "contacts.read"], write: ["accounts.write", "contacts.write"] },
  "/campaigns": { read: ["campaigns.read"], write: ["campaigns.write"] },
  "/audience": { read: ["segments.read"], write: ["segments.write"] },
  "/analytics": { read: ["analytics.read"], write: ["analytics.write"] },
  "/inbox": { read: ["inbox.read"], write: ["inbox.reply"] },
  "/tasks": { read: ["tasks.read"], write: ["tasks.write"] },
  "/ai": { read: ["ai.use"], write: [] },
  "/integrations": { read: ["integrations.read"], write: [] },
  "/data-health": { read: ["data_health.read"], write: [] },
  "/settings": { read: ["settings.read"], write: [] },
};
// 0006: contacts are personal data: a rep sees own, a viewer none, whatever the Accounts page letter says.
const READ_OVERRIDE: Record<string, Record<string, string | null>> = { sales_rep: { "contacts.read": "own" }, viewer: { "contacts.read": null } };

describe("UI page matrix (PAGE_ACCESS) vs seeded grants", () => {
  it("has a rule for every page and every page's permission is seeded", () => {
    expect(Object.keys(PAGE_ACCESS_SEED).sort()).toEqual(Object.keys(PAGE_RULES).sort());
    for (const k of Object.values(PAGE_PERMISSION)) expect(sqlPerms.has(k), k).toBe(true);
  });
  for (const [page, rule] of Object.entries(PAGE_RULES)) {
    for (const role of SYSTEM_ROLES) {
      it(`${page} for ${role.key}`, () => {
        const letter = PAGE_ACCESS_SEED[page][role.key];
        const g = role.grants;
        const readOf = (k: string): string | null => (READ_OVERRIDE[role.key] && k in READ_OVERRIDE[role.key] ? READ_OVERRIDE[role.key][k] : !letter ? null : letter === "E" ? "own" : "all");
        for (const k of rule.read) {
          const want = readOf(k);
          // owner holds every permission regardless of the page letter (it has F everywhere, so this is only a guard)
          expect(g[k] ?? null, `${role.key} ${page} read ${k}`).toBe(want);
        }
        for (const k of rule.write) {
          const want = letter === "F" ? "all" : letter === "E" ? "own" : null;
          const extra = (g[k] ?? null);
          // R / M roles must not write through this page; extras seeded for other reasons are listed explicitly (none today)
          expect(extra, `${role.key} ${page} write ${k}`).toBe(want);
        }
      });
    }
  }
  it("settings tabs line up with the grants (audit tab = audit.read, config tab = config.edit)", async () => {
    const { SETTINGS_TABS } = await import("../../auth/roles");
    for (const r of SYSTEM_ROLES) {
      expect(SETTINGS_TABS[r.key].includes("audit"), `${r.key} audit tab`).toBe(!!r.grants["audit.read"]);
      expect(SETTINGS_TABS[r.key].includes("config"), `${r.key} config tab`).toBe(!!r.grants["config.edit"]);
      expect(SETTINGS_TABS[r.key].includes("users"), `${r.key} users tab`).toBe(!!r.grants["members.invite"] || !!r.grants["members.manage"]);
    }
  });
});

describe("Sales Manager grants only roles below their own", () => {
  const rank = { own: 1, team: 2, all: 3 } as const;
  const mgr = SYSTEM_ROLES.find((r) => r.key === "sales_manager")!.grants;
  // Allow-listed (owner: Krishna, review by 2027-02-28): ai.use is own for the manager (page letter E) but all for the rep and
  // viewer-less roles (letter R). A manager therefore assigns a rep who reads more of /ai than the manager does. Decide whether
  // to raise the manager to all in a later seed migration; until then this is the only exception.
  const ALLOWED_EXCESS = new Set(["ai.use"]);
  const below = SYSTEM_ROLES.filter((r) => r.key !== "owner" && r.key !== "sales_manager").filter((r) =>
    Object.entries(r.grants).every(([k, s]) => ALLOWED_EXCESS.has(k) || (mgr[k] && rank[mgr[k]] >= rank[s]))).map((r) => r.key);

  it("MANAGER_SCOPE is exactly the roles whose grants are a subset of the manager's", () => {
    expect([...MANAGER_SCOPE].sort()).toEqual([...below].sort());
  });
  it("MANAGER_SCOPE equals the role list in the SQL guard_membership_change (every sales_manager branch)", () => {
    const sql = [...baseSql.matchAll(/in \('(sales_rep)',\s*'(viewer)'\)/g)].map((m) => [m[1], m[2]].sort().join(","));
    expect(sql.length).toBeGreaterThanOrEqual(3);
    for (const s of sql) expect(s).toBe([...MANAGER_SCOPE].sort().join(","));
    expect(read("0013_authz_core.sql")).not.toMatch(/me = 'sales_manager'[^;]*'marketing'/);
  });
  it("nobody below owner holds roles.manage, so only the owner hands out custom roles", () => {
    for (const r of SYSTEM_ROLES) if (r.key !== "owner") expect(r.grants["roles.manage"], r.key).toBeUndefined();
  });
});

describe("rep claim-from-unassigned rule (owner default: YES, AUD-148)", () => {
  it("reps hold leads.claim at own, managers and owner at all, nobody else holds it", () => {
    const g = (k: string) => SYSTEM_ROLES.find((r) => r.key === k)!.grants["leads.claim"];
    expect([g("sales_rep"), g("sales_manager"), g("owner"), g("marketing"), g("data"), g("viewer")]).toEqual(["own", "all", "all", undefined, undefined, undefined]);
  });
  it("the claim grant is backed by the territory arm: reps hold leads.read at own", () => {
    expect(systemGrants("sales_rep")["leads.read"]).toMatchObject({ scope: "own", territory: true });
  });
});
