import { LEADS_EMPTY, INTEGRATIONS_EMPTY } from "@/components/empty/definitions";
import { ModuleEmpty, genericEmpty } from "@/components/empty/module-empty";

describe("ModuleEmpty", () => {
  it("shows the module's title, body and a link-styled CTA to its next step", () => {
    cy.mount(<ModuleEmpty def={LEADS_EMPTY} />);
    cy.contains("No leads yet");
    cy.contains("Leads come in from your landing page");
    cy.contains("a", "Import leads").should("have.attr", "href", "/import");
  });
  it("every shipped definition points at a real route and has non-empty copy", () => {
    for (const def of [LEADS_EMPTY, INTEGRATIONS_EMPTY]) {
      expect(def.href.startsWith("/")).to.be.true;
      expect(def.title.length).to.be.greaterThan(0);
      expect(def.cta.length).to.be.greaterThan(0);
    }
  });
  it("genericEmpty is a safe fallback for a module without its own def yet", () => {
    cy.mount(<ModuleEmpty def={genericEmpty("Nothing here")} />);
    cy.contains("Nothing here");
    cy.contains("a", "Go to Settings").should("have.attr", "href", "/settings");
  });
});
