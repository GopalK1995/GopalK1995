# Open questions (answer inline, then log in 05-decisions)
1. Is the law firm a signed client, a warm prospect, or an idea? What exactly did they ask for?
2. What is "Coasters"? And is "Loss" the product name?
3. Screenshots/notes from yesterday's meeting — upload.
4. Stack/deploy: Supabase + Vercel OK? Who pays/owns accounts?
5. Which first screen proves value fastest to a lawyer?
6. Realistic data: is real (anonymised) firm data allowed?
7. Who is on the team — 4 or 5?
8. Pricing/pilot terms for lawyers and firms?

## Growth CRM (LAWSOME) — questions for Krishna (added 2026-10-13)
1. **GA4:** Is there a GA4 property on the landing page? Can you grant Viewer to a service account, and what is the property ID?
2. **LinkedIn:** Is there a verified LinkedIn Company Page and an ad account? Who is admin? (API partner approval is not guaranteed; CSV/mock plan stands regardless.)
3. **Email tool:** Which email tool does Venket use (Mailchimp, Zoho Campaigns, Brevo, Gmail merge...)? Can it export CSV / send webhooks?
4. **Meta:** Is there a Meta ad account and a Pixel/Conversions setup on the landing page?
5. **Supabase:** Which project and plan (Free vs Pro)? Who pays and who owns it? Free/Pro keep only 7 days of backups, PITR is a paid add-on.
6. **Backups:** Who owns backups and restore drills? Where may offsite dumps be stored, and who gets the alerts?
7. **Hosting:** Where does the CRM deploy (Vercel?) and who gets login access (Venket, Shaun, Kiruba, Ashique)?
8. **WhatsApp:** Does Venket actually plan to message leads on WhatsApp at MVP, or is it a manual channel for now?
9. **AI:** OK to send lead name/role/firm/event timeline to the Claude API for draft summaries? Needs a data-terms check; off by default until answered.
10. **Compliance:** Who reviews the privacy notice (DPDP) and lawyer-marketing copy (Bar Council advertising rules)?
11. **Scope guardrail:** Agree the switch rule: if we start building generic contacts/deals features, move to Twenty and keep only analytics + backup screens.
12. **Leads source:** Is the existing `leads` table from `lawsome-landing/supabase/leads.sql` already live anywhere, or is the new schema the only one?
