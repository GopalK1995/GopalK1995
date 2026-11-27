# CI for Growth CRM (AUD-054)

Status: written, never run on GitHub. The first run is a shakedown; expect to fix small things.

Layout: the GitHub repo root is `crm-check` and the app is `synthenei/apps/growth-crm`, so the workflows live in the repo root `.github/` and every job sets `working-directory`.

## Files

| File | Purpose |
| --- | --- |
| `.github/workflows/growth-crm-ci.yml` | install, typecheck, lint, unit, build, e2e-smoke, a11y |
| `.github/workflows/growth-crm-advisors.yml` | Supabase advisors gate, manual only |
| `.github/dependabot.yml` | weekly npm and GitHub Actions updates into `build/v1` |
| `.githooks/pre-commit` | opt-in local hook (eslint errors on staged files, then `tsc --noEmit`) |
| `synthenei/apps/growth-crm/.nvmrc` | Node 22 (CI reads it too, so there is one place to bump) |
| `.editorconfig`, `.prettierrc.json`, `.prettierignore` | editor and formatter settings |

## Jobs and what each one proves

| Job (status check name) | Command | Notes |
| --- | --- | --- |
| `install` | `npm ci` | fails if `package.json` and the lockfile disagree |
| `typecheck` | `npm run typecheck` | `tsc --noEmit` |
| `lint` | `npm run lint` | errors fail; the 100-odd warnings are legacy debt and do not fail yet |
| `unit` | `npm run test:unit:ci` | Vitest, `--pool forks` (config default jsdom: forcing `--environment node` breaks 17 component test files) |
| `build` | `npm run build` | `next build` with dummy public Supabase values |
| `e2e-smoke` | `npm run ci:smoke` | production build in demo mode, Cypress smoke spec |
| `a11y (hue 30)`, `a11y (hue 200)` | `npm run ci:a11y` | axe-core at WCAG 2.2 AA over every shell route. Informational (see below) |

Hardening: top-level `permissions: contents: read`; `concurrency` with `cancel-in-progress: true`; `persist-credentials: false` on checkout; no repository secrets are used by the CI workflow; Cypress runs in demo mode with no Supabase variables, so it cannot reach real data; the `build` job's Supabase values are placeholders. Action versions are pinned to exact tags (not full SHAs, because SHAs could not be looked up offline); Dependabot's `github-actions` entry proposes updates. To harden further, replace each tag with its commit SHA.

## Required branch protection (owner sets this in GitHub)

Settings, Branches, Add rule (or Rulesets) for `build/v1`:

1. Require a pull request before merging (at least 1 approval if there is a second person; a solo owner can use 0 approvals but keep the PR).
2. Require status checks to pass before merging, and "Require branches to be up to date before merging". Add exactly these checks: `install`, `typecheck`, `lint`, `unit`, `build`, `e2e-smoke`. Check names only appear in the picker after the workflow has run once on a PR or push.
3. Do NOT add `a11y (hue 30)` or `a11y (hue 200)` yet. They are `continue-on-error` and will be red until the open A11Y findings (for example target size on `/tasks`, nested `main`, missing `h1`) are fixed. When the matrix is green, set `continue-on-error: false` in the workflow and then add them as required.
4. Block force pushes and deletions on `build/v1`.
5. Require conversation resolution (optional) and include administrators if you want the owner bound by the same rules.
6. Actions, General: set "Workflow permissions" to read-only for the repository, and restrict allowed actions to GitHub-authored plus the ones used here.
7. Settings, Code security: enable Dependabot alerts, Dependabot security updates and secret scanning with push protection.

Caution: with these rules on, direct pushes to `build/v1` stop working, including the fast-forward pushes the fix agents use today. Turn them on only after the agents' work is merged, or switch the agents to PR branches.

## Supabase advisors gate (manual, optional)

`growth-crm-advisors.yml` runs only from the Actions tab ("Run workflow"). It calls the Supabase Management API advisors endpoint and fails on any ERROR-level finding (OPS-026: 11 SECURITY DEFINER views were reported as ERRORs). It needs two repository secrets that you create, and nothing in this change adds them:

- `SUPABASE_ACCESS_TOKEN`: a Supabase personal access token (account, access tokens). Treat it as a password.
- `SUPABASE_PROJECT_REF`: the project ref. Prefer a staging or branch project over production.

The endpoint path (`/v1/projects/{ref}/advisors/{security|performance}`) is UNVERIFIED. If it is wrong, the job fails with an HTTP code and no harm done. Alternative that needs no token in GitHub: run the advisors from the Supabase dashboard (Advisors) or the Supabase MCP `get_advisors` before each release.

## Local tooling

- Node: `nvm use` (reads `.nvmrc`, Node 22). `engines.node` is `>=22` in `package.json`.
- Pre-commit hook: enable once per clone with `npm run hooks:install` (it only runs `git config core.hooksPath .githooks`). Why not husky: husky and lint-staged would add devDependencies plus a `prepare` script, which needs a lockfile regeneration and runs on every install (including Vercel). A plain git hook has no dependency and cannot break `npm ci`. Bypass in an emergency with `git commit --no-verify`.
- Prettier: `.prettierrc.json` is committed but `prettier` is NOT yet a dependency (see below), so nothing enforces formatting yet. Do not run a repo-wide format until it is agreed: it would touch most files.

## Lockfile follow-up (owner or integrator)

Not done here, on purpose: adding a dependency by hand-editing `package.json` without regenerating `package-lock.json` makes `npm ci` fail, which would turn every CI job red. Run once, from a normal checkout (not through a junction):

```
cd synthenei/apps/growth-crm
npm install -D --save-exact prettier cypress-axe
```

Then commit `package.json` and `package-lock.json`. After that: add a `format:check` step (`prettier --check .`) once a baseline format commit exists, and switch the two helpers in `cypress/e2e/a11y/all-routes.cy.ts` to `import "cypress-axe"` if you prefer it. `axe-core` is already declared (exact `4.14.0`, matching the lockfile), so the a11y spec does not depend on cypress-axe.

## Known gaps

- The a11y matrix covers two hues at the English locale. The second locale (Tamil) is not wired: there is no known locale override for the demo build, so a `ta` run needs a small spec change. Tracked in DSYS-051.
- No tags or changelog automation (`CHANGELOG.md`) yet.
- `test:config` still uses `rm -rf` (FE-032), so it is not portable to Windows shells.
- Vercel deploys on push independently of these checks; branch protection plus Vercel's "Ignored build step" or "Deployment Checks" is what would make deploys wait for CI. Configure in Vercel (owner).
