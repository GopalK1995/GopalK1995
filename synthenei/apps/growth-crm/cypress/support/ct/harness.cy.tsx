import * as React from "react";

describe("component harness", () => {
  it("mounts a React component", () => {
    cy.mount(<button type="button">Hello</button>);
    cy.contains("button", "Hello").should("be.visible");
  });
});
