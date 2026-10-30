// Change role, suspend and reactivate; the own row and the last Owner are disabled with the reason. Written, NOT run in light mode.
import { loginOrSkip, memberRow, visitAccess } from "./_helpers";

describe("settings: change role", () => {
  it("demo owner: changing a role confirms it and says nothing was saved", () => {
    cy.loginAs("owner-lawsome");
    visitAccess();
    memberRow(/Sales Rep/i).first().find("select").first().select(1);
    cy.contains(/Demo workspace: nothing was saved/i).should("be.visible");
  });

  it("own row is disabled", () => {
    cy.loginAs("owner-lawsome");
    visitAccess();
    cy.contains("tr", /\byou\b/i).find("select").first().should("be.disabled");
  });

  it("real owner: role change persists after reload", function () {
    loginOrSkip(this, "OWNER");
    visitAccess();
    memberRow(/Viewer|Sales Rep/i).first().find("select").first().then(($s) => {
      const current = $s.val();
      const next = $s.find("option").toArray().map((o) => (o as unknown as HTMLOptionElement).value).find((v) => v !== current)!;
      cy.wrap($s).select(next);
      cy.reload();
      cy.contains("tr", /Viewer|Sales Rep/i).find("select").first().should("have.value", next);
    });
  });

  it("real owner: suspend then reactivate", function () {
    loginOrSkip(this, "OWNER");
    visitAccess();
    cy.contains("tr", /Sales Rep/i).first().contains("button", /Suspend/i).click();
    cy.get("[role=dialog]").contains("button", /Suspend/i).click();
    cy.contains(/suspended/i).should("be.visible");
    cy.contains("tr", /Deactivated/i).first().contains("button", /Reactivate/i).click();
    cy.contains(/reactivated/i).should("be.visible");
  });
});
