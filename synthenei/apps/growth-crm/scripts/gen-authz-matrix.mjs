#!/usr/bin/env node
// Growth CRM: authorization decision-matrix generator (task T057, BUILD-PLAN T057, CONTRACTS C3).
//
//   node scripts/gen-authz-matrix.mjs            regenerate src/lib/authz/__fixtures__/matrix.json AND
//                                                supabase/tests/authz_matrix.test.sql from the TS engine.
//   node scripts/gen-authz-matrix.mjs --check    exit 1 if either generated artifact is stale (CI "generator diff = 0").
//
// The fixture is produced by running the REAL TypeScript engine (decide() in src/lib/authz/engine.ts) across every
// cell of buildMatrix() in src/lib/authz/__fixtures__/matrix-cases.ts. The SQL file re-runs the same cells against the
// SQL twin (authz.check in supabase/migrations/0013_authz_core.sql) and asserts the decisions agree; a failing cell
// names role, permission, record and tenant so a reviewer can see exactly which combination disagreed.
//
// matrix-cases.ts imports the engine, which uses extensionless/directory specifiers (../catalog, ./pages, ...). Node's
// ESM loader cannot resolve those, so — exactly like the repo's `test:config` script — we transpile the reachable TS to
// CommonJS with tsc into a temp dir and require() it. Needs the TypeScript CLI (tsc) and Node >= 18 on PATH.
//   npx -y -p node@22 node scripts/gen-authz-matrix.mjs --check
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX_JSON = join(root, "src/lib/authz/__fixtures__/matrix.json");
const MATRIX_SQL = join(root, "supabase/tests/authz_matrix.test.sql");
const mode = process.argv[2] ?? "";
const lf = (t) => t.split(String.fromCharCode(13)).join(""); // tolerate CRLF checkouts

// ---------------------------------------------------------------- transpile the TS engine to CommonJS and load it
function loadEngine() {
  const out = mkdtempSync(join(tmpdir(), "authz-matrix-"));
  // Compile the two entry points we need plus everything they reach (rootDir = src keeps the ../../data/types layout).
  const r = spawnSync(
    "npx",
    ["-y", "tsc",
      "src/lib/authz/__fixtures__/matrix-cases.ts",
      "src/lib/authz/system-grants.ts",
      "src/lib/authz/catalog/system-roles.ts",
      "--outDir", out, "--rootDir", "src",
      "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node",
      "--skipLibCheck", "--esModuleInterop"],
    { cwd: root, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (r.status !== 0) { console.error(r.stdout, r.stderr); throw new Error("tsc failed to transpile the authz engine"); }
  const cases = require(join(out, "lib/authz/__fixtures__/matrix-cases.js"));
  const grants = require(join(out, "lib/authz/system-grants.js"));
  const roles = require(join(out, "lib/authz/catalog/system-roles.js"));
  const engine = require(join(out, "lib/authz/engine.js"));
  const catalog = require(join(out, "lib/authz/catalog/index.js"));
  const cleanup = () => { try { rmSync(out, { recursive: true, force: true }); } catch { /* best effort */ } };
  return { cases, grants, roles, engine, catalog, cleanup };
}

// ---------------------------------------------------------------- TS engine vs SQL seed: do the grants agree?
// The matrix fixture is built from systemGrants() (TS engine). The SQL side reads role_permissions, seeded from
// SYSTEM_ROLES (src/lib/authz/catalog/system-roles.ts). These are produced by two different rule engines, so parity is
// not free — this check is the canary. Any mismatch is a real TS/SQL disagreement and is reported, never hidden.
function grantDiffs({ grants, roles }) {
  const ROLES = ["owner", "sales_manager", "sales_rep", "marketing", "data", "viewer"];
  const seed = Object.fromEntries(roles.SYSTEM_ROLES.map((r) => [r.key, r.grants]));
  const diffs = [];
  for (const role of ROLES) {
    const ts = grants.systemGrants(role); // Record<perm, Grant{scope,...}>
    const sql = seed[role] ?? {}; // Record<perm, scope>
    const keys = new Set([...Object.keys(ts), ...Object.keys(sql)]);
    for (const k of [...keys].sort()) {
      const tScope = ts[k]?.scope; // undefined = no grant
      const sScope = sql[k]; // undefined = no grant
      if (tScope !== sScope) diffs.push({ role, perm: k, ts: tScope ?? "(none)", sql: sScope ?? "(none)" });
    }
  }
  return diffs;
}

// ---------------------------------------------------------------- matrix.json (byte-identical to the committed shape)
const COLUMNS = ["role", "support", "tenant", "modulesOff", "perm", "record", "allow", "reason", "step"];
function renderMatrixJson({ cases }) {
  const rows = cases.buildMatrix();
  return JSON.stringify({ now: cases.NOW, columns: COLUMNS, rows });
}

// ---------------------------------------------------------------- SQL generation lives in its own module
import { renderSql } from "./authz-matrix-sql.mjs";

// ---------------------------------------------------------------- main
const eng = loadEngine();
try {
  const diffs = grantDiffs(eng);
  if (diffs.length) {
    console.error(`TS/SQL grant divergences (${diffs.length}): the TS engine (systemGrants) and the SQL seed (SYSTEM_ROLES) disagree.`);
    for (const d of diffs) console.error(`  ${d.role} ${d.perm}: TS=${d.ts} SQL=${d.sql}`);
    process.exitCode = 1; throw new Error("AUD-115: grant divergence (fix system-roles.ts or the engine, no allow-list for grants)");
  } else {
    console.log("TS systemGrants and SQL SYSTEM_ROLES agree for all role x permission cells.");
  }

  const json = renderMatrixJson(eng);
  const sql = renderSql(eng, { diffs });

  if (mode === "--check") {
    const errs = [];
    if (lf(readFileSync(MATRIX_JSON, "utf8")) !== json) errs.push("src/lib/authz/__fixtures__/matrix.json is stale (run scripts/gen-authz-matrix.mjs)");
    if (lf(readFileSync(MATRIX_SQL, "utf8")) !== sql) errs.push("supabase/tests/authz_matrix.test.sql is stale (run scripts/gen-authz-matrix.mjs)");
    if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
    console.log(`OK: matrix.json (${JSON.parse(json).rows.length} rows) and authz_matrix.test.sql are up to date.`);
  } else if (mode === "") {
    writeFileSync(MATRIX_JSON, json);
    writeFileSync(MATRIX_SQL, sql);
    console.log(`wrote ${MATRIX_JSON} (${JSON.parse(json).rows.length} rows)`);
    console.log(`wrote ${MATRIX_SQL}`);
  } else { console.error("unknown flag", mode); process.exit(2); }
} finally {
  eng.cleanup();
}
