// Shared by the public API specs. Real-session specs need the staging branch DB with seeded qa-* users (CONTRACTS C16.3);
// credentials come from CYPRESS_QA_<KEY>_EMAIL / _PASSWORD. Written, NOT run in light mode.
export const creds = (key: "OWNER" | "MANAGER" | "REP" | "VIEWER" | "SHOLA") => ({
  email: Cypress.expose(`QA_${key}_EMAIL`) as string | undefined,
  password: Cypress.expose(`QA_${key}_PASSWORD`) as string | undefined,
});
export function loginOrSkip(ctx: Mocha.Context, key: Parameters<typeof creds>[0]) {
  const c = creds(key);
  if (!c.email || !c.password) ctx.skip();
  cy.loginReal({ email: c.email!, password: c.password! });
}
export const stamp = () => `t025-${Date.now().toString(36)}`;
export const api = (path: string) => `/api/v1${path}`;
export const bearer = (key: string) => ({ authorization: `Bearer ${key}` });
export const KEY_RE = /sk_(live|test)_[0-9A-Za-z]{8}_[0-9A-Za-z]{32}/;

/** Creates a key through the settings screen and yields the one-time secret. */
export function createKeyViaUi(opts: { name: string; role?: string; scopes: string[] }) {
  cy.visit("/settings/api-keys");
  cy.contains("button", /^Create key$/).click();
  cy.get("[role=dialog]").within(() => {
    cy.get("input").first().type(opts.name);
    if (opts.role) cy.contains("label", /^Role/).parent().find("button[role=combobox]").click();
  });
  if (opts.role) cy.get("[role=option]").contains(new RegExp(opts.role, "i")).click();
  cy.get("[role=dialog]").within(() => {
    for (const s of opts.scopes) cy.get(`[aria-label="${s}"]`).click();
    cy.contains("button", /^Create key$/).click();
  });
  return cy.get("[data-testid=issued-key]").invoke("text").then((t) => {
    expect(t).to.match(KEY_RE);
    return t.trim();
  });
}

/** Skips the spec unless the server under test matches: real mode has Supabase env exposed to Cypress, demo does not. */
export function requireMode(ctx: Mocha.Context, mode: "demo" | "real") {
  const real = Boolean(Cypress.expose("NEXT_PUBLIC_SUPABASE_URL"));
  if ((mode === "real") !== real) ctx.skip();
}
