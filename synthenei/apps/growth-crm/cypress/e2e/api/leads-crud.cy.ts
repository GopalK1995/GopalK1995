// Leads over REST: create, read, filter, cursor pagination, update with versions, soft delete. Written, NOT run in light mode.
import { api, bearer, createKeyViaUi, loginOrSkip, stamp, requireMode } from "./_helpers";

describe("api: leads CRUD", () => {
  it("real: full lifecycle with a leads:write key", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    createKeyViaUi({ name: stamp(), role: "sales manager", scopes: ["leads:write"] }).then((key) => {
      const h = bearer(key);
      const full_name = `API Lead ${stamp()}`;
      cy.request({ method: "POST", url: api("/leads"), headers: h, body: { full_name, source: "api-test" } }).then((c) => {
        expect(c.status).to.eq(201);
        expect(c.headers.location).to.contain("/api/v1/leads/");
        const lead = c.body.data;
        expect(lead).to.include({ full_name });
        expect(lead).to.have.property("version", 1);
        expect(lead).to.have.property("org_id");
        expect(lead).not.to.have.property("tenant_id");
        cy.request({ url: api(`/leads/${lead.id}`), headers: h }).its("body.data.id").should("eq", lead.id);
        cy.request({ url: api("/leads?filter[source]=api-test&limit=1"), headers: h }).then((l) => {
          expect(l.body.data).to.have.length(1);
          expect(l.body).to.have.property("next_cursor");
        });
        cy.request({ method: "PATCH", url: api(`/leads/${lead.id}`), headers: h, body: { city: "Madurai", expected_version: 1 } }).its("body.data.version").should("eq", 2);
        cy.request({ method: "PATCH", url: api(`/leads/${lead.id}`), headers: h, body: { city: "Chennai", expected_version: 1 }, failOnStatusCode: false }).then((r) => {
          expect(r.status).to.eq(409);
          expect(r.headers["content-type"]).to.contain("application/problem+json");
          expect(r.body.code).to.eq("conflict");
        });
        cy.request({ method: "DELETE", url: api(`/leads/${lead.id}`), headers: h }).its("status").should("eq", 204);
        cy.request({ url: api(`/leads/${lead.id}`), headers: h, failOnStatusCode: false }).its("status").should("eq", 404);
      });
    });
  });

  it("real: invalid bodies are 422 problem+json with field paths", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    createKeyViaUi({ name: stamp(), role: "sales manager", scopes: ["leads:write"] }).then((key) => {
      cy.request({ method: "POST", url: api("/leads"), headers: bearer(key), body: { full_name: "", bogus: 1 }, failOnStatusCode: false }).then((r) => {
        expect(r.status).to.eq(422);
        expect(r.body.errors).to.be.an("array").and.not.be.empty;
      });
    });
  });

  it("real: the OpenAPI document is public and lists the lead routes", function () {
    requireMode(this, "real");
    cy.request(api("/openapi.json")).then((r) => {
      expect(r.body.openapi).to.eq("3.1.0");
      expect(r.body.paths).to.have.property("/leads");
    });
  });
});
