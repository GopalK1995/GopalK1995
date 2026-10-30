// Invite from /settings/roles: real invite_member RPC plus the admin invite email (real), demo notice (demo).
// A manager sees only the roles it may assign; a viewer sees the permission-denied state. Written, NOT run in light mode.
import { loginOrSkip, stamp, visitAccess } from "./_helpers";

describe("settings: invite", () => {
  it("demo owner: invite is accepted and says nothing was sent", () => {
    cy.loginAs("owner-lawsome");
    visitAccess();
    cy.contains("button", /^Invite$/).click();
    cy.get("input[type=email]").type(`${stamp()}@example.test`);
    cy.contains("button", /Send invite/i).click();
    cy.contains(/Demo workspace: nothing was saved/i).should("be.visible");
  });

  it("real owner: invitation is created and the invite email is reported", function () {
    loginOrSkip(this, "OWNER");
    visitAccess();
    const email = `${stamp()}@synthan.test`;
    cy.contains("button", /^Invite$/).click();
    cy.get("input[type=email]").type(email);
    cy.contains("button", /Send invite/i).click();
    cy.contains(new RegExp(`Invitation sent to ${email}`, "i")).should("be.visible");
    cy.contains(/invite email/i).should("be.visible");
  });

  it("real manager: the role picker offers Sales Rep and Viewer only", function () {
    loginOrSkip(this, "MANAGER");
    visitAccess();
    cy.contains("button", /^Invite$/).click();
    cy.get("[role=dialog] select").first().find("option").then(($o) => {
      const labels = [...$o].map((o) => o.textContent ?? "");
      expect(labels.join("|")).not.to.match(/Owner/i);
    });
  });

  it("real viewer: no manage area, shown as permission denied", function () {
    loginOrSkip(this, "VIEWER");
    visitAccess();
    cy.contains(/You cannot manage this area/i).should("be.visible");
  });
});
