// T058 · A tenant's outbound webhook configuration is private to it: tenant B's endpoint never appears in tenant A's
// listing (API or UI), and the delivery log a tenant sees never carries another tenant's events. The per-row RLS proof
// (webhook_endpoints / webhook_deliveries filtered by workspace) lives in supabase/tests/isolation_all_tables.test.sql
// section 3; this is the HTTP/UI surface. Real mode only. Written, NOT run in light mode.
import { api, bearer, createKeyViaUi, loginOrSkip, requireMode, stamp } from "./_helpers";

describe("isolation: outbound webhooks are private to a tenant", () => {
  it("real: tenant B's endpoint is absent from tenant A's /api/v1/webhooks listing", function () {
    requireMode(this, "real");
    // tenant B creates an endpoint via the API.
    loginOrSkip(this, "SHOLA");
    const marker = `https://${stamp()}.example.test/hook`;
    createKeyViaUi({ name: stamp(), role: "owner", scopes: ["webhooks:write"] }).then((bKey) => {
      cy.request({ method: "POST", url: api("/webhooks"), headers: bearer(bKey), body: { url: marker, event_types: ["lead.created"] } })
        .its("status").should("be.oneOf", [200, 201]);
    });
    // tenant A lists webhooks and must not see B's id or url.
    cy.then(() => loginOrSkip(this, "OWNER"));
    createKeyViaUi({ name: stamp(), role: "owner", scopes: ["webhooks:write"] }).then((aKey) => {
      cy.request({ url: api("/webhooks"), headers: bearer(aKey) }).then((r) => {
        expect(r.status).to.eq(200);
        expect(JSON.stringify(r.body)).not.to.contain(marker);
      });
    });
  });

  it("real: the delivery log on /settings/webhooks shows only this tenant's deliveries", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    cy.visit("/settings/webhooks");
    // the owner sees their own endpoints; nothing on the page is scoped to another workspace.
    cy.contains(/Deliveries|Recent deliveries|No deliveries yet/i).should("exist");
    cy.get("body").should("not.contain", ".example.test/hook"); // the foreign marker domain never bleeds in
  });
});
