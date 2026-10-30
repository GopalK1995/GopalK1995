// Support sessions: reasoned, time-boxed, banner shown, never-list visible. Real RPC path is unit tested; run on staging with a real super user.
describe("admin: support session", () => {
  beforeEach(() => { cy.loginAs("super"); cy.visit("/admin/support"); });
  it("blocks a short reason and lists the blocked actions", () => {
    cy.contains("Never allowed in a support session").should("be.visible");
    cy.contains("Export CSV").should("be.visible");
    cy.get("textarea[name=reason]").type("too short");
    cy.contains("button", "Start session and open workspace").should("be.disabled");
  });
  it("opens a read-only session with the amber banner and ends it", () => {
    cy.get("textarea[name=reason]").type("Ticket 142: CSV import failing for Madurai leads");
    cy.contains("button", "Start session and open workspace").click();
    cy.location("pathname", { timeout: 60000 }).should("eq", "/");
    cy.contains("Support").should("be.visible");
    cy.visit("/admin/support");
    cy.contains("button", "End now").click();
    cy.contains("Support session ended").should("be.visible");
  });
  it("read-write needs a second reason", () => {
    cy.contains("Read-write").click();
    cy.get("textarea[name=reason]").type("Ticket 142: CSV import failing for Madurai leads");
    cy.contains("button", "Start session and open workspace").should("be.disabled");
    cy.get("input[name=reason2]").type("Owner asked us to fix 2 rows");
    cy.contains("button", "Start session and open workspace").should("be.enabled");
  });
});
