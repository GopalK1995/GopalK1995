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
| Hero 3D + motion (three.js, R3F, motion) | Done: lazy desktop-only map scene, static SVG fallback, reduced-motion safe |
| Static export (`STATIC_EXPORT=1`) | Done: `out/`, lead form calls Supabase RPC from the browser |
| Deployment | Not deployed |

## Run
```
cd apps/lawsome-landing && npm install && npm run dev   # http://localhost:3000
npm run typecheck && npm run build
```
Test attribution: `/?utm_source=email&utm_medium=outbound&utm_campaign=launch`

## Config (env, see `.env.example`)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — store leads (schema: `supabase/leads.sql`)
- `LEAD_WEBHOOK_URL` — route each lead to the team (Slack/Zapier/CRM)

## Deploy
**Option A: Vercel (server routes kept).** Import the repo, set Root Directory `synthenei/apps/lawsome-landing`, framework Next.js. Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon/publishable key; it can only execute `submit_lead`), optional `NEXT_PUBLIC_LEAD_WORKSPACE` (default `lawsome-tn`), `PRIVACY_NOTICE_VERSION`, `LEAD_WEBHOOK_URL`, `CRM_BASE_URL`. The form posts to `/api/leads`, which calls the RPC.

**Option B: any static host (Netlify, Cloudflare Pages, S3, GitHub Pages).**
```
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... STATIC_EXPORT=1 npm run build   # -> out/
```
Upload `out/`. In this mode there are no API routes (`pageExtensions` skips `route.ts`): the browser calls `POST {SUPABASE_URL}/rest/v1/rpc/submit_lead` directly (`src/lib/submitLead.ts`, same payload as the route; consent comes from the checkbox). Without the two env vars at build time the form shows success in demo mode and stores nothing. Analytics beacons to `/api/track` are skipped; `dataLayer` still receives consented events. Env values are baked in at build time.

## Hero and motion
- One WebGL moment: `src/components/hero/HeroScene.tsx` (three + @react-three/fiber, no drei). Line map of Tamil Nadu (simplified outline, half-degree graticule) with six district nodes; links draw once in ~2.4s on load, then the scene stops rendering (replays on map hover). DPR capped at 1.5, paused off-screen.
- Loaded via `next/dynamic` (ssr:false) after `load` + idle, only when width >= 640, WebGL available, no reduced motion, no Save-Data, >= 4 cores / 4GB. Otherwise the static SVG (`MapFallback.tsx`) stays. Mobile < 640 hides the map.
- Dashboard screen below the hero copy: DOM (so it stays crisp and LCP stays text), 6deg tilt that flattens over the first 360px of scroll; no pointer parallax.
- Framer Motion (`motion` package): section reveals (16px, stagger), screen frames settling from 10deg as they scroll in, dashboard counters (once, 800ms), pillar hover lift, nav section indicator + progress hairline, Ask Nidhi bubbles (layout), tour transitions (AnimatePresence). Ease `cubic-bezier(.16,1,.3,1)`. All respect prefers-reduced-motion via `useReduced` (hydration-safe).

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
