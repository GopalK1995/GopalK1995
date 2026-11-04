// Click-until helper: a click that lands before React hydrates (or during a navigation) is a silent no-op in a production build.
// Click, wait briefly, and click again until `done` reports the expected result. Callers still assert the outcome afterwards.
export function clickUntil(target: () => { click(): unknown }, done: ($body: JQuery<HTMLBodyElement>) => boolean, tries = 5): void {
  target().click();
  cy.wait(1200);
  cy.get("body").then(($body) => {
    if (!done($body) && tries > 0) clickUntil(target, done, tries - 1);
  });
}

/** Click a link and retry until the browser is on a path matching `path`. */
export function clickLinkUntilPath(target: () => { click(): unknown }, path: RegExp, tries = 5): void {
  target().click();
  cy.wait(1200);
  cy.location("pathname").then((p) => {
    if (!path.test(p) && tries > 0) clickLinkUntilPath(target, path, tries - 1);
  });
}

/** Click a link and retry until the query string no longer matches `gone` (e.g. a "Clear filters" link). */
export function clickLinkUntilSearchLacks(target: () => { click(): unknown }, gone: string, tries = 5): void {
  target().click();
  cy.wait(1200);
  cy.location("search").then((s) => {
    if (s.includes(gone) && tries > 0) clickLinkUntilSearchLacks(target, gone, tries - 1);
  });
}
