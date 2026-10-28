import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NOW, buildMatrix, persona, recordFor, type Row } from "../__fixtures__/matrix-cases";
import { decide } from "../engine";

const path = resolve(process.cwd(), "src/lib/authz/__fixtures__/matrix.json");
const cases = buildMatrix();
if (process.env.WRITE_MATRIX === "1") writeFileSync(path, JSON.stringify({ now: NOW, columns: ["role", "support", "tenant", "modulesOff", "perm", "record", "allow", "reason", "step"], rows: cases }));

describe("authz decision matrix (shared fixture with SQL, T057)", () => {
  it("committed matrix.json matches the engine", () => {
    expect(existsSync(path)).toBe(true);
    const fx = JSON.parse(readFileSync(path, "utf8")) as { rows: Row[] };
    expect(fx.rows.length).toBe(cases.length);
    expect(fx.rows).toEqual(JSON.parse(JSON.stringify(cases)));
  });
  it("covers six roles, all permissions, every record shape and support mode", () => {
    expect(new Set(cases.map((c) => c[0])).size).toBe(6);
    expect(new Set(cases.map((c) => c[1]))).toEqual(new Set(["none", "read_only", "read_write"]));
    expect(new Set(cases.map((c) => c[5])).size).toBe(10);
    expect(cases.length).toBeGreaterThan(4000);
  });
  // Independent invariants (do not use the engine's own tables): hold for every row.
  it("invariants hold on every row", () => {
    for (const [role, support, tenant, , perm, rec, allow, reason, step] of cases) {
      const read = perm.endsWith(".read"), tag = `${role}/${support}/${tenant}/${perm}/${rec}`;
      if (support === "read_only" && !read) expect(allow, tag).toBe(false);
      if (tenant !== "active" && !read) expect(allow, tag).toBe(false);
      if (perm.startsWith("platform.")) expect(allow, tag).toBe(false);
      if (rec === "foreign_ws") expect(allow, tag).toBe(false);
      if (allow) { expect(reason, tag).toBeNull(); expect(step, tag).toBe(8); } else expect(reason, tag).not.toBeNull();
      if (role === "viewer" && support === "none" && /\.(write|delete|manage|create|assign|move|reply|import|export|toggle)$/.test(perm)) expect(allow, tag).toBe(false);
    }
  });
  it("replaying a sample row through decide() gives the stored result", () => {
    const [role, support, tenant, , perm, rec, allow] = cases[1234];
    const p = persona(role, support as "none", tenant as "active");
    expect(decide(p, perm, recordFor(rec, p.uid), new Date(NOW)).allow).toBe(allow);
  });
});
