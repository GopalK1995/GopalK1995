import { StageAgeTicks } from "@/app/(app)/pipeline/_components/stage-age";
import { PIPELINE_BASE } from "@/app/(app)/pipeline/_lib/labels";

const labels = PIPELINE_BASE.en;

describe("StageAgeTicks", () => {
  it("draws one tick per day and keeps them neutral under the limit", () => {
    cy.mount(<StageAgeTicks days={6} max={14} labels={labels} />);
    cy.get("[data-tick]").should("have.length", 6);
    cy.get("[data-tick=over]").should("not.exist");
    cy.get("[data-testid=stage-age]").should("have.attr", "data-over", "false").and("contain.text", "6d");
  });
  it("marks ticks past the limit and states it in words, not colour alone", () => {
    cy.mount(<StageAgeTicks days={17} max={14} labels={labels} />);
    cy.get("[data-tick=over]").should("have.length", 3);
    cy.get("[data-testid=stage-age]").should("have.attr", "title").and("match", /over the 14 day limit/);
    cy.get("[role=img]").should("have.attr", "aria-label", "Stage age: 17 of 14 days");
  });
  it("caps the row for very old cards", () => {
    cy.mount(<StageAgeTicks days={60} max={14} labels={labels} />);
    cy.get("[data-tick]").should("have.length", 21);
    cy.contains("+39").should("be.visible");
  });
});
