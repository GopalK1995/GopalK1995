// Teams with managers: empty state, create, add a person, mark a manager, delete. Written, NOT run in light mode.
import { loginOrSkip, stamp, visitAccess } from "./_helpers";

describe("settings: teams", () => {
  it("empty state invites the first team (demo)", () => {
    cy.loginAs("owner-lawsome");
    visitAccess("teams");
    cy.contains(/No teams yet/i).should("be.visible");
  });

  it("real owner: create a team, add a person, make them manager, delete the team", function () {
    loginOrSkip(this, "OWNER");
    visitAccess("teams");
    const name = `South ${stamp()}`;
    cy.contains("button", /New team/i).click();
    cy.get("[role=dialog] input").first().type(name);
    cy.get("[role=dialog]").contains("button", /^Save$/).click();
    cy.contains("li", name).as("team");
    cy.get("@team").find("select").first().select(1);
    cy.get("@team").contains("button", /Add person/i).click();
    cy.get("@team").contains("button", /Make manager/i).click();
    cy.get("@team").contains(/Manager/).should("exist");
    cy.get("@team").contains("button", /Delete team/i).click();
    cy.get("[role=dialog]").contains("button", /Delete team/i).click();
    cy.contains("li", name).should("not.exist");
  });
});
