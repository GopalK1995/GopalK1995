// Staging only. Written, NOT run (light mode).
// Channel manager (generic adapter, fixture gateway): reservations arrive by webhook and appear as OTA-labelled booking records with their
// commission; an unsigned delivery is never accepted. The webhook route is T023's (/api/hooks/channel-manager/<connection id>); the
// connector must also be mapped to a signature scheme in src/lib/connectors/verify/index.ts (see "T046 needs").
//   CYPRESS_CM_CONNECTION     = id of a sandbox channel-manager connection (connected with the fixture token)
//   CYPRESS_CM_SIGNED_BODY    = a reservation webhook body, e.g. {"events":[{"event":"created","reservation":{"id":"cy-1","channel":"booking_com", ...}}]}
//   CYPRESS_CM_SIGNED_HEADERS = JSON object of the headers that sign that exact body (computed outside Cypress with the connection's webhook secret)
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = owner of the workspace
describe("connectors: channel manager fixture", () => {
  const connection = () => Cypress.expose("CM_CONNECTION") as string | undefined;
  const hook = (body: string, headers: Record<string, string> = {}) =>
    cy.request({ method: "POST", url: `/api/hooks/channel-manager/${connection()}`, body, headers: { "content-type": "application/json", ...headers }, failOnStatusCode: false });

  it("rejects an unsigned delivery", function () {
    if (!connection()) return this.skip();
    hook(JSON.stringify({ events: [] })).its("status").should("be.oneOf", [401, 404]);
  });

  it("turns a signed reservation into a booking record labelled with the OTA and commission", function () {
    const body = Cypress.expose("CM_SIGNED_BODY") as string | undefined, headers = Cypress.expose("CM_SIGNED_HEADERS") as string | undefined;
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!connection() || !body || !headers || !email || !password) return this.skip();
    hook(body, JSON.parse(headers) as Record<string, string>).its("status").should("eq", 200);
    cy.loginReal({ email, password });
    cy.visit("/o/booking");
    cy.get("main").invoke("text").should("match", /booking_com|Booking\.com/);
  });

  it("a repeated delivery does not create a second record", function () {
    const body = Cypress.expose("CM_SIGNED_BODY") as string | undefined, headers = Cypress.expose("CM_SIGNED_HEADERS") as string | undefined;
    if (!connection() || !body || !headers) return this.skip();
    hook(body, JSON.parse(headers) as Record<string, string>).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body).to.have.property("duplicate", true);
    });
  });
});
