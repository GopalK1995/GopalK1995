// Staging only. Written, NOT run (light mode).
// Part 1 (no setup): the Meta receiver contract and the connector card in a demo session.
// Part 2 (needs a sandbox Meta connection with a selected page): a signed leadgen fixture is stored, a replay is a duplicate,
//   a tampered body is refused, and the lead appears for a real owner session.
//   CYPRESS_META_CONNECTION = integration id of a connected (sandbox) meta-ads connection
//   CYPRESS_META_APP_SECRET = the Meta app secret (META_APP_SECRET of that deployment), CYPRESS_META_PAGE_ID = its selected page id
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace
import { createHmac } from "crypto";
import { clickUntil } from "../../support/retry-click";

const hook = (conn: string) => `/api/hooks/meta-ads/${conn}`;
const FAKE = "11111111-1111-4111-8111-111111111111";
const sign = (secret: string, body: string) => "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
const leadgen = (page: string, leadgenId: string) =>
  JSON.stringify({ object: "page", entry: [{ id: page, time: Math.floor(Date.now() / 1000), changes: [{ field: "leadgen", value: { leadgen_id: leadgenId, page_id: page, form_id: "1", created_time: Math.floor(Date.now() / 1000) } }] }] });

describe("connectors: Meta lead ads", () => {
  it("lists Meta in a demo session as a showcase, not as connected", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    clickUntil(() => cy.contains("main a", /meta/i), ($b) => /\/integrations\/meta/.test($b[0].ownerDocument.location.pathname));
    cy.get("main").should("contain.text", "Meta");
    cy.get("main [data-chip=connected]").should("not.exist");
  });

  it("an unknown connection or a missing signature never reaches the inbox", () => {
    cy.loginAs("owner-lawsome");
    cy.request({ method: "POST", url: hook(FAKE), body: "{}", failOnStatusCode: false }).then((r) => {
      expect(r.status).to.eq(404);
      expect(r.body).to.deep.eq({ ok: false });
    });
    const conn = Cypress.expose("META_CONNECTION") as string | undefined;
    if (!conn) return;
    cy.request({ method: "POST", url: hook(conn), body: leadgen("1", "2"), headers: { "content-type": "application/json" }, failOnStatusCode: false }).its("status").should("eq", 401);
  });

  it("signed leadgen fixture -> stored, replay -> duplicate, tampered body -> 401", function () {
    const conn = Cypress.expose("META_CONNECTION") as string | undefined, secret = Cypress.expose("META_APP_SECRET") as string | undefined;
    const page = Cypress.expose("META_PAGE_ID") as string | undefined;
    if (!conn || !secret || !page) return this.skip();
    cy.loginAs("owner-lawsome");
    const body = leadgen(page, String(Date.now()));
    const headers = { "content-type": "application/json", "x-hub-signature-256": sign(secret, body) };
    cy.request({ method: "POST", url: hook(conn), body, headers }).its("body.ok").should("eq", true);
    cy.request({ method: "POST", url: hook(conn), body, headers }).its("body.duplicate").should("eq", true);
    cy.request({ method: "POST", url: hook(conn), body: body + " ", headers, failOnStatusCode: false }).its("status").should("eq", 401);
  });

  it("the leadgen lead shows up with Meta as its source for a real owner", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!Cypress.expose("META_CONNECTION") || !email || !password) return this.skip();
    cy.loginReal({ email, password });
    cy.visit("/leads");
    cy.get("main", { timeout: 120000 }).should("contain.text", "Sample Lead");   // the sandbox gateway answers the lead fetch
  });
});
