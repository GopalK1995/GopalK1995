// Org audit viewer (demo data). Real-mode paging and RLS are covered by the unit tests with a mocked client.
describe("audit: org viewer", () => {
  beforeEach(() => { cy.loginAs("owner-lawsome"); cy.visit("/settings/audit"); });
  it("shows the append-only ledger with filters", () => {
    cy.contains("h1", "Audit log").should("be.visible");
    cy.get("table").should("exist");
    cy.contains("cannot be edited or deleted").should("be.visible");
    cy.get("input[name=actor]").should("exist");
    cy.get("input[name=action]").should("exist");
    cy.get("input[name=object]").should("exist");
    cy.get("input[name=from]").should("exist");
  });
  it("filters by source and shows the empty state when nothing matches", () => {
    cy.get("input[name=action]").type("no.such.action{enter}");
    cy.contains("No events match these filters").should("be.visible");
    cy.contains("a", "Clear filters").click();
    cy.get("table").should("exist");
  });
  it("flags support-session rows", () => {
    cy.get("select[name=source]").select("support");
    cy.contains("button", "Apply filters").click();
    cy.get("[aria-label='Written during a support session']").should("exist");
  });
  it("offers export to an owner", () => {
    cy.get("[data-testid=audit-export]").should("be.enabled");
  });
});
