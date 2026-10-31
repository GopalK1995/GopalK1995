import { loginOrSkip, stamp } from "./_helpers";

describe("comments: post, mention, edit window", () => {
  it("posts a comment that mentions a teammate who can read the lead", function () {
    loginOrSkip(this, "OWNER");
    cy.visit("/leads");
    cy.get("table a[href^='/leads/']").first().click();
    const text = stamp();
    cy.get("textarea[aria-label]").type(`${text} @`);
    cy.get("[role=listbox] [role=option]").first().click();
    cy.contains("button", /Post comment/i).click();
    cy.contains("[data-testid=comment]", text).should("be.visible");
    cy.contains("[data-testid=comment]", text).find("[data-mention]").should("exist");
  });
  it("lets the author edit and delete inside the 15 minute window", function () {
    loginOrSkip(this, "OWNER");
    cy.visit("/leads");
    cy.get("table a[href^='/leads/']").first().click();
    const text = stamp();
    cy.get("textarea[aria-label]").first().type(text);
    cy.contains("button", /Post comment/i).click();
    cy.contains("[data-testid=comment]", text).contains("button", /^Edit$/).click();
    cy.contains("button", /^Save$/).click();
    cy.contains("[data-testid=comment]", text).contains("button", /^Delete$/).click();
    cy.contains("[data-testid=comment]", text).should("not.exist");
  });
});
