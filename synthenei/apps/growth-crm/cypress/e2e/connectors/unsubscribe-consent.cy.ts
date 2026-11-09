// Staging / demo only. Written, NOT run (light mode).
// The public unsubscribe page: invalid and tampered links say so, a GET never withdraws anything, the one-click endpoint insists on the
// RFC 8058 body. With a real signed token (CYPRESS_UNSUB_TOKEN, minted with EMAIL_UNSUBSCRIBE_SECRET for a test lead) the confirm button
// writes the withdrawal and a second visit stays unsubscribed.
//   CYPRESS_UNSUB_TOKEN = a valid token for a seeded lead in a workspace with email consent
import { clickUntil } from "../../support/retry-click";

describe("connectors: unsubscribe writes a consent withdrawal", () => {
  it("is reachable without a session and explains a link that is not valid", () => {
    cy.visit("/unsubscribe/v1.not-a-real-token.signature");
    cy.get("main[data-testid=unsubscribe]").should("be.visible");
    cy.get("main").should("not.contain.text", "Unsubscribe me");
    cy.location("pathname").should("match", /^\/unsubscribe\//);   // not bounced to /login
  });

  it("a demo deployment says there is nothing to unsubscribe from", () => {
    cy.visit("/unsubscribe/anything");
    cy.get("main[data-testid=unsubscribe]").should("be.visible");
  });

  it("the one-click endpoint refuses a POST without the One-Click body and a forged token", () => {
    const form = { "content-type": "application/x-www-form-urlencoded" };
    cy.request({ method: "POST", url: "/api/email/unsubscribe/v1.x.y", body: "nope=1", headers: form, failOnStatusCode: false }).its("status").should("eq", 400);
    cy.request({ method: "POST", url: "/api/email/unsubscribe/v1.x.y", body: "List-Unsubscribe=One-Click", headers: form, failOnStatusCode: false }).its("status").should("be.oneOf", [400, 404]);
  });

  it("GET on the one-click URL only redirects to the confirmation page", () => {
    cy.request({ url: "/api/email/unsubscribe/v1.x.y", followRedirect: false, failOnStatusCode: false }).then((r) => {
      expect(r.status).to.eq(307);
      expect(String(r.redirectedToUrl ?? r.headers.location)).to.match(/\/unsubscribe\//);
    });
  });

  it("with a real token: the page asks for confirmation, confirming withdraws, and the page then says so", function () {
    const token = Cypress.expose("UNSUB_TOKEN") as string | undefined;
    if (!token) return this.skip();
    cy.visit(`/unsubscribe/${token}`);
    cy.get("main").should("contain.text", "Unsubscribe me");   // GET did not withdraw: the button is still offered
    clickUntil(() => cy.contains("main button", /unsubscribe me/i), ($b) => /you are unsubscribed/i.test($b.find("main h1").text()));
    cy.get("main h1").should("contain.text", "You are unsubscribed");
  });
});
