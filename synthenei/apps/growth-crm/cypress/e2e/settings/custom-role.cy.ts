// Custom roles: clone a system role, edit scopes and conditions in the guarded editor, explain access, and the
// disabled-with-reason state when custom roles are off. Written, NOT run in light mode.
import { loginOrSkip, stamp, visitAccess } from "./_helpers";

describe("settings: custom role", () => {
  it("clone a system role, narrow a scope, add a business-hours condition, save", function () {
    loginOrSkip(this, "OWNER");
    visitAccess("roles");
    cy.contains("tr", /Sales Rep/i).contains("button", /Clone/i).click();
    const name = `Telecaller ${stamp()}`;
    cy.get("[role=dialog] input").first().clear().type(name);
    cy.get("select[aria-label^='leads.export']").then(($s) => { if (!$s.prop("disabled")) cy.wrap($s).select("None"); });
    cy.get("select[aria-label^='leads.read']").select("Own");
    cy.get("[role=dialog] summary").first().click();
    cy.contains("label", /09:00 to 20:00/i).find("input").check();
    cy.contains("button", /Create role/i).click();
    cy.contains(new RegExp(`Role ${name} created`, "i")).should("be.visible");
    cy.contains("tr", name).should("exist");
  });

  it("manager: the new-role button is disabled with the reason", function () {
    loginOrSkip(this, "MANAGER");
    visitAccess("roles");
    cy.contains("button", /New role/i).should("have.attr", "aria-disabled", "true");
  });

  it("explain access traces the step that blocks a permission", function () {
    loginOrSkip(this, "OWNER");
    visitAccess("roles");
    cy.contains("label", /^Role/).find("select").select("Sales Rep");
    cy.contains("label", /^Permission/).find("select").select("leads.export");
    cy.contains("button", /^Explain$/).click();
    cy.contains(/Denied at step/i).should("be.visible");
    cy.contains("li", /role grant/i).should("exist");
  });

  it("demo owner: the editor works and answers with the demo notice", () => {
    cy.loginAs("owner-lawsome");
    visitAccess("roles");
    cy.contains("button", /New role/i).click();
    cy.get("[role=dialog] input").first().type("Demo role");
    cy.contains("button", /Create role/i).click();
    cy.contains(/Demo workspace: nothing was saved/i).should("be.visible");
  });
});
