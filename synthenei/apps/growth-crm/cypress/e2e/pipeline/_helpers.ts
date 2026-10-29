// Shared by the pipeline specs. Real-session specs need a staging branch DB with seeded qa-* users (CONTRACTS C16.3);
// credentials come from CYPRESS_QA_<KEY>_EMAIL / _PASSWORD (cypress.env.json, git-ignored). Written, NOT run in light mode.
export const creds = (key: "OWNER" | "MANAGER" | "REP" | "REP2" | "VIEWER") => ({
  email: Cypress.expose(`QA_${key}_EMAIL`) as string | undefined,
  password: Cypress.expose(`QA_${key}_PASSWORD`) as string | undefined,
});
export function loginOrSkip(ctx: Mocha.Context, key: Parameters<typeof creds>[0]) {
  const c = creds(key);
  if (!c.email || !c.password) ctx.skip();
  cy.loginReal({ email: c.email!, password: c.password! });
}
export const card = (name: string | RegExp) => cy.contains("li", name);
/** Opens the keyboard "Move to" menu on a card and picks a stage. */
export function moveVia(name: string | RegExp, stage: string | RegExp) {
  card(name).find("button[aria-label^='Move']").click();
  cy.contains("[role=menuitem]", stage).click();
}
/** First word-ish label of the first card in a column, used to find the same card after a reload. */
export const firstCardName = (stage: string) =>
  cy.get(`[data-stage='${stage}'] li`, { timeout: 30000 }).first().invoke("text").then((t) => t.trim().split("\n")[0].slice(0, 12));
