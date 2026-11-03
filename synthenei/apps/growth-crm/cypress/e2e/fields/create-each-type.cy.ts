// T030 (written by the author, NOT run; the integrator runs it at the gate). Demo owner: every field type can be filled in
// the editor and the save says nothing was stored. Real-mode persistence is covered by the unit tests with mocked clients.
const TYPES: [string, string][] = [
  ["Text", "Where we met"], ["Long text", "Site notes"], ["Number", "Seats"], ["Currency (INR)", "Budget"], ["Date", "Site visit date"],
  ["Date and time (IST)", "Demo slot"], ["Yes or no", "Is a repeat guest"], ["Web link", "Brochure link"], ["Email", "Alternate email"],
  ["Phone (E.164)", "Alternate phone"], ["Person", "Second owner"],
];

describe("custom fields: create each type", () => {
  beforeEach(() => { cy.loginAs("owner-lawsome"); cy.visit("/settings/fields"); });

  it("shows the labelled example fields of the demo workspace", () => {
    cy.contains("h1, h2", "Custom fields").should("exist");
    cy.contains("Demo workspace").should("exist");
    cy.contains("Example: priority").should("exist");
  });

  TYPES.forEach(([type, label]) => {
    it(`creates a ${type} field`, () => {
      cy.contains("button", "Add field").click();
      cy.get("[role=dialog]").within(() => {
        cy.get("input").first().type(label);
        cy.contains("label", "Type").parent().find("[role=combobox]").click();
      });
      cy.get("[role=option]").contains(type).click();
      cy.get("[role=dialog]").contains("button", "Add field").click();
      cy.contains("Demo workspace: nothing was saved").should("exist");
    });
  });

  it("creates a single-choice field with coloured options", () => {
    cy.contains("button", "Add field").click();
    cy.get("[role=dialog]").within(() => {
      cy.get("input").first().type("Lead temperature");
      cy.contains("label", "Type").parent().find("[role=combobox]").click();
    });
    cy.get("[role=option]").contains("Single choice").click();
    cy.get("[role=dialog]").within(() => {
      cy.contains("button", "Add option").click();
      cy.get("fieldset input").first().type("Hot");
      cy.contains("button", "Add field").click();
    });
    cy.contains("Demo workspace: nothing was saved").should("exist");
  });

  it("the editor is keyboard operable: Escape closes it without saving", () => {
    cy.contains("button", "Add field").click();
    cy.get("[role=dialog]").should("be.visible");
    cy.get("body").type("{esc}");
    cy.get("[role=dialog]").should("not.exist");
  });
});
