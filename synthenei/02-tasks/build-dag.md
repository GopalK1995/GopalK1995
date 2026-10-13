# Growth CRM build — dependency graph (DAG)

Updated 2026-10-13. Each node starts only when its parents are done. No cycles: shared code flows down, change requests flow to the owner, never sideways edits.

```mermaid
flowchart TD
  SPEC[Spec + IA — done d5fa834] --> L0
  SPEC --> BE
  BE[Backend: workspaces, memberships, RLS, seed, types — BACKEND] --> L2
  L0[L0 Foundation: security fixes, shared UI/charts/data/auth frozen, per-agent distDir — BUILD] --> SALES & ENGAGE & MKT & SYS & ADMIN & CORE
  SALES[L1 Sales: /leads /leads/:id /pipeline /tasks] --> L2
  ENGAGE[L1 Engage: /accounts /accounts/:id /inbox /ai] --> L2
  MKT[L1 Marketing: /campaigns /campaigns/:id /audience /analytics] --> L2
  SYS[L1 System: /integrations /integrations/:id /data-health /settings] --> L2
  ADMIN[L1 Admin: /admin/login /admin /admin/tenants /admin/tenants/:id /admin/users /admin/audit /admin/support] --> L2
  CORE[L1 Core — BUILD: /login / /sales /forbidden /profile, switcher, mobile nav, support banner] --> L2
  L2[L2 Integration build + Playwright 3 personas x 1440/768/390 — BUILD] --> CRIT
  CRIT[Critic review: code + screens, findings to owners] --> L3
  L3[L3 Fix round, final commit/push, screens + report to Krishna]
  PITCH[Pitch assets: 60s video, deck screens, meeting pack — PITCH] --> L3
```

| Node | Owner | Owns (paths) | Depends on |
|---|---|---|---|
| L0 Foundation | BUILD | `src/components/**`, `src/lib/**`, `src/middleware.ts`, `src/styles/**`, layouts, `next.config.mjs`, `package.json` | Spec |
| L1 Core | BUILD | `/login`, `/`, `/sales`, `/forbidden`, `/profile` | L0 |
| L1 Sales | SALES | `src/app/(app)/{leads,pipeline,tasks}/**` | L0 |
| L1 Engage | ENGAGE | `src/app/(app)/{accounts,inbox,ai}/**` | L0 |
| L1 Marketing | MARKETING | `src/app/(app)/{campaigns,audience,analytics}/**` | L0 |
| L1 System | SYSTEM | `src/app/(app)/{integrations,data-health,settings}/**` | L0 |
| L1 Admin | ADMIN | `src/app/admin/**` | L0 |
| Backend | BACKEND | `supabase/migrations`, `seed`, `types.ts`, landing `api/leads` | Spec |
| L2 Integration | BUILD | single `next build`, Playwright, previews | all L1 + Backend types |
| Review | CRITIC | read-only | each L1 node as it finishes, then L2 |
| L3 Release | Orchestrator | final push, report | Review + Pitch |

Rules: page agents never edit shared (L0) files — they message BUILD; each agent commits only its own paths (`git commit -- <paths>`); only BUILD runs `next build`; parallel dev servers use `NEXT_DIST_DIR=.next-<agent>`.
