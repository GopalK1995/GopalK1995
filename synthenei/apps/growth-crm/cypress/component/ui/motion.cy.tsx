import { FadeSlide } from "@/components/ui/motion";

describe("motion helpers", () => {
  it("renders content after a user-caused change", () => {
    cy.mount(<FadeSlide><p>Saved</p></FadeSlide>);
    cy.contains("Saved").should("be.visible");
  });
  it("is a plain wrapper under prefers-reduced-motion", () => {
    cy.wrap(Cypress.automation("remote:debugger:protocol", { command: "Emulation.setEmulatedMedia", params: { features: [{ name: "prefers-reduced-motion", value: "reduce" }] } }));
    cy.mount(<FadeSlide><p>Saved</p></FadeSlide>);
    cy.contains("Saved").parent().should("not.have.attr", "style");
  });
});
