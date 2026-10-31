// Needs a build with NEXT_PUBLIC_TAMIL_UI=1 (Tamil UI is off by default until reviewed); run it with CYPRESS_TAMIL_UI=1, otherwise the Tamil test skips.
describe("i18n: switch language", () => {
  it("defaults to English", () => {
    cy.loginAs("rep-lawsome");
    cy.visit("/");
    cy.get("html").should("have.attr", "lang", "en-IN");
  });

  (Cypress.expose("TAMIL_UI") === "1" ? it : it.skip)("renders Tamil with no horizontal overflow at 390px", () => {
    cy.viewport(390, 844);
    cy.loginAs("rep-lawsome");
    cy.setCookie("gcrm_lang", "ta");
    cy.visit("/");
    cy.get("html").should("have.attr", "lang", "ta-IN");
    cy.document().then((doc) => {
      expect(doc.documentElement.scrollWidth, "no horizontal overflow").to.be.at.most(doc.documentElement.clientWidth);
    });
  });
});
