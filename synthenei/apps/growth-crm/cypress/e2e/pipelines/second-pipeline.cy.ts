// T032 (written, NOT run): a second deal pipeline can be created, renamed and archived; the board shows the chosen one.
import { clickUntil } from "../../support/retry-click";
import { openEditor, stageRows } from "./_helpers";

describe("pipelines: second pipeline", () => {
  beforeEach(() => { cy.loginAs("owner-lawsome"); });

  it("creates a pipeline with its own stages and the board switcher offers it", () => {
    openEditor();
    cy.get("input[aria-label='New pipeline name']").type("Renewals");
    clickUntil(() => cy.contains("button", "Add pipeline"), ($b) => /Pipeline "Renewals" created/.test($b.text()));
    cy.contains(/Pipeline "Renewals" created/).should("exist");
    cy.visit("/settings/pipelines");
    cy.get("button[aria-pressed]", { timeout: 30000 }).contains("Renewals").click();
    stageRows().should("have.length", 3);
    cy.get("input[aria-label='Stage 1 name']").should("have.value", "New");

    cy.visit("/pipeline?pipeline=renewals");
    cy.get("[data-testid=pipeline-switcher]", { timeout: 30000 }).contains("a", "Renewals").should("have.attr", "aria-current", "page");
    cy.get("[data-stage='new']").should("exist");
    cy.get("[data-stage='won']").should("exist");
    cy.get("[data-stage='discovery']").should("not.exist"); // the default pipeline's stages are not on this board
    cy.visit("/pipeline");
    cy.get("[data-stage='discovery']", { timeout: 30000 }).should("exist");
    cy.get("[data-stage='new']").should("not.exist");
  });

  it("renames and archives it; an archived pipeline leaves the switcher", () => {
    openEditor();
    cy.get("input[aria-label='New pipeline name']").type("Upsell");
    clickUntil(() => cy.contains("button", "Add pipeline"), ($b) => /Pipeline "Upsell" created/.test($b.text()));
    cy.visit("/settings/pipelines");
    cy.get("button[aria-pressed]", { timeout: 30000 }).contains("Upsell").click();
    cy.get("input[aria-label='Pipeline name']").clear().type("Upsell 2");
    cy.contains("button", "Rename").click();
    cy.contains(/Renamed to "Upsell 2"/).should("exist");
    cy.contains("button", "Archive pipeline").click();
    cy.contains(/"Upsell 2" archived/).should("exist");
    cy.visit("/pipeline");
    cy.get("[data-stage='discovery']", { timeout: 30000 }).should("exist");
    cy.get("[data-testid=pipeline-switcher]").should("not.contain.text", "Upsell");
  });

  it("the default pipeline cannot be archived or renamed from this form", () => {
    openEditor();
    cy.contains("button", "Archive pipeline").should("not.exist");
    cy.get("input[aria-label='Pipeline name']").should("not.exist");
  });
});
