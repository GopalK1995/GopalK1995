#!/usr/bin/env node
// AUD-115: compare the LIVE database's system-role grants with the TS catalogue (SYSTEM_ROLES). Manual tool, NOT run in CI.
// SELECT-only: this script never connects to anything. It prints the read-only query, you run it (Supabase MCP execute_sql or
// the SQL editor, project evybdanqxgkjoybrvzru) and hand the JSON result back to it.
//
//   node scripts/authz-live-compare.mjs --sql                  print the two SELECT statements
//   node scripts/authz-live-compare.mjs --live result.json     compare; exit 1 on any difference
//
// result.json is either [{role, permission_key, scope}, ...] (the role_permissions query) or
// { role_permissions: [...], permissions: [{key, is_pii, platform_only, support_blocked}, ...] }.
// Needs Node >= 22.6 (type stripping): npx -y -p node@22 node scripts/authz-live-compare.mjs --live result.json
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SQL = {
  role_permissions: "select r.key as role, rp.permission_key, rp.scope from public.roles r join public.role_permissions rp on rp.role_id = r.id where r.tenant_id is null and r.is_system order by 1, 2",
  permissions: "select key, is_pii, platform_only, support_blocked from public.permissions where key not like 'obj:%' order by 1",
};
const args = process.argv.slice(2);
if (args[0] === "--sql") { for (const [k, q] of Object.entries(SQL)) console.log(`-- ${k}\n${q};\n`); process.exit(0); }
if (args[0] !== "--live" || !args[1]) { console.error("usage: --sql | --live result.json"); process.exit(2); }

const seed = await import(pathToFileURL(join(root, "src/lib/authz/catalog/system-roles.ts")).href);
const raw = JSON.parse(readFileSync(args[1], "utf8"));
const rows = Array.isArray(raw) ? raw : raw.role_permissions ?? [];
const live = {};
for (const r of rows) (live[r.role] ??= {})[r.permission_key] = r.scope;

const errs = [];
for (const role of seed.SYSTEM_ROLES) {
  const ts = role.grants, db = live[role.key] ?? {};
  for (const k of new Set([...Object.keys(ts), ...Object.keys(db)])) {
    if (ts[k] !== db[k]) errs.push(`${role.key} ${k}: TS=${ts[k] ?? "(none)"} live=${db[k] ?? "(none)"}`);
  }
}
for (const role of Object.keys(live)) if (!seed.SYSTEM_ROLES.some((r) => r.key === role)) errs.push(`live has system role ${role} unknown to TS`);
if (!Array.isArray(raw) && raw.permissions) {
  const ts = new Map(seed.PERMISSION_SEED.map((p) => [p.key, p]));
  for (const p of raw.permissions) {
    const t = ts.get(p.key);
    if (!t) { errs.push(`permission ${p.key}: live only`); continue; }
    if (t.isPii !== p.is_pii || t.platformOnly !== p.platform_only || t.supportBlocked !== p.support_blocked) errs.push(`permission ${p.key}: flags differ`);
  }
  for (const k of ts.keys()) if (!raw.permissions.some((p) => p.key === k)) errs.push(`permission ${k}: TS only (migration not applied?)`);
}
if (errs.length) { console.error(errs.join("\n")); console.error(`DIVERGENT: ${errs.length} difference(s)`); process.exit(1); }
console.log(`OK: live role_permissions equal the TS catalogue (${rows.length} rows)`);
