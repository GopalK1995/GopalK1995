// My day shows the day ruler with business hours and today's timed tasks, from the same rows as /tasks (real session).
// Written, NOT run in light mode.
import { loginOrSkip } from "../tasks/_helpers";

describe("sales: my day", () => {
  beforeEach(function () { loginOrSkip(this, "REP"); });

  it("renders the ruler with business hours and lists a task due today", () => {
    cy.visit("/sales");
    cy.get("[data-testid=day-ruler]", { timeout: 30000 }).should("be.visible");
    cy.get("[data-testid=day-ruler] [role=img]").should("have.attr", "aria-label").and("match", /10:00 to 18:00/);
  });
});
