// Shared by the settings (org admin) specs. Real-session specs need the staging branch DB with seeded qa-* users
// (CONTRACTS C16.3); credentials come from CYPRESS_QA_<KEY>_EMAIL / _PASSWORD. Written, NOT run in light mode.
export const creds = (key: "OWNER" | "MANAGER" | "REP" | "VIEWER") => ({
  email: Cypress.expose(`QA_${key}_EMAIL`) as string | undefined,
  password: Cypress.expose(`QA_${key}_PASSWORD`) as string | undefined,
});
export function loginOrSkip(ctx: Mocha.Context, key: Parameters<typeof creds>[0]) {
  const c = creds(key);
  if (!c.email || !c.password) ctx.skip();
  cy.loginReal({ email: c.email!, password: c.password! });
}
export const stamp = () => `t017-${Date.now().toString(36)}`;
export const memberRow = (text: string | RegExp) => cy.contains("tr", text);
/** Opens /settings/roles on the given tab (members | roles | teams). */
export const visitAccess = (tab: "members" | "roles" | "teams" = "members") => cy.visit(`/settings/roles?tab=${tab}`);
