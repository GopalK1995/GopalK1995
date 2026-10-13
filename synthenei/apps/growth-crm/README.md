# Growth CRM (white-label, multi-workspace)

Sales + marketing CRM built for LAWSOME (legal practice software for Indian law firms) and designed to be white-labelled
per tenant. Campaigns (LinkedIn, Meta, Google Ads, WhatsApp, email), web analytics, leads, law firms, pipeline and revenue
in one place. Spec: `../../03-projects/growth-crm/03-product-spec.md`. Database: `supabase/` (BACKEND).

```
npm install
npm run dev                         # http://localhost:3100
npm run build && npm start          # production build on :3201 (use this for demos)
npm run typecheck
npm run e2e                         # L2 matrix against a running `npm start` (Playwright)
NEXT_DIST_DIR=.next-<name> npx next dev -p <port>   # parallel dev servers
```

## Modes
- **Demo** (no Supabase env, or `DEMO_MODE=1`): `/login` shows personas (Owner, Sales Manager, Sales Rep, Marketing,
  Kaveri owner, Super admin). Demo sessions only ever read the seeded mock data and never call Supabase.
- **Real**: email + password via `@supabase/ssr`; memberships from `rpc('my_workspaces')`; RLS is the authority.
  `SESSION_SECRET` is required. **Turn `DEMO_MODE` off for client production.**

## Model
Tenant (brand: name, monogram, hue) → workspaces (isolated data) → memberships (role per workspace). Platform admins
(Synthan) use `/admin` and can enter a workspace only through a reasoned, time-boxed, logged support session
(amber banner; exports, erasure, integrations, branding, invites and AI toggles stay disabled).

## Code map
- `src/styles/tokens.css` design tokens (60/30/10, hue rationale, validated chart palette) → Tailwind v4 theme in `app/globals.css`.
- `src/lib/data/` types, metrics (metric IDs from the spec), workspace-scoped `DataSource` (mock + Supabase), seeded
  generator (`mock/`), backup adapter. `src/lib/auth/` session, roles + `can()`, middleware context, server actions.
- `src/components/ui|charts|shell` shared primitives; pages in `src/app/(app)` and `src/app/admin`.

All people, firms and numbers are fictional (`.example` domains, masked phones).
