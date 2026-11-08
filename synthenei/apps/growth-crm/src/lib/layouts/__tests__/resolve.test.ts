import { describe, expect, it } from "vitest";
import { pickLayout, scopeOf, type LayoutRow } from "../resolve";

const row = (id: string, p: Partial<LayoutRow> = {}): LayoutRow => ({ id, objectTypeId: "o1", kind: "detail", workspaceId: null, roleId: null, spec: {}, version: 1, ...p });
const q = { objectTypeId: "o1", kind: "detail" as const, workspaceId: "w1", roleIds: ["r1"] };

describe("pickLayout precedence", () => {
  const all = [row("org"), row("ws", { workspaceId: "w1" }), row("orgRole", { roleId: "r1" }), row("wsRole", { workspaceId: "w1", roleId: "r1" })];
  it("workspace + role beats org + role beats workspace beats org", () => {
    expect(pickLayout(all, q)?.id).toBe("wsRole");
    expect(pickLayout(all.filter((r) => r.id !== "wsRole"), q)?.id).toBe("orgRole");
    expect(pickLayout(all.filter((r) => r.id === "ws" || r.id === "org"), q)?.id).toBe("ws");
    expect(pickLayout([all[0]], q)?.id).toBe("org");
  });
  it("ignores other roles, other workspaces, other objects and other kinds", () => {
    expect(pickLayout([row("a", { roleId: "r2" }), row("b", { workspaceId: "w2" }), row("c", { objectTypeId: "o2" }), row("d", { kind: "list" })], q)).toBeNull();
  });
  it("a viewer with two role ids (system template and tenant role) gets the most specific match", () => {
    expect(pickLayout([row("t", { roleId: "r1" }), row("u", { roleId: "r9", workspaceId: "w1" })], { ...q, roleIds: ["r1", "r9"] })?.id).toBe("u");
  });
  it("no rows means no layout (the generated default applies)", () => {
    expect(pickLayout([], q)).toBeNull();
  });
  it("names the scope", () => {
    expect(scopeOf(row("x"))).toBe("org");
    expect(scopeOf(row("x", { roleId: "r" }))).toBe("org_role");
    expect(scopeOf(row("x", { workspaceId: "w" }))).toBe("workspace");
    expect(scopeOf(row("x", { workspaceId: "w", roleId: "r" }))).toBe("workspace_role");
  });
});
