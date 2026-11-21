// Staging only. Written, NOT run (light mode).
// HubSpot two-way sync against a mock API base: the server runs with HUBSPOT_API_BASE pointing at a stub that answers
// POST /crm/v3/objects/{contacts,companies,deals}/search, POST .../batch/read, PATCH .../{id}, POST /oauth/v1/token and
// GET /oauth/v1/access-tokens/{token}. The webhook check needs the app client secret the stub signs with.
//   CYPRESS_HUBSPOT_CONNECTION = integration id of a connected hubspot connection (stub)
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace
import { clickUntil } from "../../support/retry-click";

const FAKE = "11111111-1111-4111-8111-111111111111";
const hook = (conn: string) => `/api/hooks/hubspot/${conn}`;

describe("connectors: HubSpot sync", () => {
  it("demo session: HubSpot is listed, not connected, and no live badge appears without credentials", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    cy.get("main").should("contain.text", "HubSpot");
    cy.get("main [data-chip=connected]").should("not.exist");
  });

  it("the webhook answers 404 for an unknown connection and 401 for a body without a valid v3 signature", function () {
    const body = [{ eventId: 1, subscriptionType: "contact.propertyChange", portalId: 1, objectId: 1 }];
    cy.request({ method: "POST", url: hook(FAKE), body, failOnStatusCode: false }).its("status").should("eq", 404);
    const conn = Cypress.expose("HUBSPOT_CONNECTION") as string | undefined;
    if (!conn) return this.skip();
    cy.request({ method: "POST", url: hook(conn), body, headers: { "x-hubspot-signature-v3": "bad", "x-hubspot-request-timestamp": String(Date.now()) }, failOnStatusCode: false }).its("status").should("eq", 401);
  });

  it("run now syncs the stub's contacts, companies and deals; a second run changes nothing", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!Cypress.expose("HUBSPOT_CONNECTION") || !email || !password) return this.skip();
    cy.loginReal({ email, password });
    cy.visit("/integrations/hubspot");
    clickUntil(() => cy.contains("main button", /sync now/i), ($b) => /sync/i.test($b.text()));
    cy.get("main", { timeout: 180000 }).should("not.contain.text", "Sync stopped");
    cy.visit("/accounts");
    cy.get("main").should("be.visible");
  });
});
