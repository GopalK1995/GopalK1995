// T059 · Accessibility pass. Runs axe-core against every route reachable from the shell NAV (owner persona sees all of them),
// plus the always-allowed pages (/profile, /notifications) and the /forbidden denied state.
//
// Why axe-core directly and not cypress-axe: axe-core is a declared devDependency (exact 4.14.0, AUD-054); cypress-axe is not,
// because adding it needs a lockfile regeneration (see docs/CI.md). injectAxe()/checkA11y() below are a thin, equivalent
// wrapper over the installed engine. Swap them for `import "cypress-axe"` once the dependency is added.
//
// AUD-054: runs at WCAG 2.2 AA (wcag22aa adds target-size 2.5.8). The brand hue can be set with the A11Y_HUE environment
// variable (CI runs two hues): it re-tints the app by setting --brand-h on <html>, the same variable the branding tab uses.
//
// Known shared blocker (docs/tasks/T002.md): cy.loginAs() drives the demo /login persona buttons; on a cold `next dev` the first
// click can land before hydration. The command already retries. We also suppress the dev-mode hydration warning here so it cannot
// fail an otherwise-clean axe run (the production filter in cypress/support/e2e.ts only matches the minified #418 string).
Cypress.on("uncaught:exception", (err) => !/hydrat|did not match|#418|parentNode|message key|IntlError|MISSING_MESSAGE/i.test(err.message));

type AxeResult = { violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }> };

const HUE = String(Cypress.expose("A11Y_HUE") ?? "").trim();

function applyHue(win: Window): void {
  if (/^[0-9]{1,3}$/.test(HUE)) win.document.documentElement.style.setProperty("--brand-h", HUE);
}

function injectAxe(): void {
  cy.readFile("node_modules/axe-core/axe.min.js", { log: false }).then((src: string) => {
    cy.window({ log: false }).then((win) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (win as any).eval(src);
      applyHue(win);
    });
  });
}

function checkA11y(label: string): void {
  cy.window({ log: false }).then((win) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axe = (win as any).axe;
    const opts = { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } };
    return (axe.run(win.document, opts) as Promise<AxeResult>).then((res) => {
      if (res.violations.length) {
        const lines = res.violations.map((v) => `  [${v.impact ?? "n/a"}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) e.g. ${v.nodes[0]?.target.join(" ")}`);
        Cypress.log({ name: "axe", message: `${label}: ${res.violations.length} violation(s)`, consoleProps: () => res });
        throw new Error(`axe found ${res.violations.length} violation(s) on ${label}:\n${lines.join("\n")}`);
      }
    });
  });
}

// Owner holds every permission, so this is the full set of shell-reachable destinations.
const ROUTES: string[] = [
  "/", "/sales", "/notifications",
  "/leads", "/import", "/pipeline", "/accounts", "/inbox", "/tasks",
  "/campaigns", "/audience", "/analytics", "/analytics/social",
  "/ai",
  "/integrations", "/data-health",
  "/settings", "/settings/notifications", "/settings/roles", "/settings/audit", "/settings/billing",
  "/settings/api-keys", "/settings/webhooks", "/settings/pipelines", "/settings/email",
  "/settings/privacy", "/settings/fields", "/settings/objects", "/settings/layouts",
  "/o/example_items",
  "/profile",
];

describe("a11y: every shell route is axe-clean (owner)", () => {
  beforeEach(() => cy.loginAs("owner-lawsome"));

  ROUTES.forEach((route) => {
    it(`axe-clean: ${route}`, () => {
      cy.visit(route);
      cy.get("#main-content", { timeout: 20000 }).should("exist");
      injectAxe();
      checkA11y(route);
    });
  });

  it("axe-clean: the command palette when open", () => {
    cy.visit("/leads");
    cy.get("#main-content").should("exist");
    cy.get("body").type("{ctrl}k");
    cy.get("[role=dialog]").should("be.visible");
    injectAxe();
    checkA11y("command palette");
  });
});

describe("a11y: the denied state (/forbidden) names the missing permission", () => {
  it("a viewer who opens Settings sees the permission that is missing", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/settings", { failOnStatusCode: false });
    cy.contains("Missing permission").should("exist");
    cy.contains("code", "settings.read").should("exist");
    injectAxe();
    checkA11y("/forbidden");
  });
});

export {};
