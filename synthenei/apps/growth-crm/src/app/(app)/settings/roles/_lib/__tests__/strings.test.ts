import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../../../../../messages/en/settings-access.json";
import ta from "../../../../../../../messages/ta/settings-access.json";
import review from "../../../../../../../messages/ta/_review/settings-access.json";
import { fill, sa } from "../strings";

const root = join(__dirname, "../..");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? (f === "__tests__" ? [] : files(p)) : /\.(ts|tsx)$/.test(f) ? [p] : [];
});
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("settingsAccess strings", () => {
  const keys = Object.keys(en);
  it("Tamil drafts cover every key, keep the placeholders, and are all listed for review", () => {
    expect(Object.keys(ta).sort()).toEqual([...keys].sort());
    for (const k of keys) expect(ph((ta as Record<string, string>)[k]), k).toBe(ph((en as Record<string, string>)[k]));
    expect([...(review as string[])].sort()).toEqual([...keys].sort());
  });
  it("every literal sa(\"key\") used by the feature exists, and dynamic families are complete", () => {
    const used = new Set<string>();
    for (const f of [...files(root), ...files(join(root, "../_components"))]) {
      for (const m of readFileSync(f, "utf8").matchAll(/\bsa\("([A-Za-z0-9_]+)"/g)) used.add(m[1]);
    }
    for (const k of used) expect(keys, k).toContain(k);
    for (const c of ["self_change", "last_owner", "out_of_scope", "needs_roles_manage", "role_exceeds_you", "owner_only"]) expect(keys).toContain(`deny_${c}`);
    for (const c of ["unknown_permission", "platform_only", "not_held", "exceeds_scope", "roles_manage_restricted", "conditions_invalid", "conditions_weaker", "mask_weaker"]) expect(keys).toContain(`viol_${c}`);
    for (const c of ["unauthenticated", "org_suspended", "org_readonly", "module_off", "plan_limit", "support_blocked", "support_readonly", "no_permission", "out_of_scope", "condition_failed"]) expect(keys).toContain(`authz_${c}`);
    for (const c of ["suspended", "reactivated"]) expect(keys).toContain(c);
    for (const c of ["None", "Own", "Team", "All"]) expect(keys).toContain(`scope${c}`);
  });
  it("no em dashes, no exclamation marks, fill() replaces placeholders", () => {
    for (const [k, v] of Object.entries(en)) { expect(v, k).not.toMatch(/—|!/); }
    expect(fill("a {x} b", { x: 3 })).toBe("a 3 b");
    expect(sa("nope")).toBe("nope");
  });
});
