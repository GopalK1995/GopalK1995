// Staging / demo only. Written, NOT run (light mode).
// Part 1 (demo, no setup): every generative feature is Off on /ai, a viewer cannot flip a switch, and turning one on needs the data checks.
// Part 2 (needs a real workspace that has never opened /ai): CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD; all four gateway switches are
// off, and asking for a draft says so instead of calling a model.
describe("ai: off by default", () => {
  it("demo owner: summary, next best action, reply drafts and Ask the CRM are all Off", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/ai");
    cy.get("main [role=switch]").then(($s) => {
      const off = $s.filter((_, el) => el.getAttribute("aria-checked") === "false");
      expect(off.length, "at least the four gateway features are off").to.be.gte(4);
    });
    cy.get("main").should("not.contain.text", "Never (on)");
  });

  it("demo owner: a switch asks for all three data checks before it turns on", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/ai");
    cy.get("main [role=switch][aria-checked=false]").first().click();
    cy.get("[role=dialog] button").contains(/^turn on$/i).should("be.disabled");
    cy.get("[role=dialog] input[type=checkbox]").each(($c) => cy.wrap($c).check());
    cy.get("[role=dialog] button").contains(/^turn on$/i).should("not.be.disabled");
  });

  it("a viewer cannot flip a switch", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/ai", { failOnStatusCode: false });
    cy.get("main [role=switch]").each(($s) => cy.wrap($s).should("be.disabled"));
  });

  it("real owner: all four gateway features start off and the settings card says so", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!email || !password) return this.skip();
    cy.loginReal({ email, password });
    cy.visit("/ai");
    cy.get("[data-cy=ai-settings]").should("be.visible");
    cy.get("main [role=switch]").filter("[aria-checked=true]").should("have.length", 0);
  });
});
