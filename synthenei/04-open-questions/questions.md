# Open questions (answer inline, then log in 05-decisions)

Updated 2026-10-13 with Krishna's answers. Status: **ANSWERED** (moved to the decision log where it is a decision) or **OPEN**.

## General
1. **ANSWERED** Is the law firm a signed client, a warm prospect, or an idea? -> Warm prospect. "Innovous" refers to this warm-prospect perspective; a meeting with the client (LAWSOME owner) is still needed (task H7, owner Ashique).
2. **ANSWERED** What is "Coasters"? And is "Loss" the product name? -> "Coasters" is unrelated; ignore. The product is LAWSOME.
3. **ANSWERED** Screenshots/notes from the meeting -> Ashique has admin access to the LAWSOME dev build. Screenshots are fine for internal use; keep personal data out of anything public or client-facing (crop/blur real names, use synthetic data in public assets).
4. **ANSWERED** Stack/deploy -> Supabase is OK; the CRM deploys in Krishna's own infrastructure. **OPEN part:** who pays for and owns the Supabase project, and which plan (see G5).
5. **OPEN** Which first screen proves value fastest to the client? Proposal in the spec: `/sales` "My day", then the owner's Command Center (spec section 12). Confirm after the client meeting.
6. **ANSWERED** Realistic data -> Realistic Tamil Nadu firm data is OK (fictional firm names, Chennai/Coimbatore/Madurai/Trichy/Salem/Tirunelveli, Madras HC / Madurai Bench). No real people's phone numbers or emails in the repo.
7. **ANSWERED** Team size -> 5: Krishna (builder), Venkat (marketing), Shaun (PM / RevOps), Ashique (sales), Kiruba (data).
8. **OPEN** Pricing/pilot terms for lawyers and firms (LAWSOME's own plans and per-seat price; needed to prefill deal values; placeholders are Practice / Chambers / Enterprise).

## Growth CRM
| # | Question | Status / answer |
|---|---|---|
| G1 | GA4 property on the landing page? | **ANSWERED: none yet.** GA4 is shown as Showcase on sample data. **OPEN:** who creates the property and when (F3). |
| G2 | Verified LinkedIn Company Page and ad account? | **ANSWERED: none yet.** LinkedIn is Showcase + CSV. **OPEN:** whose page (Synthan or the client's) and who applies for API access (F4). |
| G3 | Which email tool? | **ANSWERED: none yet.** Mailchimp is the showcase placeholder. **OPEN:** final tool choice (B4). |
| G4 | Meta ad account / Pixel? | **OPEN** (assumed none; Showcase). Ad accounts should belong to the client under white-label. |
| G5 | Supabase project and plan; who pays and owns it? | **PARTLY ANSWERED:** Supabase is approved. **OPEN:** plan (Free vs Pro: 7-day backups either way, PITR is paid), region, and whether the client's production data sits in our project or a separate one. |
| G6 | Who owns backups and restore drills; where do offsite dumps go; who gets alerts? | **OPEN.** Proposal: Krishna owns the nightly dump on his infrastructure; Kiruba reviews `/data-health` weekly; alerts to Krishna + Shaun. |
| G7 | Hosting and logins | **ANSWERED:** deploys in Krishna's own infrastructure. Logins: all 5 team members, with roles per spec section 10. **OPEN:** domain/subdomain for the white-label (e.g. `crm.<client-domain>`). |
| G8 | WhatsApp at MVP? | **ANSWERED (in principle):** showcase now (template send is simulated). **OPEN:** Cloud API direct vs an Indian BSP; who completes Meta Business verification (should be the client). |
| G9 | OK to send lead data to the Claude API? | **ANSWERED: AI features are OK.** Still off by default per tenant until the data-terms checklist in `/ai` is ticked (provider retention terms, privacy notice mentions AI, no client-matter data). **OPEN:** who signs off the checklist for the client tenant. |
| G10 | Who reviews the privacy notice (DPDP) and marketing copy (BCI rules)? | **OPEN** (E5, E6; Shaun's legal contact). |
| G11 | Scope guardrail / switch-to-Twenty rule | **SUPERSEDED:** with white-label to the client, the thin custom CRM is confirmed in principle (decision 2026-10-13). Keep CSV export and webhooks so migration stays possible. |
| G12 | Is the old landing `leads` table live anywhere? | **OPEN.** schema.sql renames a pre-existing single-tenant `public.leads` to `landing_leads_legacy` if found; the landing app should move to `submit_lead()`. |

## New questions from the spec (2026-10-13)
| # | Question | Owner |
|---|---|---|
| C1 | Client meeting: what sales tools do they use today (Zoho? HubSpot? Excel + WhatsApp groups)? How many salespeople? Which metrics do they report to the owner? | Ashique |
| C2 | Does the client already have a Meta Business Manager, WhatsApp Business number, Google Ads and LinkedIn page? Who are the admins? | Ashique -> client |
| C3 | Does LAWSOME bill through Razorpay (needed for collected-revenue metrics)? | Ashique -> client |
| C4 | Booking tool for demos: Calendly or Cal.com (self-hostable on Krishna's infra)? | Krishna + Venkat |
| C5 | Sales territories: which districts map to which salesperson? | Shaun |
| C6 | Is the e-filing mandate at Madras HC still on hold? (Affects campaign messaging; verify before use.) | Venkat |
| D3 | A credible count of practising advocates / firms in Tamil Nadu for market sizing (none found). | Kiruba |
