// Staging only: emit a test event from the ops console and watch the drainer process it. Needs a platform-admin
// session on staging; written but not run in light mode.
describe("ops queue console", () => {
  it("shows an emitted test event as processed within 20 s", () => {
    cy.visit("/admin/ops");
    cy.get("[data-testid=ops-queues]").should("be.visible");
    cy.get("[data-testid=ops-emit-test]").click();
    const deadline = Date.now() + 20_000;
    const poll = (): void => {
      cy.reload();
      cy.get("[data-testid=ops-runs]").then(($t) => {
        const done = /event\.fanout\s*succeeded/.test($t.text());
        if (done || Date.now() > deadline) {
          expect(done, "event.fanout run succeeded").to.eq(true);
        } else {
          cy.wait(2000);
          poll();
        }
      });
    };
    poll();
  });
});
