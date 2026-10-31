// Staging only. Written, NOT run (light mode). Inbound receiver contract over plain HTTP; needs no login.
// Optional signed-delivery test: set CYPRESS_HOOK_MOCK_CONNECTION (an integration id of a connected "mock" connection) and
// CYPRESS_HOOK_MOCK_SECRET (its webhook secret, Standard Webhooks format). Without them the signed tests skip.
import { createHmac } from "crypto";

const base = "/api/hooks";
const FAKE = "11111111-1111-4111-8111-111111111111";

describe("webhooks in: receiver contract", () => {
  it("unknown connection is a bare 404", () => {
    cy.request({ method: "POST", url: `${base}/whatsapp/${FAKE}`, body: "{}", failOnStatusCode: false }).then((r) => {
      expect(r.status).to.eq(404);
      expect(r.body).to.deep.eq({ ok: false });
    });
  });
  it("malformed token and unsupported connector are 404", () => {
    cy.request({ method: "POST", url: `${base}/whatsapp/not-a-uuid`, body: "{}", failOnStatusCode: false }).its("status").should("eq", 404);
    cy.request({ method: "POST", url: `${base}/csv/${FAKE}`, body: "{}", failOnStatusCode: false }).its("status").should("eq", 404);
  });
  it("Meta challenge GET never echoes for an unknown connection", () => {
    cy.request({ url: `${base}/whatsapp/${FAKE}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=abc`, failOnStatusCode: false }).then((r) => {
      expect(r.status).to.eq(404);
      expect(String(r.body)).not.to.contain("abc");
    });
  });
  it("signed Standard Webhooks delivery is accepted once, a replay is a duplicate, a bad signature is 401", function () {
    const conn = Cypress.expose("HOOK_MOCK_CONNECTION") as string | undefined, secret = Cypress.expose("HOOK_MOCK_SECRET") as string | undefined;
    if (!conn || !secret) return this.skip();
    const body = JSON.stringify({ events: [{ id: `e-${Date.now()}` }] });
    const id = `msg_${Date.now()}`, ts = String(Math.floor(Date.now() / 1000));
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const sig = "v1," + createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
    const headers = { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": sig };
    cy.request({ method: "POST", url: `${base}/mock/${conn}`, body, headers }).then((r) => { expect(r.status).to.eq(200); expect(r.body.ok).to.eq(true); });
    cy.request({ method: "POST", url: `${base}/mock/${conn}`, body, headers }).its("body.duplicate").should("eq", true);
    cy.request({ method: "POST", url: `${base}/mock/${conn}`, body: body + " ", headers: { ...headers, "webhook-id": `${id}x` }, failOnStatusCode: false }).then((r) => {
      expect(r.status).to.eq(401);
      expect(r.body).to.deep.eq({ ok: false });
    });
  });
});
