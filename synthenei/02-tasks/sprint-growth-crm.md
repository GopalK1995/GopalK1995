# Sprint: Growth CRM for LAWSOME (Venket's funnel platform)

Plan: `03-projects/growth-crm/`. Rule: one product (LAWSOME), thin custom build, labelled mocks until access exists. Statuses: todo / doing / done / blocked. Last updated 2026-10-13.

## Done in the scaffold pass (by Claude, to review)
| # | Task | Owner | Status |
|---|---|---|---|
| G1 | Build-vs-buy research + recommendation | Krishna (reviews) | done (needs Krishna's sign-off) |
| G2 | Screens/metrics/data-model plan + schema.sql | Krishna (reviews) | done |
| G3 | Next.js scaffold, 12 screens, synthetic data | Krishna (reviews) | done (build + typecheck pass) |

## Krishna (build)
| # | Task | Status |
|---|---|---|
| K1 | Confirm recommendation (custom vs Twenty) and the 12-screen MVP | todo |
| K2 | Create Supabase project, review + apply `schema.sql`, set RLS properly | blocked (project/billing question) |
| K3 | Wire landing `/api/leads` + `/api/track` to Supabase (`leads`, `lead_events`, `consent_log`) | todo |
| K4 | Daily GA4 `runReport` job into `ga4_daily` | blocked (GA4 property access) |
| K5 | CSV importers for LinkedIn / Meta / email into `campaign_daily_metrics` | todo |
| K6 | Backup job: scheduled `supabase db dump` offsite + heartbeat into `backup_checks`; real `BackupMonitorAdapter` | blocked (who owns backups, storage target) |
| K7 | Verify whether Supabase Management API exposes backup status; document result | todo |
| K8 | Auth + roles (admin / marketer / viewer) | todo |

## Venket (marketing)
| # | Task | Status |
|---|---|---|
| V1 | Confirm the funnel steps and the metrics he actually wants first (review `02-screens-and-metrics.md`) | todo |
| V2 | Share which email tool is used + export of one past campaign (CSV) | todo |
| V3 | Export LinkedIn Campaign Manager + Meta Ads Manager CSVs for the first campaign | todo |
| V4 | Agree UTM naming convention (`utm_campaign` values in `campaigns` table) | todo |
| V5 | Confirm first-response SLA and who owns follow-up | todo |

## Shaun / Kiruba / Ashique
| # | Task | Owner | Status |
|---|---|---|---|
| S1 | Track the sprint, daily 10-min sync, chase blockers in open-questions | Shaun | todo |
| K-1 | List of target firms by city/size for audience definitions (public info only, no private data) | Kiruba | todo |
| A1 | Name 5 friendly firms to test the demo flow; log objections heard after demos | Ashique | todo |
| A2 | Review privacy notice wording and lawyer-marketing copy against Bar Council advertising rules, or find a legal reviewer | Ashique (with counsel) | todo |

## Out of scope
Second product, email sending, WhatsApp inbox, real LinkedIn API, ML lead scoring, billing/revenue.
