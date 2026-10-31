// Real-session specs need a staging branch DB with seeded qa-* users; credentials from CYPRESS_QA_<KEY>_EMAIL/_PASSWORD.
// Written, NOT run in light mode. The record page must mount <RecordCollab/> (see docs/tasks/T027.md, Needs from integrator).
export const creds = (key: "OWNER" | "REP" | "REP2" | "VIEWER") => ({
  email: Cypress.expose(`QA_${key}_EMAIL`) as string | undefined,
  password: Cypress.expose(`QA_${key}_PASSWORD`) as string | undefined,
});
export function loginOrSkip(ctx: Mocha.Context, key: Parameters<typeof creds>[0]) {
  const c = creds(key);
  if (!c.email || !c.password) ctx.skip();
  cy.loginReal({ email: c.email!, password: c.password! });
}
export const stamp = () => `T027 ${Date.now().toString(36)}`;
