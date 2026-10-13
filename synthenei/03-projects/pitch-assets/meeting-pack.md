# LAWSOME owner meeting: meeting pack (internal)

**Goal:** leave with a yes to a small, priced 30-day pilot of the LAWSOME go-to-market work: landing page, outbound campaign and the growth CRM with 2 salespeople. Also leave with the inputs needed to start it.
**Stance:** we market LAWSOME and run its sales funnel. We do not build the product. Everything we show is labelled as **Sample data**, **Showcase** (simulated integration) or **AI draft**. Nothing is live yet, so say "designed to" or "plan" for anything not built.

## Agenda (60 min)

| Time | Who | What | Material |
|---|---|---|---|
| 0–5 | **Ashique** | Opening: why we're here, what we've built for LAWSOME so far, and what we want to leave with (a pilot) | — |
| 5–7 | Krishna | Play the 60-second film | `pitch-assets/lawsome-60s.mp4` (captioned; silent unless the Tamil VO has been added) |
| 7–12 | All, led by Ashique | **Discovery, part 1:** questions 1, 2, 6 and 7 below. What they answer here shapes the rest | this pack |
| 12–24 | **Krishna** | Landing page (about 4 min): hero, guided tour, lead form with consent. Then the growth CRM concept (about 8 min, see "CRM demo" below) | `apps/lawsome-landing` (local); `apps/growth-crm` build, or its screens |
| 24–32 | **Venkat** | Campaign plan: ICP (managing partners and practice heads at Tamil Nadu firms), message ("Your entire law firm. One clear view."), channels, sequence and what each step costs. Uses the deck screens | `pitch-assets/deck-screens/` |
| 32–39 | **Shaun** | POC plan: 30-day pilot scope, 2 salespeople, weekly check-ins, success measures (below) | — |
| 39–45 | **Kiruba** | Data: lead sources and quality, consent and DPDP handling, data ownership, and the backup and export plan | — |
| 45–55 | All, led by Ashique | **Discovery, part 2:** the remaining questions. **Listen more than we talk.** | this pack |
| 55–60 | Ashique | The ask and next steps | — |

### CRM demo (Krishna, about 5 of the 10 minutes; full script in `03-projects/growth-crm/03-product-spec.md` section 12)
1. Branded login with a role picker, then the rep's "My day": follow-ups due and overdue, a hot lead whose score shows the factors behind it, and demos this week against target pace.
2. Lead detail: log a call, send a Tamil WhatsApp template (labelled **Showcase**, simulated) and schedule a demo.
3. Pipeline: move a deal to "Proposal sent". Marking it Won needs seats and a value in INR.
4. Owner Command Center: revenue against target, cost per demo by campaign, wins by district and the rep scorecard.
5. Integrations page: showcase tiles with their real blockers (Meta verification, LinkedIn API approval). AI features are off by default.
6. **Multi-workspace and white-label.** Use the workspace switcher to move from "LAWSOME · Tamil Nadu" (`lawsome-tn`) to "LAWSOME · Kerala pilot" (`lawsome-kl`): the role changes from Sales Rep to Viewer and the data is isolated. Then switch to the second tenant, "Kaveri LegalTech (demo)" (`kaveri-demo`, workspace "Kaveri · Coimbatore"), and the whole app re-themes. That proves the white-label.
7. **Super admin and support access.** Open the `/admin` console and start a support session. It needs a reason (at least 20 characters), a time box of 15, 30 or 60 minutes and a mode (read-only or read-write). An amber banner shows while it runs, and it appears in the tenant's audit log.
8. **Mobile.** Show the 390 px phone view of the rep's "My day". Use a real phone if the build is up; otherwise use the screenshot.

Steps 6–8 are the newest requirement. Before the meeting, check with the BUILD/ADMIN agents which parts are built and which are spec only, and say "designed to" for anything not built.

## Discovery questions for the LAWSOME owner
1. **Sales team:** How many people sell today? Who follows up a demo request, and how fast?
2. **Lead sources:** Where do your current customers come from (referrals, bar associations, events, digital)? Which source closes best?
3. **Pricing model:** How do you charge (per seat, per site, annual)? Typical deal size? Is there a free trial or pilot?
4. **Target cities:** Chennai and Madurai first? Coimbatore, Tiruchirappalli? Firm size, and court focus (High Court, District)?
5. **Marketing owner:** Who owns marketing today? What budget and tools exist (CRM, email, WhatsApp Business)?
6. **30-day success:** What would make the next 30 days a clear win: demos booked, pilots started, revenue?
7. **White-label:** Does the CRM or landing need to carry only the LAWSOME brand? Would you resell it to firms or partners?
8. **Regions and brands:** Will you run more than one region or brand (Tamil Nadu now, a Kerala pilot, a partner brand)? Who should see which data?
9. **Data and access:** Can we get a sanitised export of past leads and customers? Who signs off on data handling?
10. **Product proof:** Can we get a verified Ask Nidhi capture from the working build for the public assets?

Hypotheses to confirm, not assert: the owner wants cost per demo by campaign, rep follow-up discipline (response SLA, overdue items), the quarter's weighted pipeline in INR, which Tamil Nadu firms convert, confidence that the data is safe and theirs, and their own brand on everything.

## Objection handling

| Objection | Answer |
|---|---|
| **"What will this cost?"** | Start with a fixed-price 30-day pilot with 2 salespeople and a defined scope. Only commit further if it hits the agreed numbers. Quote after discovery, once we know team size and channels. Don't improvise a number in the room. |
| **"Is our data safe? What about DPDP?"** | **Built today:** leads are collected with explicit consent and a privacy notice, and analytics only run after consent (on the landing page). **Designed, in the pilot plan:** the data stays yours, with export at any time, a retention and deletion policy, an audit log and daily backups. Backups start before go-live, and we'll show you the first backup record. The privacy notice is a draft pending legal review, so say so. Under BCI rules we market a software product *to* lawyers; nothing advertises advocates to the public. |
| **"Can your team see our data?"** | Only inside an audited, time-boxed support session. It needs a stated reason, has a 15 to 60 minute limit and is read-only unless you agree otherwise, and it shows in your audit log. (This is the design. Say which parts are built.) |
| **"We already use X CRM."** | Fine. We don't need to replace it. The landing page and campaigns can feed X, and the growth CRM's value is the owner and rep views on top. Ask what X doesn't show them today. If they're happy with X, the pilot is the campaign plus reporting. |
| **"Can we trust the AI?" (Ask Nidhi or AI drafts in the CRM)** | Ask Nidhi *supports legal research*. It surfaces related matters and judgments for the advocate to verify. It does not give legal advice or predict outcomes. In the CRM, AI features are off by default, labelled "AI draft", and a person approves them. We make no accuracy claims we haven't validated. |
| **"Is any of this live?"** | No. The screens show sample data, and integrations are labelled Showcase with their real blockers named. The pilot is how it goes live. |

## The ask and next step
1. Agree a **30-day pilot**: 2 salespeople, a Chennai/Madurai ICP, landing page plus one outbound campaign plus CRM reporting.
2. Inputs within 3 working days: current tools, team size, pricing sheet, platform access (domain/Vercel, WhatsApp Business, email), a sanitised lead export, and a verified Ask Nidhi capture.
3. Book a 30-minute follow-up this week to confirm scope and price, and name the owner's point of contact.

## Do not say or show
- WhatsApp per-message prices, the June 2026 court AI rules (unverified), or any Tamil Nadu advocate-count figure. We have no credible source for any of them.
- "AI-powered", "revolutionise", "seamless", "unlock". Also no productivity percentages and no advocate testimonials (BCI Rule 36).
- Any real names or screenshots from the dev build: they contain tester and party PII.

## Materials checklist
- [ ] `pitch-assets/lawsome-60s.mp4` on the laptop, tested on the room's screen (it has no sound)
- [ ] Landing running locally (`apps/lawsome-landing`, `npm run dev`) as a backup to any deployed URL
- [ ] CRM build running, with workspace switcher, Kaveri tenant and `/admin` checked the evening before
- [ ] A phone ready for the 390 px "My day" view
- [ ] Fallback if the CRM build fails on the day: screenshots from `apps/growth-crm/preview/`
- [ ] **Landing fix before showing it live:** its dashboard shows Open 17 against a 24-case total (it should be 16). Fix it in `apps/lawsome-landing/src/data/demo.ts`, or skip the dashboard tour slide in the room
- [ ] Venkat's deck using `pitch-assets/deck-screens/`, with "Sample data" on every product slide
- [ ] A printed copy of the discovery questions for the note-taker (Kiruba)
