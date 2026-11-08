// Staging only. Written, NOT run (light mode).
// Part 1 (no setup): the WhatsApp receiver contract and the showcase page in a demo session.
// Part 2 (needs a sandbox WhatsApp connection): a signed fixture lands in the inbox, a replay is a duplicate, STOP is accepted.
//   CYPRESS_WA_CONNECTION = integration id of a connected (sandbox) WhatsApp connection
//   CYPRESS_WA_APP_SECRET = the Meta app secret stored with it, CYPRESS_WA_PHONE_NUMBER_ID = its phone number id
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace (reads the inbox for real)
import { createHmac } from "crypto";

const hook = (conn: string) => `/api/hooks/whatsapp/${conn}`;
const FAKE = "11111111-1111-4111-8111-111111111111";
const sign = (secret: string, body: string) => "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
const delivery = (phoneNumberId: string, wamid: string, text: string) =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "1", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { display_phone_number: "0", phone_number_id: phoneNumberId },
      contacts: [{ profile: { name: "Cypress Customer" }, wa_id: "919800000099" }],
      messages: [{ from: "919800000099", id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
    } }] }],
  });

describe("connectors: WhatsApp inbound", () => {
  it("shows the WhatsApp connector in a demo session as a showcase, not as connected", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    cy.get("main").should("contain.text", "WhatsApp");
    cy.get("main [data-chip=connected]").should("not.exist");
  });

  it("an unknown connection or a missing signature never reaches the inbox", () => {
    cy.loginAs("owner-lawsome");
    cy.request({ method: "POST", url: hook(FAKE), body: "{}", failOnStatusCode: false }).then((r) => {
      expect(r.status).to.eq(404);
      expect(r.body).to.deep.eq({ ok: false });
    });
    const conn = Cypress.expose("WA_CONNECTION") as string | undefined;
    if (!conn) return;
    cy.request({ method: "POST", url: hook(conn), body: delivery("1", "wamid.NOSIG", "x"), headers: { "content-type": "application/json" }, failOnStatusCode: false }).its("status").should("eq", 401);
  });

  it("signed text fixture -> inbox, replay -> duplicate, tampered body -> 401, STOP accepted", function () {
    const conn = Cypress.expose("WA_CONNECTION") as string | undefined, secret = Cypress.expose("WA_APP_SECRET") as string | undefined;
    const pnid = Cypress.expose("WA_PHONE_NUMBER_ID") as string | undefined;
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!conn || !secret || !pnid || !email || !password) return this.skip();
    cy.loginAs("owner-lawsome");
    const stamp = `wa-${Date.now().toString(36)}`;
    const body = delivery(pnid, `wamid.${stamp}`, `Hello from ${stamp}`);
    const headers = { "content-type": "application/json", "x-hub-signature-256": sign(secret, body) };
    cy.request({ method: "POST", url: hook(conn), body, headers }).its("body.ok").should("eq", true);
    cy.request({ method: "POST", url: hook(conn), body, headers }).its("body.duplicate").should("eq", true);
    cy.request({ method: "POST", url: hook(conn), body: body + " ", headers, failOnStatusCode: false }).its("status").should("eq", 401);
    const stop = delivery(pnid, `wamid.${stamp}-stop`, "STOP");
    cy.request({ method: "POST", url: hook(conn), body: stop, headers: { "content-type": "application/json", "x-hub-signature-256": sign(secret, stop) } }).its("status").should("eq", 200);
    // The job drains within a minute or two on staging; the real-session inbox then lists the thread with the message text.
    cy.loginReal({ email, password });
    cy.visit("/inbox");
    cy.get("main", { timeout: 120000 }).should("contain.text", `Hello from ${stamp}`);
  });
});
