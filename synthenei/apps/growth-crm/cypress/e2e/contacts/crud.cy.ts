// T015 (not run by the author). The demo workspace has no contacts table, so the page says so; real CRUD runs on staging.
describe("contacts: crud", () => {
  it("demo workspace shows the not-connected state, not invented rows", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/contacts");
    cy.contains("not connected yet").should("exist");
  });
  it("account page add-contact dialog validates the phone number (demo)", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/accounts");
    cy.get("table a").first().click();
    cy.get("[data-cy=add-contact]").click();
    cy.get("input[name=fullName]").type("Test Contact");
    cy.get("input[name=phone]").type("123");
    cy.get("[data-cy=account-submit]").click();
    cy.contains("10 digit").should("exist");
  });
});
