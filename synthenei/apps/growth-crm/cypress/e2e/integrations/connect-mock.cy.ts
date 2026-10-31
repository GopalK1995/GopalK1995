// Staging only: connect the built-in mock connector as the Owner, see it as Sandbox (never Connected), test it, disconnect it.
// Needs the qa-owner identity and a catalogue row + availability for "mock" on the branch DB (see docs/tasks/T022.md). Written, NOT run in light mode.
import { loginOrSkip } from "../settings/_helpers";

describe("integrations: connect the mock connector", () => {
  it("connects in sandbox, never claims Connected, tests and disconnects", function () {
    loginOrSkip(this, "OWNER");
    cy.visit("/integrations/mock");
    cy.get("[data-chip]").first().should("have.attr", "data-chip", "available");
    cy.get("input[name=api_key]").type("mock-key-ok", { log: false });
    cy.contains("button", "Connect").click();
    cy.get("[data-chip]").first({ timeout: 20000 }).should("have.attr", "data-chip", "sandbox");
    cy.contains("Sandbox: not sending to real customers").should("be.visible");
    cy.get("[data-chip=connected]").should("not.exist");
    cy.document().its("body").should("not.contain.text", "mock-key-ok");
    cy.contains("button", "Test connection").click();
    cy.contains("Connection works").should("be.visible");
    cy.contains("button", "Disconnect").click();
    cy.get("[role=dialog]").contains("button", "Disconnect").click();
    cy.get("[data-chip]").first({ timeout: 20000 }).should("have.attr", "data-chip", "disconnected");
  });
  it("rejects a wrong key without storing anything", function () {
    loginOrSkip(this, "OWNER");
    cy.visit("/integrations/mock");
    cy.get("input[name=api_key]").type("wrong-key", { log: false });
    cy.contains("button", "Connect").click();
    cy.contains("The vendor rejected these credentials.").should("be.visible");
    cy.get("[data-chip]").first().should("have.attr", "data-chip", "available");
  });
});
