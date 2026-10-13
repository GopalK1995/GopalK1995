# LAWSOME landing page — build log & runbook (internal)

Location: `apps/lawsome-landing` (Next.js 15.5.27 · React 19 · TypeScript · token-driven CSS)

## What it is
Conversion page for the outbound email campaign. 8-section structure from the product brief: hero, dashboard, calendar/hearings, cases, team & sites, eCourts, Ask Nidhi, final CTA + lead form. Plus a 60-second auto-playing guided tour.

## Status
| Item | State |
|---|---|
| Page, tokens, responsive (1440 / 390) | Done, type-check + build pass, no overflow/console errors |
| Lead form + validation + consent | Done |
| `/api/leads` | Done; demo mode logs only until a backend is configured |
| UTM capture + consent-gated events | Done (`page_view, cta_click, form_start, form_submit, tour_play`) |
| `demo_booked` event | Not wired — needs the calendar tool (Calendly/Cal.com) callback |
| Real LAWSOME screenshots | Replaced by synthetic recreations (see PII note) |
| Ask Nidhi | Illustrative conversation; replace with a verified capture |
| Privacy notice | DRAFT — legal review required |
| Deployment | Not deployed (needs Vercel account) |

## Run
```
cd apps/lawsome-landing && npm install && npm run dev   # http://localhost:3000
npm run typecheck && npm run build
```
Test attribution: `/?utm_source=email&utm_medium=outbound&utm_campaign=launch`

## Config (env, see `.env.example`)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — store leads (schema: `supabase/leads.sql`)
- `LEAD_WEBHOOK_URL` — route each lead to the team (Slack/Zapier/CRM)

## Design system
All colour/type/space/shape values live in `src/styles/tokens.css`; product-screen replicas in `screens.css`. Change tokens, not components.

## Pre-launch checklist
- [ ] Deploy (Vercel), set env vars, confirm a test lead reaches the team
- [ ] Wire real analytics (GA4/PostHog) behind consent; add `demo_booked`
- [ ] Add demo-booking link/embed to the final CTA
- [ ] Replace Ask Nidhi illustration with real, verified output
- [ ] Legal sign-off: privacy notice, consent wording, advertising rules
- [ ] Set `robots` to index (currently noindex), add OG image
- [ ] Verify all links/forms on real phones; run Lighthouse
- [ ] Email -> landing UTM links tested end-to-end
