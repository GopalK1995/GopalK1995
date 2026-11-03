// T030 (written by the author, NOT run). Editor validation and the required flag, in a demo workspace.
describe("custom fields: validation", () => {
  beforeEach(() => { cy.loginAs("owner-lawsome"); cy.visit("/settings/fields"); });

  it("an empty label is refused with a message next to the field", () => {
    cy.contains("button", "Add field").click();
    cy.get("[role=dialog]").contains("button", "Add field").click();
    cy.get("[role=dialog]").contains("Enter a label").should("exist");
  });

  it("a single-choice field needs at least one option", () => {
    cy.contains("button", "Add field").click();
    cy.get("[role=dialog]").within(() => {
      cy.get("input").first().type("Pick one");
      cy.contains("label", "Type").parent().find("[role=combobox]").click();
    });
    cy.get("[role=option]").contains("Single choice").click();
    cy.get("[role=dialog]").contains("button", "Add field").click();
    cy.get("[role=dialog]").contains("Add at least one option").should("exist");
  });

  it("a key with capitals or spaces is refused", () => {
    cy.contains("button", "Add field").click();
    cy.get("[role=dialog]").within(() => {
      cy.get("input").first().type("Bad one");
      cy.contains("label", "Key").parent().find("input").clear().type("Bad Key");
      cy.contains("button", "Add field").click();
      cy.contains("lowercase letters").should("exist");
    });
  });

  it("retiring a field asks for a reason of at least 8 characters", () => {
    cy.contains("button", "Retire").first().click();
    cy.get("[role=dialog]").within(() => {
      cy.contains("button", "Retire field").should("be.disabled");
      cy.get("textarea").type("too short");
      cy.contains("button", "Retire field").should("not.be.disabled");
    });
  });

  it("rep without fields.manage gets the explained no-access page, not a broken page", () => {
    cy.loginAs("rep-lawsome");
    // The role page matrix 403s /settings for a rep (middleware rewrite to the no-access page) before the page's own denied state.
    cy.visit("/settings/fields", { failOnStatusCode: false });
    cy.contains("cannot open").should("exist");
    cy.contains("button", "Add field").should("not.exist");
  });
});
