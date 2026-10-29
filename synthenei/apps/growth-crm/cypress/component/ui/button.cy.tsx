import { keys } from "../../support/keyboard";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("shows a focus ring on keyboard focus and fires on Enter", () => {
    const onClick = cy.stub().as("click");
    cy.mount(<Button variant="primary" onClick={onClick}>Save</Button>);
    cy.get("button").focus().should("have.css", "outline-style", "solid");
    keys("{Enter}");
    cy.get("@click").should("have.been.calledOnce");
  });
  it("disabledReason keeps focus, blocks click and explains why", () => {
    const onClick = cy.stub().as("click");
    cy.mount(<Button disabledReason="Needs the leads.export permission" onClick={onClick}>Export</Button>);
    cy.get("button").should("have.attr", "aria-disabled", "true").focus();
    cy.contains("Needs the leads.export permission").should("exist");
    cy.get("button").click({ force: true });
    cy.get("@click").should("not.have.been.called");
  });
  it("uses the control radius, not a pill", () => {
    cy.mount(<Button>Plain</Button>);
    cy.get("button").should("have.css", "border-top-left-radius", "8px");
  });
});
