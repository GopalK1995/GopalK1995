// Shared by the outbound webhook specs (T024). Real-session specs need the staging branch DB with seeded qa-* users and, for
// delivery, a PUBLIC https receiver in CYPRESS_WEBHOOK_ECHO_URL (the SSRF guard correctly refuses localhost, so a local echo
// server cannot be used end to end; unit tests cover the delivery path against a fake transport). Written, NOT run in light mode.
export const creds = (key: "OWNER" | "MANAGER" | "VIEWER") => ({
  email: Cypress.expose(`QA_${key}_EMAIL`) as string | undefined,
  password: Cypress.expose(`QA_${key}_PASSWORD`) as string | undefined,
});
export function loginOrSkip(ctx: Mocha.Context, key: Parameters<typeof creds>[0]) {
  const c = creds(key);
  if (!c.email || !c.password) ctx.skip();
  cy.loginReal({ email: c.email!, password: c.password! });
}
export function requireMode(ctx: Mocha.Context, mode: "demo" | "real") {
  const real = Boolean(Cypress.expose("NEXT_PUBLIC_SUPABASE_URL"));
  if ((mode === "real") !== real) ctx.skip();
}
export const echoUrl = () => (Cypress.expose("WEBHOOK_ECHO_URL") as string | undefined) ?? "";
export const stamp = () => `t024-${Date.now().toString(36)}`;

/** Opens the Add endpoint dialog, fills it and saves. Yields nothing; the secret panel appears on success. */
export function addEndpointViaUi(opts: { url: string; description?: string; events?: string[] }) {
  cy.visit("/settings/webhooks");
  cy.contains("button", /^Add endpoint$/).click();
  cy.get("[role=dialog]").within(() => {
    cy.get("input").first().clear().type(opts.url);
    if (opts.description) cy.contains("label", /^Description/).parent().find("input").type(opts.description);
    for (const e of opts.events ?? ["lead.created"]) cy.get(`[aria-label="${e}"]`).click();
    cy.contains("button", /^Save$/).click();
  });
}
