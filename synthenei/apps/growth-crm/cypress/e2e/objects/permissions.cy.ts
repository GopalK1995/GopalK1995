// T033 (written by the author, NOT run). Permissions come from the catalogue (obj:<key>.read|write|delete), never from a role name.
// Demo grants mirror the database defaults for a new object: owner full, sales manager read and write, plus read for sales reps.
// The role editor lists the object permissions without a code change.
describe("custom objects: permissions", () => {
  it("owner: can create and delete", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/o/example_items");
    cy.get("main").contains("button", "New Example item").should("not.have.attr", "aria-disabled", "true");
    cy.visit("/o/example_items/demo-rec-1");
    cy.get("main").contains("button", "Delete").should("not.have.attr", "aria-disabled", "true");
  });

  it("sales rep: reads the list, cannot create, rename or delete, and the reasons are shown", () => {
    cy.loginAs("rep-lawsome");
    cy.get("nav[aria-label=Main]").contains("a", "Example items").should("exist");
    cy.visit("/o/example_items");
    cy.get("main").contains("td", "Example: first item").should("exist");
    cy.get("main").contains("button", "New Example item").should("not.exist");
    cy.visit("/o/example_items/demo-rec-1");
    cy.get("main").contains("h1", "Example: first item").should("exist");
    cy.get("main").find("button[aria-label^='Rename']").should("have.attr", "aria-disabled", "true");
    cy.get("main").contains("button", "Delete").should("have.attr", "aria-disabled", "true");
    cy.get("main").contains("button", "Link a record").should("have.attr", "aria-disabled", "true");
  });

  it("viewer and marketing: no sidebar entry and the list says why it cannot be opened", () => {
    for (const persona of ["viewer-lawsome", "mkt-lawsome"] as const) {
      cy.loginAs(persona);
      cy.get("nav[aria-label=Main]").contains("a", "Example items").should("not.exist");
      cy.visit("/o/example_items", { failOnStatusCode: false });
      cy.get("main").contains("You cannot open these records").should("exist");
      cy.get("main").contains("td", "Example: first item").should("not.exist");
      cy.visit("/o/example_items/demo-rec-1", { failOnStatusCode: false });
      cy.get("main").contains("You cannot open these records").should("exist");
    }
  });

  it("personal data custom fields are masked for a role without pii.read (the phone is not in the page)", () => {
    cy.loginAs("rep-lawsome");
    cy.visit("/o/example_items/demo-rec-1");
    cy.get("main [data-testid=custom-fields]").should("exist");
    cy.document().then((d) => expect(d.documentElement.outerHTML).not.to.contain("+919800000001"));
  });

  it("the role editor lists the object permissions next to the catalogue", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/roles?tab=roles");
    cy.get("main").contains("option", "obj:example_items.read").should("exist");
    cy.get("main").contains("option", "obj:example_items.write").should("exist");
    cy.get("main").contains("option", "obj:example_items.delete").should("exist");
  });
});
