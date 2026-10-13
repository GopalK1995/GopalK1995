# Growth CRM for LAWSOME: build vs buy

Date: 2026-10-13. Owner: Krishna (build), Venket (user). Status: recommendation, pending Krishna's confirmation.

Source key: **[V]** = vendor-authored or reseller blog (treat as marketing). **[O]** = official docs. **[T]** = third-party summary (unverified). Where sources conflict I say so. Nothing here was tested hands-on.

## 1. What we actually need

One product (LAWSOME), one funnel: email/LinkedIn/Meta campaign -> landing page -> demo -> consultation/access request. Venket needs to see: which campaign produced which lead, what each lead costs, who has been followed up, and whether data is flowing in and backed up. Volumes will be tiny at first (hundreds of leads, low thousands of sessions). The landing app already posts `leads` and `track` events with UTMs and consent gating.

## 2. Findings per building block

### CRM core
- **Twenty (open source CRM).** Self-hosting is a Docker Compose stack: Postgres, Redis, server and worker. Guides suggest 2 GB RAM minimum and ~4 GB / 2 vCPU for a small team; server and worker spike above 1 GB during migrations ([RamNode guide, V](https://ramnode.com/guides/twenty-crm), [Railway template, V](https://railway.com/deploy/twenty-open-source-crm.md)). Software is AGPL-3.0, REST and GraphQL APIs and webhooks are included, and Twenty sends all event types to the webhook URL ([Twenty webhooks docs, O](https://docs.twenty.com/developers/api-and-webhooks/webhooks), [pricing, O](https://www.twenty.com/pricing)). Cloud is about $9/user/month (Pro) or $19 (Organization) with API limits of 50/100 per minute ([search summary of pricing page](https://www.twenty.com/pricing)). Caveats: it is a generic CRM, so campaign cost, ad-spend, GA4 and backup monitoring are not part of it; AGPL matters if we ever modify and resell; we would own upgrades and backups of a second stack. HMAC webhook signing was claimed by a directory but not confirmed ([T](https://thegtmdirectory.com/tools/twenty/md)).
- **Zoho CRM / Freshsales / HubSpot.** One India-focused comparison says Zoho is best value (Zia AI scoring), HubSpot costs 3-5x more (Breeze AI), and WhatsApp integration is weak on HubSpot/Zoho. The source is vendor-authored ([Groweon, V](https://www.groweon.com/blog/?p=1868)). Per-seat pricing grows with the team; none of them shows "cost per demo by campaign" without ad-spend ingestion, which is the core ask.

### Analytics, funnels, dashboards
- **GA4 export vs API.** BigQuery export is free on standard properties with a 1M events/day cap on the daily export ([Google reporting-surfaces doc, O](https://support.google.com/analytics/answer/13644080)); it contains no ad spend, CRM revenue or attribution results ([OWOX, V](https://www.owox.com/blog/articles/build-attribution-model-bigquery.md)). The Data API (`runReport`) is token-quota limited; sources disagree on exact numbers (200k tokens/property/day cited by [seogets, T](https://seogets.com/help/google-analytics-4-api-quotas-and-how-they-can-be-exceeded-1xz8u), a much lower figure by [supergood, T](https://supergood.ai/api-report-card/google-analytics)), so verify on Google's quota page. For our scale a once-daily `runReport` pull of a few dimensions fits easily; BigQuery is only worth it if we want raw event-level analysis.
- **PostHog.** Funnels, cohorts, retention are in the core product; cloud free tier is reported at ~1M events/month; self-host is MIT but one competitor claims PostHog itself recommends self-hosting only to ~300k events/month and needs Postgres, Redis, ClickHouse and Kafka ([OpenPanel, V - competitor](https://openpanel.dev/articles/self-hosted-product-analytics), [Userpilot, V](https://userpilot.com/blog/posthog-features/)). Good optional add-on for session replay and funnels; do not self-host.
- **Metabase / Looker Studio.** Looker Studio is free and quick for GA4/BigQuery; Metabase OSS is free to self-host and suits SQL databases ([Basedash comparison, V](https://www.basedash.com/vs/lookerstudio-vs-metabase)). Useful as a stopgap, but neither gives Venket tasks, lead detail or consent logs.
- **Airbyte / OWOX connectors.** Airbyte Core is free self-managed; Cloud starts around $20/month per its pricing page, third parties quote differently ([Airbyte, V](https://airbyte.com/airbyte-cloud), [Hevo, V](https://hevodata.com/learn/airbyte-pricing.md)). I could not confirm LinkedIn Ads connector status; check the connector catalog. Overkill for MVP, relevant once Meta/LinkedIn spend must sync daily.

### Channels
- **LinkedIn.** Lead Gen Form sync needs `r_marketing_leadgen_automation`, reporting needs Advertising API access, a verified Company Page and roles; partner approval is not guaranteed and timelines are unpublished ([MS Learn Lead Sync, O](https://learn.microsoft.com/en-us/linkedin/marketing/lead-sync/getting-access-leadsync?view=li-lms-2024-07), [recent changes, O](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/recent-changes)). Decision: CSV import + clearly labelled mock first.
- **WhatsApp Business Platform.** Since 1 July 2025 pricing is per delivered template message by category and recipient country; non-template messages in an open service window are free. India marketing rate quoted at roughly Rs 0.78-0.88 per message, utility ~Rs 0.11-0.13, but figures conflict across reseller blogs ([Meta pricing, O](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing), [MyOperator, V](https://support.myoperator.com/portal/en/kb/articles/whatsapp-has-shifted-to-per-message-pricing-effective-july-1-2025-based-on-message-categories-and-your-recipient-s-country-in-india-there-are-three-paid-categories), [Wati, V](https://support.wati.io/en/articles/11561662-introducing-message-based-pricing)). Meta also caps marketing templates per user. MVP: log WhatsApp as a manual follow-up channel; API integration is phase 2 and needs a BSP or Cloud API onboarding.

### AI helpers (suggestions, not accuracy claims)
- **Lead summary and next-action text via Claude API.** Prompt caching bills cache reads at 0.1x base input price, and Haiku 4.5 base input is listed at $1/MTok ([Anthropic prompt caching docs, O](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)). A summary of one lead's timeline is a few hundred tokens, so cost is negligible at our volume. Risks: the model can misstate facts; always show the source timeline next to the summary, label it "AI draft", and never send personal data beyond what is needed. Check Anthropic's current data-retention terms before sending lead PII.
- **Campaign insight narrative** (weekly "what changed" text) from aggregated, non-personal metrics: low risk.
- **Lead scoring.** Zoho Zia and HubSpot Breeze offer it ([Groweon, V](https://www.groweon.com/blog/?p=1868)), but with under ~100 leads any model is noise. Start with a transparent rule score (role = managing partner/owner, firm email, demo watched) and revisit when we have outcomes.
- **Email/ad copy generation:** useful but outside the CRM; Venket can use Claude directly.

### Backups
- Supabase: daily backups on all plans, retention 7 days (Free/Pro), 14 (Team), 30 (Enterprise); PITR is a paid add-on from roughly $100/month; backups do not include Storage objects or Edge Functions ([Supabase backups, O](https://supabase.com/docs/guides/platform/backups.md), [pricing, O](https://supabase.com/pricing.md)). My search found no official native alert for failed backups and no confirmed Management API endpoint for listing backups ([search result](https://drdroid.io/alert-diagnosis-knowledge/supabase-backup-failure/), not authoritative). So the monitor design must assume we cannot just read "last backup time" from Supabase; plan a belt-and-braces check: our own scheduled `pg_dump`/`supabase db dump` to separate storage, plus a heartbeat row, plus verification of the dump (size, row counts, restore drill). Verify the Management API reference before committing.

### Compliance (concise, not legal advice)
- **Bar Council of India Rule 36** restricts advocates from soliciting or advertising; the BCI sent cease-and-desist notices in 2024 to listing platforms and criticised promotional reels in 2025; platform liability is unsettled ([MediaNama](https://www.medianama.com/2025/03/223-the-bar-council-of-india-warns-against-legal-advertising-online/), [Moneylife](https://moneylife.in/article/after-dsk-legal-ads-bar-council-condemns-lawyers-advertising-services-on-social-media/76657.html), [Scroll](https://scroll.in/article/1080748/should-indian-lawyers-be-allowed-to-advertise-their-noble-profession)). Implication: we market a software product to lawyers (B2B), not lawyer services to the public. Keep copy to product features, never client-solicitation, no lead-sharing marketplace, no celebrity endorsements. Get a lawyer to review once.
- **DPDP Act 2023 / Rules 2025** were notified in November 2025 with staggered dates; most consent, notice, erasure and breach obligations apply 18 months after publication (about May 2027), consent manager rules earlier ([Storyboard18](https://www.storyboard18.com/amp/digital/breaking-govt-notifies-final-dpdp-rules-sets-staggered-rollout-with-key-obligations-for-data-fiduciaries-84201.htm), [DSK Legal](https://dsklegal.com/?p=26455); secondary sources, check the Gazette). Build the consent log, withdrawal and deletion workflow now; it is cheap at the start and expensive later.

## 3. Options compared

| | A. Thin custom (Next.js + Supabase) | B. Twenty (self-host or cloud) + Metabase | C. Zoho CRM / HubSpot + Looker Studio |
|---|---|---|---|
| Fits "one product, funnel + campaign cost + backup health" | Yes, built around it | Partly; CRM fits, funnel/ad-cost/backup do not | Partly; marketing tooling generic |
| Build effort | Medium: ~10 screens (scaffold done in this repo, 2-4 weeks to wire real data) | Low for CRM; medium for custom objects, ingestion and dashboards | Low setup; integration work for GA4/ad spend |
| Running cost | Supabase Free/Pro + hosting; likely tens of USD/month | Server (~2-4 GB RAM) or $9-19/user + Metabase | Per-seat; HubSpot materially higher ([V](https://www.groweon.com/blog/?p=1868)) |
| Data ownership / DPDP control | Full | Full if self-hosted | Vendor-hosted, data residency to check |
| AI | Our own Claude calls, transparent | Add-on build | Vendor AI (Zia, Breeze, Freddy), black box |
| Main risk | We maintain it; scope creep into a generic CRM | Two stacks to run and back up; AGPL | Lock-in, cost creep, weak WhatsApp ([V](https://www.groweon.com/blog/?p=1868)) |

## 4. Recommendation

**Build a thin custom CRM on Next.js + Supabase (Option A), scoped strictly to the LAWSOME funnel, and keep it replaceable.**

Why: the unique value is joining GA4 + campaign spend + leads + follow-up + backup health in one view for one non-technical marketer. Off-the-shelf CRMs give us the lead list but not that join, and we would still build ingestion and dashboards. The data model is small (about 11 tables), the landing app already writes to Supabase, and Krishna already uses this stack.

Guardrails to avoid the obvious failure mode (building a worse HubSpot):
1. No custom email sending, sequences or WhatsApp inbox in MVP. Use the existing email tool; log sends/campaigns by import.
2. Time-box: if by sprint 3 the team is building contacts/companies/deals features that Twenty already ships, switch to Twenty and keep only the analytics + backup screens on top.
3. Keep leads exportable (CSV + webhook out) so migration to Twenty or Zoho is a day, not a project.
4. AI features are assistive drafts only, behind a flag, with source data visible.

Phasing: MVP on synthetic data (done in this scaffold) -> real lead and event ingestion from the landing app -> daily GA4 `runReport` job -> CSV import for LinkedIn/Meta/email spend -> Meta Marketing API and LinkedIn real connectors only after access is granted -> WhatsApp API only if Venket confirms it is a real channel.

Open risks: GA4 property and LinkedIn page admin access unknown; Supabase plan and who owns backups unknown; Claude API data terms for lead PII unchecked; BCI/DPDP review not done. See `04-open-questions/questions.md`.
