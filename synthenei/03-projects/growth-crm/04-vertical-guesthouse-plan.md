# Vertical plan: Western Ghats guesthouse CRM (second client, same codebase)

Status: planned 2026-10-21. Goal: the same CRM serves two unrelated businesses. Logging in through a client's own link shows only that client's content; LAWSOME users see only LAWSOME.

## 1. How isolation already works (and what we add)
- Tenant -> workspaces -> memberships (role per workspace). A session only carries the workspaces its user belongs to; `pageCtx()` scopes every page to the active workspace; the database enforces the same with RLS.
- We add: (a) a **vertical** per tenant (vocabulary + stage names + metrics emphasis), (b) a **guesthouse dataset**, (c) a **branded sign-in link per client** (`/g/<slug>`) that lists only that client's personas, (d) no persona belongs to both tenants.

## 2. The client (fictional, rename freely)
- Tenant `shola-mist` — **Shola Mist Guesthouse**, product label "Stay CRM", Coonoor, the Nilgiris, Tamil Nadu. One property, ~14 rooms: Valley-view Room, Garden Cottage, Family Suite, Heritage Room, Dorm loft (groups).
- Workspace `shola-mist-coonoor`, dataset `wg`. Brand: forest green (OKLCH hue ~152), monogram "S".
- Season model: peak Apr-Jun and Oct-Jan (Pongal, Diwali, Christmas, New Year), long weekends, monsoon lull Jul-Sep; weekend demand from Chennai, Coimbatore, Bengaluru, Kochi.
- Sign-in links: `/g/shola-mist` (this client) and `/g/lawsome` (LAWSOME). `/login` stays as the internal all-personas demo hub.

## 3. Who logs in (personas, `shola-mist` only; none also in LAWSOME)
| Persona | Role | Lands on | Does |
|---|---|---|---|
| Kavitha Ramesh, owner | owner | Command Center | bookings, revenue, campaign payback, brand |
| Balamurugan S., enquiries & bookings | sales_rep | My day | replies on WhatsApp/phone, sends quotes, confirms advance |
| Sneha Joseph, marketing (freelance) | marketing | Campaigns | Instagram/Meta, WhatsApp broadcasts, Google profile, travel-agent partners |
| Ramesh Iyer, manager (viewer) | viewer | Command Center | read-only, masked guest details |

## 4. Vocabulary map (vertical config, one source of truth)
| Concept in code | Legal (LAWSOME) | Guesthouse (Shola Mist) |
|---|---|---|
| Lead | Lead | Enquiry |
| Account | Law firm | Guest / partner (repeat guest, travel agent, corporate group, wedding planner) |
| Deal | Deal | Booking |
| Deal value / seats | ARR / seats | Booking value (INR) / nights |
| Practice areas | Civil, Criminal... | Trip type: Couples, Family, Friends group, Workation, Wedding & events, Corporate retreat, Trekking |
| Courts | Courts | Rooms of interest |
| Firm size | Solo..50+ | Party size: 1-2, 3-5, 6-10, 11-25, 25+ |
| Lead stages | new, contacted, qualified, demo_booked, demo_done, proposal, won, lost | New enquiry, Replied, Dates confirmed, Quote sent, Advance pending, Hold, Booked, Lost |
| Demo | Demo | Site visit / call |
| Hearings, eCourts, Ask Nidhi | yes | not shown |
| Copilot examples | law-firm questions | occupancy and enquiry questions |

## 5. Data to generate (synthetic, fictional names, `.example` emails, no real people)
- ~140 enquiries over 90 days with seasonality; fields: trip type, party size, preferred dates, nights, room interest, source channel, UTM, first response time.
- ~30 bookings with realistic Coonoor pricing (Rs 3,500-9,500 per night by room, weekend and festival uplift) and 55% of bookings from repeat guests/referrals; some cancellations.
- ~45 guests/partners: repeat families, 6 travel agents (Ooty-Coonoor-Kodaikanal circuits), 4 corporate groups, 2 wedding planners.
- Campaigns (8): Instagram Reels "Monsoon mist weekends" (Meta), Meta lead ads for Bengaluru/Chennai/Coimbatore weekenders, Click-to-WhatsApp Pongal long weekend (WhatsApp), Repeat-guest Diwali offer broadcast (WhatsApp), Google Business Profile + Search "homestay in Coonoor" (Google Ads), Travel-agent partner programme (referral), OTA boost Booking.com / MakeMyTrip (referral, labelled OTA), Workation midweek offer (Meta).
- Metrics emphasised for this vertical: enquiries to bookings, cost per booking, direct-booking share vs OTA commission, ADR, 30-day forward occupancy, average first response time, repeat-guest share.
- Inbox: WhatsApp threads in English and Tamil. Integrations hub: WhatsApp Business, Instagram/Meta, Google Business Profile, Booking.com, MakeMyTrip, Airbnb (channel manager), Razorpay (advance payments), Mailchimp. All Showcase.

## 6. Build split (no overlapping files)
- **DATA agent:** `lib/data/mock/hospitality.ts` (+ small registration in `configs.ts`/`generate-index.ts`), additive optional fields in `lib/data/types.ts`, `lib/tenancy.ts` (tenant, workspace, users, memberships, personas), conversations, integrations, copilot answers.
- **UI agent:** `lib/vertical.ts` (vocabulary + stage labels + KPI emphasis), branded sign-in `/g/[slug]`, login persona filtering, middleware public path, nav and page wording via the vocabulary, Command Center / My day / Campaigns tile swaps, brand theming for the new tenant.

## 7. Acceptance checks
1. `/g/shola-mist` shows only Shola Mist personas, green brand; `/g/lawsome` shows only LAWSOME personas.
2. Shola Mist personas see zero LAWSOME text (law, advocate, court, hearing, eCourts, Ask Nidhi, Tamil Nadu bar) on any page; LAWSOME personas see zero guesthouse text.
3. Every page works for both tenants at 1440 / 390; production build passes; no console errors.
4. Server actions and middleware still re-check workspace membership (a Shola Mist session cannot open a LAWSOME workspace via `?ws=`).
5. Real database: not changed in phase 1 (demo mode). Phase 2 = SQL seed for the new tenant, pasted in the Supabase SQL editor.

---

# Addendum (2026-10-22): everything configurable, not hard-coded

Requirement: wording, stages, taxonomies, navigation, fonts, branding and data must be editable by the **super admin** (platform) and the **org admin** (tenant owner) from the UI, with nothing client-specific baked into pages.

## A. Configuration model (one JSON document per tenant)
`TenantConfig` (versioned, validated with a schema) with these sections:
1. **preset**: `legal` | `hospitality` | `blank` (starting template; presets are code, a tenant's overrides are data).
2. **vocabulary**: singular/plural nouns (lead, account, deal, visit/demo), nav labels, KPI labels, page titles, empty-state text, form labels. Merged over the preset.
3. **stages**: lead stages and deal stages: label, order, win probability, colour token, "counts as won/lost". Maps onto the fixed internal enums, so metrics keep working.
4. **taxonomies**: interests/trip types or practice areas, rooms or products, party/firm-size buckets, lost reasons, channels' display names (not the channel enum).
5. **modules**: on/off per module (inbox, copilot, integrations, audience, analytics, tasks, accounts) and per-vertical features (hearings/eCourts only for legal).
6. **branding**: name, product label, logo, accent hue, **font pair** (heading + body) chosen from an allow-list of self-hosted/next-font fonts; contrast check blocks unsafe combinations.
7. **dashboard**: which 4 headline KPI tiles and which charts appear on Command Center / My day (chosen from a catalogue of metric IDs).
8. **data**: sample-data switch (on for demo tenants, off for real ones), CSV import mappings, targets (monthly targets per rep), SLA hours, business hours.

## B. Who can change what
| Section | Org admin (tenant owner) | Super admin (Synthan) |
|---|---|---|
| vocabulary, stages, taxonomies, targets, SLA | edit own tenant | edit any tenant |
| branding (name, logo, hue, fonts) | tenant primary owner only | edit any tenant |
| modules on/off | can switch off modules they don't want | can switch any on/off, incl. vertical-only features |
| preset / vertical | read-only | change (with a preview + warning) |
| dashboard tiles | pick from the allowed catalogue | extend the catalogue per tenant |
| data: import, sample-data switch | import own data; switch sample data off | any tenant, but real business data only inside an audited support session (existing rules) |
| create tenant from template | no | yes (Legal, Guesthouse, Blank) |
Every change writes an audit-log row (who, what changed, before/after). Changes are versioned so an admin can roll back.

## C. Storage and delivery
- Database: table `tenant_config` (tenant_id PK, version, config jsonb, updated_by, updated_at) plus `tenant_config_history`. RLS: members read their tenant's config; only the tenant's owners (and, via the audited RPC, platform admins) write. No DROP/DELETE statements in the migration.
- App: `lib/config` resolves `effective = deepMerge(preset, tenantConfig)`; the shell layout loads it once per request and feeds the existing `vocabFor()` / `useVocab()` / `useBrand()` API, so pages don't change when the source moves from code to data.
- Demo mode (no Supabase session): overrides persist in a signed, httpOnly cookie per tenant and are labelled "Saved in this browser (demo)"; real mode persists to `tenant_config`.
- Fonts are chosen by key from an allow-list (no arbitrary URLs), applied through CSS variables.

## D. Screens
- Org admin: **Settings -> Configuration** tabs (Wording, Stages, Categories, Modules, Dashboard, Branding & fonts, Data & import, History/rollback), with a live preview and "Reset to preset".
- Super admin: **Admin -> Tenants -> <tenant> -> Configuration** (same editors, plus Preset, Modules and tile catalogue, "Create tenant from template", "Copy config from another tenant").

## E. Acceptance
1. Renaming "Enquiries" to "Requests" as org admin changes every page for that tenant only, immediately, and the other tenant is unaffected.
2. Changing a stage label/order/probability updates pipeline, funnel and forecasts consistently.
3. Switching a module off hides its nav entry and blocks its route (403), server-side.
4. A font change applies to that tenant's pages only; the contrast/branding check still blocks bad combinations.
5. Org admin cannot edit another tenant, nor super-admin-only sections (server-side checks, tested). Super admin edits are audited.
6. Presets still render exactly as today when a tenant has no overrides.
