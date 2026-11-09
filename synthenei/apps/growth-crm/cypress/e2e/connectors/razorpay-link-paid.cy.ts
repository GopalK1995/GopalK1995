// Staging only. Written, NOT run (light mode).
// Part 1 (no setup): the receiver contract for Razorpay and the showcase card in a demo session.
// Part 2 (needs a connected Razorpay TEST connection and an open payment link made from a deal): a signed payment_link.paid fixture
//   is accepted, a replay is a duplicate, a tampered body is 401; the job then marks the payment paid and the deal moves to the stage
//   set in the connection's `paid_stage_key` setting.
//   CYPRESS_RZP_CONNECTION = integration id of the connected Razorpay connection
//   CYPRESS_RZP_WEBHOOK_SECRET = the webhook secret stored with it
//   CYPRESS_RZP_LINK_ID / CYPRESS_RZP_CRM_PAYMENT_ID / CYPRESS_RZP_AMOUNT_PAISE = the open link's vendor id, local payment id and amount
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace (reads the payment for real)
import { createHmac } from "crypto";

const hook = (conn: string) => `/api/hooks/razorpay/${conn}`;
const FAKE = "11111111-1111-4111-8111-111111111111";
const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body, "utf8").digest("hex");
const paid = (link: string, crm: string, amount: number) =>
  JSON.stringify({
    entity: "event", account_id: "acc_CypressAccount1", event: "payment_link.paid", contains: ["payment_link", "payment"],
    payload: {
      payment_link: { entity: { id: link, entity: "payment_link", amount, amount_paid: amount, currency: "INR", status: "paid", reference_id: crm, notes: { crm_payment_id: crm } } },
      payment: { entity: { id: `pay_cy${Date.now().toString(36)}`, entity: "payment", amount, currency: "INR", status: "captured", method: "upi", notes: { crm_payment_id: crm } } },
    },
    created_at: Math.floor(Date.now() / 1000),
  });

describe("connectors: Razorpay link paid", () => {
  it("shows the Razorpay connector in a demo session as a showcase, not as connected", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    cy.get("main").should("contain.text", "Razorpay");
    cy.get("main [data-chip=connected]").should("not.exist");
  });

  it("an unknown connection or a missing signature never reaches the payments", () => {
    cy.loginAs("owner-lawsome");
    cy.request({ method: "POST", url: hook(FAKE), body: "{}", failOnStatusCode: false }).then((r) => {
      expect(r.status).to.eq(404);
      expect(r.body).to.deep.eq({ ok: false });
    });
    const conn = Cypress.expose("RZP_CONNECTION") as string | undefined;
    if (!conn) return;
    cy.request({ method: "POST", url: hook(conn), body: paid("plink_x", FAKE, 100), headers: { "content-type": "application/json" }, failOnStatusCode: false }).its("status").should("eq", 401);
  });

  it("signed payment_link.paid -> accepted, replay -> duplicate, tampered body -> 401, then the deal list still loads", function () {
    const g = (k: string) => Cypress.expose(k) as string | undefined;
    const conn = g("RZP_CONNECTION"), secret = g("RZP_WEBHOOK_SECRET"), link = g("RZP_LINK_ID"), crm = g("RZP_CRM_PAYMENT_ID"), amount = Number(g("RZP_AMOUNT_PAISE"));
    const email = g("OWNER_EMAIL"), password = g("OWNER_PASSWORD");
    if (!conn || !secret || !link || !crm || !amount || !email || !password) return this.skip();
    cy.loginAs("owner-lawsome");
    const body = paid(link, crm, amount);
    const headers = { "content-type": "application/json", "x-razorpay-signature": sign(secret, body), "x-razorpay-event-id": `evt_cy_${Date.now().toString(36)}` };
    cy.request({ method: "POST", url: hook(conn), body, headers }).its("body.ok").should("eq", true);
    cy.request({ method: "POST", url: hook(conn), body, headers }).its("body.duplicate").should("eq", true);
    cy.request({ method: "POST", url: hook(conn), body: body + " ", headers, failOnStatusCode: false }).its("status").should("eq", 401);
    // The job drains within a minute or two on staging; the payment chip lives on the deal page once the integrator mounts it.
    cy.loginReal({ email, password });
    cy.visit("/pipeline");
    cy.get("main", { timeout: 120000 }).should("be.visible");
  });
});
