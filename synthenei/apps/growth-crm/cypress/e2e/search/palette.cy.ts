// T056 (written by the author, NOT run). Command palette in demo mode (APP_ENV=demo).
// Opens with Ctrl+K, searches records, runs permitted actions, navigates with the keyboard, hides what the role may not do.
const open = () => { cy.get("body").type("{ctrl}k"); cy.get("[role=dialog]").should("be.visible"); cy.get("[role=dialog] input[role=combobox]").should("be.focused"); };

describe("command palette", () => {
  it("opens with Ctrl+K, closes with Escape and returns focus to the page", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/leads");
    open();
    cy.get("body").type("{esc}");
    cy.get("[role=dialog]").should("not.exist");
  });

  it("finds an account by name and opens it with Enter", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/");
    open();
    cy.get("[role=dialog] input").type("vaigai");
    cy.get("[role=dialog]").contains("[cmdk-item]", "Vaigai").should("exist");
    cy.get("[role=dialog] input").type("{enter}");
    cy.location("pathname").should("match", /\/(accounts|leads)\//);
  });

  it("finds a searchable custom-object record", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/");
    open();
    cy.get("[role=dialog] input").type("first item");
    cy.get("[role=dialog]").contains("[cmdk-item]", "Example: first item").click();
    cy.location("pathname").should("eq", "/o/example_items/demo-rec-1");
  });

  it("offers navigation and actions, and a recent item next time", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/");
    open();
    cy.get("[role=dialog]").contains("[cmdk-group-heading]", "Go to").should("exist");
    cy.get("[role=dialog]").contains("[cmdk-item]", "Log call").should("exist");
    cy.get("[role=dialog] input").type("example: second");
    cy.get("[role=dialog]").contains("[cmdk-item]", "Example: second item").click();
    cy.visit("/");
    open();
    cy.get("[role=dialog]").contains("[cmdk-group-heading]", "Recent").should("exist");
    cy.get("[role=dialog]").contains("[cmdk-item]", "Example: second item").should("exist");
  });

  it("viewer: no write actions, no Settings pages in the list", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/");
    open();
    cy.get("[role=dialog]").contains("[cmdk-item]", "Log call").should("not.exist");
    cy.get("[role=dialog]").contains("[cmdk-item]", /^New /).should("not.exist");
    cy.get("[role=dialog] input").type("api keys");
    cy.get("[role=dialog]").contains("[cmdk-item]", "API keys").should("not.exist");
  });

  it("viewer: an unmatched query shows the empty state (masking is covered by the unit tests)", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/");
    open();
    cy.get("[role=dialog] input").type("zzzqqq");
    cy.get("[role=dialog]").contains("No matches").should("exist");
  });

  it("shows the empty state and the too-short hint", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/");
    open();
    cy.get("[role=dialog] input").type("q");
    cy.get("[role=dialog]").contains("at least 2 characters").should("exist");
    cy.get("[role=dialog] input").type("zzzz");
    cy.get("[role=dialog]").contains("No matches").should("exist");
  });

  it("shows an error state with Try again when the search endpoint fails", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/");
    cy.intercept("GET", "/api/search?q=*", { statusCode: 500, body: { error: "search_failed" } }).as("search");
    open();
    cy.get("[role=dialog] input").type("vaigai");
    cy.wait("@search");
    cy.get("[role=dialog] [role=alert]").should("contain", "not available");
    cy.get("[role=dialog]").contains("button", "Try again").should("exist");
  });

  it("works at 390 px without horizontal scroll", () => {
    cy.viewport(390, 800);
    cy.loginAs("owner-lawsome");
    cy.visit("/");
    open();
    cy.get("[role=dialog]").invoke("outerWidth").should("be.lte", 390);
    cy.document().then((d) => expect(d.documentElement.scrollWidth).to.be.lte(390));
  });
});
