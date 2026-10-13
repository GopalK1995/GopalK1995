# Master task list (all workstreams)

Updated: 2026-10-13. Status: `done` · `doing` · `todo` · `blocked`. Supersedes `sprint-1-hour.md` (written before we knew LAWSOME already exists).

## A. Tomorrow's pitch (priority 1)
| ID | Task | Description | Owner | Status | Needs |
|---|---|---|---|---|---|
| A1 | Landing page build | 8-section LAWSOME page (hero, dashboard, calendar/hearings, cases, team/sites, eCourts, Ask Nidhi, CTA form) + 60s guided tour, design tokens, responsive | Krishna | done | — |
| A2 | Deploy landing page | Put it on a live URL (Vercel), set env vars, test on phone | Krishna | todo | Vercel account |
| A3 | Connect lead capture | Send form leads to Supabase table and/or team webhook (Slack/Zapier); test one lead end to end | Krishna | todo | Supabase project or webhook URL |
| A4 | Demo booking | Add Calendly/Cal.com link to final CTA; fire `demo_booked` event | Krishna | todo | Booking tool choice |
| A5 | Ask Nidhi real capture | Replace illustrative chat with a verified real conversation from the working build | Krishna | todo | Ask Nidhi access, verified matter |
| A6 | Sample screens for deck | Export clean screen images (synthetic data) for Venket's deck | Krishna -> Venket | todo | — |
| A7 | 1-minute product video | 60s walkthrough (Curefit-style): record the guided tour / real app, add captions + voice-over | Venket (Krishna supports) | todo | Script (A8) |
| A8 | Video script + storyboard | Shot list matching the 6 demo segments, 60s total | Venket | todo | — |
| A9 | Demo script rehearsal | 6-8 min live demo flow (`06-skills/demo-script.md`), dry run with Ashique | Ashique + Krishna | todo | Working build |
| A10 | Team sign-off | "@all check this out" — everyone approves the page before the pitch | Shaun | todo | A2 |

## B. Email campaign (marketing email -> landing -> demo -> consultation)
| ID | Task | Description | Owner | Status | Needs |
|---|---|---|---|---|---|
| B1 | Email copy | Draft in `06-skills/email-campaign.md`; finalise subject lines + 2 variants | Venket | doing | — |
| B2 | UTM links | Build tracked links using the UTM convention | Venket | todo | A2 URL |
| B3 | Prospect list | Advocates / law-firm leaders, segmented, with source + lawful basis logged | Kiruba | todo | — |
| B4 | Send tool setup | Pick tool (Brevo/Zoho/Mailchimp etc.), domain auth (SPF/DKIM), unsubscribe | Venket + Krishna | todo | Tool decision |
| B5 | LinkedIn campaign | Posts/carousels/outreach with same message | Venket | todo | — |
| B6 | Launch + monitor | Send in batches, watch replies, visits, form submits | Venket + Shaun | todo | B1-B4 |

## C. Growth CRM for Venket (`apps/growth-crm`, plan in `03-projects/growth-crm/`)
| ID | Task | Description | Owner | Status | Needs |
|---|---|---|---|---|---|
| C1 | Build-vs-buy research | Compared custom vs Twenty vs Zoho/HubSpot; recommends thin custom Next.js + Supabase, kept replaceable | agent/Krishna | done | — |
| C2 | Screens, metrics, data model | 12 MVP screens, metric formulas, 11-table schema, architecture, real-vs-mock integration map | agent/Krishna | done | — |
| C3 | App scaffold with synthetic data | All 12 screens rendering on sample data | agent/Krishna | done | — |
| C4 | Real lead + event ingestion | Landing page writes leads/events to CRM tables | Krishna | todo | Supabase project |
| C5 | GA4 connector | Daily GA4 Data API job (sessions, sources, pages, devices, geo) | Krishna | todo | GA4 property access |
| C6 | Campaign spend import | CSV import for LinkedIn / Meta / email metrics | Krishna | todo | Export samples from Venket |
| C7 | LinkedIn integration | Shown as mock + CSV now; real API only after LinkedIn approves access | Krishna | blocked | Verified Company Page, API approval |
| C8 | Meta Ads connector | Marketing API after ad-account access | Krishna | todo | Ad account access |
| C9 | Backup monitor | Daily DB dump job + heartbeat, retention, restore-drill log shown on screen | Krishna | todo | Who owns backups, storage target |
| C10 | AI assist | Claude-based lead summaries / campaign insight drafts, off by default | Krishna | todo | Data-terms check, API key |
| C11 | Roles + consent | Admin/marketer/viewer roles; consent log, deletion requests (DPDP) | Krishna | todo | — |
| C12 | Venket walkthrough | Review screens with Venket, adjust metrics to what he actually uses | Krishna + Venket | todo | C3 |

## D. Sales & data
| ID | Task | Description | Owner | Status | Needs |
|---|---|---|---|---|---|
| D1 | Pitch narrative | Growth-engine / 30-day POC pitch (`08-external/growth-engine-pitch.md`) | Ashique | done (draft) | — |
| D2 | Warm contacts | 10 lawyers/firms for pilot demos | Ashique | todo | — |
| D3 | Pipeline stages + SLA | Agree stage definitions and response-time rules in CRM | Shaun | todo | C3 |
| D4 | Data sources log | Where prospect data comes from, rules, dedupe | Kiruba | todo | — |
| D5 | Account Manager | Decide who handles follow-up and demos | Shaun | todo | — |

## E. Workspace, docs, compliance
| ID | Task | Description | Owner | Status | Needs |
|---|---|---|---|---|---|
| E1 | Synthenei workspace | Folders for team, strategy, tasks, projects, questions, decisions, skills, data, external | Krishna | done | — |
| E2 | Internal docs | Team roles, LAWSOME positioning + claims policy, landing runbook, demo script, email draft | Krishna | done | — |
| E3 | External docs | Pitch doc, product one-pager, rules for what can be shared | Krishna | done | — |
| E4 | Decision log + open questions refresh | Growth-CRM decisions + 12 questions added (recommendation pending Krishna) | Krishna | done | — |
| E5 | Privacy notice + consent wording | Legal review of draft (DPDP Act 2023) | Shaun (legal contact) | todo | Legal reviewer |
| E6 | Advertising-rules check | Bar Council rules on marketing to advocates / referral programme | Shaun | todo | Legal reviewer |
| E7 | Playbooks | Client onboarding, weekly status update, scraping rules | Shaun / Kiruba | todo | — |

## F. Accounts & access (blockers for many tasks)
| ID | Task | Description | Owner | Status |
|---|---|---|---|---|
| F1 | Vercel account | For A2 | Krishna | todo |
| F2 | Supabase project + plan | Leads/CRM database; Pro plan gives 7-day backups | Krishna | todo |
| F3 | GA4 property | Create or grant access; link to landing page | Venket | todo |
| F4 | LinkedIn Company Page admin + verification | Needed before any API application | Venket | todo |
| F5 | Domain + email sending domain | Landing URL and campaign sender | Krishna | todo |

## G. Later (not now)
| ID | Task | Description |
|---|---|---|
| G1 | Green Pulse | Restaurant/DJ venue marketing strategy — separate client, park until LAWSOME launches |
| G2 | Multi-product marketing platform | Reuse growth CRM for other products only after LAWSOME works |
| G3 | Referral programme | Only after legal review (E6) |
| G4 | WhatsApp channel | Only if Venket confirms it's a real channel |
