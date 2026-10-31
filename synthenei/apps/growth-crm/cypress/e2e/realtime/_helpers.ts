// Shared by the realtime specs. Real-session specs need the staging branch DB with qa-* users (CONTRACTS C16.3) and
// CYPRESS_NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY. Written, NOT run in light mode.
export const cred = (key: "MANAGER" | "REP" | "REP2") => ({
  email: Cypress.expose(`QA_${key}_EMAIL`) as string | undefined,
  password: Cypress.expose(`QA_${key}_PASSWORD`) as string | undefined,
});
export function loginOrSkip(ctx: Mocha.Context, key: Parameters<typeof cred>[0]) {
  const c = cred(key);
  if (!c.email || !c.password) ctx.skip();
  cy.loginReal({ email: c.email!, password: c.password! });
}
/** A second, headless session: password grant against GoTrue, so a "colleague" can act while the browser shows another user. */
export function peerToken(key: Parameters<typeof cred>[0]): Cypress.Chainable<string> {
  const c = cred(key);
  const url = String(Cypress.expose("NEXT_PUBLIC_SUPABASE_URL"));
  return cy.request({ method: "POST", url: `${url}/auth/v1/token?grant_type=password`, headers: { apikey: String(Cypress.expose("NEXT_PUBLIC_SUPABASE_ANON_KEY")) }, body: { email: c.email, password: c.password }, log: false })
    .its("body.access_token") as Cypress.Chainable<string>;
}
export const rest = (path: string) => `${String(Cypress.expose("NEXT_PUBLIC_SUPABASE_URL"))}/rest/v1/${path}`;
export const apikey = () => String(Cypress.expose("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
