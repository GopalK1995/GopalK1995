// T040 (written by the author, NOT run). Demo workspace. The labelled example fields show on the lead and account pages and as list
// columns; an edit validates and answers "nothing was saved" (demo never writes). The real create-field -> edit -> list -> API path
// needs a staging workspace and is covered by the unit tests of save, list and layout resolution.
import { clickUntil } from "../../support/retry-click";

describe("custom fields on record pages and lists", () => {
  beforeEach(() => { cy.loginAs("owner-lawsome"); });

  it("lead list shows custom columns and a select filter built from the field definitions", () => {
    cy.visit("/leads");
    cy.get("main table").contains("th", "Example: priority").should("exist");
    cy.get("main table").contains("td", "Normal").should("exist");
    cy.get("main select").contains("option", "Example: priority").should("exist");
  });

  it("filtering by a custom value is URL-driven", () => {
    cy.visit("/leads?custom.example_priority=high");
    cy.location("search").should("include", "custom.example_priority=high");
    cy.get("main").contains("Example: priority").should("exist");
  });

  it("lead detail renders the custom-fields section with the example values", () => {
    cy.visit("/leads");
    cy.get("main table tbody a").first().click();
    cy.get("main [data-testid=custom-fields]").should("exist");
    cy.get("main [data-testid=custom-fields]").contains("Example: where we met").should("exist");
    cy.get("main [data-testid=custom-fields]").contains("Example value").should("exist");
  });

  it("editing a value in demo mode says nothing was saved", () => {
    cy.visit("/leads");
    cy.get("main table tbody a").first().click();
    cy.get("main [data-testid=custom-fields]").should("exist");
    clickUntil(() => cy.get("main [data-testid=custom-fields]").contains("button", "Edit"), ($b) => $b.find("[data-testid=custom-fields] input, [data-testid=custom-fields] textarea").length > 0);
    cy.get("main [data-testid=custom-fields] input[type=text], main [data-testid=custom-fields] input:not([type])").first().clear().type("Met at an event");
    cy.get("main [data-testid=custom-fields]").contains("button", "Save").click();
    cy.contains(/not saved|nothing was saved/i).should("exist");
  });

  it("account detail renders the same section", () => {
    cy.visit("/accounts");
    cy.get("main table tbody a, main ul a").first().click();
    cy.get("main [data-testid=custom-fields]").should("exist");
  });
});
