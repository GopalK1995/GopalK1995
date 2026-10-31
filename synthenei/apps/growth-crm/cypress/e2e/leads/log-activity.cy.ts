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
    // The browser's own min/max (08:00 to 20:00) blocks the submit before the server's "between 08:00 and 20:00" message; assert that guard.
    cy.get("input[name=time]").then(($i) => { expect(($i[0] as HTMLInputElement).validity.rangeUnderflow, "07:00 is before the 08:00 minimum").to.eq(true); });
    cy.contains(/Demo workspace: nothing was saved|Demo scheduled/i).should("not.exist");
  });
});
