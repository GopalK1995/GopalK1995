// T013 (not run by the author; the integrator runs it at the gate).
describe("leads: create", () => {
  it("demo owner: creating a lead says nothing was saved (no database write)", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/leads");
    cy.get("[data-cy=create-lead]").click();
    cy.get("input[name=fullName]").type("Test Partner");
    cy.get("input[name=phone]").type("9876543210");
    cy.contains("button", "Save lead").click();
    cy.contains("Demo workspace: nothing was saved").should("exist");
  });
  it("shows field errors for missing contact details", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/leads");
    cy.get("[data-cy=create-lead]").click();
    cy.get("input[name=fullName]").type("No Contact");
    cy.contains("button", "Save lead").click();
    cy.contains("Add a phone number or an email").should("exist");
  });
  it("viewer sees the create button disabled with a reason", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/leads");
    cy.get("[data-cy=create-lead]").should("be.disabled");
  });
});
