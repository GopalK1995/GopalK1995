#!/usr/bin/env node
// Runs pgTAP files against the Supabase BRANCH database (never production): node scripts/run-pgtap.mjs supabase/tests/0013_authz_core.test.sql ...
// Needs the psql CLI on PATH and SUPABASE_DB_URL (the branch connection string). Exits 1 on any "not ok" or psql error.
import { spawnSync } from "node:child_process";

const url = process.env.SUPABASE_DB_URL;
const files = process.argv.slice(2);
if (!url || files.length === 0) {
  console.error("usage: SUPABASE_DB_URL=<branch url> node scripts/run-pgtap.mjs <file.test.sql>...");
  process.exit(2);
}
if (process.env.SUPABASE_PROD_REF && url.includes(process.env.SUPABASE_PROD_REF)) {
  console.error("refusing to run pgTAP against the production project");
  process.exit(2);
}
let failed = false;
for (const f of files) {
  const r = spawnSync("psql", [url, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-f", f], { encoding: "utf8" });
  process.stdout.write(`== ${f}\n${r.stdout ?? ""}`);
  if (r.error || r.status !== 0 || /^not ok/m.test(r.stdout ?? "")) { process.stderr.write(r.stderr ?? String(r.error)); failed = true; }
}
process.exit(failed ? 1 : 0);
