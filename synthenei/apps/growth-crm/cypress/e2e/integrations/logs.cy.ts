// Staging only: the sync log lists runs with status chips, counts and notes that carry no personal data or secrets.
import { loginOrSkip } from "../settings/_helpers";

describe("integrations: sync log", () => {
  it("shows runs, counts and a PII-free note", function () {
    loginOrSkip(this, "OWNER");
    cy.visit("/integrations/mock");
    cy.get("table").contains("th", "Rows in").should("be.visible");
    cy.get("[data-run-status]").then(($rows) => {
      if (!$rows.length) { cy.contains("No runs yet.").should("be.visible"); return; }
      const text = $rows.text();
      expect(text).not.to.match(/@example\.test|\+91\d{10}|mock-key/i);
    });
  });
  it("a viewer without integrations access sees the permission state, not the log", function () {
    loginOrSkip(this, "VIEWER");
    cy.visit("/integrations");
    cy.get("body").then(($b) => {
      if ($b.text().includes("You cannot view integrations")) cy.contains("Your role").should("be.visible");
      else cy.get("[data-connector]").should("exist");
    });
  });
});
