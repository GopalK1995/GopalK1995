// API keys screen: create (secret shown once, never again), list, rotate, revoke, last used. Written, NOT run in light mode.
import { api, bearer, createKeyViaUi, loginOrSkip, stamp, requireMode } from "./_helpers";

describe("api: key management", () => {
  it("demo: the screen explains that no key is issued and still renders the ledger", function () {
    requireMode(this, "demo");
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/api-keys");
    cy.contains(/keys are not issued/i).should("be.visible");
    cy.contains("Zapier lead intake").should("be.visible");
  });

  it("demo: the API does not exist (404) and the OpenAPI document is absent", function () {
    requireMode(this, "demo");
    cy.request({ url: api("/me"), failOnStatusCode: false }).its("status").should("eq", 404);
    cy.request({ url: api("/openapi.json"), failOnStatusCode: false }).its("status").should("eq", 404);
  });

  it("real: the secret is shown once, the list only shows the masked key, last used updates", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    const name = stamp();
    createKeyViaUi({ name, role: "viewer", scopes: ["leads:read"] }).then((secret) => {
      cy.contains("button", /I have saved the key/).click();
      cy.reload();
      cy.contains("tr", name).within(() => {
        cy.contains(/never used/i).should("be.visible");
        cy.contains(secret.slice(-32)).should("not.exist");
      });
      cy.get("body").should("not.contain.text", secret);
      cy.request({ url: api("/me"), headers: bearer(secret) }).then((r) => {
        expect(r.status).to.eq(200);
        expect(r.body.data.key.scopes).to.deep.eq(["leads:read"]);
        expect(r.body.data).to.have.property("org_id");
      });
      cy.reload();
      cy.contains("tr", name).contains(/never used/i).should("not.exist");
    });
  });

  it("real: rotate invalidates the old secret; revoke stops the key at once", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    const name = stamp();
    createKeyViaUi({ name, role: "viewer", scopes: ["leads:read"] }).then((secret) => {
      cy.contains("button", /I have saved the key/).click();
      cy.contains("tr", name).contains("button", /^Rotate$/).click();
      cy.contains("[role=dialog] button", /Rotate key/).click();
      cy.get("[data-testid=issued-key]").invoke("text").then((fresh) => {
        expect(fresh.trim()).not.to.eq(secret);
        cy.request({ url: api("/me"), headers: bearer(secret), failOnStatusCode: false }).its("status").should("eq", 401);
        cy.request({ url: api("/me"), headers: bearer(fresh.trim()) }).its("status").should("eq", 200);
        cy.contains("button", /I have saved the key/).click();
        cy.contains("tr", name).contains("button", /^Revoke$/).click();
        cy.contains("[role=dialog] button", /Revoke key/).click();
        cy.contains("tr", name).contains(/revoked/i).should("be.visible");
        cy.request({ url: api("/me"), headers: bearer(fresh.trim()), failOnStatusCode: false }).its("status").should("eq", 401);
      });
    });
  });

  it("real: a viewer cannot open the screen", function () {
    requireMode(this, "real");
    loginOrSkip(this, "VIEWER");
    cy.visit("/settings/api-keys");
    cy.contains(/cannot manage API keys/i).should("be.visible");
  });
});
