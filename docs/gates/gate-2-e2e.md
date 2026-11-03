# Gate 2 e2e report (demo mode, production server)

Branch fix/gate2-e2e. Run: `start-server-and-test "next start -p 3203" ... "cypress run --e2e"`, no Supabase env.

## Failing tests and decisions

| Test | Verdict | File changed | Why |
|---|---|---|---|
| contacts/crud: not-connected state | App bug | src/lib/auth/roles.ts | `/contacts` was missing from the page-access matrix, so default-deny returned 403 for every role. It now follows `/accounts` access. |
| audit/org-viewer (3) | App bug + spec | src/lib/authz/load.ts, cypress/e2e/audit/org-viewer.cy.ts | Demo principal lacked seeded permissions (`audit.read`), so the demo Owner saw "You cannot read the audit log" while the real Owner can. Demo/fallback principal now fills grants from the frozen seed (never overriding derived ones; matrix.json untouched). Spec: `{enter}` does not submit in Cypress 16 (click Apply filters) and Clear needs the URL to change before asserting. |
| accounts/merge | App gap | src/app/(app)/accounts/[id]/page.tsx, merge.cy.ts | Demo merge dialog offered no target. Demo now lists the other fixture accounts; spec picks the first enabled option instead of index 1. |
| admin/platform-roles (tenant user) | Spec | platform-roles.cy.ts | The 403 is a rewrite, URL stays `/admin/tenants`; now asserts the denial page and absence of the policy tab. |
| i18n/switch-language (Tamil) | Spec | switch-language.cy.ts | Tamil UI is build-flagged off; test skips unless `CYPRESS_TAMIL_UI=1`. |
| leads/log-activity (out-of-hours) | Spec | log-activity.cy.ts | Browser min/max on the time input (08:00 to 20:00) blocks submit before the server message; asserts `rangeUnderflow` and that nothing was saved. |
| ops/queue | Spec | queue.cy.ts | Needs real queues; skips without Supabase env, logs in as super admin when it runs. |
| settings/change-role (2) | Spec | change-role.cy.ts | First "Sales Rep" row was the locked own row (every select lists all roles); targets Arun Kumar and a different role. "you" tag runs into the e-mail in row text so `\b` never matched; row found by name. |
| settings/no-escalation (demo rep) | Spec | no-escalation.cy.ts | Forbidden page is a rewrite (URL unchanged); asserts the page text. Real-only `you` selector also fixed. |
| settings/support-blocked (2) | Spec | support-blocked.cy.ts | `reason2` exists only in read_write (hydration race on forced radio check also removed); read_only acts as Viewer so settings is a 403 page, read_write gets the support-denied message. |
| tenancy/switch-workspace | Spec | switch-workspace.cy.ts | Shell renders two switchers (mobile + sidebar); uses the visible one. |
| accounts/crud (1) | Flaky | none | Passed on rerun (first-load hydration race). |

## Build fixes needed after rebase (outside my brief, flagged)
T025 code on build/v1 broke `next build`: `src/app/(app)/settings/api-keys/_components/keys-view.tsx` (client component) imported `src/lib/api/keys.ts` (node:crypto); and `src/lib/api/handler.ts` returned a handler with an optional second argument, which Next's route type check rejects. Minimal fixes: local `maskedKey` copy in the client file; exported handler typed as an overload pair (implementation unchanged). The T025 owner should confirm.

## Security
No role-escalation or tenant-leak failure found. The `/contacts` 403 was an over-deny. The demo principal fix only adds grants the real seed already gives that role (viewer-in-support gets viewer grants).

## Update after merging origin/build/v1 (second pass)
Merged 9 further commits cleanly (no conflicts). Typecheck clean, lint 0 errors (97 pre-existing warnings), Vitest 70 files / 1020 tests passing. No further app or spec changes were needed: all 16 failing tests were already addressed above.
Unverified (Cypress not run in this pass): every spec fix above, especially ops/queue (skips without Supabase env), i18n Tamil (skips without CYPRESS_TAMIL_UI=1), and the demo merge-target and audit-grant app changes. The integrator should rerun the demo-mode e2e suite on the merged build. Shell/nav files were not touched (integ1 owns them).
