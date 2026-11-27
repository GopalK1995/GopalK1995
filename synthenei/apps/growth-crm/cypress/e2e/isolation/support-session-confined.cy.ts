// T058 · A support session is confined to the single workspace it was opened for: a platform admin gets no business
// data anywhere without a session, and starting one for workspace X never unlocks a different workspace Y. The RLS proof
// (admin with an active read_write session on ws A sees ws A, but neither ws C of the same tenant nor ws B of another
// tenant; admin with no session sees nothing) is in supabase/tests/isolation_all_tables.test.sql section 3b.3. This spec
// exercises the demo UI/HTTP surface. Demo mode.
//
// Verified against real middleware behaviour (src/middleware.ts, src/lib/auth/context.ts resolveHint): the `?ws=`
// deep-link switch is explicitly skipped for platform admins (middleware.ts "if (wsParam && !session.platformAdmin)"),
// so it is not a real access vector for this role either way -- asserting 403 on it is the wrong probe:
//   - No session: resolveHint returns null for a platform admin with no support cookie, so middleware's
//     `if (!active) return redirect("/admin")` fires -- a safe 307 away from any business page, not a 403.
//   - Active session on workspace A: resolveHint binds the active workspace strictly to `support.ws` and never reads
//     the `?ws=` query param, so a request naming a foreign workspace is served 200 -- but with A's own data, not the
//     foreign tenant's. The real confinement proof is therefore "the body always reflects the session's own
//     workspace, never the queried one", not a status code.
const req = (url: string) => cy.request({ url, failOnStatusCode: false, followRedirect: false });

describe("isolation: support session is confined to one workspace", () => {
  it("a platform admin with no session reaches no tenant's workspace", () => {
    cy.loginAs("super");
    // the super admin is a member of nothing; `?ws=` is a no-op for this role, so every deep-link redirects to
        // /admin (never to the business page itself -- no tenant data is ever in the response).
    for (const url of ["/?ws=lawsome-tn", "/leads?ws=shola-mist-coonoor", "/leads?ws=kaveri-cbe"]) {
      req(url).then((r) => {
        expect(r.status, url).to.eq(307);
        expect(new URL(r.redirectedToUrl ?? r.headers.location as string, "http://localhost").pathname, url).to.eq("/admin");
      });
    }
  });

  it("an open session does not extend to a workspace of another tenant", () => {
    cy.loginAs("super");
    cy.visit("/admin/support");
    cy.hydrated();
    cy.get("textarea[name=reason]", { timeout: 15000 }).should("not.be.disabled").type("Ticket T058: isolation confinement check for the Tamil Nadu workspace");
    cy.contains("button", "Start session and open workspace").click();
    cy.location("pathname", { timeout: 60000 }).should("eq", "/");
    // the session was opened for the Tamil Nadu (legal) workspace. `?ws=` naming a different tenant's workspace is
    // ignored by resolveHint, not honoured -- the response is 200 but must still be the session's own (legal) data,
    // never the foreign tenant's (hospitality) vocabulary. Reuses the vocabulary-leak technique as the real proof.
    for (const url of ["/leads?ws=shola-mist-coonoor", "/leads?ws=kaveri-cbe"]) {
      req(url).then((r) => {
        expect(r.status, url).to.eq(200);
        const body = String(r.body);
        ["Rooms on hold", "Advance pending", "Dates confirmed", "Quote sent"].forEach((w) => expect(body, `${url} leaked "${w}"`).not.to.contain(w));
      });
    }
    // clean up so the session banner does not leak into later specs. endSupport() redirects to
    // /admin?support=ended (src/lib/auth/actions.ts) -- a route this dev server may not have compiled yet, so give
    // it the same long timeout as the other post-redirect assertions above.
    cy.visit("/admin/support");
    cy.hydrated();
    cy.contains("button", "End now").should("be.visible").click();
    cy.contains("Support session ended", { timeout: 60000 }).should("be.visible");
  });
});
