import { describe, expect, it } from "vitest";
import { CAN, PAGE_ACCESS, ROLES, SUPPORT_BLOCKED, accessFor, can, type Action } from "../../auth/roles";
import { permissionDef } from "../catalog";
import { ACTION_PERMISSION } from "../system-grants";
import { LEGACY_CAN, LEGACY_PAGE_ACCESS, LEGACY_SUPPORT_BLOCKED, legacyCan } from "../__fixtures__/legacy-roles";

describe("roles.ts derived views equal the legacy tables", () => {
  it("PAGE_ACCESS is identical", () => expect(PAGE_ACCESS).toEqual(LEGACY_PAGE_ACCESS));
  it("SUPPORT_BLOCKED is identical", () => expect([...SUPPORT_BLOCKED].sort()).toEqual([...LEGACY_SUPPORT_BLOCKED].sort()));
  it("SUPPORT_BLOCKED equals the actions whose permission is supportBlocked in the catalogue", () => {
    const derived = (Object.keys(ACTION_PERMISSION) as Action[]).filter((a) => permissionDef(ACTION_PERMISSION[a])?.supportBlocked);
    expect([...SUPPORT_BLOCKED].sort()).toEqual(derived.sort());
  });
  it("CAN and can() match for every role, action and support mode", () => {
    for (const action of Object.keys(LEGACY_CAN) as Action[]) for (const role of ROLES) {
      expect(CAN[action](role), `${action}/${role}`).toBe(LEGACY_CAN[action](role));
      for (const support of [null, { mode: "read_only" as const }, { mode: "read_write" as const }]) {
        expect(can(action, { role, support }), `${action}/${role}/${support?.mode}`).toBe(legacyCan(action, { role, support }));
      }
    }
  });
  it("accessFor keeps default deny and open paths", () => {
    expect(accessFor("viewer", "/profile")).toBe("F");
    expect(accessFor("owner", "/unknown")).toBeNull();
    expect(accessFor("sales_rep", "/leads/abc")).toBe("E");
  });
});
