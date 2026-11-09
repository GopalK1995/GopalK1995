// T040 (written by the author, NOT run). Every record page with a detail view carries the collaboration block (follow, comments,
// activity) and a presence slot. A second live viewer needs the presence task from T026 (skipped without it, like realtime/presence).
import { clickLinkUntilPath } from "../../support/retry-click";

describe("record pages: collaboration and presence", () => {
  beforeEach(() => { cy.loginAs("owner-lawsome"); });

  it("lead detail has follow and comments", () => {
    cy.visit("/leads");
    clickLinkUntilPath(() => cy.get("main table tbody a").first(), /^\/leads\/[^/]+$/);
    cy.get("main").contains("button", /follow/i).should("exist");
    cy.get("main").contains(/comments?/i).should("exist");
  });

  it("account detail has follow and comments", () => {
    cy.visit("/accounts");
    clickLinkUntilPath(() => cy.get("main table tbody a, main ul a").first(), /^\/accounts\/[^/]+$/);
    cy.get("main").contains("button", /follow/i).should("exist");
  });

  it("campaign detail has follow and comments", () => {
    cy.visit("/campaigns");
    clickLinkUntilPath(() => cy.get("main table tbody a, main ul a").first(), /^\/campaigns\/[^/]+$/);
    cy.get("main").contains("button", /follow/i).should("exist");
    cy.get("main").contains(/comments?/i).should("exist");
  });

  it("a colleague's face appears on the lead page", function () {
    if (!Cypress.expose("QA_HAS_PRESENCE_TASK")) this.skip();
    cy.visit("/leads");
    cy.get("main table tbody a").first().click();
    cy.task("presencePeer", { who: "REP", scope: "record", action: "join" });
    cy.get("[data-testid=presence-faces]", { timeout: 15000 }).should("have.attr", "data-count", "1");
  });
});
