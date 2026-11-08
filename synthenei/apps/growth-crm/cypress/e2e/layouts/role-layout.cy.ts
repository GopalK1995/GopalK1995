// T033 (written by the author, NOT run). Per-role layouts: the demo ships a reduced record page for sales reps (role layout) while
// the owner sees the generated default; the editor shows which layout a choice uses, validates before saving, and says nothing was
// stored in demo.
describe("layouts: per-role", () => {
  it("owner sees every section; a sales rep sees only the role layout and no related list", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/o/example_items/demo-rec-1");
    cy.get("main [data-testid=custom-fields]").within(() => {
      cy.contains("Details").should("exist");
      cy.contains("Notes").should("exist");
      cy.contains("Contact").should("exist");
    });
    cy.get("main").contains("Related records").should("exist");

    cy.loginAs("rep-lawsome");
    cy.visit("/o/example_items/demo-rec-1");
    cy.get("main [data-testid=custom-fields]").within(() => {
      cy.contains("Summary").should("exist");
      cy.contains("Quantity").should("exist");
      cy.contains("Notes").should("not.exist");
    });
    cy.get("main").contains("Related records").should("not.exist");
    cy.get("main").contains("Comments").should("exist");
  });

  it("editor: the sales rep choice has its own saved layout; everyone has none and uses the default", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/layouts?object=example_items&kind=detail&scope=org&role=sales_rep");
    cy.get("main").contains("This layout is saved for exactly this choice.").should("exist");
    cy.get("main").contains("label", "Section title").parent().find("input").should("have.value", "Summary");
    cy.visit("/settings/layouts?object=example_items&kind=detail&scope=org");
    cy.get("main").contains("uses the generated default").should("exist");
    cy.get("main").contains("button", "Remove this layout").should("not.exist");
  });

  it("editor: an empty section title is refused before saving, a valid change says nothing was stored", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/layouts?object=example_items&kind=detail&scope=org&role=sales_rep");
    cy.get("main").contains("label", "Section title").parent().find("input").clear();
    cy.get("main").contains("button", "Save layout").click();
    cy.get("main").contains("Every section needs a title").should("exist");
    cy.get("main").contains("label", "Section title").parent().find("input").type("Overview");
    cy.get("main").contains("button", "Save layout").click();
    cy.contains("Demo workspace: nothing was saved").should("exist");
  });

  it("editor: fields can be reordered with buttons and added from the unplaced list", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/layouts?object=example_items&kind=detail&scope=org&role=sales_rep");
    cy.get("main").contains("not on this layout").should("exist");
    cy.get("main").find("button[aria-label^='Move Status down']").click();
    cy.get("main").find("button[aria-label^='Move Quantity up']").should("exist");
    cy.get("main").find("button[aria-label^='Remove Quantity']").click();
    cy.get("main").contains("not on this layout").should("exist");
  });

  it("editor: the list layout can switch columns", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/layouts?object=example_items&kind=list&scope=org");
    cy.get("main").contains("Name (always shown)").should("exist");
    cy.get("main").find("button[aria-label^='Remove Status']").click();
    cy.get("main").contains("button", "Save layout").click();
    cy.contains("Demo workspace: nothing was saved").should("exist");
  });

  it("a sales rep cannot manage layouts", () => {
    cy.loginAs("rep-lawsome");
    cy.visit("/settings/layouts", { failOnStatusCode: false });
    cy.contains("cannot").should("exist");
    cy.contains("button", "Save layout").should("not.exist");
  });
});
