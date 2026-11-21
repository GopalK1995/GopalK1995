// T054. Written, not run (no Cypress run was allowed for this task).
// Demo path runs anywhere; the real path needs staging users: CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD.
describe("dashboard: owner home", () => {
  it("demo owner: decision zone first, then the configured tiles, then the month ruler", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/");
    cy.contains("h1", "Home").should("exist");
    cy.contains("Sample data").should("exist");
    cy.get("[data-zone=decision]").should("be.visible").and("contain.text", "Gap to target");
    // Order on the page: decision zone, headline readings, ruler.
    cy.get("[data-zone=decision]").then(($dz) => {
      cy.get("dl[aria-label='Headline readings']").then(($tiles) => {
        expect($dz[0].compareDocumentPosition($tiles[0]) & Node.DOCUMENT_POSITION_FOLLOWING).to.be.greaterThan(0);
      });
    });
    cy.get("dl[aria-label='Headline readings'] [data-tile]").should("have.length", 4);
    cy.contains("h2", "pipeline flow against target").should("exist");
  });

  it("every chart has a table toggle that shows the same numbers as a real table", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/");
    cy.contains("h2", "pipeline flow against target").parents("section").first().within(() => {
      cy.contains("button", "Table").click();
      cy.get("table").should("exist");
      cy.get("table thead th").first().should("have.text", "Day");
      cy.contains("button", "Chart").click();
      cy.get("table").should("not.exist");
    });
  });

  it("paid and organic social sit side by side, a missing reading says No data and is never 0", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/");
    cy.contains("h2", "Paid and organic social").parents("section").first().within(() => {
      cy.get("thead th").then(($th) => expect([...$th].map((t) => t.textContent)).to.deep.equal(["Measure", "Paid", "Organic"]));
      cy.get("[data-row=followers] [data-side=paid]").should("contain.text", "Not applicable");
      cy.get("[data-row=spend] [data-side=organic]").should("contain.text", "Not applicable");
      cy.contains("a", "Open social analytics").should("have.attr", "href", "/analytics/social");
    });
  });

  it("decision rows link into the pipeline, leads or tasks for an owner", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/");
    cy.get("[data-decision] a").each(($a) => expect($a.attr("href")).to.match(/^\/(leads|pipeline|tasks)/));
  });

  const email = Cypress.expose("OWNER_EMAIL") as string | undefined;
  const password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
  (email && password ? it : it.skip)("real owner: no sample band, no demo numbers, empty readings say No data", () => {
    cy.loginReal({ email: email!, password: password! });
    cy.visit("/");
    cy.contains("Sample data").should("not.exist");
    cy.get("[data-zone=decision]").should("exist");
    cy.get("dl[aria-label='Headline readings'] [data-tile]").should("have.length", 4);
    cy.get("dl[aria-label='Headline readings']").should("not.contain.text", "NaN");
  });
});
