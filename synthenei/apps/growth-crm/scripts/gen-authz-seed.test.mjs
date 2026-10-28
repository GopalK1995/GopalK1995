// Unit snapshot for the system-role seed generator (T001). Vitest (added by T002) or `node --test`-free: uses vitest globals via import.
// Not run by T001 (Vitest was not on build/v1 yet); the same checks run today through `node scripts/gen-authz-seed.mjs --check`.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./gen-authz-seed.mjs", import.meta.url));

describe("gen-authz-seed", () => {
  it("is up to date and reproduces CAN, PAGE_ACCESS and SUPPORT_BLOCKED (diff = 0)", () => {
    const out = execFileSync(process.execPath, [script, "--check"], { encoding: "utf8" });
    expect(out).toContain("diff = 0");
  });
  it("seed shape snapshot", async () => {
    const seed = await import("../src/lib/authz/catalog/system-roles.ts");
    expect(seed.SYSTEM_ROLES.map((r) => r.key)).toEqual(["owner", "sales_manager", "sales_rep", "marketing", "data", "viewer"]);
    expect(seed.SYSTEM_ROLES.find((r) => r.key === "viewer").grants["pii.read"]).toBeUndefined();
    expect(seed.SYSTEM_ROLES.find((r) => r.key === "sales_rep").grants["leads.write"]).toBe("own");
    expect(seed.PERMISSION_SEED.filter((p) => p.supportBlocked).length).toBe(17);
  });
});
