// The showcase cards ("Described and mapped, not wired") exist only in the demo deployment. Real sessions see the
// catalogue-driven list with honest states. Demo part runs anywhere; the real part needs the staging Owner.
import { loginOrSkip } from "../settings/_helpers";

describe("integrations: showcase is demo only", () => {
  it("demo shows the showcase", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    cy.contains(/Nothing here is connected in this deployment/i).should("be.visible");
  });
  it("a real session never sees showcase wording or a Connected chip without credentials", function () {
    loginOrSkip(this, "OWNER");
    cy.visit("/integrations");
    cy.contains(/Showcase|Described and mapped|sample data imitates/i).should("not.exist");
    cy.get("[data-chip=connected]").each(($c) => {
      cy.wrap($c).closest("tr").find("a").first().invoke("attr", "href").then((href) => {
        cy.visit(String(href));
        cy.contains("Reconnect").should("not.exist");
        cy.contains("Live").should("exist");
      });
    });
  });
});
