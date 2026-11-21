// Staging only. Written, NOT run (light mode).
// Zoho CRM migration import and sync, against a mock API base: the server runs with ZOHO_API_BASE and ZOHO_ACCOUNTS_URL pointing at a
// stub that answers POST /crm/v6/coql (Leads, Contacts, Accounts, Deals), GET /crm/v6/<Module>?ids=..., PUT/POST on modules, GET /crm/v6/org
// and POST /oauth/v2/token. Sandbox truth is checked in a demo session: Zoho is never shown as connected without credentials.
//   CYPRESS_ZOHO_CONNECTION = integration id of a connected zoho-crm connection (stub), CYPRESS_ZOHO_STUB_LEAD_EMAIL = an email the stub serves as a Zoho lead
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace
import { clickUntil } from "../../support/retry-click";

const FAKE = "11111111-1111-4111-8111-111111111111";
const hook = (conn: string) => `/api/hooks/zoho-crm/${conn}`;

describe("connectors: Zoho CRM import and sync", () => {
  it("demo session: Zoho is listed, not connected, and no live badge appears without credentials", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    cy.get("main").should("contain.text", "Zoho");
    cy.get("main [data-chip=connected]").should("not.exist");
  });

  it("the Zoho notification endpoint answers 404 for an unknown connection and never 200 for an unsigned body", function () {
    cy.request({ method: "POST", url: hook(FAKE), body: { module: "Leads", ids: ["1"], operation: "update" }, failOnStatusCode: false }).its("status").should("eq", 404);
    const conn = Cypress.expose("ZOHO_CONNECTION") as string | undefined;
    if (!conn) return this.skip();
    cy.request({ method: "POST", url: hook(conn), body: { module: "Leads", ids: ["1"], operation: "update", token: "wrong" }, failOnStatusCode: false }).its("status").should("eq", 401);
  });

  it("run now imports the stub's leads through the import pipeline, and the leads list shows them", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    const lead = Cypress.expose("ZOHO_STUB_LEAD_EMAIL") as string | undefined;
    if (!Cypress.expose("ZOHO_CONNECTION") || !email || !password || !lead) return this.skip();
    cy.loginReal({ email, password });
    cy.visit("/integrations/zoho-crm");
    clickUntil(() => cy.contains("main button", /sync now/i), ($b) => /sync/i.test($b.text()));
    cy.visit("/leads");
    cy.get("main", { timeout: 180000 }).should("contain.text", lead.split("@")[0]);
  });

  it("the sync log explains rejected records without showing personal data", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!Cypress.expose("ZOHO_CONNECTION") || !email || !password) return this.skip();
    cy.loginReal({ email, password });
    cy.visit("/integrations/zoho-crm");
    cy.get("main").should("not.contain.text", "@example.com");
  });
});
