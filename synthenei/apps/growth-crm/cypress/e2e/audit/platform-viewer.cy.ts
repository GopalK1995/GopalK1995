describe("audit: platform viewer", () => {
  beforeEach(() => { cy.loginAs("super"); cy.visit("/admin/audit"); });
  it("lists events across tenants with tenant and workspace filters", () => {
    cy.contains("h1", "Audit log").should("be.visible");
    cy.get("table").should("exist");
    cy.get("input[name=tenant]").should("exist");
    cy.get("input[name=workspace]").should("exist");
  });
  it("highlights rows written during a support session", () => {
    cy.get("[aria-label='Written during a support session']").should("exist");
    cy.contains("Support-session activity").should("be.visible");
  });
  it("masks personal data in the target text", () => {
    cy.get("table").invoke("text").should("not.match", /[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i);
  });
  it("tenant page Audit tab links to the platform log", () => {
    cy.visit("/admin/tenants/lawsome");
    cy.contains("[role=tab]", "Audit").click();
    cy.contains("a", "Open in audit log").should("have.attr", "href").and("include", "/admin/audit");
  });
});
