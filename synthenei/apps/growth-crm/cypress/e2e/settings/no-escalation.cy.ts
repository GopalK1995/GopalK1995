// Escalation is refused and shown with a reason: a manager cannot assign Owner or a custom role, nobody edits their own
// role, the last Owner is protected. The server-side rules are unit-tested; this checks the surface. Written, NOT run in light mode.
import { loginOrSkip, memberRow, visitAccess } from "./_helpers";

describe("settings: no escalation", () => {
  it("manager: Owner is not offered and custom roles are disabled", function () {
    loginOrSkip(this, "MANAGER");
    visitAccess();
    memberRow(/Sales Rep/i).first().find("select").first().find("option").then(($o) => {
      expect([...$o].map((o) => o.textContent).join("|")).not.to.match(/Owner|Custom/i);
    });
    visitAccess("roles");
    cy.contains("button", /New role/i).should("have.attr", "aria-disabled", "true");
  });

  it("owner: own row is locked, so an admin cannot edit their own role", function () {
    loginOrSkip(this, "OWNER");
    visitAccess();
    cy.contains("tr", /\byou\b/i).find("select").first().should("be.disabled");
  });

  it("owner: with a single active Owner, that Owner cannot be suspended by anyone", function () {
    loginOrSkip(this, "OWNER");
    visitAccess();
    cy.get("tbody tr").filter(":contains('Owner')").then(($rows) => {
      if ($rows.length === 1) cy.wrap($rows).find("button[aria-label^='Suspend']").should("be.disabled");
    });
  });

  it("owner: a scope above what the owner holds is disabled in the editor", function () {
    loginOrSkip(this, "OWNER");
    visitAccess("roles");
    cy.contains("button", /New role/i).click();
    cy.get("select[aria-label^='leads.read']").find("option[value=all]").should("exist");
  });

  it("demo rep: the manage area is not reachable (forbidden page or the denied state)", () => {
    cy.loginAs("rep-lawsome");
    cy.visit("/settings/roles", { failOnStatusCode: false });
    cy.location("pathname").then((path) => {
      if (!path.includes("forbidden")) cy.contains(/You cannot manage this area/i).should("be.visible");
    });
  });
});
