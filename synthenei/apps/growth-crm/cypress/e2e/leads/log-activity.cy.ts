describe("leads: log call, email, schedule", () => {
  beforeEach(() => { cy.loginAs("owner-lawsome"); cy.visit("/leads?view=all"); cy.get("table tbody a").first().click(); });
  it("logs a call", () => {
    cy.contains("button", "Log call").click();
    cy.contains("button", "Save call").click();
    cy.contains(/Call logged for/).should("exist");
  });
  it("schedules a demo and rejects an out-of-hours time", () => {
    cy.contains("button", /Schedule demo|Schedule/).click();
    cy.get("input[name=time]").clear().type("07:00");
    cy.get("form").contains("button", /Schedule|Book/).click();
    cy.contains(/08:00 and 20:00|between 08:00/).should("exist");
  });
});
