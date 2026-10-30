// Policy editor on the tenant page. Demo mode: validates and reports; the diff-and-audit path is unit tested
// (src/app/admin/__tests__/actions.test.ts) and runs against the real RPC on staging.
describe("admin: org-admin policy", () => {
  beforeEach(() => { cy.loginAs("super"); cy.visit("/admin/tenants/lawsome"); cy.contains("[role=tab]", "Org-admin policy").click(); });
  it("shows the toggles, caps, module and connector pickers", () => {
    cy.contains("What org admins may do").should("be.visible");
    cy.contains("label", "API keys").should("be.visible");
    cy.contains("label", "Seat cap").should("be.visible");
  });
  it("requires a reason of at least 8 characters", () => {
    cy.contains("label", "API keys").find("input").uncheck();
    cy.contains("button", "Save policy").click();
    cy.contains("at least 8 characters").should("be.visible");
  });
  it("saves with a reason", () => {
    cy.contains("label", "API keys").find("input").uncheck();
    cy.get("input[placeholder^='e.g. Pilot']").type("Pilot contract excludes API access");
    cy.contains("button", "Save policy").click();
    cy.contains("Would save the org-admin policy").should("be.visible");
  });
  it("lists the connector availability matrix with editable cells", () => {
    cy.visit("/admin/connectors");
    cy.get("table").should("contain.text", "WhatsApp Business");
    cy.get("select[aria-label^='WhatsApp Business mode in production']").should("be.visible");
  });
});
