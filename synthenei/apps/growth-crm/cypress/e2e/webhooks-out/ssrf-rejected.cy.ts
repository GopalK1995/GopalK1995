// Outbound webhooks: the SSRF guard at create time. Written, NOT run in light mode.
// The guard also runs on every send (rebinding, redirects, metadata IP): see src/lib/webhooks/__tests__/send.test.ts.
import { addEndpointViaUi, loginOrSkip, requireMode } from "./_helpers";

const BAD: [string, string, RegExp][] = [
  ["plain http", "http://hooks.example.com/x", /must start with https/i],
  ["loopback", "https://127.0.0.1/hook", /not allowed/i],
  ["private range", "https://10.0.0.5/hook", /not allowed/i],
  ["cloud metadata address", "https://169.254.169.254/latest/meta-data", /not allowed/i],
  ["localhost", "https://localhost/hook", /not allowed/i],
  ["credentials in url", "https://user:pw@hooks.example.com/x", /user name or password/i],
];

describe("webhooks-out: SSRF rejected", () => {
  for (const [label, url, msg] of BAD) {
    it(`demo: ${label} is refused with a plain message`, function () {
      requireMode(this, "demo");
      cy.loginAs("owner-lawsome");
      addEndpointViaUi({ url });
      cy.get("[role=dialog]").contains(msg).should("be.visible");
      cy.get("[data-testid=issued-secret]").should("not.exist");
    });
  }

  it("real: a rejected URL creates no endpoint", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    cy.visit("/settings/webhooks");
    cy.get("body").then(($b) => {
      const before = $b.find("tbody tr").length;
      addEndpointViaUi({ url: "https://169.254.169.254/latest/meta-data" });
      cy.get("[role=dialog]").contains(/not allowed/i).should("be.visible");
      cy.contains("button", /^Cancel$/).click();
      cy.reload();
      cy.get("tbody tr").should("have.length", before);
    });
  });
});
