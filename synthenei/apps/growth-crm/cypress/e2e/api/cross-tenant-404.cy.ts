// A key from one organisation sees another organisation's ids as 404, never 403. Written, NOT run in light mode.
import { api, bearer, createKeyViaUi, loginOrSkip, stamp, requireMode } from "./_helpers";

describe("api: cross-tenant isolation", () => {
  it("real: lead ids from another tenant are 404 on read, update and delete", function () {
    requireMode(this, "real");
    loginOrSkip(this, "SHOLA");
    createKeyViaUi({ name: stamp(), role: "owner", scopes: ["leads:write"] }).then((foreignKey) => {
      cy.request({ method: "POST", url: api("/leads"), headers: bearer(foreignKey), body: { full_name: "Foreign Lead" } }).then((c) => {
        const foreignId = c.body.data.id as string;
        loginOrSkip(this, "OWNER");
        createKeyViaUi({ name: stamp(), role: "owner", scopes: ["leads:write"] }).then((key) => {
          const h = bearer(key);
          for (const method of ["GET", "PATCH", "DELETE"] as const) {
            cy.request({ method, url: api(`/leads/${foreignId}`), headers: h, body: method === "PATCH" ? { city: "x" } : undefined, failOnStatusCode: false }).then((r) => {
              expect(r.status, method).to.eq(404);
              expect(r.body.code).to.eq("not_found");
            });
          }
          cy.request({ url: api("/leads?filter[full_name]=Foreign%20Lead"), headers: h }).its("body.data").should("have.length", 0);
        });
      });
    });
  });
});
