// Shared by the tasks and My day specs. Real-session specs need a staging branch DB with seeded qa-* users (CONTRACTS C16.3);
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
export const taskRow = (title: string | RegExp) => cy.contains("[data-testid=task-row]", title);
export const stamp = () => `T016 ${Date.now().toString(36)}`;
/** Creates a task through the dialog; due tomorrow 17:30 IST by default. */
export function createViaDialog(title: string) {
  cy.contains("button", /New task/i).click();
  cy.get("input[name=title]").type(title);
  cy.contains("button", /Create task/i).click();
  cy.contains(/Task created/i).should("be.visible");
}
