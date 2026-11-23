// UI channel of the authorization matrix (T057). BUILD-PLAN: "sampling one route per permission" for the UI.
// For each demo persona we hit one route governed by a distinct page permission and assert the HTTP status (200 open /
// 403 forbidden) matches the matrix.json decision for that role's list-level grant. The server enforces this in
// src/middleware.ts (accessFor -> /forbidden rewrite with status 403), so this exercises the real UI server guard, not
// just the client nav. A failing cell names the role, route and permission.
//
// Runs in DEMO mode (no real Supabase). Only the four roles with a demo persona are covered here (owner, sales_rep,
// marketing, viewer); sales_manager and data have no demo persona and are covered by the SQL channel
// (supabase/tests/authz_matrix.test.sql). Routes are chosen to govern a non-module-gated permission and to not
// redirect for any of these roles, so status is an unambiguous 200/403.
import { PERSONA_FOR, listAllow } from "./_helpers";

const ROUTES: { path: string; perm: string }[] = [
  { path: "/sales", perm: "myday.read" },
  { path: "/leads", perm: "leads.read" },
  { path: "/pipeline", perm: "deals.read" },
  { path: "/settings", perm: "settings.read" },
];

describe("authz-matrix UI channel: page access matches the matrix", () => {
  for (const [role, persona] of Object.entries(PERSONA_FOR)) {
    for (const { path, perm } of ROUTES) {
      const expected = listAllow(role, perm);
      it(`${role} ${expected ? "opens" : "is 403 on"} ${path} (${perm})`, () => {
        cy.loginAs(persona as never);
        cy.request({ url: path, failOnStatusCode: false, followRedirect: false }).its("status").should("eq", expected ? 200 : 403);
      });
    }
  }
});
