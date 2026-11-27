// Click helpers that gate on hydration instead of hard waits: a click before React hydrates is a silent no-op, so wait for
// <body data-hydrated="true"> (HydrationMarker), click once, then assert the outcome with a retrying cy assertion.
// The `tries` argument is kept for call-site compatibility and is ignored.
export function clickUntil(target: () => { click(): unknown }, done: ($body: JQuery<HTMLBodyElement>) => boolean, _tries = 5): void {
  cy.hydrated();
  target().click();
  cy.get("body").should(($body) => { expect(done($body as JQuery<HTMLBodyElement>), "expected result after click").to.eq(true); });
}

/** Click a link and assert the browser ends up on a path matching `path`. */
export function clickLinkUntilPath(target: () => { click(): unknown }, path: RegExp, _tries = 5): void {
  cy.hydrated();
  target().click();
  cy.location("pathname").should("match", path);
}

/** Click a link and assert the query string no longer contains `gone` (e.g. a "Clear filters" link). */
export function clickLinkUntilSearchLacks(target: () => { click(): unknown }, gone: string, _tries = 5): void {
  cy.hydrated();
  target().click();
  cy.location("search").should("not.contain", gone);
}
