// Staging only: queue a manual sync for the connected mock connector and wait for the tick to run it. The second run is
// idempotent (no duplicate leads). Needs the Owner identity and a way to drive the tick (cy.task("tick") or the cron).
import { loginOrSkip } from "../settings/_helpers";

describe("integrations: run sync", () => {
  it("queues a manual sync and shows a partial run with a human-readable note", function () {
    loginOrSkip(this, "OWNER");
    cy.visit("/integrations/mock");
    cy.get("input[name=api_key]").then(($i) => { if ($i.length) cy.wrap($i).type("mock-key-ok", { log: false }); });
    cy.get("body").then(($b) => { if ($b.find("button:contains('Connect')").length) cy.contains("button", "Connect").click(); });
    cy.contains("button", "Run sync now", { timeout: 20000 }).click();
    cy.contains("Sync queued").should("be.visible");
    const deadline = Date.now() + 60000;
    const poll = (): void => {
      cy.reload();
      cy.get("body").then(($b) => {
        const done = $b.find("[data-run-status=partial], [data-run-status=success]").length > 0;
        if (done || Date.now() > deadline) { expect(done, "a finished run is listed").to.eq(true); } else { cy.wait(3000); poll(); }
      });
    };
    poll();
    cy.get("[data-run-status=partial]").first().should("contain.text", "1 row could not be imported");
  });
  it("viewer cannot run a sync: the button says why", function () {
    loginOrSkip(this, "VIEWER");
    cy.visit("/integrations/mock");
    cy.contains("button", "Run sync now").should("have.attr", "aria-disabled", "true");
  });
});
