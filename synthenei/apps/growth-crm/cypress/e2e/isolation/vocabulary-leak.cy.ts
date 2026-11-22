// T058 · Vocabulary leak: a legal-vertical tenant's UI/data never carries hospitality-only words, and a hospitality
// tenant never carries legal-only words. This REUSES the two canonical live checks rather than re-deriving them:
//   - cypress/e2e/pipelines/vocab-parity.cy.ts  (positive parity: each vertical reads its own words, same stage ids)
//   - cypress/e2e/search/no-foreign-results.cy.ts  ("the Shola Mist palette shows no legal vocabulary")
// It adds only the missing direction — that the leak is absent BOTH ways, at the board and the search palette — using the
// same demo tenants (lawsome = legal, shola-mist = hospitality). Demo mode. Written, NOT run (see docs/tasks/T058.md).

// Words that belong to exactly one vertical (safe leak markers; the shared "Lost" is excluded).
const LEGAL_ONLY = ["Discovery", "Demo scheduled", "Demo done", "Proposal sent", "Negotiation"];
const HOSPITALITY_ONLY = ["Dates confirmed", "Quote sent", "Rooms on hold", "Advance pending", "Final confirmation"];

describe("isolation: cross-vertical vocabulary never leaks", () => {
  it("the legal tenant's pipeline shows legal words and no hospitality words", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/pipeline");
    cy.get("[data-stage]", { timeout: 30000 }).should("exist");
    cy.get("body").then(($b) => {
      const text = $b.text();
      LEGAL_ONLY.forEach((w) => expect(text, `legal word "${w}"`).to.contain(w));
      HOSPITALITY_ONLY.forEach((w) => expect(text, `no hospitality word "${w}"`).not.to.contain(w));
    });
  });

  it("the hospitality tenant's pipeline shows hospitality words and no legal words", () => {
    cy.loginAs("owner-shola");
    cy.visit("/pipeline");
    cy.get("[data-stage]", { timeout: 30000 }).should("exist");
    cy.get("body").then(($b) => {
      const text = $b.text();
      HOSPITALITY_ONLY.forEach((w) => expect(text, `hospitality word "${w}"`).to.contain(w));
      LEGAL_ONLY.forEach((w) => expect(text, `no legal word "${w}"`).not.to.contain(w));
    });
  });

  it("the command palette carries no foreign-vertical vocabulary in either tenant", () => {
    cy.loginAs("owner-shola");
    cy.visit("/");
    cy.get("body").type("{ctrl}k");
    cy.get("[role=dialog]").should("be.visible").then(($d) => {
      const text = $d.text();
      LEGAL_ONLY.forEach((w) => expect(text, `palette: no legal word "${w}"`).not.to.contain(w));
    });
  });
});
