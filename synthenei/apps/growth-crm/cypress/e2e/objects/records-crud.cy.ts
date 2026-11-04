// T033 (written by the author, NOT run). Demo workspace: list, search, create (validation), open, rename, link, comment area and delete
// on the example custom object. Every write says nothing was stored; real-mode persistence is covered by the unit tests.
import { clickUntil } from "../../support/retry-click";

const OPEN_DIALOG = ($b: JQuery<HTMLBodyElement>) => $b.find("[role=dialog]").length > 0;

describe("custom object records: list and create", () => {
  beforeEach(() => { cy.loginAs("owner-lawsome"); cy.visit("/o/example_items"); });

  it("lists the example records with a layout-driven set of columns", () => {
    cy.get("main").contains("h1, h2", "Example items").should("exist");
    cy.get("main table").should("exist");
    cy.get("main table").contains("th", "Name").should("exist");
    cy.get("main table").contains("th", "Status").should("exist");
    cy.get("main table").contains("td", "Example: first item").should("exist");
  });

  it("search narrows the list and an empty result says so", () => {
    cy.get("main input[type=text], main input:not([type])").first().type("second");
    cy.get("main").contains("Example: second item").should("exist");
    cy.get("main").contains("Example: first item").should("not.exist");
    cy.get("main input[type=text], main input:not([type])").first().clear().type("zzzz");
    cy.get("main").contains("Nothing matches").should("exist");
  });

  it("filters by a select field built from the field definitions", () => {
    cy.get("main select").first().select("Done");
    cy.location("search").should("include", "custom.status=done");
    cy.get("main").contains("Example: third item").should("exist");
    cy.get("main").contains("Example: first item").should("not.exist");
  });

  it("create: required name is enforced, then the save says nothing was stored", () => {
    clickUntil(() => cy.get("main").contains("button", "New Example item"), OPEN_DIALOG);
    cy.get("[role=dialog]").contains("button", "Create Example item").click();
    cy.get("[role=dialog]").contains("Name").should("exist");
    cy.get("[role=dialog]").find("[role=alert]").should("exist");
    cy.get("[role=dialog]").contains("label", "Name").parent().find("input").first().type("Example: new one");
    cy.get("[role=dialog]").contains("button", "Create Example item").click();
    cy.contains("Demo workspace: nothing was saved").should("exist");
  });

  it("Escape closes the create dialog", () => {
    clickUntil(() => cy.get("main").contains("button", "New Example item"), OPEN_DIALOG);
    cy.get("body").type("{esc}");
    cy.get("[role=dialog]").should("not.exist");
  });
});

describe("custom object records: detail", () => {
  beforeEach(() => { cy.loginAs("owner-lawsome"); cy.visit("/o/example_items/demo-rec-1"); });

  it("shows the title, the layout sections and the related and comment areas", () => {
    cy.get("main").contains("h1", "Example: first item").should("exist");
    cy.get("main [data-testid=custom-fields]").should("exist");
    cy.get("main [data-testid=custom-fields]").contains("Details").should("exist");
    cy.get("main [data-testid=custom-fields]").contains("Contact").should("exist");
    cy.get("main").contains("Related records").should("exist");
    cy.get("main").contains("a", "Example: second item").should("have.attr", "href", "/o/example_items/demo-rec-2");
    cy.get("main").contains("Comments").should("exist");
  });

  it("rename: empty is refused, a new name is accepted with the demo notice", () => {
    clickUntil(() => cy.get("main").find("button[aria-label^='Rename']"), ($b) => $b.find("main input").length > 0);
    cy.get("main input").first().clear();
    cy.get("main").contains("button", "Save").should("be.disabled");
    cy.get("main input").first().type("Example: renamed");
    cy.get("main").contains("button", "Save").click();
    cy.contains("Demo workspace: nothing was saved").should("exist");
  });

  it("delete asks for confirmation first", () => {
    clickUntil(() => cy.get("main").contains("button", "Delete"), OPEN_DIALOG);
    cy.get("[role=dialog]").contains("Delete this Example item?").should("exist");
    cy.get("[role=dialog]").contains("button", "Cancel").click();
    cy.get("[role=dialog]").should("not.exist");
    clickUntil(() => cy.get("main").contains("button", "Delete"), OPEN_DIALOG);
    cy.get("[role=dialog]").contains("button", "Delete Example item").click();
    cy.contains("Demo workspace: nothing was saved").should("exist");
  });

  it("link a record: search finds another record", () => {
    clickUntil(() => cy.get("main").contains("button", "Link a record"), OPEN_DIALOG);
    cy.get("[role=dialog] input").first().type("third");
    cy.get("[role=dialog]").contains("button", "Search").click();
    cy.get("[role=dialog]").contains("Example: third item").should("exist");
    cy.get("[role=dialog]").contains("button", "Link").click();
    cy.contains("Demo workspace: nothing was saved").should("exist");
  });

  it("an unknown record shows a not-found state with a way back", () => {
    cy.visit("/o/example_items/demo-rec-999");
    cy.get("main").contains("was not found").should("exist");
    cy.get("main").contains("a", "Back to").should("have.attr", "href", "/o/example_items");
  });

  it("an unknown object is a 404", () => {
    cy.request({ url: "/o/does_not_exist", failOnStatusCode: false }).its("status").should("eq", 404);
  });
});
