// Ports the essentials of scripts/e2e-matrix.mjs: each demo persona logs in and lands on its home route;
// a role without access to a page gets 403.
import { PERSONAS, type Persona } from "../../support/personas";

describe("smoke: demo personas", () => {
  (Object.keys(PERSONAS) as Persona[]).forEach((persona) => {
    it(`${persona} lands on ${PERSONAS[persona].home}`, () => {
      cy.loginAs(persona);
      cy.visit(PERSONAS[persona].home);
      cy.location("pathname").should("eq", PERSONAS[persona].home);
      cy.get("body").should(($b) => {
        expect($b.text()).not.to.match(/Unhandled Runtime Error|Application error: a (server|client)-side exception/i);
      });
    });
  });

  it("sales_rep is denied /campaigns with 403", () => {
    cy.loginAs("rep-lawsome");
    cy.request({ url: "/campaigns", failOnStatusCode: false }).its("status").should("eq", 403);
  });
});
