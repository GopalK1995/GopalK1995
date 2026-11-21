// Staging only. Written, NOT run (light mode).
// Google Business Profile review replies: a reply is drafted, sent for approval, approved by a named person, and only then posted.
// Runs against the Showcase gateway (APP_ENV=demo, sandbox token) or a stub via GBP_REVIEWS_API_BASE. The page that mounts <ReviewsPanel>
// is wired by the integrator (not in T045's Owns); its path is passed in.
//   CYPRESS_GBP_REVIEWS_PATH = path of the page that mounts the panel (for example the inbox reviews tab)
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of the workspace (holds inbox.reply)
describe("connectors: Google Business Profile review approval", () => {
  const path = () => Cypress.expose("GBP_REVIEWS_PATH") as string | undefined;
  beforeEach(function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!path() || !email || !password) return this.skip();
    cy.loginReal({ email, password });
    cy.visit(path() as string);
  });

  it("offers no way to post a reply that has not been approved", () => {
    cy.get("[data-testid=review-card]").first().within(() => {
      cy.get("[data-testid=post-reply]").should("not.exist");
      cy.get("[data-testid=reply-status]").should("not.contain.text", "Posted");
    });
  });

  it("draft, send for approval, approve, post: each step visible in the status chip", () => {
    cy.get("[data-testid=review-card][data-reply-status=none]").first().as("card");
    cy.get("@card").find("[data-testid=draft-suggest]").click();
    cy.get("@card").find("[data-testid=reply-source]").should("be.visible");
    cy.get("@card").should("have.attr", "data-reply-status", "draft");
    cy.get("@card").find("[data-testid=reply-text]").clear().type("Thank you for the feedback, we appreciate it.");
    cy.get("@card").find("[data-testid=draft-save]").click();
    cy.get("@card").find("[data-testid=submit-approval]").click();
    cy.get("@card").should("have.attr", "data-reply-status", "pending_approval");
    cy.get("@card").find("[data-testid=post-reply]").should("not.exist");   // waiting for approval is not postable
    cy.get("@card").find("[data-testid=approve]").click();
    cy.get("@card").should("have.attr", "data-reply-status", "approved");
    cy.get("@card").find("[data-testid=reply-text]").should("have.attr", "readonly");
    cy.get("@card").find("[data-testid=post-reply]").click();
    cy.get("@card").should("have.attr", "data-reply-status", "posted");
  });

  it("editing an approved reply sends it back to draft", () => {
    cy.get("[data-testid=review-card][data-reply-status=approved]").first().as("card");
    cy.get("@card").find("[data-testid=edit-reply]").click();
    cy.get("@card").should("have.attr", "data-reply-status", "draft");
    cy.get("@card").find("[data-testid=post-reply]").should("not.exist");
  });
});
