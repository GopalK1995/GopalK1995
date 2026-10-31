// Demo path runs everywhere. The real path needs staging users: CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD.
describe("campaigns: create, edit, pause, metrics", () => {
  it("demo owner creates a campaign; the toast says nothing was saved", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/campaigns");
    cy.contains("button", "New campaign").click();
    cy.get("#nc-name").type("Madurai family law push");
    cy.get("#nc-b").type("75000");
    cy.contains("button", "Create campaign").click();
    cy.contains("nothing was saved", { matchCase: false }).should("exist");
  });
  it("viewer cannot create: the control is disabled", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/campaigns");
    cy.contains("button", "New campaign").should("be.disabled");
  });
  const email = Cypress.expose("OWNER_EMAIL") as string | undefined;
  const password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
  (email && password ? it : it.skip)("real owner creates, pauses and adds a day; state survives a reload", () => {
    cy.loginReal({ email: email!, password: password! });
    cy.visit("/campaigns");
    cy.contains("button", "New campaign").click();
    cy.get("#nc-name").type(`Cypress campaign ${Date.now()}`);
    cy.get("#nc-b").type("5000");
    cy.contains("button", "Create campaign").click();
    cy.contains("Campaign created").should("exist");
    cy.reload();
    cy.contains("Cypress campaign").first().click();
    cy.contains("button", "Pause").click();
    cy.contains("Campaign paused").should("exist");
    cy.contains("button", "Add a day").click();
    cy.get("#md-day").type("2026-10-01");
    cy.get("#md-spend").type("1200");
    cy.contains("button", "Save day").click();
    cy.contains("Metrics saved").should("exist");
  });
});
