import { describe, expect, it } from "vitest";
import { systemPrincipal } from "@/lib/authz";
import { allowedActions } from "../actions";
import type { Role } from "@/lib/data/types";

const ids = (role: Role) => allowedActions(systemPrincipal({ uid: "u", workspaceId: "w", role })).map((a) => a.id);

describe("palette actions are permission-aware", () => {
  it("owner gets the write actions", () => { expect(ids("owner")).toEqual(expect.arrayContaining(["new-lead", "log-call", "new-task"])); });
  it("viewer gets none of the write actions", () => {
    const v = ids("viewer");
    for (const a of ["new-lead", "log-call", "new-task", "import-leads"]) expect(v).not.toContain(a);
  });
  it("a module that is off removes its actions", () => {
    const p = systemPrincipal({ uid: "u", workspaceId: "w", role: "owner", modulesOff: ["tasks"] });
    expect(allowedActions(p).map((a) => a.id)).not.toContain("new-task");
  });
  it("support read-only sessions get no write actions", () => {
    const p = systemPrincipal({ uid: "u", workspaceId: "w", role: "owner", support: { mode: "read_only" } });
    expect(allowedActions(p)).toEqual([]);
  });
});

describe("scoped roles", () => {
  it("a sales rep (own scope) still gets New lead and Log call", () => { expect(ids("sales_rep")).toEqual(expect.arrayContaining(["new-lead", "log-call"])); });
});
