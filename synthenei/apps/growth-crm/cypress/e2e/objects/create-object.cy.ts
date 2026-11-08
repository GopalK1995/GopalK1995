// T033 (written by the author, NOT run; the integrator runs it at the gate). Demo workspace: the owner can create a custom object
// (labels, icon, primary field), the key is derived and shown, a reserved word is renamed, the save says nothing was stored, and
// the example object appears in the sidebar. Real-mode persistence is covered by the unit tests with mocked clients.
import { clickUntil } from "../../support/retry-click";

describe("custom objects: create", () => {
  beforeEach(() => { cy.loginAs("owner-lawsome"); cy.visit("/settings/objects"); });

  it("lists the labelled example object with its key and links", () => {
    cy.get("main").contains("h1, h2", "Custom objects").should("exist");
    cy.get("main").contains("Demo workspace").should("exist");
    cy.get("main").contains("tr", "Example items").within(() => {
      cy.contains("example_items").should("exist");
      cy.contains("a", "Fields").should("have.attr", "href", "/settings/fields?object=example_items");
      cy.contains("a", "Layouts").should("have.attr", "href", "/settings/layouts?object=example_items");
      cy.contains("a", "Open").should("have.attr", "href", "/o/example_items");
    });
  });

  it("creates an object: the key preview follows the name and the save says nothing was stored", () => {
    clickUntil(() => cy.get("main").contains("button", "Create object"), ($b) => $b.find("[role=dialog]").length > 0);
    cy.get("[role=dialog]").within(() => {
      cy.contains("label", "Name (singular, English)").parent().find("input").type("Site visit");
      cy.contains("Key: site_visit").should("exist");
      cy.contains("label", "Name (plural, English)").parent().find("input").type("Site visits");
      cy.contains("label", "Name (singular, Tamil)").parent().find("input").type("தளப் பார்வை");
      cy.contains("label", "Icon").parent().find("[role=combobox]").click();
    });
    cy.get("[role=option]").contains("Building").click();
    cy.get("[role=dialog]").within(() => {
      cy.contains("label", "Main field label (English)").parent().find("input").should("have.value", "Name");
      cy.contains("button", "Create object").click();
    });
    cy.contains("Demo workspace: nothing was saved").should("exist");
  });

  it("a reserved word gets a different key instead of failing", () => {
    clickUntil(() => cy.get("main").contains("button", "Create object"), ($b) => $b.find("[role=dialog]").length > 0);
    cy.get("[role=dialog]").within(() => {
      cy.contains("label", "Name (singular, English)").parent().find("input").type("Deal");
      cy.contains("Key: x_deal").should("exist");
    });
  });

  it("the create button stays disabled until the names are filled in", () => {
    clickUntil(() => cy.get("main").contains("button", "Create object"), ($b) => $b.find("[role=dialog]").length > 0);
    cy.get("[role=dialog]").contains("button", "Create object").should("be.disabled");
  });

  it("Escape closes the dialog without saving", () => {
    clickUntil(() => cy.get("main").contains("button", "Create object"), ($b) => $b.find("[role=dialog]").length > 0);
    cy.get("body").type("{esc}");
    cy.get("[role=dialog]").should("not.exist");
  });

  it("the sidebar has an entry for the enabled object and it opens the list", () => {
    cy.get("nav[aria-label=Main]").contains("a", "Example items").should("have.attr", "href", "/o/example_items");
    cy.visit("/o/example_items");
    cy.get("main").contains("Example: first item").should("exist");
  });

  it("a viewer cannot open the page", () => {
    cy.loginAs("viewer-lawsome");
    // The role page matrix may 403 /settings for a viewer before the page's own denied state.
    cy.visit("/settings/objects", { failOnStatusCode: false });
    cy.contains("cannot").should("exist");
    cy.contains("button", "Create object").should("not.exist");
  });
});
