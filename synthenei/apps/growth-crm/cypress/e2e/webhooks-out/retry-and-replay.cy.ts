// Outbound webhooks: delivery log states, retries and owner-only replay. Written, NOT run in light mode.
// Retry timing (30 s, 2 m, 10 m, 1 h, 6 h, 24 h), auto-disable and idempotent redelivery are covered by unit tests with a fake transport.
import { loginOrSkip, requireMode } from "./_helpers";
import { clickLinkUntilPath, clickUntil } from "../../support/retry-click";

describe("webhooks-out: delivery log and replay", () => {
  it("demo: the log shows delivered, retrying and gave-up rows with status, latency and next try", function () {
    requireMode(this, "demo");
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/webhooks");
    clickLinkUntilPath(() => cy.contains("tr", "hooks.example.com").contains("a", /delivery log/i), /\/settings\/webhooks\/demo-1$/);
    cy.contains("tr", "deal.won").within(() => { cy.contains(/delivered/i); cy.contains("200"); cy.contains("182 ms"); });
    cy.contains("tr", "lead.stage_changed").within(() => { cy.contains(/retrying/i); cy.contains("503"); });
    cy.contains("tr", "lead.created").contains(/gave up/i);
  });

  it("demo: filtering by status narrows the log and an empty filter shows the empty state", function () {
    requireMode(this, "demo");
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/webhooks/demo-1?status=dead");
    cy.contains("lead.created").should("be.visible");
    cy.contains("deal.won").should("not.exist");
    cy.visit("/settings/webhooks/demo-1?status=pending");
    cy.contains(/no deliveries yet/i).should("be.visible");
  });

  it("demo: owner replays a delivery after a confirmation and nothing is saved", function () {
    requireMode(this, "demo");
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/webhooks/demo-1");
    clickUntil(() => cy.contains("tr", "lead.created").contains("button", /^Replay$/), ($b) => $b.find("[role=dialog]").length > 0);
    cy.get("[role=dialog]").contains("button", /replay delivery/i).click();
    cy.contains(/nothing was saved/i).should("be.visible");
  });

  it("real: an unknown endpoint id shows the not-found state", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    cy.visit("/settings/webhooks/00000000-0000-4000-8000-000000000000");
    cy.contains(/no longer exists/i).should("be.visible");
  });
});
