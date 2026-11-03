// T030 (written by the author, NOT run). A viewer never receives a personal-data custom value. The record-page checks
// activate once T040 mounts <CustomFields/> on the lead page (they skip while data-testid=custom-fields is absent).
describe("custom fields: personal data stays hidden", () => {
  it("a viewer cannot open the field editor", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/settings/fields");
    cy.contains("You cannot manage custom fields").should("exist");
  });

  it("the demo example phone (personal data) is not in the page source for a viewer", function () {
    cy.loginAs("viewer-lawsome");
    cy.visit("/leads");
    cy.get("[data-row] a, tbody a").first().click();
    cy.get("body").then(($b) => {
      if (!$b.find("[data-testid=custom-fields]").length) this.skip();
    });
    cy.get("[data-testid=custom-fields]").should("exist");
    cy.get("[data-testid=custom-fields]").should("not.contain.text", "alternate phone");
    cy.document().then((d) => expect(d.documentElement.outerHTML).not.to.contain("example_alt_phone"));
  });

  it("the same page for an owner lists the field", function () {
    cy.loginAs("owner-lawsome");
    cy.visit("/leads");
    cy.get("[data-row] a, tbody a").first().click();
    cy.get("body").then(($b) => {
      if (!$b.find("[data-testid=custom-fields]").length) this.skip();
    });
    cy.get("[data-testid=custom-fields]").contains("alternate phone").should("exist");
  });
});
