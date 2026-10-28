import { DEMO_SUPER_CODE, type Persona } from "./personas";

export interface RealUser {
  email: string;
  password: string;
}

declare global {
  namespace Cypress {
    interface Chainable {
      /** Demo mode: click the persona button on /login (or the platform-admin code flow for "super"). */
      loginAs(persona: Persona): Chainable<void>;
      /** Staging: sign in a seeded Supabase user. Refuses to run against the production project. */
      loginReal(user: RealUser): Chainable<void>;
    }
  }
}

Cypress.Commands.add("loginAs", (persona: Persona) => {
  cy.session(["demo", persona], () => {
    if (persona === "super") {
      cy.visit("/admin/login?step=code");
      cy.get("input[name=code]").type(DEMO_SUPER_CODE);
      cy.get("form button").last().click();
    } else {
      cy.visit("/login");
      cy.get(`button[data-persona="${persona}"]`).click();
    }
    cy.location("pathname", { timeout: 60000 }).should("not.match", /\/login$/);
  });
});

Cypress.Commands.add("loginReal", (user: RealUser) => {
  const url = String(Cypress.expose("NEXT_PUBLIC_SUPABASE_URL") ?? "");
  const prodRef = String(Cypress.expose("PROD_SUPABASE_REF") ?? "evybdanqxgkjoybrvzru");
  if (!url) throw new Error("loginReal: NEXT_PUBLIC_SUPABASE_URL is not set (export it before running Cypress).");
  if (url.includes(prodRef) && !Cypress.expose("ALLOW_PROD")) {
    throw new Error("loginReal refused: Supabase URL points at the production project. Set CYPRESS_ALLOW_PROD only for an approved production smoke.");
  }
  cy.session(["real", user.email], () => {
    cy.visit("/login");
    cy.get("input[name=email]").type(user.email);
    cy.get("input[name=password]").type(user.password, { log: false });
    cy.get("form button[type=submit]").click();
    cy.location("pathname", { timeout: 60000 }).should("not.match", /\/login$/);
  });
});

export {};
