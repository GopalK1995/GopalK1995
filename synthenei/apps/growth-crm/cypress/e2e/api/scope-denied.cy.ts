// A key never exceeds its scopes or its role. Written, NOT run in light mode.
import { api, bearer, createKeyViaUi, loginOrSkip, stamp, requireMode } from "./_helpers";

describe("api: scope and role limits", () => {
  it("real: a leads:read key cannot write, and cannot read contacts", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    createKeyViaUi({ name: stamp(), role: "sales manager", scopes: ["leads:read"] }).then((key) => {
      cy.request({ method: "POST", url: api("/leads"), headers: bearer(key), body: { full_name: "x y" }, failOnStatusCode: false }).then((r) => {
        expect(r.status).to.eq(403);
        expect(r.body.code).to.eq("forbidden");
      });
      cy.request({ url: api("/contacts"), headers: bearer(key), failOnStatusCode: false }).its("status").should("eq", 403);
      cy.request({ url: api("/leads"), headers: bearer(key) }).its("status").should("eq", 200);
    });
  });

  it("real: a viewer-role key with a write scope is still read-only (role grant AND scope)", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    createKeyViaUi({ name: stamp(), role: "viewer", scopes: ["leads:write"] }).then((key) => {
      cy.request({ method: "POST", url: api("/leads"), headers: bearer(key), body: { full_name: "x y" }, failOnStatusCode: false }).its("status").should("eq", 403);
    });
  });

  it("real: a manager cannot create a key with the owner role (no escalation)", function () {
    requireMode(this, "real");
    loginOrSkip(this, "MANAGER");
    cy.visit("/settings/api-keys");
    cy.contains("button", /^Create key$/).click();
    cy.contains("label", /^Role/).parent().find("button[role=combobox]").click();
    cy.get("[role=option]").contains(/^Owner$/).should("not.exist");
  });

  it("real: missing or malformed keys are 401 with WWW-Authenticate", function () {
    requireMode(this, "real");
    cy.request({ url: api("/me"), failOnStatusCode: false }).then((r) => {
      expect(r.status).to.eq(401);
      expect(r.headers["www-authenticate"]).to.contain("Bearer");
    });
    cy.request({ url: api("/me"), headers: bearer("sk_live_AAAAAAAA_" + "b".repeat(32)), failOnStatusCode: false }).its("status").should("eq", 401);
  });
});
