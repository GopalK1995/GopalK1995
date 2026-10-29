// Demo mode: a ?ws= deep link to a workspace the persona does not belong to is a 403; own workspaces switch.
describe("tenancy: foreign ?ws= is forbidden", () => {
  it("rep-lawsome gets 403 for a Shola Mist workspace", () => {
    cy.loginAs("rep-lawsome");
    cy.request({ url: "/?ws=shola-mist-coonoor", failOnStatusCode: false, followRedirect: false }).its("status").should("eq", 403);
  });
  it("rep-lawsome gets 403 for a Kaveri workspace", () => {
    cy.loginAs("rep-lawsome");
    cy.request({ url: "/leads?ws=kaveri-cbe", failOnStatusCode: false, followRedirect: false }).its("status").should("eq", 403);
  });
});

describe("tenancy: public sign-in pages stay scoped", () => {
  ["lawsome", "shola-mist"].forEach((slug) => it(`/g/${slug} renders`, () => { cy.request(`/g/${slug}`).its("status").should("eq", 200); }));
  it("/g/nope is 404", () => { cy.request({ url: "/g/nope", failOnStatusCode: false }).its("status").should("eq", 404); });
});
