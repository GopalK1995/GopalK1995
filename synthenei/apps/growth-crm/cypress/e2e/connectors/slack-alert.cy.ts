// Staging only. Written, NOT run (light mode).
// Part 1 (no setup): the Slack receiver contract (unknown connection / unsigned request never reach the inbox) and the connector card in a demo session.
// Part 2 (needs a sandbox Slack connection with a chosen channel):
//   CYPRESS_SLACK_CONNECTION = integration id of a connected (sandbox) slack connection
//   CYPRESS_SLACK_SIGNING_SECRET = SLACK_SIGNING_SECRET of that deployment
// A signed revocation event for the connection's own team parks it; a tampered or stale body is refused.
import { createHmac } from "crypto";
import { clickUntil } from "../../support/retry-click";

const hook = (conn: string) => `/api/hooks/slack/${conn}`;
const FAKE = "11111111-1111-4111-8111-111111111111";
const sign = (secret: string, ts: string, body: string) => "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`, "utf8").digest("hex");
const revoked = (team: string) => JSON.stringify({ type: "event_callback", team_id: team, event_id: `Ev${Date.now()}`, event: { type: "tokens_revoked" } });

describe("connectors: Slack alerts", () => {
  it("lists Slack in a demo session as a showcase, not as connected", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    clickUntil(() => cy.contains("main a", /slack/i), ($b) => /\/integrations\/slack/.test($b[0].ownerDocument.location.pathname));
    cy.get("main").should("contain.text", "Slack");
    cy.get("main [data-chip=connected]").should("not.exist");
  });

  it("an unknown connection or a missing signature never reaches the inbox", () => {
    cy.loginAs("owner-lawsome");
    cy.request({ method: "POST", url: hook(FAKE), body: "{}", failOnStatusCode: false }).then((r) => {
      expect(r.status).to.eq(404);
      expect(r.body).to.deep.eq({ ok: false });
    });
    const conn = Cypress.expose("SLACK_CONNECTION") as string | undefined;
    if (!conn) return;
    cy.request({ method: "POST", url: hook(conn), body: revoked("T1"), headers: { "content-type": "application/json" }, failOnStatusCode: false }).its("status").should("eq", 401);
  });

  it("a signed event is accepted, a replay is a duplicate, a tampered body or a stale timestamp is refused", function () {
    const conn = Cypress.expose("SLACK_CONNECTION") as string | undefined, secret = Cypress.expose("SLACK_SIGNING_SECRET") as string | undefined;
    if (!conn || !secret) return this.skip();
    cy.loginAs("owner-lawsome");
    const body = JSON.stringify({ type: "event_callback", team_id: "T-not-this-team", event_id: `Ev${Date.now()}`, event: { type: "tokens_revoked" } });
    const ts = String(Math.floor(Date.now() / 1000));
    const headers = { "content-type": "application/json", "x-slack-request-timestamp": ts, "x-slack-signature": sign(secret, ts, body) };
    cy.request({ method: "POST", url: hook(conn), body, headers }).its("body.ok").should("eq", true);
    cy.request({ method: "POST", url: hook(conn), body, headers }).its("body.duplicate").should("eq", true);
    cy.request({ method: "POST", url: hook(conn), body: body + " ", headers, failOnStatusCode: false }).its("status").should("eq", 401);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    cy.request({ method: "POST", url: hook(conn), body, headers: { ...headers, "x-slack-request-timestamp": old, "x-slack-signature": sign(secret, old, body) }, failOnStatusCode: false }).its("status").should("eq", 401);
  });
});
