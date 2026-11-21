// T056 (written by the author, NOT run). Search never returns another tenant's records, never answers without a session,
// and refuses structure-breaking input without error. Demo mode: Lawsome (legal) and Shola Mist (hospitality) are different tenants.
const hits = (q: string) => cy.request({ url: `/api/search?q=${encodeURIComponent(q)}`, failOnStatusCode: false });

describe("search isolation", () => {
  it("anonymous requests get 401 and no data", () => {
    cy.clearCookies();
    hits("vaigai").then((r) => { expect(r.status).to.eq(401); expect(JSON.stringify(r.body)).not.to.contain("Vaigai"); });
  });

  it("a Lawsome user finds the Lawsome firm; a Shola Mist user finds nothing for it", () => {
    cy.loginAs("owner-lawsome");
    hits("vaigai").then((r) => { expect(r.status).to.eq(200); expect(r.body.hits.map((h: { type: string }) => h.type)).to.include("account"); });
    cy.loginAs("owner-shola");
    hits("vaigai").then((r) => { expect(r.status).to.eq(200); expect(r.body.hits).to.have.length(0); });
  });

  it("the Shola Mist palette shows no legal vocabulary", () => {
    cy.loginAs("owner-shola");
    cy.visit("/");
    cy.get("body").type("{ctrl}k");
    cy.get("[role=dialog]").should("be.visible").and("not.contain", "Law firms");
  });

  it("filter-breaking input is neutralised and returns a normal answer", () => {
    cy.loginAs("owner-lawsome");
    for (const q of ["a,id.neq.0", "x)or(owner_id.not.is.null", "%_%", "\\", "' or 1=1 --", "*"]) {
      hits(q).then((r) => { expect(r.status, q).to.be.oneOf([200]); expect(r.body, q).to.have.property("hits"); });
    }
  });

  it("the bootstrap call lists only permitted actions for a viewer", () => {
    cy.loginAs("viewer-lawsome");
    hits("").then((r) => { expect(r.status).to.eq(200); expect(r.body.actions).to.have.length(0); });
  });

  it("rate limits a burst with 429 and Retry-After", () => {
    cy.loginAs("owner-lawsome");
    const burst = Array.from({ length: 45 }, (_, i) => i);
    cy.wrap(burst).each(() => hits("vaigai")).then(() => hits("vaigai")).then((r) => {
      expect(r.status).to.eq(429); expect(r.headers).to.have.property("retry-after");
    });
  });
});
