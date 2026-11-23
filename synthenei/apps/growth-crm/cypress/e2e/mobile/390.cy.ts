// T059 · Mobile pass. No horizontal scroll at 390px on every shell-reachable route, in English and (when the Tamil UI gate is open)
// in Tamil. The no-overflow assertion reuses the existing pattern from cypress/e2e/search/palette.cy.ts and i18n/switch-language.cy.ts:
//   documentElement.scrollWidth <= clientWidth
// To test Tamil the dev server / build must set NEXT_PUBLIC_TAMIL_UI=1 (Tamil is gated off by default, owner blocker B-9). When the
// gate is closed the locale falls back to English; the test then still verifies 390px no-overflow, and logs which locale was active.
Cypress.on("uncaught:exception", (err) => !/hydrat|did not match|#418|parentNode|message key|IntlError|MISSING_MESSAGE/i.test(err.message));

const W = 390;
const ROUTES = ["/", "/sales", "/leads", "/pipeline", "/accounts", "/inbox", "/tasks", "/campaigns", "/audience", "/analytics", "/ai", "/integrations", "/data-health", "/settings", "/settings/roles", "/settings/billing", "/o/example_items", "/profile"];

function expectNoHScroll(route: string): void {
  cy.document().then((doc) => {
    const el = doc.documentElement;
    expect(el.scrollWidth, `no horizontal overflow at ${W}px on ${route}`).to.be.at.most(el.clientWidth);
  });
}

describe("mobile 390px: no horizontal scroll (owner, English)", () => {
  beforeEach(() => {
    cy.viewport(W, 844);
    cy.loginAs("owner-lawsome");
  });

  ROUTES.forEach((route) => {
    it(`no horizontal scroll: ${route}`, () => {
      cy.visit(route);
      cy.get("#main-content", { timeout: 20000 }).should("exist");
      expectNoHScroll(route);
    });
  });

  it("the bottom quick-nav and the drawer are reachable and the drawer closes", () => {
    cy.visit("/");
    cy.get('nav[aria-label="Quick"]').should("be.visible");
    cy.get('button[aria-label="More destinations"]').click();
    cy.get('[role=dialog], [data-state=open]').should("exist");
    expectNoHScroll("/ (drawer open)");
  });

  it("the command palette fits and does not overflow at 390px", () => {
    cy.visit("/leads");
    cy.get("#main-content").should("exist");
    cy.get("body").type("{ctrl}k");
    cy.get("[role=dialog]").should("be.visible").invoke("outerWidth").should("be.lte", W);
    expectNoHScroll("/leads (palette open)");
  });
});

describe("mobile 390px: Tamil locale fits", () => {
  const TA_ROUTES = ["/", "/leads", "/pipeline", "/settings"];

  TA_ROUTES.forEach((route) => {
    it(`Tamil, no horizontal scroll: ${route}`, () => {
      cy.viewport(W, 844);
      // owner-lawsome, not rep-lawsome: sales_rep has no settings.read grant (src/lib/authz/catalog/system-roles.ts),
      // so /settings 403s for that persona -- this check is about Tamil text overflow, not authz, so any
      // fully-permissioned persona works; owner also matches the English-locale block above.
      cy.loginAs("owner-lawsome");
      cy.setCookie("gcrm_lang", "ta");
      cy.visit(route);
      cy.get("#main-content", { timeout: 20000 }).should("exist");
      cy.get("html").invoke("attr", "lang").then((lang) => {
        // Tamil only applies when NEXT_PUBLIC_TAMIL_UI=1 at build time; otherwise it is English (gate closed) and we still check overflow.
        Cypress.log({ name: "locale", message: `${route}: html lang=${lang}` });
        expectNoHScroll(`${route} (lang ${lang})`);
      });
    });
  });
});

export {};
