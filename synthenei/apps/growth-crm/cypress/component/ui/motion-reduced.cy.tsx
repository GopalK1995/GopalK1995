import { FadeSlide } from "@/components/ui/motion";

// Own spec file on purpose: motion reads prefers-reduced-motion once per page and caches it, so the emulation
// must be in place before the first FadeSlide ever mounts. Cypress loads each spec in a fresh page.
describe("motion helpers under prefers-reduced-motion", () => {
  before(() => {
    cy.wrap(Cypress.automation("remote:debugger:protocol", { command: "Emulation.setEmulatedMedia", params: { features: [{ name: "prefers-reduced-motion", value: "reduce" }] } }));
  });
  after(() => {
    cy.wrap(Cypress.automation("remote:debugger:protocol", { command: "Emulation.setEmulatedMedia", params: { features: [{ name: "prefers-reduced-motion", value: "" }] } }));
  });
  it("is a plain wrapper", () => {
    cy.mount(<FadeSlide><p>Saved</p></FadeSlide>);
    cy.window().then((w) => expect(w.matchMedia("(prefers-reduced-motion: reduce)").matches).to.eq(true));
    cy.contains("Saved").parent().should("not.have.attr", "style");
  });
});
