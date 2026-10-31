// Per-key rate limit: 429 with Retry-After once the window is exhausted; headers on every response. Written, NOT run in light mode.
import { api, bearer, createKeyViaUi, loginOrSkip, stamp, requireMode } from "./_helpers";

describe("api: rate limit", () => {
  it("real: RateLimit headers are present and the 121st request in a minute is 429", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    createKeyViaUi({ name: stamp(), role: "viewer", scopes: ["leads:read"] }).then((key) => {
      cy.request({ url: api("/me"), headers: bearer(key) }).then((r) => {
        expect(r.headers).to.have.property("ratelimit-limit", "120");
        expect(r.headers).to.have.property("ratelimit-remaining");
        expect(r.headers).to.have.property("x-request-id");
      });
      const burn = (n: number): Cypress.Chainable => (n === 0 ? cy.wrap(null) : cy.request({ url: api("/me"), headers: bearer(key), failOnStatusCode: false }).then(() => burn(n - 1)));
      burn(119).then(() => {
        cy.request({ url: api("/me"), headers: bearer(key), failOnStatusCode: false }).then((r) => {
          expect(r.status).to.eq(429);
          expect(r.headers).to.have.property("retry-after");
          expect(r.body.code).to.eq("rate_limited");
        });
      });
    });
  });
});
