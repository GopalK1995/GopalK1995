// Session A (browser) is on the board; session B (REP2, headless via PostgREST) moves a deal; A's board updates in under 3 s
// without a reload, through an id-only broadcast and a refetch. Needs the staging branch DB with realtime enabled and the
// board wired to useLiveList (integration point in docs/tasks/T026.md). Skipped when QA_MANAGER / QA_REP2 are not set. Written, NOT run.
import { apikey, loginOrSkip, peerToken, rest } from "./_helpers";

describe("realtime: live update", () => {
  beforeEach(function () {
    loginOrSkip(this, "MANAGER");
    if (!Cypress.expose("QA_REP2_EMAIL")) this.skip();
  });

  it("a deal moved by a colleague appears on my board within 3 s", () => {
    cy.visit("/pipeline");
    cy.get("[data-stage] li", { timeout: 30000 }).should("exist");
    peerToken("REP2").then((token) => {
      const headers = { apikey: apikey(), Authorization: `Bearer ${token}` };
      cy.request({ url: rest("deals?select=id,stage_id,version&deleted_at=is.null&limit=1"), headers }).then(({ body }) => {
        const deal = body[0];
        cy.request({ url: rest("pipeline_stages?select=id&id=neq." + deal.stage_id + "&limit=1"), headers }).then(({ body: stages }) => {
          cy.request({ method: "PATCH", url: rest(`deals?id=eq.${deal.id}&version=eq.${deal.version}`), headers: { ...headers, Prefer: "return=representation" }, body: { stage_id: stages[0].id } });
          cy.get(`[data-deal-id='${deal.id}']`, { timeout: 3000 }).closest("[data-stage]").should("not.have.attr", "data-stage-id", deal.stage_id);
        });
      });
    });
  });
});
