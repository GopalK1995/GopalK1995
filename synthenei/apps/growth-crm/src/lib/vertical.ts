// Vertical vocabulary: one source of truth for industry wording. LEGAL strings are character-identical to the original
// hard-coded copy (LAWSOME / Kaveri). HOSPITALITY is the guesthouse vocabulary (Shola Mist). Pure data and helpers:
// importable from server components, client components and middleware.
import type { DealStage, FirmSize, LeadStage } from "./data/types";
import { TENANTS } from "./tenancy";

export type Vertical = "legal" | "hospitality";
/** Singular/plural pair: `nc(2, v.n.lead)` -> "2 leads". */
export interface Noun { one: string; many: string }
export const nc = (n: number, x: Noun) => `${n} ${n === 1 ? x.one : x.many}`;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const LEGAL = {
  id: "legal" as Vertical,
  n: {
    lead: { one: "lead", many: "leads" } as Noun,
    deal: { one: "deal", many: "deals" } as Noun,
    demo: { one: "demo", many: "demos" } as Noun,
    firm: { one: "firm", many: "firms" } as Noun,
    // @@LEGAL-N
  },
  nav: { leads: "Leads", accounts: "Law firms", sell: "Sell" },
  leadStage: { new: "New", contacted: "Contacted", qualified: "Qualified", demo_booked: "Demo booked", demo_done: "Demo done", proposal: "Proposal", won: "Won", lost: "Lost" } as Record<LeadStage, string>,
  dealStage: { discovery: "Discovery", demo_scheduled: "Demo scheduled", demo_done: "Demo done", proposal: "Proposal sent", negotiation: "Negotiation", won: "Won", lost: "Lost" } as Record<DealStage, string>,
  partySize: { Solo: "Solo", "2–5": "2–5", "6–20": "6–20", "21–50": "21–50", "50+": "50+" } as Record<FirmSize, string>,
  channelFamily: { "Paid social": "Paid social", Search: "Search", WhatsApp: "WhatsApp", Email: "Email", "Referrals & events": "Referrals & events" } as Record<string, string>,
  funnel: { visit: "Visitors (consented)", cta: "CTA click", form: "Form start", lead: "Lead", qualified: "Qualified", demo: "Demo booked", demo_done: "Demo done", won: "Won" } as Record<string, string>,
  search: "Search leads, firms, cities",
  cc: {
    sub: (districts: number, region: string) => `Revenue, pipeline and the campaigns feeding them, for law firms across ${districts} districts: ${region}.`,
    unanswered: (n: number) => `${n} lead${n === 1 ? "" : "s"} past the 2-hour first-response SLA without a reply`,
    unansweredOk: "Every new lead got a first reply within the 2-hour SLA",
    quiet: (n: number, city: string) => `${n} ${city} ${n === 1 ? "firm has" : "firms have"} had no contact in 5+ days`,
    quietOk: "Every prospect firm was contacted in the last 5 days",
    stale: (n: number) => `${n} proposal${n === 1 ? "" : "s"} with no reply for 7+ days`,
    headline: "Open pipeline", headlineFoot: (count: number, weighted: string, win: string) => `${count} deals · weighted ${weighted} · win rate ${win}`,
    stageAria: "Open pipeline value by stage", closing: "Closing next", wonIn: (month: string, n: number) => `Won in ${month} · ${n} deals`,
    kWon: "Won this month", kWonFoot: (avg: string) => `Avg deal ${avg} · annual seats, placeholder prices`, kWonNone: "No deals won yet in this workspace",
    kNew: "New leads (30 days)", kConv: "Lead → demo", kConvFoot: (a: number, b: number) => `${a} demos from ${b} leads`,
    kCost: "Cost per demo", kCostFoot: (booked: number, spend: string, sla: string, med: string, prev: string) => `${booked} paid demos booked · spend ${spend} · SLA met ${sla} (median ${med}, prev. ${prev})`,
    perDay: "Leads per day", perDaySub: "All channels, created date (IST). Line = 7-day average.", perDayAria: "Leads per day, last 90 days, with 7-day average", perDayBar: "Leads that day",
    mix: "Channel mix", mixSub: "Leads by first-touch channel, top 4 + other", mixAria: "Share of leads by channel", mixCenter: "leads",
    funnel: "Funnel: visit to won", cpd: "Cost per demo by campaign", cpdAria: "Cost per demo booked by campaign in rupees", cpdNote: (n: number, spend: string) => `${n} demos from ${spend} spend`, cpdValue: "Cost per demo",
    firms: "Top firms in pipeline", firmsSub: "Open deal value, best lead score at the firm", firmsLink: "Law firms", firmsCaption: "Top firms by open pipeline value", firmCol: "Firm",
    firmMeta: (locality: string, city: string, lawyers: number) => `${locality}, ${city} · ${lawyers} lawyers`,
    team: (month: string) => `Team in ${month}`, teamSub: "Won vs monthly target · demos booked this month · SLA on leads from the last 30 days",
    rep: (i: number) => `Rep ${i}`, teamLine: (booked: number, done: number, target: number, sla: string, open: string) => `${booked} demos booked · ${done}/${target} done · SLA ${sla} · open ${open}`,
    territories: "Territories", allTerritory: "all districts", prevMonthLabel: (m: string) => `vs ${m}`,
  },
  rooms: 0,
  mk: {
    sub: "Which campaigns turn rupees into demos. Spend and reach come from platform exports; leads and demos are counted in the CRM, so the Gap column shows where they disagree.",
    kLeads: "Leads · 30 days", kCpl: "Cost per lead · 30 days", kDemos: "Demos booked · 30 days", kDemosFoot: "vs prior 30d · by booking date", kCpd: "Cost per demo · 30 days", kCpdUnit: "demo",
    cheapest: "Which campaigns bring leads cheapest?", cheapestSub: "Cost per CRM lead over 90 days, lowest first. * Mailchimp counts tool cost only, no media spend.", cplAria: "Cost per lead by campaign", cplValue: "Cost per lead",
    cplNote: (n: number, ch: string, tool: boolean) => `${n} leads · ${ch}${tool ? " · tool cost only" : ""}`,
    best: (cost: string) => ` books demos at ${cost} each, the lowest of any paid-media campaign with 3 or more demos.`,
    email: (name: string, cost: string) => ` Email re-engagement (${name}) costs ${cost} per demo, but only reaches people already in the list.`,
    donutLeads: (n: number) => `${n} leads`, perUnit: (cost: string) => `${cost}/demo`, noUnit: "no demos",
    th: { leads: "Leads", demos: "Demos", conv: "Lead → demo" }, mobileFact: (l: number, d: number) => `${l} leads · ${d} demos`,
    tableCaption: "All campaigns with spend, reach, CTR, CPL, leads, demos and conversion",
    foot: "Synthetic data shaped like LinkedIn, Meta, Google Ads, WhatsApp and Mailchimp exports",
    radarCpl: "CPL", leadRate: "Lead rate",
  },
  cd: {
    funnelDemo: "Demos booked", funnelWon: "Won", funnelLead: "Leads (CRM)",
    kLeads: "Leads in CRM", kDemos: "Demos booked", kDemosFoot: (cost: string | null, pctLeads: string) => `${cost ? `${cost} per demo` : "no paid spend"} · ${pctLeads} of leads`,
    kWonFoot: (n: number, roas: string | null) => `${n} deal${n === 1 ? "" : "s"} · ${roas ? `${roas}× ROAS` : "no spend to compare"}`,
    cplFoot: (cpl: string, platform: number) => `CPL ${cpl} · platform says ${platform}`,
    spendTitle: "Is spend turning into leads day by day?", spendSub: "Daily spend from the platform export beside CRM leads by created date (IST)",
    attribTitle: "Who gets the credit?", attribSub: "First touch: this campaign sourced the lead. Last touch: the lead's final touch was still this campaign's channel.",
    moved: (a: number, b: number, list: string) => `${a} of ${b} leads had a later touch elsewhere: ${list}. Multi-touch credit is out of scope at this volume.`,
    who: "Who responded?", whoSub: (n: number) => `${n} CRM leads by role, district and firm size`, role: "Role", district: "District", size: "Firm size (lawyers)",
    utmLeads: "Leads", utmDemos: "Demos", leadsTitle: "Leads from this campaign", leadsSub: (n: number, masked: boolean) => `${n} leads, first touch. ${masked ? "Names masked for your role." : "Newest first."}`,
    leadsCaption: (name: string) => `Leads attributed to ${name}`, leadsEmpty: "No CRM leads from this campaign yet.", leadsHint: "Leads appear once a form submit carries",
    colLead: "Lead", colFirm: "Firm", colDistrict: "District",
    notePh: "Swapped the carousel's 2nd card to the Tamil cause-list screenshot on 9 Oct; CTR up from 0.9% to 1.2% since.",
    foot: (stage: string) => `Stage labels: ${stage} and later count as demos.`,
    attr: { leads: "Leads", demos: "Demos", won: "Won", revenue: "Revenue" }, utmSub: "How linked leads were tagged when they arrived",
    dlgNamePh: "Madurai Bench hearings — senior advocates", dlgThemePh: "hearings", dlgDistrict: "District", dlgStatewide: "Statewide",
    platforms: [
      { key: "linkedin", label: "LinkedIn Campaign Manager", cols: "Campaign name, Date, Impressions, Clicks, Total spent, Leads" },
      { key: "meta", label: "Meta Ads Manager", cols: "Campaign name, Day, Reach, Impressions, Link clicks, Amount spent (INR), Leads" },
      { key: "google_ads", label: "Google Ads", cols: "Campaign, Day, Impr., Clicks, Cost, Conversions" },
      { key: "email", label: "Mailchimp", cols: "Campaign, Send date, Emails sent, Unique opens, Unique clicks, Unsubscribes" },
      { key: "whatsapp", label: "WhatsApp (BSP export)", cols: "Template, Date, Sent, Delivered, Read, Replied, Cost" },
    ] as { key: string; label: string; cols: string }[],
    channelOptions: [["linkedin", "LinkedIn"], ["whatsapp", "WhatsApp"], ["email", "Mailchimp"], ["meta", "Meta"], ["google_ads", "Google Ads"]] as [string, string][],
    defaultChannel: "linkedin", leadsWord: "leads", exportMsg: (n: number) => `CSV of ${n} leads would download`, exportDetail: (n: number) => `${n} without marketing consent excluded from platform uploads.`,
    segMsg: (seg: string, size: number, camp: string) => `Segment "${seg}" (${size} leads) would be attached to "${camp}"`,
    radarFoot: "Cost efficiency ranks cost per lead, lowest first; email with no media spend ranks best.",
  },
  an: {
    sub: (name: string) => `How people move through the ${name} site before they become leads, and which channel gets credit once they do.`,
    note: (name: string) => `GA4 is not connected. Every number here is a sample series shaped like a GA4 property for the ${name} site.`,
    stack: { won: "Won", open: "Demo done, deal open", booked: "Booked, upcoming", lost: "Lost" },
    weeklyTitle: "How many demos are booked each week, and where are they now?", weeklySub: (n: number) => `${n} demos booked in 12 weeks, stacked by today's outcome`,
    weeklyAria: "Demos booked per week stacked by outcome.", weeklyNote: "Recent weeks are mostly upcoming or open: outcomes settle 2–4 weeks after the demo.",
    pagesSub: "Last 90 days. Key event = form submit or demo booking.", ctaPath: "/demo",
    credit: (pct: string) => `Leads from the last 90 days. ${pct} arrived without a utm_campaign (M19).`,
    formsKpi: "GA4 vs CRM form submits", crmSubmits: "CRM submits",
    att: { leads: "Leads", demos: "Demos", won: "Won", bars: "Leads by channel", note: (d: number, w: number) => `${d} demos · ${w} won`, first: "Credit to the channel that brought the lead in", last: "Credit to the lead's most recent touch",
      cap: "Leads, demos and won deals by channel under" },
  },
  au: {
    eyebrow: "Marketing · all live leads", sub: "Who our leads are, by district, firm size, practice and role, and which slices turn into demos. Build a segment, then attach it to a campaign.",
    icpTitle: "Ideal customer profile", icpFoot: (a: number, b: number) => `${a} of ${b} leads match (M15)`,
    icpLines: [["Role:", "Managing Partner, Senior Advocate, Partner, Founding Advocate"], ["Firm:", "2 or more lawyers (ICP tier A or B)"], ["Contact:", "work email, Tamil Nadu district"]] as [string, string][],
    icpConv: "ICP lead → demo", others: "Everyone else", convWord: "lead → demo", demosWord: "demos",
    distTitle: "Which districts bring leads?", distSub: (l: string, n: number, t: number) => `${l} brings ${n} of ${t} leads. Hover a bar for demos and conversion.`, distSubNone: "Leads by district", distAria: "Leads by Tamil Nadu district.",
    sizeTitle: "How big are the firms?", sizeSub: "Leads by number of lawyers, smallest first", sizeAria: "Leads by firm size.",
    pracTitle: "What do they practise?", pracSub: "Primary practice area of the lead's firm", pracAria: "Leads by practice area.", pracOther: (n: number) => `Other (${n} areas)`, pracCenter: "leads",
    roleTitle: "Who fills the form?", roleSub: "Leads by role; decision-makers highlighted", roleAria: "Leads by role.", roleHi: (t: string) => ["Managing Partner", "Senior Advocate", "Partner", "Founding Advocate"].includes(t),
    segSub: "Lead → demo and win rate per segment; win rate counts closed deals only", colLeads: "Leads", colLeads30: "Leads 30 d", colConv: "Lead → demo", mobileConv: " to demo", mobileLeads: " leads",
    segments: [
      { id: "chn-hc", name: "Chennai High Court decision-makers", rule: "District = Chennai AND court = Madras HC AND role in ICP roles" },
      { id: "kongu", name: "Kongu belt mid-size firms", rule: "District in Coimbatore, Salem AND firm size 6–50" },
      { id: "south", name: "Madurai Bench litigators", rule: "District in Madurai, Tirunelveli, Tiruchirappalli AND High Court practice" },
      { id: "small", name: "Solo and small chambers", rule: "Firm size in Solo, 2–5" },
      { id: "ops", name: "Practice and office managers", rule: "Role in Practice Manager, Office Manager" },
    ],
    fields: { district: "District", size: "Firm size", title: "Role", practice: "Practice area", court: "Court focus", channel: "Source channel" },
    courtOpts: ["Madras High Court / Madurai Bench", "District courts only"], matching: "Matching leads", convRow: "Lead → demo",
    initName: "Madurai Bench senior advocates", initRules: [{ field: "district", values: ["Madurai", "Tirunelveli"] }, { field: "court", values: ["Madras High Court / Madurai Bench"] }] as { field: string; values: string[] }[],
    foot: "Synthetic Tamil Nadu firms and leads. Counts only: no names or contact details leave the server on this page.",
  },
  role: { owner: "Owner", sales_manager: "Sales Manager", sales_rep: "Sales Rep", marketing: "Marketing", data: "Data", viewer: "Viewer" } as Record<string, string>,
  wa: [
    { id: "ecourts_intro_ta", lang: "Tamil", body: "வணக்கம் {{1}}, LAWSOME உங்கள் Madras High Court மற்றும் மாவட்ட நீதிமன்ற வழக்குகளின் அடுத்த விசாரணை தேதிகளை காலை 7 மணிக்கு அனுப்பும். டெமோ பார்க்க DEMO என பதில் அனுப்பவும்." },
    { id: "demo_invite_ta", lang: "Tamil", body: "வணக்கம் {{1}}, {{2}} குழுவுக்கு 30 நிமிட LAWSOME டெமோ ஏற்பாடு செய்யலாமா? மாலை 5:30க்கு பிறகு அல்லது சனிக்கிழமை காலை வசதியா? பதில் அனுப்பவும்." },
    { id: "demo_reminder_en", lang: "English", body: "Hi {{1}}, a reminder of your LAWSOME demo for {{2}}. The Meet link is in your email. Reply 1 to confirm or 2 to reschedule." },
    { id: "proposal_followup_en", lang: "English", body: "Hi {{1}}, sharing the annual proposal for {{2}} again. Happy to walk your partners through it this week." },
  ] as { id: string; lang: string; body: string }[],
  /** Quick-actions / inbox template list (legal keeps its original three). */
  waQuick: [
    { id: "ecourts_intro_ta", lang: "Tamil", body: "வணக்கம் {{1}}, LAWSOME உங்கள் Madras High Court மற்றும் மாவட்ட நீதிமன்ற வழக்குகளின் அடுத்த விசாரணை தேதிகளை காலை 7 மணிக்கு அனுப்பும். டெமோ பார்க்க DEMO என பதில் அனுப்பவும்." },
    { id: "demo_reminder_en", lang: "English", body: "Hi {{1}}, a reminder of your LAWSOME demo on {{2}}. The Meet link is in your email. Reply 1 to confirm or 2 to reschedule." },
    { id: "proposal_followup_en", lang: "English", body: "Hi {{1}}, sharing the annual proposal for {{2}} again. Happy to walk your partners through it this week." },
  ] as { id: string; lang: string; body: string }[],
  lost: [["price", "Price"], ["competitor", "Chose a competitor"], ["no_decision", "No decision"], ["timing", "Timing"], ["not_a_fit", "Not a fit"], ["in_house_excel", "Stayed on in-house Excel"]] as [string, string][],
  views: { mine: "My open leads", unassigned: "Unassigned", today: "New today", sla: "SLA breached", hot: "Hot (70+)", all: "All" } as Record<string, string>,
  ls: {
    title: "Leads", eyebrowRep: "Your leads and unassigned leads in your territory", eyebrowMasked: (role: string) => `Read-only for ${role}: names masked, no contact details`, eyebrowAll: (n: string) => `${n} leads in this workspace`,
    sub: (view: string, n: string, count: number, range: string) => `${view}: ${n} lead${count === 1 ? "" : "s"}${range}.`,
    emptyMine: "No open leads assigned to you.", emptyMineHint: (unassigned: number) => (unassigned ? `Claim from Unassigned (${unassigned} in your territory).` : "Your manager assigns leads from this page; new web leads in your districts are routed to you automatically."),
    emptyUnassigned: "No unassigned leads.", emptyUnassignedHint: "Territory routing (Chennai, Kongu & Salem, South TN) assigned every new lead. Check SLA breached for leads waiting on a first touch.",
    emptyToday: "No leads created today yet.", emptyTodayHint: "Web forms and Meta lead ads usually arrive after 11:00 IST. Open All to work older leads.",
    emptySla: "No first-response SLA breaches.", emptySlaHint: "Every lead in this view was touched within 2 business hours.",
    emptyFilter: "No leads match these filters.", emptyFilterHint: "Clear a filter or search by phone number instead of name.",
    district: "District", searchMasked: "Search firm, city or district", search: "Search name, firm, phone or city",
    maskedNote: "Viewer access shows initials, firm, district, stage and score only. Phone, email and timelines stay hidden.", unknownFirm: "Unknown firm",
    colLead: "Lead", colFirm: "Firm · district", tableAria: "Leads", selectAll: "Select all leads on this page",
    importBtn: "Import CSV", importTitle: "Import leads from CSV", importDesc: "Columns we read: name, phone, email, firm, city, role, source. Duplicates match on phone or email.", importMerge: "Merge into existing lead", importConfirm: "leads",
    importTooBig: "Files up to 2 MB. Split larger exports by district.",
    a: {
      notFound: "Lead not found in this workspace.", onlyOwn: "You can act only on leads assigned to you.", pickOwner: "Pick a sales rep or manager in this workspace.", noneFound: "None of the selected leads are in this workspace.",
      assigned: (n: number, who: string) => `${n} lead${n > 1 ? "s" : ""} assigned to ${who}`, exported: (n: number, masked: boolean) => `Exported ${n} leads${masked ? " (phone and email masked)" : ""}`,
      needRows: "The file needs a header row and at least one lead.", queued: (f: number, d: number, merged: boolean) => `Import queued: ${f} new leads, ${d} duplicates ${merged ? "merged" : "skipped"}`,
      demoPast: "The demo time is in the past.", demoSched: (date: string, time: string, min: number, mode: string) => `Demo scheduled for ${date}, ${time} IST (${min} min, ${mode})`, demoSub: "Meeting activity and prep task created; deal moves to Demo scheduled.",
      callSub: "", dq: [["student", "Student"], ["not_a_firm", "Not a law firm"], ["outside_tn", "Outside Tamil Nadu"], ["duplicate", "Duplicate"], ["no_budget", "No budget"], ["competitor", "Competitor"]] as [string, string][],
    },
  },
  qa: {
    callDefault: "Discussed cause-list alerts for Madras HC matters; partner wants Tamil walkthrough.", waName: "Saravanan", waSlot: "Thu 15 Oct, 5:30 pm",
    demoBtn: "Schedule demo", demoTitle: "Schedule a demo", demoModes: ["Google Meet", "In person at firm", "Phone"], demoNote: "Most partners prefer after 5:30 pm on weekdays or Saturday mornings (court hours 10:30–17:00).",
    demoToast: (firm: string) => `Demo scheduled${firm ? ` with ${firm}` : ""}`, demoToastSub: "Demo: task created and deal moved to Demo scheduled for this session only.", consentMsg: "This lead has not opted in to WhatsApp. Templates are blocked until consent is recorded.",
  },
  ld: {
    metaTitle: (id: string) => `Lead ${id}`, otherRepTitle: "This lead is assigned to another rep.", otherRepBody: "Sales Reps open only their own leads. Ask your Sales Manager to reassign it if the firm is in your territory.", backToMine: "Back to my leads",
    unknownFirm: "Unknown firm", crumb: (id: string) => `Leads · ${id}`, district: (d: string) => `${d} district`, subAt: "at",
    followUp: "Demo follow-up", maskedCard: "Firm", maskedRows: (firm: string, district: string, size: string, courts: string, source: string, lawyers: number | null) => [["Firm", firm], ["District", district], ["Size", lawyers === null ? "Unknown" : `${size} (${lawyers} lawyers)`], ["Courts", courts], ["Source", source]] as [string, string][],
    maskedNote: (role: string) => `Your role (${role}) reads masked records: initials, firm, district, stage and score. Phone, email, messages and activity stay with the sales team. Ask the Owner if you need full access.`,
    readOnly: (role: string) => `Read-only for ${role}: calls, messages and stage changes are made by the sales team.`,
    sentOn: (ch: string) => ch, firstTouchWarn: (rel: string) => `Log the first touch to start the SLA clock. The lead arrived ${rel}.`,
    summaryA: (title: string, size: string, lawyers: number | string, district: string, stage: string, ch: string, rel: string) => `${title} at a ${size} firm (${lawyers} lawyers) in ${district}; ${stage} stage, came in via ${ch} ${rel}.`,
    snapshot: "Firm snapshot", openAccount: "Open firm",
    snapRows: (a: { name: string; where: string; lawyers: number; size: string; courts: string; practice: string; tier: string }) => [["Firm", a.name], ["Location", a.where], ["Lawyers", `${a.lawyers} (${a.size})`], ["Courts", a.courts], ["Practice", a.practice], ["ICP tier", a.tier]] as [string, string][],
    dealCard: "Open deal", seatsRow: "Seats · plan", seatsVal: (seats: number, plan: string, nights: number | null) => `${seats} · ${plan}`, inStage: "In stage", expectedClose: "Expected close", wonOn: "Won on",
    tasksFor: "Tasks for this lead", nextBest: {
      newCall: "Call now to start the conversation", newNoTouch: (rel: string, passed: boolean) => `No first touch yet; the lead came in ${rel} and the 2-hour SLA ${passed ? "has already passed" : "is still running"}.`, newTouched: "First touch done; confirm interest and a demo slot.",
      contactedWa: "Send WhatsApp template demo_invite_ta", contactedCall: "Call to book a demo with the partners", noWa: "No WhatsApp consent, so a call is the fastest route.",
      qualifiedAct: "Schedule demo", qualifiedWhy: "Qualified but no demo yet. Partners are usually free after 17:30 or on Saturday mornings.",
      bookedWa: "Send WhatsApp template demo_reminder_en", bookedMail: "Email demo reminder with the Meet link", bookedWhy: "Demo is booked; a reminder the day before cuts no-shows.",
      doneAct: "Send proposal", doneWhy: (since: string, intent: boolean) => `Demo done${since}${intent ? "; pricing page visited since" : ""}.`,
      propAct: "Call the managing partner to close", propWhy: (quiet: number) => `Proposal is with them; last two-way contact ${quiet} day${quiet === 1 ? "" : "s"} ago.`, defAct: "Mark as nurture", defWhy: "No clear buying signal yet.",
    },
    dismissReasons: ["Already done", "Wrong timing", "Partner unavailable", "Not relevant"],
    // stay card only renders for hospitality
  },
  la: {
    callPh: "e.g. Partner in court till 5; wants a Tamil walkthrough of the Madurai Bench cause list.", statusLabel: "Set lead status", converted: "Converted to deal",
    emailSubject: (name: string, firm: string) => `${name} for ${firm}: cause-list alerts and next steps`,
    emailBody: (first: string, name: string) => `Dear ${first},\n\nThank you for your time today. As discussed, I am sharing how ${name} sends next-hearing dates for your Madras High Court and district court matters every morning.\n\nRegards`,
    demoBtn: "Schedule demo", demoTitle: "Schedule a demo", demoDesc: (firm: string) => `${firm} · times in IST`, modes: ["Google Meet", "In person at the firm", "Phone"], demoNote: "Partners are usually free after 17:30 on weekdays or on Saturday mornings; court hours run 10:30–17:00.", demoFoot: "Schedule demo",
    noWa: (name: string) => `${name} has not opted in to WhatsApp. Record consent first; templates stay blocked until then.`, dqDesc: "The lead leaves open views and stops counting towards SLA. You can reopen it later.",
  },
  ib: {
    sub: (n: number, unread: number) => `${n} conversations across WhatsApp, email and LinkedIn, ${unread} unread. Showcase: no messages are sent. Data is sample.`,
    channels: ["whatsapp", "email", "linkedin"] as string[],
    emailTpl: [
      { id: "demo_recap_en", lang: "English", body: "Dear {{1}}, thank you for your time today. As promised, here is the recap of the demo and the trial workspace link for {{2}}." },
      { id: "pricing_note_en", lang: "English", body: "Dear {{1}}, please find the annual pricing for {{2}} attached. Clerks use free staff seats; prices exclude GST." },
      { id: "security_note_en", lang: "English", body: "Dear {{1}}, attaching our data-handling note: data is hosted in AWS Mumbai and customer content is never used to train models." },
    ] as { id: string; lang: string; body: string }[],
    suggestTpl: (stage: string): string => (stage.startsWith("Demo") ? "demo_reminder_en" : "ecourts_intro_ta"), yourFirm: "your firm",
    ack: (ta: boolean) => `I have read this draft${ta ? ", checked the Tamil," : ""} and it makes no promise outside our price list or legal advice.`,
    modelNote: "Sent to the model: first name, role, firm, district and this thread with phone and email removed.",
    readOnly: "Marketing can read conversations to see campaign replies. Replies are sent by the owning rep.", leadEyebrow: "Lead", firmMeta: (district: string, lawyers: number) => ` · ${district} · ${lawyers} lawyers`,
    dealEyebrow: "Open deal", dealLine: (plan: string, seats: number) => `${plan} · ${seats} seats`, noDeal: "No open deal. Open one from the firm page once a demo is agreed.", followUp: "Demo follow-up", linked: "Linked lead",
    needsReview: "It needs Owner or counsel review before it goes out.", linkedMsg: "That lead is not in this workspace.",
  },
  login: {
    line: "Every campaign, lead and law firm in one ledger, from first click to signed seats.", facts: (leads: number, accounts: number, open: number, towns: string) => [["Leads (90 days)", String(leads)], ["Law firms", String(accounts)], ["Open deals", String(open)], ["Districts", towns]] as [string, string][],
    foot: "Sample tenant. Firms and people are fictional; nothing is sent to WhatsApp, email or ad platforms.", emailPh: "you@firm.example", short: "Your sign-in for the sales and marketing desk.",
  },
  md: {
    sub: (touch: number, overdue: number, demos: number) => `${touch} touches due today, ${overdue} overdue, ${demos} demos left this week.`,
    nothing: "Nothing due today. Check hot leads on the right.", slaLabel: (h: number) => `First-response SLA (${h} business hours)`,
    hot: "Hot leads", hotNone: "No leads above 70 yet. Scores rise with pricing-page visits and WhatsApp replies.",
    wk: "Demos this week", wkSub: "Monday to Saturday, IST", wkAria: "Demos per day this week", wkSeries: "Demos", days: 6,
    pipe: "My pipeline by stage", pipeSub: (n: number, val: string) => `${n} open deals · ${val}`, pipeNote: (n: number) => `${n} deals`, pipeAria: "My open pipeline value by stage",
    target: "Target vs achieved", targetSub: (m: string) => `${m}, pace tick = share of month gone`, won: "Won value", done: "Demos done",
    conv: [["Lead", "new"], ["Contacted", "contacted"], ["Demo booked", "demo_booked"], ["Proposal", "proposal"], ["Won", "won"]] as [string, string][], convSub: "Last 90 days, cohort by lead created",
    actSeries: "Demos", mixTitle: "My leads by source", mixAria: "My leads by source channel", mixCenter: "leads",
    stuck: "Stuck deals", stuckSub: "More than 10 days in the current stage", stuckNone: "No deal has sat in one stage for more than 10 days.",
    foot: "Working hours 10:00–19:00 IST, Monday to Saturday. Court hours (10:30–17:00) are the worst time to call partners.",
  },
  pl: {
    bands: [["lt1", "Under ₹1 L", 0, 1e5], ["1to3", "₹1 L – ₹3 L", 1e5, 3e5], ["gt3", "₹3 L and above", 3e5, Infinity]] as [string, string, number, number][],
    eyebrowRep: "Your deals", eyebrowAll: "All reps", eyebrowRO: (role: string, masked: boolean) => `Read-only for ${role}${masked ? ": firm names only" : ""}`, title: "Pipeline",
    sub: (open: string, value: string, wtd: string, won: string, n: number) => `${open} open deals worth ${value}, weighted ${wtd} by stage probability. Won this month: ${won} from ${n} deal${n === 1 ? "" : "s"}.`,
    district: "District", close: "Close month", hint: "Drag a card to another column, or use its move button (keyboard: Tab to the button, Enter, arrow keys). Cards turn amber after 10 days in a stage and red after 14.",
    seatsLine: (seats: number, plan: string) => `${seats} seats · ${plan}`, shareAria: "Share of deals that reached the next stage", firmCol: "Firm", seatsCol: "Seats", tableAria: "Deals",
    emptyTitle: "No deals yet.", emptyHint: "Convert a qualified lead from Leads to start the pipeline.", drop: "Drop a deal here", noDeals: "No deals", noIn: (stage: string) => `No deals in ${stage}. Swipe to the next stage.`, deals: (n: number) => `${n} deals`,
    wonTitle: (f: string) => `Mark ${f} as Won`, wonDesc: "Nothing is Won without plan, seats and value, so the forecast stays honest.", plan: "Plan", seats: "Seats", value: "Annual value (₹)", start: "Start date", wonNote: (name: string) => `Plan names are placeholders until ${name} shares its price list.`,
    wonErr: "Fill plan, seats, annual value and start date.", wonBtn: "Mark Won", plans: ["Practice", "Chambers", "Enterprise"], lostTitle: (f: string) => `Mark ${f} as Lost`, lostDesc: "Pick the main reason. It feeds the win/loss review on the Command Center.", compPh: "e.g. a Delhi-based case management vendor",
    a: { wonNeedsPlan: "Won needs a plan.", seatsMax: "Won needs seats (1 to 500).", needValue: "Won needs an annual value in rupees.", wonMsg: (name: string, val: string, seats: number, plan: string) => `${name} marked Won: ${val}, ${seats} seats, ${plan}`, notFound: "Deal not found in this workspace.", ownOnly: "You can move only your own deals.", roleCant: (role: string) => `Your role (${role}) cannot move deals.` },
  },
  // @@LEGAL
};
export type Vocab = typeof LEGAL;

const HOSPITALITY: Vocab = {
  id: "hospitality",
  n: {
    lead: { one: "enquiry", many: "enquiries" },
    deal: { one: "booking", many: "bookings" },
    demo: { one: "site visit", many: "site visits" },
    firm: { one: "guest", many: "guests" },
    // @@HOSP-N
  },
  nav: { leads: "Enquiries", accounts: "Guests & partners", sell: "Bookings" },
  leadStage: { new: "New enquiry", contacted: "Replied", qualified: "Dates confirmed", demo_booked: "Quote sent", demo_done: "Rooms on hold", proposal: "Advance pending", won: "Booked", lost: "Lost" },
  dealStage: { discovery: "Dates confirmed", demo_scheduled: "Quote sent", demo_done: "Rooms on hold", proposal: "Advance pending", negotiation: "Final confirmation", won: "Booked", lost: "Lost" },
  partySize: { Solo: "1–2 guests", "2–5": "3–5 guests", "6–20": "6–10 guests", "21–50": "11–25 guests", "50+": "25+ guests" },
  channelFamily: { "Paid social": "Instagram & Meta", Search: "Google & search", WhatsApp: "WhatsApp", Email: "Email", "Referrals & events": "Referrals & OTA" },
  funnel: { visit: "Website visitors (consented)", cta: "Enquire click", form: "Form start", lead: "Enquiry", qualified: "Dates confirmed", demo: "Quote sent", demo_done: "Rooms on hold", won: "Booked" },
  search: "Search enquiries, guests, towns",
  cc: {
    sub: (districts: number, region: string) => `Enquiries, bookings and the campaigns feeding them. Guests write in from ${districts} home towns; the property sits on the ${region.replace(" circuit", "")} circuit.`,
    unanswered: (n: number) => `${n} ${n === 1 ? "enquiry" : "enquiries"} past the 2-hour first-reply target without an answer`,
    unansweredOk: "Every new enquiry got a first reply within 2 hours",
    quiet: (n: number, city: string) => `${n} ${city} ${n === 1 ? "guest or partner has" : "guests and partners have"} not been contacted in 5+ days`,
    quietOk: "Every prospect guest and partner was contacted in the last 5 days",
    stale: (n: number) => `${n} ${n === 1 ? "quote" : "quotes"} waiting on a reply or advance for 7+ days`,
    headline: "Open enquiry value", headlineFoot: (count: number, weighted: string, win: string) => `${count} bookings in progress · weighted ${weighted} · win rate ${win}`,
    stageAria: "Open enquiry value by stage", closing: "Arriving next", wonIn: (month: string, n: number) => `Booked for ${month} · ${n} bookings`,
    kWon: "Bookings this month", kWonFoot: (avg: string) => `Avg booking value ${avg} · room revenue before taxes`, kWonNone: "No bookings confirmed yet in this workspace",
    kNew: "New enquiries (30 days)", kConv: "Enquiry → booking", kConvFoot: (a: number, b: number) => `${a} bookings from ${b} enquiries`,
    kCost: "Cost per booking", kCostFoot: (booked: number, spend: string, sla: string, med: string, prev: string) => `${booked} paid bookings · spend ${spend} · first reply within 2h ${sla} (median ${med}, prev. ${prev})`,
    perDay: "Enquiries per day", perDaySub: "All channels, created date (IST). Line = 7-day average.", perDayAria: "Enquiries per day, last 90 days, with 7-day average", perDayBar: "Enquiries that day",
    mix: "Where enquiries come from", mixSub: "Enquiries by first-touch channel, top 4 + other", mixAria: "Share of enquiries by channel", mixCenter: "enquiries",
    funnel: "Funnel: visit to booked", cpd: "Cost per booking by campaign", cpdAria: "Cost per booking by campaign in rupees", cpdNote: (n: number, spend: string) => `${n} bookings from ${spend} spend`, cpdValue: "Cost per booking",
    firms: "Top guests and partners in pipeline", firmsSub: "Open booking value, best enquiry score for the guest", firmsLink: "Guests & partners", firmsCaption: "Top guests and partners by open booking value", firmCol: "Guest / partner",
    firmMeta: (locality: string, city: string, guests: number) => `${locality}, ${city}${guests ? ` · usually ${guests} guests` : ""}`,
    team: (month: string) => `Front desk in ${month}`, teamSub: "Booked value vs monthly target · quotes sent this month · first-reply rate on enquiries from the last 30 days",
    rep: (i: number) => `Host ${i}`, teamLine: (booked: number, done: number, target: number, sla: string, open: string) => `${booked} quotes sent · ${done}/${target} rooms held · first reply ${sla} · open ${open}`,
    territories: "Coverage", allTerritory: "all channels", prevMonthLabel: (m: string) => `vs ${m}`,
  },
  rooms: 14,
  mk: {
    sub: "Which campaigns turn rupees into bookings. Spend and reach come from platform exports; enquiries and bookings are counted in the CRM, so the Gap column shows where they disagree.",
    kLeads: "Enquiries · 30 days", kCpl: "Cost per enquiry · 30 days", kDemos: "Bookings · 30 days", kDemosFoot: "vs prior 30d · by confirmation date", kCpd: "Cost per booking · 30 days", kCpdUnit: "booking",
    cheapest: "Which campaigns bring enquiries cheapest?", cheapestSub: "Cost per CRM enquiry over 90 days, lowest first. * Mailchimp counts tool cost only, no media spend.", cplAria: "Cost per enquiry by campaign", cplValue: "Cost per enquiry",
    cplNote: (n: number, ch: string, tool: boolean) => `${n} enquiries · ${ch}${tool ? " · tool cost only" : ""}`,
    best: (cost: string) => ` brings in bookings at ${cost} each, the lowest of any paid-media campaign with 3 or more bookings.`,
    email: (name: string, cost: string) => ` Email re-engagement (${name}) costs ${cost} per booking, but only reaches people already on the list.`,
    donutLeads: (n: number) => `${n} enquiries`, perUnit: (cost: string) => `${cost}/booking`, noUnit: "no bookings",
    th: { leads: "Enquiries", demos: "Bookings", conv: "Enquiry → booking" }, mobileFact: (l: number, d: number) => `${l} enquiries · ${d} bookings`,
    tableCaption: "All campaigns with spend, reach, CTR, cost per enquiry, enquiries, bookings and conversion",
    foot: "Synthetic data shaped like Instagram and Meta, Google Ads, WhatsApp, Booking.com and Mailchimp exports",
    radarCpl: "per enquiry", leadRate: "Enquiry rate",
  },
  cd: {
    funnelDemo: "Quotes sent", funnelWon: "Booked", funnelLead: "Enquiries (CRM)",
    kLeads: "Enquiries in CRM", kDemos: "Bookings", kDemosFoot: (cost: string | null, pctLeads: string) => `${cost ? `${cost} per booking` : "no paid spend"} · ${pctLeads} of enquiries`,
    kWonFoot: (n: number, roas: string | null) => `${n} ${n === 1 ? "booking" : "bookings"} · ${roas ? `${roas}× return on spend` : "no spend to compare"}`,
    cplFoot: (cpl: string, platform: number) => `Cost per enquiry ${cpl} · platform says ${platform}`,
    spendTitle: "Is spend turning into enquiries day by day?", spendSub: "Daily spend from the platform export beside CRM enquiries by created date (IST)",
    attribTitle: "Who gets the credit?", attribSub: "First touch: this campaign sourced the enquiry. Last touch: the guest's final touch was still this campaign's channel.",
    moved: (a: number, b: number, list: string) => `${a} of ${b} enquiries had a later touch elsewhere: ${list}. Multi-touch credit is out of scope at this volume.`,
    who: "Who responded?", whoSub: (n: number) => `${n} CRM enquiries by trip type, home town and party size`, role: "Trip type", district: "Home town", size: "Party size",
    utmLeads: "Enquiries", utmDemos: "Quotes", leadsTitle: "Enquiries from this campaign", leadsSub: (n: number, masked: boolean) => `${n} enquiries, first touch. ${masked ? "Names masked for your role." : "Newest first."}`,
    leadsCaption: (name: string) => `Enquiries attributed to ${name}`, leadsEmpty: "No CRM enquiries from this campaign yet.", leadsHint: "Enquiries appear once a form submit or WhatsApp click carries",
    colLead: "Enquiry", colFirm: "Guest", colDistrict: "Home town",
    notePh: "Swapped the second Reel to the valley-view room footage on 9 Oct; saves and replies have picked up since.",
    foot: (stage: string) => `Stage labels: ${stage} and later count as quotes. A booking is a confirmed stay with advance paid.`,
    attr: { leads: "Enquiries", demos: "Quotes", won: "Booked", revenue: "Revenue" }, utmSub: "How linked enquiries were tagged when they arrived",
    dlgNamePh: "Pongal long weekend — Coimbatore families", dlgThemePh: "pongal", dlgDistrict: "Home town", dlgStatewide: "All markets",
    platforms: [
      { key: "meta", label: "Meta Ads Manager", cols: "Campaign name, Day, Reach, Impressions, Link clicks, Amount spent (INR), Leads" },
      { key: "google_ads", label: "Google Ads", cols: "Campaign, Day, Impr., Clicks, Cost, Conversions" },
      { key: "whatsapp", label: "WhatsApp (BSP export)", cols: "Template, Date, Sent, Delivered, Read, Replied, Cost" },
      { key: "referral", label: "Booking.com / MakeMyTrip extranet", cols: "Campaign, Date, Impressions, Clicks, Commission and boost cost, Bookings" },
      { key: "email", label: "Mailchimp", cols: "Campaign, Send date, Emails sent, Unique opens, Unique clicks, Unsubscribes" },
    ],
    channelOptions: [["meta", "Instagram / Meta"], ["whatsapp", "WhatsApp"], ["google_ads", "Google Ads"], ["referral", "Partner / OTA"], ["email", "Mailchimp"]],
    defaultChannel: "meta", leadsWord: "enquiries", exportMsg: (n: number) => `CSV of ${n} enquiries would download`, exportDetail: (n: number) => `${n} without marketing consent excluded from platform uploads.`,
    segMsg: (seg: string, size: number, camp: string) => `Segment "${seg}" (${size} guests) would be attached to "${camp}"`,
    radarFoot: "Cost efficiency ranks cost per enquiry, lowest first; email with no media spend ranks best.",
  },
  an: {
    sub: (name: string) => `How people move through the ${name} website before they enquire, and which channel gets credit once they do.`,
    note: (name: string) => `GA4 is not connected. Every number here is a sample series shaped like a GA4 property for the ${name} website.`,
    stack: { won: "Booked", open: "Quote out, open", booked: "Quote sent, recent", lost: "Lost" },
    weeklyTitle: "How many quotes go out each week, and where are they now?", weeklySub: (n: number) => `${n} quotes sent in 12 weeks, stacked by today's outcome`,
    weeklyAria: "Quotes sent per week stacked by outcome.", weeklyNote: "Recent weeks are mostly open: guests usually decide within 1–2 weeks of the quote.",
    pagesSub: "Last 90 days. Key event = enquiry form submit or WhatsApp click.", ctaPath: "/enquire",
    credit: (pct: string) => `Enquiries from the last 90 days. ${pct} arrived without a utm_campaign (M19).`,
    formsKpi: "GA4 vs CRM enquiry forms", crmSubmits: "CRM enquiries",
    att: { leads: "Enquiries", demos: "Quotes", won: "Booked", bars: "Enquiries by channel", note: (d: number, w: number) => `${d} quotes · ${w} booked`, first: "Credit to the channel that brought the enquiry in", last: "Credit to the guest's most recent touch",
      cap: "Enquiries, quotes and bookings by channel under" },
  },
  au: {
    eyebrow: "Marketing · all live enquiries", sub: "Who is writing in, by home town, party size, trip type and how they found us, and which slices turn into bookings. Build a segment, then attach it to a campaign.",
    icpTitle: "Repeat and referral guests", icpFoot: (a: number, b: number) => `${a} of ${b} enquiries come from repeat guests or referrals`,
    icpLines: [["Origin:", "repeat guests, referrals from past guests and travel agents"], ["Party:", "any size, 1 to 25+ guests"], ["Contact:", "WhatsApp number on file"]],
    icpConv: "Repeat and referral → booking", others: "New guests", convWord: "enquiry → booking", demosWord: "bookings",
    distTitle: "Which home towns send guests?", distSub: (l: string, n: number, t: number) => `${l} sends ${n} of ${t} enquiries. Hover a bar for bookings and conversion.`, distSubNone: "Enquiries by home town", distAria: "Enquiries by home town.",
    sizeTitle: "How big are the parties?", sizeSub: "Enquiries by party size, smallest first", sizeAria: "Enquiries by party size.",
    pracTitle: "What kind of trip?", pracSub: "Trip type on the enquiry", pracAria: "Enquiries by trip type.", pracOther: (n: number) => `Other (${n} trip types)`, pracCenter: "enquiries",
    roleTitle: "Who is writing in?", roleSub: "Enquiries by guest origin; repeat and referral highlighted", roleAria: "Enquiries by guest origin.", roleHi: (t: string) => t !== "New guest",
    segSub: "Enquiry → booking and win rate per segment; win rate counts closed enquiries only", colLeads: "Enquiries", colLeads30: "Enquiries 30 d", colConv: "Enquiry → booking", mobileConv: " to booking", mobileLeads: " enquiries",
    segments: [
      { id: "chn-wk", name: "Chennai weekenders", rule: "Home town = Chennai AND trip type in Couples, Friends group" },
      { id: "blr-fam", name: "Bengaluru and Coimbatore families", rule: "Home town in Bengaluru, Coimbatore AND trip type = Family" },
      { id: "repeat", name: "Repeat guests", rule: "Origin = Repeat guest" },
      { id: "big", name: "Large parties", rule: "Party size 6 or more" },
      { id: "work", name: "Workation midweek", rule: "Trip type in Workation, Corporate retreat" },
    ],
    fields: { district: "Home town", size: "Party size", title: "Guest origin", practice: "Trip type", court: "Room interest", channel: "Source channel" },
    courtOpts: [], matching: "Matching enquiries", convRow: "Enquiry → booking",
    initName: "Weekend couples from Chennai", initRules: [{ field: "district", values: ["Chennai"] }, { field: "practice", values: ["Couples"] }],
    foot: "Synthetic guests and enquiries. Counts only: no names or contact details leave the server on this page.",
  },
  role: { owner: "Owner", sales_manager: "Manager", sales_rep: "Reservations", marketing: "Marketing", data: "Data", viewer: "Viewer" },
  wa: [
    { id: "enquiry_reply_ta", lang: "Tamil", body: "வணக்கம் {{1}}, ஷோலா மிஸ்ட்டுக்கு எழுதியதற்கு நன்றி. உங்கள் தேதிகளுக்கு அறைகள் உள்ளன. கட்டணம் மற்றும் முன்பணம் விவரங்களை அனுப்பலாமா? பதில் அனுப்பவும்." },
    { id: "enquiry_reply_en", lang: "English", body: "Hi {{1}}, thank you for writing to Shola Mist. We have rooms free for your dates. May I share the rates and the advance needed to hold them?" },
    { id: "quote_followup_en", lang: "English", body: "Hi {{1}}, sharing the quote for {{2}} again. The rooms stay on hold until tomorrow evening; happy to answer any questions." },
    { id: "advance_reminder_en", lang: "English", body: "Hi {{1}}, a reminder that the advance for {{2}} is still pending. The payment link is in our last message; reply 1 once paid." },
  ],
  waQuick: [],
  lost: [["price", "Price"], ["competitor", "Booked elsewhere"], ["no_decision", "No decision"], ["timing", "Dates not available"], ["not_a_fit", "Not a fit"], ["in_house_excel", "Trip cancelled"]],
  views: { mine: "My open enquiries", unassigned: "Unassigned", today: "New today", sla: "Reply overdue", hot: "Hot (70+)", all: "All" },
  ls: {
    title: "Enquiries", eyebrowRep: "Your enquiries and unassigned enquiries", eyebrowMasked: (role: string) => `Read-only for ${role}: names masked, no contact details`, eyebrowAll: (n: string) => `${n} enquiries in this workspace`,
    sub: (view: string, n: string, count: number, range: string) => `${view}: ${n} ${count === 1 ? "enquiry" : "enquiries"}${range}.`,
    emptyMine: "No open enquiries assigned to you.", emptyMineHint: (unassigned: number) => (unassigned ? `Claim from Unassigned (${unassigned} waiting).` : "The owner assigns enquiries from this page; new website and WhatsApp enquiries are routed to you automatically."),
    emptyUnassigned: "No unassigned enquiries.", emptyUnassignedHint: "Every new enquiry has a host. Check Reply overdue for enquiries still waiting on a first reply.",
    emptyToday: "No enquiries received today yet.", emptyTodayHint: "WhatsApp and Instagram enquiries usually arrive after 8 pm IST. Open All to work older enquiries.",
    emptySla: "No overdue first replies.", emptySlaHint: "Every enquiry in this view was answered within 2 hours.",
    emptyFilter: "No enquiries match these filters.", emptyFilterHint: "Clear a filter or search by phone number instead of name.",
    district: "Home town", searchMasked: "Search guest, town or trip type", search: "Search name, guest, phone or town",
    maskedNote: "Viewer access shows initials, guest, home town, stage and score only. Phone, email and message history stay hidden.", unknownFirm: "Unknown guest",
    colLead: "Enquiry", colFirm: "Guest · home town", tableAria: "Enquiries", selectAll: "Select all enquiries on this page",
    importBtn: "Import CSV", importTitle: "Import enquiries from CSV", importDesc: "Columns we read: name, phone, email, guest or company, town, trip type, source. Duplicates match on phone or email.", importMerge: "Merge into existing enquiry", importConfirm: "enquiries",
    importTooBig: "Files up to 2 MB. Split larger exports by month.",
    a: {
      notFound: "Enquiry not found in this workspace.", onlyOwn: "You can act only on enquiries assigned to you.", pickOwner: "Pick a host or manager in this workspace.", noneFound: "None of the selected enquiries are in this workspace.",
      assigned: (n: number, who: string) => `${n} ${n > 1 ? "enquiries" : "enquiry"} assigned to ${who}`, exported: (n: number, masked: boolean) => `Exported ${n} enquiries${masked ? " (phone and email masked)" : ""}`,
      needRows: "The file needs a header row and at least one enquiry.", queued: (f: number, d: number, merged: boolean) => `Import queued: ${f} new enquiries, ${d} duplicates ${merged ? "merged" : "skipped"}`,
      demoPast: "The visit time is in the past.", demoSched: (date: string, time: string, min: number, mode: string) => `Site visit or call scheduled for ${date}, ${time} IST (${min} min, ${mode})`, demoSub: "Calendar entry and prep task created; booking moves to Quote sent.",
      callSub: "", dq: [["spam", "Spam"], ["travel_agent_cold", "Cold sales call"], ["outside_area", "Outside our season or area"], ["duplicate", "Duplicate"], ["budget", "Budget too low"], ["competitor", "Competitor research"]],
    },
  },
  qa: {
    callDefault: "Spoke to the guest; confirmed dates and sent the rate card on WhatsApp.", waName: "Ramya", waSlot: "Sat 17 Oct",
    demoBtn: "Schedule visit or call", demoTitle: "Schedule a site visit or call", demoModes: ["Phone call", "Video call", "Visit at the property"], demoNote: "Most guests prefer a call after 6 pm on weekdays or a weekend morning.",
    demoToast: (firm: string) => `Visit or call scheduled${firm ? ` with ${firm}` : ""}`, demoToastSub: "Demo: task created and enquiry moved to Quote sent for this session only.", consentMsg: "This guest has not opted in to WhatsApp. Templates are blocked until consent is recorded.",
  },
  ld: {
    metaTitle: (id: string) => `Enquiry ${id}`, otherRepTitle: "This enquiry is assigned to another host.", otherRepBody: "Reservations staff open only their own enquiries. Ask the owner or manager to reassign it if you should handle this guest.", backToMine: "Back to my enquiries",
    unknownFirm: "Unknown guest", crumb: (id: string) => `Enquiries · ${id}`, district: (d: string) => `from ${d}`, subAt: "·",
    followUp: "Stay follow-up", maskedCard: "Guest", maskedRows: (firm: string, district: string, size: string, courts: string, source: string, lawyers: number | null) => [["Guest", firm], ["Home town", district], ["Party", lawyers === null ? "Unknown" : lawyers ? `${size} (usually ${lawyers} guests)` : size], ["Interested in", courts], ["Source", source]],
    maskedNote: (role: string) => `Your role (${role}) reads masked records: initials, home town, stage and score. Phone, email, messages and activity stay with the reservations team. Ask the owner if you need full access.`,
    readOnly: (role: string) => `Read-only for ${role}: calls, messages and stage changes are made by the reservations team.`,
    sentOn: (ch: string) => ch, firstTouchWarn: (rel: string) => `Log the first reply to start the response clock. The enquiry arrived ${rel}.`,
    summaryA: (title: string, size: string, lawyers: number | string, district: string, stage: string, ch: string, rel: string) => `${title}, ${size}, from ${district}; ${stage.toLowerCase()}, came in via ${ch} ${rel}.`,
    snapshot: "Guest snapshot", openAccount: "Open guest",
    snapRows: (a: { name: string; where: string; lawyers: number; size: string; courts: string; practice: string; tier: string }) => [["Guest", a.name], ["Location", a.where], ["Usual party", a.lawyers ? `${a.lawyers} guests (${a.size})` : a.size], ["Rooms of interest", a.courts || "Any"], ["Interests", a.practice || "Not recorded"]],
    dealCard: "Booking", seatsRow: "Nights · rooms", seatsVal: (seats: number, plan: string, nights: number | null) => `${seats} ${seats === 1 ? "night" : "nights"}`, inStage: "In stage", expectedClose: "Decision expected", wonOn: "Booked on",
    tasksFor: "Tasks for this enquiry", nextBest: {
      newCall: "Reply on WhatsApp with availability and rates", newNoTouch: (rel: string, passed: boolean) => `No reply sent yet; the enquiry came in ${rel} and the 2-hour reply target ${passed ? "has already passed" : "is still running"}.`, newTouched: "First reply sent; confirm dates and party size.",
      contactedWa: "Send WhatsApp template enquiry_reply_en", contactedCall: "Call to confirm dates and rooms", noWa: "No WhatsApp consent, so a call is the fastest route.",
      qualifiedAct: "Send the quote", qualifiedWhy: "Dates are confirmed but no quote has gone out. Include room rates, taxes and the advance needed to hold the rooms.",
      bookedWa: "Send WhatsApp template quote_followup_en", bookedMail: "Email the quote again with the cancellation terms", bookedWhy: "Quote is out; a nudge the next evening usually gets an answer.",
      doneAct: "Send the advance payment link", doneWhy: (since: string, intent: boolean) => `Rooms are on hold${since}${intent ? "; rate page viewed since" : ""}.`,
      propAct: "Call the guest to confirm the advance", propWhy: (quiet: number) => `Advance is pending; last two-way contact ${quiet} day${quiet === 1 ? "" : "s"} ago.`, defAct: "Keep in the follow-up list", defWhy: "No clear booking signal yet.",
    },
    dismissReasons: ["Already done", "Wrong timing", "Guest unavailable", "Not relevant"],
  },
  la: {
    callPh: "e.g. Guest is travelling until Friday; wants the valley-view room if it is free.", statusLabel: "Set enquiry status", converted: "Converted to booking",
    emailSubject: (name: string, firm: string) => `Your stay at ${name}: rooms, rates and next steps`,
    emailBody: (first: string, name: string) => `Dear ${first},\n\nThank you for your enquiry. As discussed, I am sharing the room options, rates and the advance needed to hold your dates at ${name}.\n\nRegards`,
    demoBtn: "Schedule visit or call", demoTitle: "Schedule a site visit or call", demoDesc: (firm: string) => `${firm} · times in IST`, modes: ["Phone call", "Video call", "Visit at the property"], demoNote: "Most guests are free for a call after 6 pm on weekdays or on weekend mornings.", demoFoot: "Schedule",
    noWa: (name: string) => `${name} has not opted in to WhatsApp. Record consent first; templates stay blocked until then.`, dqDesc: "The enquiry leaves open views and stops counting towards the reply target. You can reopen it later.",
  },
  ib: {
    sub: (n: number, unread: number) => `${n} conversations across WhatsApp, Instagram, phone and email, ${unread} unread. Showcase: no messages are sent. Data is sample.`,
    channels: ["whatsapp", "email"],
    emailTpl: [
      { id: "quote_recap_en", lang: "English", body: "Dear {{1}}, thank you for your enquiry. As promised, here is the quote for {{2}} with room rates, taxes and the advance needed to hold the rooms." },
      { id: "arrival_note_en", lang: "English", body: "Dear {{1}}, looking forward to hosting {{2}}. Check-in is from 1 pm; the road up from Coonoor town has a steep last stretch, so I have attached directions." },
      { id: "cancel_terms_en", lang: "English", body: "Dear {{1}}, attaching our cancellation terms for {{2}}: advance is adjustable against a new date within 90 days if you cancel 10 days before arrival." },
    ],
    suggestTpl: (stage: string) => (stage.startsWith("Quote") || stage.startsWith("Advance") || stage.startsWith("Rooms") ? "quote_followup_en" : "enquiry_reply_en"), yourFirm: "your group",
    ack: (ta: boolean) => `I have read this draft${ta ? ", checked the Tamil," : ""} and it makes no promise outside our rate card and booking terms.`,
    modelNote: "Sent to the model: first name, trip type, guest, home town and this thread with phone and email removed.",
    readOnly: "Marketing can read conversations to see campaign replies. Replies are sent by the reservations team.", leadEyebrow: "Enquiry", firmMeta: (district: string, lawyers: number) => ` · ${district}${lawyers ? ` · usually ${lawyers} guests` : ""}`,
    dealEyebrow: "Booking", dealLine: (plan: string, seats: number) => `${seats} ${seats === 1 ? "night" : "nights"}`, noDeal: "No open booking. Open one from the guest page once dates and rooms are agreed.", followUp: "Stay follow-up", linked: "Linked enquiry",
    needsReview: "It needs the owner's review before it goes out.", linkedMsg: "That enquiry is not in this workspace.",
  },
  login: {
    line: "Every enquiry, booking and returning guest in one place, from the first WhatsApp message to the morning of arrival.", facts: (leads: number, accounts: number, open: number, towns: string) => [["Enquiries (90 days)", String(leads)], ["Guests & partners", String(accounts)], ["Open bookings", String(open)], ["Home towns", towns]],
    foot: "Sample property. Guests and people are fictional; nothing is sent to WhatsApp, email or ad platforms.", emailPh: "you@sholamist.example", short: "Your sign-in for enquiries, bookings and campaigns.",
  },
  md: {
    sub: (touch: number, overdue: number, demos: number) => `${touch} touches due today, ${overdue} overdue, ${demos} arrivals left this week.`,
    nothing: "Nothing due today. Check hot enquiries on the right.", slaLabel: (h: number) => `First reply within ${h * 1} hours`,
    hot: "Hot enquiries", hotNone: "No enquiries above 70 yet. Scores rise with rate-page visits and WhatsApp replies.",
    wk: "Arrivals this week", wkSub: "Monday to Sunday, check-in dates of confirmed bookings", wkAria: "Arrivals per day this week", wkSeries: "Arrivals", days: 7,
    pipe: "My bookings by stage", pipeSub: (n: number, val: string) => `${n} open bookings · ${val}`, pipeNote: (n: number) => `${n} bookings`, pipeAria: "My open booking value by stage",
    target: "Target vs achieved", targetSub: (m: string) => `${m}, pace tick = share of month gone`, won: "Booked value", done: "Rooms held",
    conv: [["Enquiry", "new"], ["Replied", "contacted"], ["Quote sent", "demo_booked"], ["Advance pending", "proposal"], ["Booked", "won"]], convSub: "Last 90 days, cohort by enquiry received",
    actSeries: "Quotes", mixTitle: "My enquiries by source", mixAria: "My enquiries by source channel", mixCenter: "enquiries",
    stuck: "Stalled bookings", stuckSub: "More than 10 days in the current stage", stuckNone: "No booking has sat in one stage for more than 10 days.",
    foot: "Reply window 8:00–21:00 IST, every day. Guests tend to message in the evening, so check WhatsApp after 7 pm.",
  },
  pl: {
    bands: [["lt1", "Under ₹25K", 0, 25e3], ["1to3", "₹25K – ₹75K", 25e3, 75e3], ["gt3", "₹75K and above", 75e3, Infinity]],
    eyebrowRep: "Your bookings", eyebrowAll: "All hosts", eyebrowRO: (role: string, masked: boolean) => `Read-only for ${role}${masked ? ": guest names only" : ""}`, title: "Pipeline",
    sub: (open: string, value: string, wtd: string, won: string, n: number) => `${open} bookings in progress worth ${value}, weighted ${wtd} by stage probability. Booked this month: ${won} from ${n} ${n === 1 ? "booking" : "bookings"}.`,
    district: "Home town", close: "Decision month", hint: "Drag a card to another column, or use its move button (keyboard: Tab to the button, Enter, arrow keys). Cards turn amber after 10 days in a stage and red after 14.",
    seatsLine: (seats: number, plan: string) => `${seats} ${seats === 1 ? "night" : "nights"}`, shareAria: "Share of bookings that reached the next stage", firmCol: "Guest", seatsCol: "Nights", tableAria: "Bookings",
    emptyTitle: "No bookings yet.", emptyHint: "Convert an enquiry from Enquiries once dates are confirmed to start the pipeline.", drop: "Drop a booking here", noDeals: "No bookings", noIn: (stage: string) => `No bookings in ${stage}. Swipe to the next stage.`, deals: (n: number) => `${n} bookings`,
    wonTitle: (f: string) => `Confirm booking for ${f}`, wonDesc: "A booking is confirmed only with room type, nights, value and check-in date, so occupancy stays honest.", plan: "Room type", seats: "Nights", value: "Total booking value (₹)", start: "Check-in date", wonNote: (name: string) => `Room types and rates follow the ${name} rate card.`,
    wonErr: "Fill room type, nights, booking value and check-in date.", wonBtn: "Confirm booking", plans: ["Valley-view Room", "Garden Cottage", "Family Suite", "Heritage Room", "Dorm loft"], lostTitle: (f: string) => `Mark ${f} as Lost`, lostDesc: "Pick the main reason. It feeds the lost-enquiry review on the Command Center.", compPh: "e.g. a homestay in Ooty, or an OTA listing",
    a: { wonNeedsPlan: "Booking needs a room type.", seatsMax: "Booking needs nights (1 to 500).", needValue: "Booking needs a value in rupees.", wonMsg: (name: string, val: string, seats: number, plan: string) => `${name} confirmed: ${val}, ${seats} ${seats === 1 ? "night" : "nights"}, ${plan}`, notFound: "Booking not found in this workspace.", ownOnly: "You can move only your own bookings.", roleCant: (role: string) => `Your role (${role}) cannot move bookings.` },
  },
  // @@HOSP
};

/** Template layer (functions + page copy). INTERNAL: pages must go through vocabFor()/useVocab(), never import this. */
const TEMPLATES: Record<Vertical, Vocab> = { legal: LEGAL, hospitality: HOSPITALITY };

// ---------------------------------------------------------------- preset data (JSON-mergeable, no functions/JSX)
export type ModuleKey = "inbox" | "ai" | "integrations" | "audience" | "analytics" | "tasks" | "accounts" | "campaigns" | "data-health";
export const MODULE_KEYS: ModuleKey[] = ["inbox", "ai", "integrations", "audience", "analytics", "tasks", "accounts", "campaigns", "data-health"];
/** Route prefix -> module. A disabled module hides its nav entry and 403s its route (middleware). */
export const MODULE_ROUTE: Record<string, ModuleKey> = { "/inbox": "inbox", "/ai": "ai", "/integrations": "integrations", "/audience": "audience", "/analytics": "analytics", "/tasks": "tasks", "/accounts": "accounts", "/campaigns": "campaigns", "/data-health": "data-health" };
export const FONT_STACKS: Record<string, string> = {
  default: "", geist: "var(--font-geist-sans), system-ui, sans-serif", system: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif", serif: "ui-serif, Georgia, 'Times New Roman', serif",
};
export interface TenantConfigPreset {
  id: "legal" | "hospitality" | "blank";
  /** Which template set supplies page copy that is not (yet) a data field. */
  base: Vertical;
  search: string; rooms: number;
  n: Vocab["n"]; nav: Vocab["nav"]; leadStage: Vocab["leadStage"]; dealStage: Vocab["dealStage"]; partySize: Vocab["partySize"];
  channelFamily: Record<string, string>; funnel: Record<string, string>; role: Record<string, string>;
  lost: [string, string][]; views: Record<string, string>; plans: string[];
  modules: Record<ModuleKey, boolean>; features: { ecourts: boolean; hearings: boolean };
  fonts: { heading: string; body: string };
  /** Headline tiles on the Command Center, by metric id (see kpiTiles()). */
  kpiTiles: string[];
}
const ALL_ON = Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as Record<ModuleKey, boolean>;
const fromTemplate = (id: TenantConfigPreset["id"], base: Vertical, features: TenantConfigPreset["features"], kpiTiles: string[]): TenantConfigPreset => {
  const t = TEMPLATES[base];
  return JSON.parse(JSON.stringify({ id, base, search: t.search, rooms: t.rooms, n: t.n, nav: t.nav, leadStage: t.leadStage, dealStage: t.dealStage, partySize: t.partySize, channelFamily: t.channelFamily, funnel: t.funnel, role: t.role, lost: t.lost, views: t.views, plans: t.pl.plans, modules: ALL_ON, features, fonts: { heading: "default", body: "default" }, kpiTiles }));
};
export const PRESETS: Record<TenantConfigPreset["id"], TenantConfigPreset> = {
  legal: fromTemplate("legal", "legal", { ecourts: true, hearings: true }, ["won", "new", "conv", "cost"]),
  hospitality: fromTemplate("hospitality", "hospitality", { ecourts: false, hearings: false }, ["won", "new", "conv", "cost"]),
  // Blank: neutral nouns; page copy still comes from the legal template until a tenant overrides it (CONFIG agent editors).
  blank: { ...fromTemplate("blank", "legal", { ecourts: false, hearings: false }, ["won", "new", "conv", "cost"]), n: { lead: { one: "lead", many: "leads" }, deal: { one: "deal", many: "deals" }, demo: { one: "meeting", many: "meetings" }, firm: { one: "account", many: "accounts" } }, nav: { leads: "Leads", accounts: "Accounts", sell: "Sell" } },
};
type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
/** Per-tenant overrides, merged over a preset. Data only. */
export type TenantConfigOverrides = DeepPartial<Omit<TenantConfigPreset, "id" | "base">> & { preset?: TenantConfigPreset["id"] };
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
export function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(over)) out[k] = deepMerge((base as Record<string, unknown>)[k], over[k]);
  return out as T;
}
/** Config source hook: code today (presets only); the CONFIG agent swaps in tenant_config / cookie overrides here. */
let overridesFor: (tenantId: string) => TenantConfigOverrides | undefined = () => undefined;
export const setConfigResolver = (fn: typeof overridesFor) => { overridesFor = fn; };

export function effectiveConfig(t: TenantLike): TenantConfigPreset {
  const id = typeof t === "string" ? t : t?.id ?? "";
  const ov = overridesFor(id);
  const preset = PRESETS[ov?.preset ?? verticalOf(t)];
  return deepMerge(preset, ov);
}
/** Pure: preset/effective config -> the Vocab pages consume (data fields from config, copy from the base template). */
export function resolveVocab(cfg: TenantConfigPreset): Vocab {
  const t = TEMPLATES[cfg.base];
  return { ...t, id: cfg.base, search: cfg.search, rooms: cfg.rooms, n: cfg.n, nav: cfg.nav, leadStage: cfg.leadStage, dealStage: cfg.dealStage, partySize: cfg.partySize, channelFamily: cfg.channelFamily, funnel: cfg.funnel, role: cfg.role, lost: cfg.lost, views: cfg.views, pl: { ...t.pl, plans: cfg.plans } };
}

type TenantLike = { vertical?: Vertical; id?: string } | string | null | undefined;
export function verticalOf(t: TenantLike): Vertical {
  if (!t) return "legal";
  if (typeof t === "string") return TENANTS.find((x) => x.id === t)?.vertical ?? "legal";
  return t.vertical ?? (t.id ? TENANTS.find((x) => x.id === t.id)?.vertical : undefined) ?? "legal";
}
/** Server side: `vocabFor(active.tenant)`. Client side: `useVocab()` from components/shell/providers. */
export const vocabFor = (t: TenantLike): Vocab => resolveVocab(effectiveConfig(t));

// ---------------------------------------------------------------- accessors (pages use these, not the tables)
export const stageLabel = (t: TenantLike, kind: "lead" | "deal", key: string) => (kind === "lead" ? vocabFor(t).leadStage : vocabFor(t).dealStage)[key as never] as string;
export const taxonomy = (t: TenantLike) => { const c = effectiveConfig(t); return { partySize: c.partySize, lostReasons: c.lost, plans: c.plans, channelFamily: c.channelFamily }; };
export const isModuleEnabled = (t: TenantLike, module: ModuleKey) => effectiveConfig(t).modules[module] !== false;
/** Module a pathname belongs to (undefined = not gated). */
export const moduleForPath = (pathname: string): ModuleKey | undefined => { const k = Object.keys(MODULE_ROUTE).find((r) => pathname === r || pathname.startsWith(r + "/")); return k ? MODULE_ROUTE[k] : undefined; };
export const isFeatureEnabled = (t: TenantLike, f: keyof TenantConfigPreset["features"]) => effectiveConfig(t).features[f] === true;
export const kpiTiles = (t: TenantLike) => effectiveConfig(t).kpiTiles;
export const fontsFor = (t: TenantLike) => effectiveConfig(t).fonts;

/** Public client sign-in links: /g/<slug>. Slug equals the tenant id. */
export const SIGNIN_SLUGS = ["shola-mist", "lawsome"] as const;
