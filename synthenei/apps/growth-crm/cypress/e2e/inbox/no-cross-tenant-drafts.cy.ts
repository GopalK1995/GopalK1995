// The Tamil sample drafts are legal-vertical demo copy keyed by conversation id; no other tenant may ever see them.
describe("inbox: no cross-tenant drafts", () => {
  it("hospitality workspace shows no Tamil draft toggle and no legal-vertical Tamil drafts", () => {
    cy.loginAs("owner-shola");
    cy.visit("/inbox");
    // Hospitality guests legitimately write in Tamil, so Tamil text alone is fine. What must not leak is the
    // legal-vertical Tamil draft toggle (Segmented "Draft language") and the legal sample drafts (TAMIL_DRAFTS).
    // Re-query per index: opening a conversation re-renders the list, so a held row element goes stale.
    cy.get("[data-cy=conversation-row]").its("length").then((n) => {
      for (let i = 0; i < n; i++) {
        cy.get("[data-cy=conversation-row]").eq(i).click();
        cy.get("main").within(() => {
          cy.get("[role=radiogroup][aria-label='Draft language']").should("not.exist");
          cy.contains("[role=radio]", "தமிழ்").should("not.exist");
          cy.contains("Check translation").should("not.exist");
        });
      }
    });
    // Distinctive fragments of the legal Tamil drafts (CV-71 / CV-72): case numbers, hearing list, advocate seats.
    cy.get("main").invoke("text").should("not.match", /வழக்கு எண்கள்|வழக்கறிஞர் இருக்கைகளுக்கு|விசாரணைப் பட்டியல்/);
  });
  it("hospitality workspace never shows legal words in the inbox", () => {
    cy.loginAs("owner-shola");
    cy.visit("/inbox");
    cy.get("main").invoke("text").should("not.match", /\b(advocate|lawyer|court|chambers)\b/i);
  });
});
