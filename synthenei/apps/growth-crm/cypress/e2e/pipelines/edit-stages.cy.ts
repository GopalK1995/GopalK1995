// T032 (written, NOT run): the owner of the legal demo workspace adds, renames, reorders and archives stages; the board follows.
import { addStage, openEditor, saveStages, stageRows } from "./_helpers";

describe("pipelines: edit stages", () => {
  beforeEach(() => { cy.loginAs("owner-lawsome"); });

  it("adds a stage with probability, colour and SLA, and the pipeline board shows it", () => {
    openEditor();
    stageRows().its("length").then((n) => {
      addStage(n);
      // the new stage lands before the first Won/Lost stage: position 6 of 8 rows
      cy.get("input[aria-label='Stage 6 name']").type("Site visit");
      cy.get("input[aria-label='Site visit probability percent']").clear().type("55");
      cy.get("select[aria-label='Site visit colour']").select("Accent");
      cy.get("input[aria-label='Site visit SLA hours']").type("72");
    });
    saveStages();
    cy.visit("/pipeline");
    cy.get("[data-stage='site_visit']", { timeout: 30000 }).should("exist").find("h2").should("contain.text", "Site visit");
  });

  it("renames a stage and the new name shows on the board", () => {
    openEditor();
    cy.get("input[aria-label='Stage 1 name']").clear().type("First call");
    saveStages();
    cy.visit("/pipeline");
    cy.get("[data-stage='discovery'] h2", { timeout: 30000 }).should("have.text", "First call");
  });

  it("reorders open stages with the up and down buttons", () => {
    openEditor();
    cy.get("input[aria-label='Stage 1 name']").invoke("val").then((first) => {
      cy.get("button[aria-label^='Move'][aria-label$='down']").first().click();
      cy.get("input[aria-label='Stage 2 name']").should("have.value", first);
    });
  });

  it("refuses to archive a stage that still has deals, and explains why", () => {
    openEditor();
    cy.get("button[aria-label^='Archive']").first().click();
    cy.contains("button", "Save stages").click();
    cy.contains(/still has records/i, { timeout: 15000 }).should("exist");
  });

  it("Won and Lost cannot be archived and keep their fixed probabilities", () => {
    openEditor();
    cy.get("button[aria-label='Archive Won'], button[aria-label='Archive Lost']").should("be.disabled");
    cy.get("input[aria-label='Won probability percent']").should("be.disabled").and("have.value", "100");
    cy.get("input[aria-label='Lost probability percent']").should("be.disabled").and("have.value", "0");
  });
});

describe("pipelines: permissions", () => {
  it("a sales rep cannot open the editor", () => {
    cy.loginAs("rep-lawsome");
    cy.visit("/settings/pipelines");
    cy.contains(/do not have permission/i).should("exist");
    cy.contains("button", "Save stages").should("not.exist");
  });
});
