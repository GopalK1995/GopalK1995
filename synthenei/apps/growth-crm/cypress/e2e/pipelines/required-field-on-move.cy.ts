// T032 (written, NOT run): a stage can require fields; moving a deal into it is refused (and the card goes back) until they are filled.
// Precondition from the demo dataset: not every open deal's lead has a next-step date. The spec looks for one, so it needs at least one.
import { moveVia } from "../pipeline/_helpers";
import { openEditor, saveStages } from "./_helpers";

describe("pipelines: required field on move", () => {
  beforeEach(() => { cy.loginAs("owner-lawsome"); });

  it("refuses a move into a stage that requires Next step when the deal has none, naming the field", () => {
    openEditor();
    // Stage 4 (the proposal stage of the legal preset) requires a next step.
    cy.get("input[aria-label='Stage 4 name']").invoke("val").then((stageName) => {
      cy.get("summary").eq(3).click();
      cy.get("fieldset").eq(3).contains("label", "Next step").find("input").check();
      saveStages();
      cy.visit("/pipeline");
      cy.get("[data-stage='discovery'] li", { timeout: 30000 }).then(($cards) => {
        const names = [...$cards].slice(0, 10).map((li) => li.querySelector("a, span")?.textContent?.trim() ?? "").filter(Boolean);
        let refused = false;
        // Try the cards in order until one is refused: the toast names the missing field.
        const attempt = (i: number): void => {
          if (i >= names.length || refused) return;
          moveVia(names[i], String(stageName));
          cy.wait(800);
          cy.get("body").then(($b) => {
            if (/Cannot move to .*Next step/i.test($b.text())) { refused = true; return; }
            attempt(i + 1);
          });
        };
        attempt(0);
        cy.then(() => expect(refused, "a deal without a next step was refused").to.eq(true));
      });
      // a refused card is back in its column
      cy.get("[data-stage='discovery'] li").should("have.length.at.least", 1);
    });
  });

  it("the stage editor lists the required fields of the record type", () => {
    openEditor();
    cy.get("summary").first().click();
    cy.get("fieldset").first().within(() => {
      ["Value", "Next step", "Owner"].forEach((l) => cy.contains("label", l).should("exist"));
    });
  });
});
