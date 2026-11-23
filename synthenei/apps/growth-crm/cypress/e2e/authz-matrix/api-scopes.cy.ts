// REST API channel of the authorization matrix (T057). BUILD-PLAN: the API channel runs "all API cells" (more
// exhaustive than the UI sampling). For each system role we mint an API key with that role and every read scope, then
// GET every public resource and assert the status matches the matrix.json decision for that role's <resource>.read
// grant (200 allowed, 403 forbidden); plus a write-enforcement cell proving role grant AND scope are both required.
// A failing cell names the role, resource and permission.
//
// REAL mode only: the public API mints a bot JWT and looks the key up in Supabase (src/lib/api/auth.ts), so it cannot
// run against demo data -- same as every other cypress/e2e/api/* spec, which skip cleanly without a staging branch DB
// and CYPRESS_QA_* credentials. Written here, exercised on the staging branch.
import { api, bearer, createKeyViaUi, loginOrSkip, requireMode, stamp } from "../api/_helpers";
import { listAllow } from "./_helpers";

// role -> the label shown in the "Create key" role picker (createKeyViaUi matches case-insensitively).
const ROLES: { role: string; label: string }[] = [
  { role: "owner", label: "owner" },
  { role: "sales_manager", label: "sales manager" },
  { role: "sales_rep", label: "sales rep" },
  { role: "marketing", label: "marketing" },
  { role: "data", label: "data" },
  { role: "viewer", label: "viewer" },
];
const RESOURCES = ["leads", "contacts", "accounts", "deals", "tasks", "activities", "campaigns"] as const;
const READ_SCOPES = RESOURCES.map((r) => `${r}:read`);

describe("authz-matrix API channel: key role x resource reads match the matrix", () => {
  for (const { role, label } of ROLES) {
    it(`real: a ${role} key reads exactly the resources the matrix allows`, function () {
      requireMode(this, "real");
      loginOrSkip(this, "OWNER");
      createKeyViaUi({ name: stamp(), role: label, scopes: READ_SCOPES }).then((key) => {
        for (const res of RESOURCES) {
          const want = listAllow(role, `${res}.read`) ? 200 : 403;
          cy.request({ url: api(`/${res}`), headers: bearer(key), failOnStatusCode: false })
            .its("status").should("eq", want);
        }
      });
    });
  }

  it("real: a viewer key with a write scope still cannot create (role grant AND scope)", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    createKeyViaUi({ name: stamp(), role: "viewer", scopes: ["leads:read", "leads:write"] }).then((key) => {
      // viewer has no leads.create grant in the matrix, so the write scope cannot grant it.
      const want = listAllow("viewer", "leads.create") ? 200 : 403;
      cy.request({ method: "POST", url: api("/leads"), headers: bearer(key), body: { full_name: "Authz Matrix" }, failOnStatusCode: false })
        .its("status").should("eq", want);
    });
  });
});
