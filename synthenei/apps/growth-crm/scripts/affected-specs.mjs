#!/usr/bin/env node
// Maps changed paths (git diff vs base, plus working tree) to Cypress spec globs.
// Usage: node scripts/affected-specs.mjs [--base=origin/build/v1]   (prints comma-separated globs)
//        node scripts/affected-specs.mjs | xargs npx cypress run --spec
import { execSync } from "node:child_process";

const base = (process.argv.find((a) => a.startsWith("--base=")) ?? "--base=origin/build/v1").slice(7);
const sh = (c) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
const prefix = sh("git rev-parse --show-prefix").trim();
const changed = new Set(
  [...sh(`git diff --name-only ${base}...HEAD`).split("\n"), ...sh("git diff --name-only HEAD").split("\n"), ...sh("git ls-files --others --exclude-standard").split("\n")]
    .filter(Boolean).map((f) => f.split(String.fromCharCode(92)).join("/")).filter((f) => !prefix || f.startsWith(prefix)).map((f) => f.slice(prefix.length)),
);

const globs = new Set(["cypress/e2e/smoke/**/*.cy.ts"]);
// path prefix -> spec area (cypress/e2e/<area>/**)
const AREAS = [
  ["src/app/(app)/leads", "leads"], ["src/app/(app)/pipeline", "pipeline"], ["src/app/(app)/accounts", "accounts"],
  ["src/app/(app)/campaigns", "campaigns"], ["src/app/(app)/inbox", "inbox"], ["src/app/(app)/tasks", "tasks"],
  ["src/app/(app)/integrations", "integrations"], ["src/app/(app)/settings", "settings"], ["src/app/(app)/data-health", "data-health"],
  ["src/app/admin", "admin"], ["src/lib/authz", "authz"], ["src/lib/auth", "authz"], ["src/components/shell", "shell"],
];
const ALL = ["package.json", "package-lock.json", "cypress.config.ts", "next.config.mjs", "src/app/layout.tsx", "src/middleware.ts", "middleware.ts"];

let everything = false;
for (const f of changed) {
  if (ALL.includes(f) || f.startsWith("cypress/support/")) everything = true;
  if (/^cypress\/(e2e|component)\/.+\.cy\.tsx?$/.test(f)) globs.add(f);
  for (const [p, area] of AREAS) {
    if (f.startsWith(p)) { globs.add(`cypress/e2e/${area}/**/*.cy.ts`); globs.add(`cypress/component/${area}/**/*.cy.{ts,tsx}`); }
  }
}
if (everything) { globs.clear(); globs.add("cypress/e2e/**/*.cy.ts"); }
process.stdout.write([...globs].join(",") + "\n");
