// The wizard's own mechanics (resume, required-vs-optional, finish gating) are fully exercisable in demo mode: every
// onboarding action writes its progress to a real per-tenant cookie even in a demo session (src/app/(app)/onboarding/_lib/state-store.ts),
// only the underlying business action (saveConfig, inviteMember) short-circuits. The admin "creates a brand-new org,
// invites its owner" half cannot be demo-driven at all -- src/app/admin/_components/actions.ts createTenant's demo
// branch only reports what it would do and never adds a real tenant -- so that half is real-session only.
import { creds } from "../settings/_helpers";

const cookieName = "onboarding_lawsome"; // owner-lawsome's tenant id is "lawsome" (src/lib/demo/tenancy-fixture.ts)

describe("onboarding: wizard mechanics (demo)", () => {
  beforeEach(() => { cy.clearCookie(cookieName); cy.loginAs("owner-lawsome"); cy.visit("/onboarding"); });

  it("walks every step, including the optional ones, and only then enables Finish", () => {
    cy.contains("button", "Finish setup").should("be.disabled");

    // 1. template
    cy.contains("button", "Legal practice").click();
    cy.contains("Demo: shown as sample progress, nothing is saved.").should("be.visible");

    // 2. branding. The contrast gate is real (recomputed server-side, see actions.ts) but every hue 0-359 passes it
    // at this app's fixed accent/navy lightness values, so there is no "bad hue" to assert a disabled Save against.
    cy.contains("button", "Branding").click();
    cy.get("input[aria-label='Accent hue']").invoke("val", 180).trigger("input").trigger("change");
    cy.contains("button", "Save branding").should("be.enabled").click();

    // 3. modules
    cy.contains("button", "Modules").click();
    cy.contains("button", "Save modules").click();

    // 4 & 5: pipelines and fields are "confirm you did it" steps pointing at their own full editors.
    cy.contains("button", "Pipeline").click();
    cy.contains("button", "Mark as done").click();
    cy.contains("button", "Custom fields").click();
    cy.contains("button", "Mark as done").click();

    // 6. team
    cy.contains("button", "Invite your team").click();
    cy.get("input[type=email]").type("newhire@example.com");
    cy.contains("button", "Send invite").click();

    cy.contains("button", "Finish setup").should("be.enabled"); // every required step done; optional ones still todo

    // 7 & 8: optional steps can be skipped without blocking finish.
    cy.contains("button", "Connect an integration").click();
    cy.contains("button", "Skip for now").click();
    cy.contains("button", "Import leads").click();
    cy.contains("button", "Skip for now").click();

    cy.contains("button", "Finish setup").should("be.enabled").click();
    cy.location("pathname", { timeout: 10000 }).should("eq", "/");
  });

  it("resumes at the first unanswered step after a reload", () => {
    cy.contains("button", "Legal practice").click();
    cy.contains("button", "Branding").should("have.attr", "aria-current", "true");
    cy.reload();
    cy.contains("button", "Branding").should("have.attr", "aria-current", "true"); // the cookie survived the reload
  });

  it("finish stays disabled while any required step is unanswered, even with every optional step skipped", () => {
    cy.contains("button", "Connect an integration").click();
    cy.contains("button", "Skip for now").click();
    cy.contains("button", "Import leads").click();
    cy.contains("button", "Skip for now").click();
    cy.contains("button", "Finish setup").should("be.disabled");
  });
});

const owner = creds("OWNER");
const real = !!owner.email && !!owner.password;
(real ? describe : describe.skip)("onboarding: admin creates an org, owner completes setup (real)", () => {
  it("a brand-new tenant lands its owner on an empty onboarding wizard", () => {
    // Needs CYPRESS_QA_OWNER_EMAIL/_PASSWORD for an owner of a tenant created fresh on staging (no onboarding progress yet).
    cy.loginReal({ email: owner.email!, password: owner.password! });
    cy.visit("/onboarding");
    cy.contains("button", "Finish setup").should("be.disabled");
    cy.contains("button", "Legal practice").should("be.visible");
  });
});
