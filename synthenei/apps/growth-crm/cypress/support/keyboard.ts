import userEvent from "@testing-library/user-event";

/**
 * Real keyboard input for component specs. Cypress `.type("{enter}")` and `cy.press` only dispatch key events;
 * they do not trigger the browser's default activation (Enter/Space clicking a focused button), so they cannot
 * prove keyboard operability. user-event dispatches the full sequence including activation behaviour.
 * Uses the currently focused element, so call `.focus()` first.
 */
export function keys(sequence: string) {
  return cy.wrap(null, { log: false }).then(() => userEvent.keyboard(sequence)).then(() => undefined);
}
