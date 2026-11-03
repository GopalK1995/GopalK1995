// The Tamil sample drafts are legal-vertical demo copy keyed by conversation id; no other tenant may ever see them.
describe("inbox: no cross-tenant drafts", () => {
  it("hospitality workspace shows no Tamil draft toggle and no Tamil text in the inbox", () => {
    cy.loginAs("owner-shola");
    cy.visit("/inbox");
    // Re-query per index: opening a conversation re-renders the list, so a held row element goes stale.
    cy.get("[data-cy=conversation-row]").its("length").then((n) => {
      for (let i = 0; i < n; i++) {
        cy.get("[data-cy=conversation-row]").eq(i).click();
        cy.contains("தமிழ்").should("not.exist");
      }
    });
    cy.get("body").invoke("text").should("not.match", /[஀-௿]/);
  });
  it("hospitality workspace never shows legal words in the inbox", () => {
    cy.loginAs("owner-shola");
    cy.visit("/inbox");
    cy.get("main").invoke("text").should("not.match", /\b(advocate|lawyer|court|chambers)\b/i);
  });
});
