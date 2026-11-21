// T052 (written, NOT run by the author). Access export bundle: one JSON file of everything held about the person.
// Demo: the download control is present but disabled with a reason (a sample workspace has no data to export), and the route refuses callers
// without a session. Staging (CYPRESS_PRIVACY_ACCESS_REQUEST = id of an access request linked to a seeded lead; owner credentials as in
// erasure.cy.ts): the route returns an attachment whose manifest lists every section and is never cached.
describe("privacy: access export", () => {
  it("is disabled in a sample workspace and explains why (demo)", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/privacy/demo-req-2");
    cy.contains("Access bundle").should("be.visible");
    cy.contains("button", "Download access bundle").should("be.disabled");
  });
  it("the export route needs a session", () => {
    cy.request({ url: "/settings/privacy/40000000-0000-4000-8000-000000000001/export", failOnStatusCode: false, followRedirect: false }).its("status").should("be.oneOf", [302, 307, 401, 403]);
  });

  describe("staging", () => {
    const req = Cypress.expose("PRIVACY_ACCESS_REQUEST") as string | undefined;
    beforeEach(function () { if (!req) this.skip(); });
    it("returns the bundle as a no-store JSON attachment with a manifest of every section", () => {
      cy.loginReal({ email: String(Cypress.expose("OWNER_EMAIL")), password: String(Cypress.expose("OWNER_PASSWORD")) });
      cy.request(`/settings/privacy/${req}/export`).then((r) => {
        expect(r.status).to.eq(200);
        expect(r.headers["cache-control"]).to.eq("no-store");
        expect(String(r.headers["content-disposition"])).to.match(/^attachment; filename="access-bundle-/);
        const b = r.body as { manifest: { format: string; sections: { name: string }[] }; data: Record<string, unknown[]> };
        expect(b.manifest.format).to.eq("access-bundle/v1");
        const names = b.manifest.sections.map((s) => s.name);
        for (const n of ["lead", "activities", "messages", "consent_log", "lead_events", "records"]) expect(names).to.include(n);
        expect(JSON.stringify(b)).not.to.contain("tenant_id");
      });
    });
    it("a malformed id is a 404", () => {
      cy.loginReal({ email: String(Cypress.expose("OWNER_EMAIL")), password: String(Cypress.expose("OWNER_PASSWORD")) });
      cy.request({ url: "/settings/privacy/not-a-uuid/export", failOnStatusCode: false }).its("status").should("eq", 404);
    });
  });
});
