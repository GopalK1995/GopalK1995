// T033 (written by the author, NOT run). Saved views on a custom-object list: a shared example view applies its filters, saving says
// nothing was stored in demo, and sharing (team or workspace) is only offered to roles that hold views.share.
import { clickUntil } from "../../support/retry-click";

const OPEN_DIALOG = ($b: JQuery<HTMLBodyElement>) => $b.find("[role=dialog]").length > 0;

describe("saved views", () => {
  it("opens a shared view: its filter and columns apply, and All clears it", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/o/example_items");
    cy.get("main").contains("td", "Example: second item").should("exist");
    cy.get("main").contains("a", "Active items").click();
    cy.location("search").should("include", "view=");
    cy.get("main").contains("td", "Example: first item").should("exist");
    cy.get("main").contains("td", "Example: fourth item").should("exist");
    cy.get("main").contains("td", "Example: second item").should("not.exist");
    cy.get("main").contains("th", "Quantity").should("exist");
    cy.get("main").contains("th", "Due date").should("not.exist");
    cy.get("main").contains("a", /^All$/).click();
    cy.location("search").should("not.include", "view=");
    cy.get("main").contains("td", "Example: second item").should("exist");
  });

  it("owner: saves the current filter as a view; sharing options are enabled; the demo says nothing was stored", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/o/example_items?custom.status=new");
    clickUntil(() => cy.get("main").contains("button", "Save view"), OPEN_DIALOG);
    cy.get("[role=dialog]").within(() => {
      cy.contains("label", "Name").parent().find("input").type("New ones");
      cy.contains("label", "Who can see it").parent().find("[role=combobox]").click();
    });
    cy.get("[role=option]").contains("Everyone in this workspace").should("not.have.attr", "aria-disabled", "true").click();
    cy.get("[role=dialog]").contains("button", "Save").click();
    cy.contains("Demo workspace: nothing was saved").should("exist");
  });

  it("save needs a name", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/o/example_items");
    clickUntil(() => cy.get("main").contains("button", "Save view"), OPEN_DIALOG);
    cy.get("[role=dialog]").contains("button", "Save").should("be.disabled");
  });

  it("sales rep: can keep a view private but team and workspace sharing are disabled with the reason", () => {
    cy.loginAs("rep-lawsome");
    cy.visit("/o/example_items");
    clickUntil(() => cy.get("main").contains("button", "Save view"), OPEN_DIALOG);
    cy.get("[role=dialog]").contains("Sharing views needs the share permission").should("exist");
    cy.get("[role=dialog]").contains("label", "Who can see it").parent().find("[role=combobox]").click();
    cy.get("[role=option]").contains("My team").should("have.attr", "aria-disabled", "true");
    cy.get("[role=option]").contains("Everyone in this workspace").should("have.attr", "aria-disabled", "true");
    cy.get("[role=option]").contains("Only me").should("not.have.attr", "aria-disabled", "true");
  });

  it("the filter bar and sort control write to the URL, so a view can be shared by link", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/o/example_items");
    cy.get("main").contains("label", "Sort").find("[role=combobox]").click();
    cy.get("[role=option]").contains("Quantity (Z to A)").click();
    cy.location("search").should("include", "sort=custom.quantity%3Adesc");
    cy.get("main table tbody tr").first().should("contain.text", "Example: third item");
  });
});
