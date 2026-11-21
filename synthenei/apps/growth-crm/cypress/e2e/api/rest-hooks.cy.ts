// Staging, real mode only. Written, NOT run (light mode). REST hooks as Zapier and Make use them: subscribe through POST /api/v1/webhooks,
// list, unsubscribe through DELETE. Needs the staging branch DB with a seeded QA owner (CONTRACTS C16.3).
import { api, bearer, createKeyViaUi, loginOrSkip, requireMode, stamp } from "./_helpers";

describe("api: REST hooks (Zapier / Make)", () => {
  it("subscribe returns the signing secret once; the subscription lists and unsubscribes; http and private targets are refused", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    createKeyViaUi({ name: `hooks-${stamp()}`, scopes: ["webhooks:read", "webhooks:write"] }).then((key) => {
      const url = `https://hooks.example.com/${stamp()}`;
      cy.request({ method: "POST", url: api("/webhooks"), headers: bearer(key), body: { url, event_types: ["lead.created"], description: "Zapier" } }).then((r) => {
        expect(r.status).to.eq(201);
        expect(r.body.data.secret).to.match(/^whsec_/);
        const id = r.body.data.id as string;
        cy.request({ url: api(`/webhooks/${id}`), headers: bearer(key) }).then((g) => expect(g.body.data).not.to.have.property("secret"));
        cy.request({ method: "DELETE", url: api(`/webhooks/${id}`), headers: bearer(key) }).its("status").should("eq", 204);
        cy.request({ method: "DELETE", url: api(`/webhooks/${id}`), headers: bearer(key), failOnStatusCode: false }).its("status").should("eq", 404);
      });
      for (const bad of ["http://hooks.example.com/x", "https://127.0.0.1/x", "https://169.254.169.254/x"]) {
        cy.request({ method: "POST", url: api("/webhooks"), headers: bearer(key), body: { url: bad, event_types: ["lead.created"] }, failOnStatusCode: false }).its("status").should("be.oneOf", [400, 422]);
      }
    });
  });

  it("a key without the webhooks:write scope cannot subscribe", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    createKeyViaUi({ name: `hooks-ro-${stamp()}`, scopes: ["webhooks:read"] }).then((key) => {
      cy.request({ method: "POST", url: api("/webhooks"), headers: bearer(key), body: { url: "https://hooks.example.com/x", event_types: ["lead.created"] }, failOnStatusCode: false }).its("status").should("eq", 403);
    });
  });
});
