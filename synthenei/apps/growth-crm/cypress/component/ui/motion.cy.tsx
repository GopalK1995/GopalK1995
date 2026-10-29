import { FadeSlide } from "@/components/ui/motion";

describe("motion helpers", () => {
  it("renders content after a user-caused change", () => {
    cy.mount(<FadeSlide><p>Saved</p></FadeSlide>);
    cy.contains("Saved").should("be.visible");
  });
});
