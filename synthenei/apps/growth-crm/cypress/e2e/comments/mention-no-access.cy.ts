import { loginOrSkip, stamp } from "./_helpers";

// REP2 has no access to this lead (own scope). The autocomplete must not offer them and a typed mention must not be stored.
describe("mention of a user without read access", () => {
  it("does not list users who cannot open the record", function () {
    loginOrSkip(this, "OWNER");
    cy.visit("/leads");
    cy.get("table a[href^='/leads/']").first().click();
    cy.get("textarea[aria-label]").first().type(`${stamp()} @qa-rep2`);
    cy.get("[role=listbox]").should("contain.text", "No one who can read this record matches");
    cy.contains("button", /Post comment/i).click();
    cy.contains("[data-testid=comment]", "qa-rep2").find("[data-mention]").should("not.exist");
  });
});
