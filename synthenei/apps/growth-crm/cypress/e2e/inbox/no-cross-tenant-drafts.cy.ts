// The Tamil sample drafts are legal-vertical demo copy keyed by conversation id; no other tenant may ever see them.
describe("inbox: no cross-tenant drafts", () => {
  it("hospitality workspace shows no Tamil draft toggle and no Tamil text in the inbox", () => {
    cy.loginAs("owner-kaveri");
    cy.visit("/inbox");
    cy.get("[data-cy=conversation-row]").each(($row) => {
      cy.wrap($row).click();
      cy.contains("தமிழ்").should("not.exist");
    });
    cy.get("body").invoke("text").should("not.match", /[஀-௿]/);
  });
  it("hospitality workspace never shows legal words in the inbox", () => {
    cy.loginAs("owner-kaveri");
    cy.visit("/inbox");
    cy.get("main").invoke("text").should("not.match", /\b(advocate|lawyer|court|chambers)\b/i);
  });
});
