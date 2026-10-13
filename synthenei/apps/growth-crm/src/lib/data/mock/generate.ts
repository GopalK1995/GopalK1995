// Deterministic synthetic dataset for LAWSOME's growth CRM (Tamil Nadu law firms).
// ALL DATA IS FICTIONAL. Seed is fixed so every render produces the same numbers.
import type {
  Account, Activity, ActivityKind, AuditEntry, Campaign, CampaignDay, Channel, ConsentEntry, Dataset, Deal, DealStage,
  FirmSize, Ga4Channel, Ga4Day, Ga4Page, Lead, LeadStage, PrivacyRequest, ScoreFactor, SyncRun, Task,
} from "../types";
import { FIRST_NAMES, PRICE_PER_SEAT, SURNAMES, TITLES } from "./catalog";
import type { DatasetConfig } from "./configs";
import { DAY, HOUR, MIN, NOW_ISO, NOW_MS, istAt, istDate, iso, makeRng } from "./seed";
import { buildConversations } from "./conversations";
import { buildIntegrations } from "./integrations";

const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// ---------------------------------------------------------------- accounts
export function buildDataset(cfg: DatasetConfig): Dataset {
const { firms: FIRMS, team: TEAM, campaigns: CAMPAIGNS, cityMeta: CITY_META, repForCity } = cfg;
const rng = makeRng(cfg.seed);
const SIZE_FOR = (lawyers: number): FirmSize => (lawyers <= 1 ? "Solo" : lawyers <= 5 ? "2–5" : lawyers <= 20 ? "6–20" : lawyers <= 50 ? "21–50" : "50+");
const accounts: Account[] = FIRMS.map(([name, city, locality, areas], i) => {
  const lawyers = rng.weighted([[1, 2], [rng.int(2, 5), 9], [rng.int(6, 15), 14], [rng.int(16, 38), 9], [rng.int(42, 71), 2]] as const);
  const meta = CITY_META[city];
  const courts = rng.sample(meta.courts, Math.min(meta.courts.length, rng.int(2, 3)));
  if (!courts.some((c) => c.includes("High Court")) && rng.chance(0.6)) courts.unshift(meta.courts.find((c) => c.includes("High Court"))!);
  const size = SIZE_FOR(lawyers);
  const tier = size === "6–20" || size === "21–50" ? "A" : size === "2–5" || size === "50+" ? "B" : "C";
  return {
    id: `acc-${slug(name)}`, name, city, locality, district: meta.district, courts, practiceAreas: areas, size, lawyers,
    founded: rng.int(1978, 2021), website: `${slug(name).replace(/-/g, "")}.example`, ownerId: repForCity(city),
    status: "prospect", icpTier: tier, arr: 0, lastActivityAt: NOW_ISO,
  } satisfies Account;
});
// A few accounts were customers before this 90-day window (renewal base).
for (const [idx, seats, plan] of cfg.preCustomers) {
  if (!accounts[idx]) continue;
  accounts[idx].status = "customer"; accounts[idx].arr = seats * PRICE_PER_SEAT[plan];
}
if (cfg.churnedIdx !== null && accounts[cfg.churnedIdx]) accounts[cfg.churnedIdx].status = "churned";

// ---------------------------------------------------------------- leads
const CHANNEL_WEIGHTS: [string, number][] = cfg.channelWeights;
const campaignById = new Map(CAMPAIGNS.map((c) => [c.id, c]));
const CITY_BIAS: Record<string, string[] | null> = cfg.cityBias;
const UTM: Record<Channel, [string, string]> = {
  linkedin: ["linkedin", "paid_social"], whatsapp: ["whatsapp", "messaging"], email: ["mailchimp", "email"], meta: ["facebook", "paid_social"],
  google_ads: ["google", "cpc"], organic: ["google", "organic"], referral: ["referral", "referral"], event: ["event", "offline"],
};
const STAGE_ORDER: LeadStage[] = ["new", "contacted", "qualified", "demo_booked", "demo_done", "proposal", "won"];

function pickStage(ageDays: number): LeadStage {
  const r = rng.next() * 0.72 + Math.min(ageDays, 60) / 60 * 0.38;
  if (ageDays < 2) return r < 0.6 ? "new" : "contacted";
  if (r < 0.14) return "new";
  if (r < 0.34) return "contacted";
  if (r < 0.5) return "qualified";
  if (r < 0.62) return "demo_booked";
  if (r < 0.73) return "demo_done";
  if (r < 0.81) return "proposal";
  if (r < 0.9) return "won";
  return "lost";
}

const TITLE_PTS: Record<string, number> = { "Managing Partner": 25, "Senior Advocate": 20, Partner: 18, "Founding Advocate": 15, "Practice Manager": 12, "Office Manager": 8, Associate: 6 };
const SIZE_PTS: Record<FirmSize, number> = { Solo: 4, "2–5": 12, "6–20": 20, "21–50": 18, "50+": 10 };

const leads: Lead[] = [];
const usedNames = new Set<string>();
for (let i = 0; i < cfg.leadCount; i++) {
  const src = rng.weighted(CHANNEL_WEIGHTS);
  const cmp = campaignById.get(src) ?? null;
  const channel: Channel = cmp ? cmp.channel : (src as Channel);
  const bias = CITY_BIAS[src];
  let pool = accounts.filter((a) => a.status !== "churned");
  if (bias && rng.chance(0.85)) pool = pool.filter((a) => bias.includes(a.city));
  const acc = rng.pick(pool);
  let name = "";
  do { name = `${rng.pick(cfg.firstNames ?? FIRST_NAMES)} ${rng.pick(cfg.surnames ?? SURNAMES)}`; } while (usedNames.has(name));
  usedNames.add(name);
  const title = rng.weighted(TITLES);
  // creation time: inside the campaign's live window when campaign-sourced
  const lo = cmp ? Math.max(cmp.startOffset, -89) : -89;
  const hi = cmp && cmp.endOffset !== null ? cmp.endOffset : 0;
  const dayOff = Math.round(lo + (hi - lo) * Math.pow(rng.next(), 0.9));
  const created = new Date(istAt(dayOff, rng.int(8, 20), rng.int(0, 59))).getTime();
  const createdAt = iso(Math.min(created, NOW_MS - 25 * MIN));
  const ageDays = (NOW_MS - new Date(createdAt).getTime()) / DAY;
  const stage = pickStage(ageDays);
  const personal = rng.chance(0.18);
  const [first, last] = name.split(" ");
  const email = personal ? `${first.toLowerCase()}.${last.toLowerCase().slice(0, 4)}${rng.int(11, 98)}@mail.example` : `${first.toLowerCase()}@${acc.website}`;
  const ownerId = acc.ownerId;
  const respMins = stage === "new" ? (rng.chance(0.5) ? null : rng.int(18, 200)) : Math.round(Math.exp(rng.float(2.6, 6.4)));
  const sinceTouch = stage === "won" || stage === "lost" ? rng.float(2, 20) : Math.min(ageDays, rng.float(0.1, stage === "new" ? 1.5 : 9));
  const lastTouchAt = iso(Math.max(new Date(createdAt).getTime(), NOW_MS - sinceTouch * DAY));
  const active = stage !== "won" && stage !== "lost";
  let nextActionAt: string | null = null, nextAction: string | null = null;
  if (active) {
    const bucket = rng.weighted([["overdue", 18], ["today", 32], ["soon", 50]] as const);
    nextActionAt = bucket === "overdue" ? istAt(-rng.int(1, 4), rng.int(10, 17), rng.pick([0, 30])) : bucket === "today" ? istAt(0, rng.int(9, 18), rng.pick([0, 15, 30, 45])) : istAt(rng.int(1, 6), rng.int(10, 17), rng.pick([0, 30]));
    nextAction = ({
      new: rng.pick(["First call — confirm demo slot", "Send WhatsApp intro (template: ecourts_intro_ta)", "First call within SLA"]),
      contacted: rng.pick(["Follow-up call: share Madras HC cause-list sample", "WhatsApp: send 2-min product tour", "Call back — asked for Tamil walkthrough"]),
      qualified: rng.pick(["Schedule demo with partners", "Confirm number of advocates and juniors", "Share pricing for 10+ seats"]),
      demo_booked: rng.pick(["Demo reminder on WhatsApp", "Prepare demo on their Madurai Bench cases", "Confirm demo attendees"]),
      demo_done: rng.pick(["Send recap + trial workspace", "Follow up on data migration question", "Call partner re: billing module"]),
      proposal: rng.pick(["Chase signed proposal", "Negotiate annual vs monthly", "Answer data-residency question from partner"]),
    } as Record<string, string>)[stage];
  }
  const high = acc.courts.some((c) => c.includes("High Court"));
  const recencyDays = (NOW_MS - new Date(lastTouchAt).getTime()) / DAY;
  const intent = stage !== "new" && rng.chance(0.55);
  const waReply = channel === "whatsapp" || rng.chance(0.3);
  const factors: ScoreFactor[] = [
    { label: "Seniority", points: TITLE_PTS[title], detail: `${title} — decision maker ${TITLE_PTS[title] >= 15 ? "or close to one" : "unlikely to sign alone"}` },
    { label: "Firm fit", points: SIZE_PTS[acc.size], detail: `${acc.lawyers} lawyer${acc.lawyers > 1 ? "s" : ""} (${acc.size}); ICP tier ${acc.icpTier}` },
    { label: "Recency", points: recencyDays < 2 ? 15 : recencyDays < 7 ? 8 : 0, detail: `Last touch ${recencyDays < 1 ? "today" : `${Math.round(recencyDays)} days ago`}` },
    { label: "Intent", points: intent ? 15 : 0, detail: intent ? "Viewed /pricing twice and the eCourts sync page" : "No pricing or demo page views yet" },
    { label: "Responsiveness", points: waReply ? 10 : 0, detail: waReply ? "Replied on WhatsApp within a day" : "No inbound replies yet" },
    { label: "Court focus", points: high ? 8 : 3, detail: high ? "Regular Madras High Court practice (our strongest module)" : "District court practice only" },
  ];
  if (personal) factors.push({ label: "Personal email", points: -5, detail: "Used a personal address on the form" });
  if (recencyDays > 14 && active) factors.push({ label: "Gone quiet", points: -10, detail: "No two-way contact for 14+ days" });
  const score = Math.max(4, Math.min(97, factors.reduce((a, f) => a + f.points, 0) + rng.int(-3, 3)));
  const [utmSource, utmMedium] = UTM[channel];
  const firstTouch = channel;
  const lastTouch: Channel = rng.chance(0.65) ? channel : rng.pick(["whatsapp", "email", "organic", "linkedin"] as Channel[]);
  const consentAt = createdAt;
  const seats = Math.max(1, Math.round(acc.lawyers * rng.float(0.6, 1)));
  leads.push({
    id: `${cfg.idPrefix}-${1001 + i}`, name, title, accountId: acc.id, email, phone: `+91 9${rng.int(1, 9)}xxx xx${rng.int(100, 999)}`, city: acc.city,
    stage, ownerId, channel, campaignId: cmp?.id ?? null,
    utm: { source: utmSource, medium: utmMedium, campaign: cmp ? cmp.utmCampaign : rng.chance(0.25) ? null : null },
    firstTouch, lastTouch, createdAt, lastTouchAt, firstResponseMins: respMins, nextActionAt, nextAction,
    score, scoreFactors: factors,
    consent: { followup: true, marketing: rng.chance(0.62), whatsapp: channel === "whatsapp" || rng.chance(0.55), at: consentAt, noticeVersion: ageDays > 40 ? "v1.2" : "v1.3" },
    potentialValue: seats * PRICE_PER_SEAT[seats >= 20 ? "Enterprise" : seats >= 8 ? "Chambers" : "Practice"],
    tags: [acc.icpTier === "A" ? "ICP A" : "", high ? "High Court" : "", personal ? "Personal email" : ""].filter(Boolean),
  });
}
leads.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

// ---------------------------------------------------------------- deals
const DEAL_FROM_LEAD: Partial<Record<LeadStage, DealStage[]>> = {
  qualified: ["discovery"], demo_booked: ["demo_scheduled"], demo_done: ["demo_done"], proposal: ["proposal", "negotiation"], won: ["won"], lost: ["lost"],
};
const PROB: Record<DealStage, number> = { discovery: 0.1, demo_scheduled: 0.25, demo_done: 0.4, proposal: 0.6, negotiation: 0.8, won: 1, lost: 0 };
const dealLeads: Lead[] = [];
const seenAcc = new Set<string>();
for (const st of ["won", "proposal", "demo_done", "demo_booked", "qualified", "lost"] as LeadStage[]) {
  const want = ({ won: 6, proposal: 5, demo_done: 4, demo_booked: 4, qualified: 3, lost: 3 } as Record<string, number>)[st];
  for (const l of leads.filter((x) => x.stage === st)) {
    if (dealLeads.filter((x) => x.stage === st).length >= want) break;
    if (seenAcc.has(l.accountId)) continue;
    seenAcc.add(l.accountId); dealLeads.push(l);
  }
}
const LOST_REASONS = ["Chose to stay on Excel + WhatsApp groups", "Price for juniors' seats", "Partner wants offline-first desktop app", "Went with a Delhi-based vendor"];
const deals: Deal[] = dealLeads.slice(0, cfg.maxDeals).map((l, i) => {
  const acc = accounts.find((a) => a.id === l.accountId)!;
  const opts = DEAL_FROM_LEAD[l.stage]!;
  const stage = opts[i % opts.length];
  const seats = Math.max(2, Math.round(acc.lawyers * rng.float(0.65, 1.05)));
  const plan = seats >= 20 ? "Enterprise" : seats >= 7 ? "Chambers" : "Practice";
  const value = seats * PRICE_PER_SEAT[plan];
  const created = new Date(l.createdAt).getTime() + rng.int(2, 9) * DAY;
  const createdAt = iso(Math.min(created, NOW_MS - 2 * DAY));
  const wonAt = stage === "won" ? istAt(i % 2 === 0 ? -rng.int(1, 11) : -rng.int(14, 80), rng.int(11, 18)) : undefined;
  const stageEnteredAt = wonAt ?? iso(NOW_MS - rng.int(1, 16) * DAY - rng.int(0, 8) * HOUR);
  return {
    id: `DL-${301 + i}`, name: `${acc.name} — ${plan} (${seats} seats)`, accountId: acc.id, leadId: l.id, ownerId: l.ownerId,
    stage, value, seats, plan, probability: PROB[stage], createdAt, stageEnteredAt,
    expectedClose: stage === "won" ? wonAt! : istAt(rng.int(3, 45), 17), wonAt, lostReason: stage === "lost" ? LOST_REASONS[i % LOST_REASONS.length] : undefined,
  } satisfies Deal;
});
for (const dl of deals) {
  const acc = accounts.find((a) => a.id === dl.accountId)!;
  if (dl.stage === "won") { acc.status = "customer"; acc.arr += dl.value; }
  else if ((dl.stage === "proposal" || dl.stage === "negotiation") && acc.status === "prospect") acc.status = "trial";
}

// ---------------------------------------------------------------- activities
const acts: Activity[] = [];
let actN = 0;
const pushAct = (leadId: string, kind: ActivityKind, at: number, title: string, detail?: string, byId?: string) => {
  if (at > NOW_MS) return;
  acts.push({ id: `ac-${++actN}`, leadId, kind, at: iso(at), title, detail, byId });
};
const CH_LABEL: Record<Channel, string> = { linkedin: "LinkedIn ad", whatsapp: "WhatsApp template", email: "Mailchimp email", meta: "Meta lead ad", google_ads: "Google Search ad", organic: "Google organic search", referral: "referral from a client firm", event: cfg.eventLabel };
for (const l of leads) {
  const c0 = new Date(l.createdAt).getTime();
  const acc = accounts.find((a) => a.id === l.accountId)!;
  const cmp = l.campaignId ? campaignById.get(l.campaignId) : null;
  const first = l.name.split(" ")[0];
  pushAct(l.id, l.channel === "email" ? "email_click" : "ad_click", c0 - rng.int(3, 40) * MIN, `Clicked ${CH_LABEL[l.channel]}`, cmp ? `Campaign: ${cmp.name}` : undefined);
  pushAct(l.id, "page_view", c0 - rng.int(1, 3) * MIN, rng.pick(["Viewed /pricing", "Viewed /features/ecourts-sync", "Viewed /features/hearing-calendar", "Viewed /tamil"]));
  pushAct(l.id, "form_submit", c0, l.channel === "meta" || l.channel === "linkedin" ? "Submitted in-platform lead form" : "Submitted demo request form", `Role: ${l.title} · Firm size: ${acc.size}`);
  const idx = STAGE_ORDER.indexOf(l.stage === "lost" ? "contacted" : l.stage);
  let t = c0 + (l.firstResponseMins ?? 60) * MIN;
  if (l.firstResponseMins !== null) {
    if (rng.chance(0.5)) pushAct(l.id, "call", t, `Call · ${rng.int(4, 14)} min`, `Spoke to ${first}. ${rng.pick(["Runs ~40 matters at the High Court, diary kept by a junior.", "Wants hearing reminders for the whole chamber.", "Asked if cause lists from the Madurai Bench are covered.", "Interested, but partners decide in a Saturday meeting."])}`, l.ownerId);
    else pushAct(l.id, "whatsapp_out", t, "WhatsApp template sent: ecourts_intro_ta", "Vanakkam — sharing a 2-minute tour of the hearing calendar.", l.ownerId);
  }
  if (idx >= 1) {
    t += rng.float(0.3, 2) * DAY;
    pushAct(l.id, "whatsapp_in", t, `${first} replied on WhatsApp`, rng.pick(["Can it show Madras HC and City Civil Court cases in one calendar?", "Is the data stored in India?", "Send the Tamil version please.", "What is the price for 8 advocates?"]));
    pushAct(l.id, "stage_change", t + 20 * MIN, "Stage: New → Contacted", undefined, l.ownerId);
  }
  if (idx >= 2) { t += rng.float(1, 4) * DAY; pushAct(l.id, "email_open", t, "Opened 'Ask Nidhi: hearing brief sample'"); pushAct(l.id, "stage_change", t + 2 * HOUR, "Stage: Contacted → Qualified", "Decision maker confirmed; 6+ advocates", l.ownerId); }
  if (idx >= 3) { t += rng.float(1, 3) * DAY; pushAct(l.id, "demo_booked", t, `Demo booked for ${new Date(t + 2 * DAY).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}`, "Google Meet · 30 min · partners + office manager", l.ownerId); }
  if (idx >= 4) { t += rng.float(2, 4) * DAY; pushAct(l.id, "demo_done", t, "Demo completed", rng.pick(["Liked eCourts sync; asked about migrating 6 years of Excel diaries.", "Partner wants billing in INR with GST invoices.", "Associates keen on Ask Nidhi; partner cautious on data privacy."]), l.ownerId); }
  if (idx >= 5) { t += rng.float(1, 4) * DAY; pushAct(l.id, "proposal_sent", t, "Proposal sent", `Annual plan, ${Math.max(2, Math.round(acc.lawyers * 0.8))} seats`, l.ownerId); }
  if (l.stage === "won") pushAct(l.id, "stage_change", Math.min(NOW_MS - DAY, t + rng.float(2, 6) * DAY), "Stage: Proposal → Won", "Signed annual agreement", l.ownerId);
  if (l.stage === "lost") pushAct(l.id, "stage_change", new Date(l.lastTouchAt).getTime(), "Stage → Lost", rng.pick(LOST_REASONS), l.ownerId);
  if (rng.chance(0.4)) pushAct(l.id, "note", new Date(l.lastTouchAt).getTime() - 30 * MIN, "Note", rng.pick(["Prefers calls after 6 pm — in court till 5.", "Office manager handles software decisions.", "Mentioned two other firms in the same building.", "Uses a paid case-diary app today; contract ends in March."]), l.ownerId);
}
acts.sort((a, b) => b.at.localeCompare(a.at));
for (const a of accounts) {
  const latest = acts.find((x) => leads.find((l) => l.id === x.leadId)?.accountId === a.id);
  a.lastActivityAt = latest?.at ?? istAt(-rng.int(30, 80), 12);
}

// ---------------------------------------------------------------- campaign daily metrics (90 days)
const CH_RATES: Record<string, { cpm: number; ctr: number; reachPerImp: number; eng: number }> = {
  linkedin: { cpm: 560, ctr: 0.0062, reachPerImp: 0.42, eng: 0.011 },
  meta: { cpm: 140, ctr: 0.0105, reachPerImp: 0.36, eng: 0.022 },
  google_ads: { cpm: 0, ctr: 0.054, reachPerImp: 0.8, eng: 0.06 },
  whatsapp: { cpm: 0, ctr: 0.19, reachPerImp: 0.97, eng: 0.31 },
  email: { cpm: 0, ctr: 0.034, reachPerImp: 0.98, eng: 0.27 },
};
const campaignDays: CampaignDay[] = [];
for (const c of CAMPAIGNS) {
  const end = c.endOffset ?? 0;
  for (let off = c.startOffset; off <= end; off++) {
    const date = istDate(off);
    const dow = new Date(date + "T12:00:00Z").getUTCDay();
    const wk = dow === 0 ? 0.55 : dow === 6 ? 0.8 : 1;
    const rate = CH_RATES[c.channel];
    const spend = c.channel === "email" ? (off % 8 === 0 ? c.dailyBudget * 7.8 : 0) : Math.round(c.dailyBudget * wk * rng.float(0.82, 1.12));
    let impressions: number;
    if (c.channel === "google_ads") impressions = Math.round(spend / rng.float(26, 34) / rate.ctr);
    else if (c.channel === "whatsapp") impressions = Math.round(spend / rng.float(0.82, 0.95));
    else if (c.channel === "email") impressions = off % 8 === 0 ? Math.round(c.audienceSize * rng.float(0.88, 0.95)) : 0;
    else impressions = Math.round((spend / rate.cpm) * 1000);
    const clicks = Math.round(impressions * rate.ctr * rng.float(0.85, 1.15));
    const crmLeads = leads.filter((l) => l.campaignId === c.id && l.createdAt.slice(0, 10) === date).length;
    campaignDays.push({
      campaignId: c.id, date, spend, impressions, reach: Math.round(impressions * rate.reachPerImp), clicks,
      platformLeads: crmLeads + (rng.chance(0.07) ? 1 : 0), engagements: Math.round(impressions * rate.eng * rng.float(0.8, 1.2)),
    });
  }
}
const campaigns: Campaign[] = CAMPAIGNS.map(({ startOffset, endOffset, dailyBudget: _d, ...c }) => ({
  ...c, startDate: istDate(startOffset), endDate: endOffset === null ? null : istDate(endOffset),
}));

// ---------------------------------------------------------------- GA4 (90 days)
const GA4_SHARE: Record<Ga4Channel, number> = { "Organic Search": 0.29, "Paid Search": 0.17, "Paid Social": 0.24, Email: 0.07, Direct: 0.17, Referral: 0.06 };
const ga4: Ga4Day[] = [];
for (let off = -89; off <= 0; off++) {
  const date = istDate(off);
  const dow = new Date(date + "T12:00:00Z").getUTCDay();
  const trend = 1 + (off + 89) / 89 * 0.38;
  const wk = dow === 0 ? 0.48 : dow === 6 ? 0.74 : 1;
  const spike = date === istDate(-44) || date === istDate(-36) || date === istDate(-28) ? 1.45 : 1; // email sends
  const sessions = Math.round(cfg.ga4Base * trend * wk * spike * rng.float(0.9, 1.1) * (off === 0 ? 0.45 : 1));
  const byChannel = {} as Record<Ga4Channel, number>;
  let left = sessions;
  (Object.keys(GA4_SHARE) as Ga4Channel[]).forEach((ch, i, arr) => {
    const v = i === arr.length - 1 ? left : Math.round(sessions * GA4_SHARE[ch] * rng.float(0.86, 1.14) * (ch === "Email" ? spike : 1) / spike);
    byChannel[ch] = Math.max(0, Math.min(v, left)); left -= byChannel[ch];
  });
  const mobile = Math.round(sessions * rng.float(0.6, 0.66)), tablet = Math.round(sessions * 0.03);
  ga4.push({
    date, sessions, users: Math.round(sessions * 0.81), engagedSessions: Math.round(sessions * rng.float(0.52, 0.6)),
    avgEngagementSecs: Math.round(rng.float(62, 84)), keyEvents: leads.filter((l) => l.createdAt.slice(0, 10) === date && l.channel !== "meta" && l.channel !== "linkedin").length + (rng.chance(0.2) ? 1 : 0),
    byChannel, byDevice: { mobile, tablet, desktop: sessions - mobile - tablet },
  });
}
const totalSessions = ga4.reduce((a, d) => a + d.sessions, 0);
const ga4Pages: Ga4Page[] = [
  ["/", "LAWSOME — Practice management for Indian law firms", 0.38, 0.51, 48, 41],
  ["/pricing", "Pricing", 0.13, 0.69, 96, 33],
  ["/features/ecourts-sync", "eCourts & cause-list sync", 0.1, 0.72, 118, 12],
  ["/features/ask-nidhi", "Ask Nidhi research assistant", 0.08, 0.64, 104, 9],
  ["/tamil", "LAWSOME தமிழில்", 0.07, 0.66, 88, 7],
  ["/features/hearing-calendar", "Hearing calendar", 0.06, 0.61, 81, 5],
  ["/blog/dpdp-checklist-for-law-firms", "DPDP checklist for law firms", 0.06, 0.58, 142, 3],
  ["/demo", "Book a demo", 0.05, 0.81, 63, 28],
  ["/customers/kovai-legal", "Case study: Kovai Legal Associates", 0.03, 0.7, 131, 4],
].map(([path, title, share, er, secs, conv]) => ({ path: path as string, title: title as string, sessions: Math.round(totalSessions * (share as number) * rng.float(0.95, 1.05)), engagementRate: er as number, avgSecs: secs as number, conversions: conv as number }));

// ---------------------------------------------------------------- tasks
const tasks: Task[] = [];
let tN = 0;
for (const l of leads.filter((x) => x.nextActionAt && x.nextAction)) {
  const a = l.nextAction!.toLowerCase();
  const kind: Task["kind"] = a.includes("whatsapp") ? "whatsapp" : a.includes("demo") ? "demo" : a.includes("proposal") || a.includes("pricing") || a.includes("negotiate") ? "proposal" : a.includes("call") ? "call" : a.includes("send") ? "email" : "follow_up";
  tasks.push({ id: `T-${++tN}`, leadId: l.id, dealId: deals.find((d) => d.leadId === l.id)?.id ?? null, title: l.nextAction!, kind, ownerId: l.ownerId, dueAt: l.nextActionAt!, status: "open", priority: l.score >= 70 ? "high" : l.score < 35 ? "low" : "normal" });
}
for (let i = 0; i < 14; i++) {
  const l = leads[(i * 7) % leads.length];
  tasks.push({ id: `T-${++tN}`, leadId: l.id, dealId: null, title: rng.pick(["Logged call outcome", "Sent recap email", "Shared trial workspace link", "Sent WhatsApp demo reminder"]), kind: rng.pick(["call", "email", "whatsapp"] as const), ownerId: l.ownerId, dueAt: istAt(-rng.int(0, 3), rng.int(9, 17)), status: "done", priority: "normal" });
}
// demo slots this week for the calendar strip
leads.filter((l) => l.stage === "demo_booked").forEach((l, i) => {
  tasks.push({ id: `T-${++tN}`, leadId: l.id, dealId: deals.find((d) => d.leadId === l.id)?.id ?? null, title: `Demo: ${accounts.find((a) => a.id === l.accountId)!.name}`, kind: "demo", ownerId: l.ownerId, dueAt: istAt(i % 6, [11, 15, 17, 12, 16][i % 5], i % 2 ? 30 : 0), status: "open", priority: "high" });
});

// ---------------------------------------------------------------- consent, privacy, audit, sync
const consent: ConsentEntry[] = [];
let cN = 0;
for (const l of leads) {
  consent.push({ id: `CN-${++cN}`, leadId: l.id, purpose: "demo_followup", action: "granted", noticeVersion: l.consent.noticeVersion, via: l.channel === "meta" || l.channel === "linkedin" ? "Platform lead form" : "Website form", at: l.createdAt });
  if (l.consent.marketing) consent.push({ id: `CN-${++cN}`, leadId: l.id, purpose: "marketing_email", action: "granted", noticeVersion: l.consent.noticeVersion, via: "Website form checkbox", at: l.createdAt });
  if (l.consent.whatsapp) consent.push({ id: `CN-${++cN}`, leadId: l.id, purpose: "whatsapp", action: "granted", noticeVersion: l.consent.noticeVersion, via: "WhatsApp opt-in reply", at: iso(new Date(l.createdAt).getTime() + 3 * HOUR) });
}
for (const l of leads.filter((_, i) => i % 23 === 5)) consent.push({ id: `CN-${++cN}`, leadId: l.id, purpose: "marketing_email", action: "withdrawn", noticeVersion: "v1.3", via: "Unsubscribe link", at: iso(NOW_MS - rng.int(1, 20) * DAY) });
consent.sort((a, b) => b.at.localeCompare(a.at));
const privacyRequests: PrivacyRequest[] = [
  { id: "PR-014", leadId: leads[17 % leads.length].id, kind: "erasure", receivedAt: istAt(-6, 11), dueAt: istAt(24, 11), status: "in_progress" },
  { id: "PR-013", leadId: leads[42 % leads.length].id, kind: "withdrawal", receivedAt: istAt(-9, 15), dueAt: istAt(21, 15), status: "open" },
  { id: "PR-012", leadId: leads[63 % leads.length].id, kind: "access", receivedAt: istAt(-19, 10), dueAt: istAt(11, 10), status: "open" },
  { id: "PR-011", leadId: leads[88 % leads.length].id, kind: "erasure", receivedAt: istAt(-41, 12), dueAt: istAt(-11, 12), status: "done" },
  { id: "PR-010", leadId: leads[101 % leads.length].id, kind: "withdrawal", receivedAt: istAt(-57, 16), dueAt: istAt(-27, 16), status: "done" },
];
const AUDIT_ACTIONS: [string, string, string][] = [
  ["u-priya", "Reassigned 6 leads", "Leads view: Madurai · new · unassigned"],
  ["u-arun", "Moved deal to Proposal", "DL-305"],
  ["u-sanjay", "Ran CSV import", "LinkedIn lead-gen export (41 rows, 2 rejected)"],
  ["u-meenakshi", "Changed role", "Divya Sekar: Sales Rep (unchanged scope)"],
  ["u-nithya", "Paused campaign", "Cause-list alerts — Trichy & Salem"],
  ["u-sanjay", "Exported CSV", "Consent log (DPDP access request PR-012)"],
  ["u-priya", "Edited pipeline stage", "Renamed 'Trial' to 'Demo done'"],
  ["u-karthik", "Logged call", "LD-1033"],
  ["u-meenakshi", "Updated branding", "Accent hue 245, logo placeholder"],
  ["u-divya", "Marked task done", "T-12 — Sent recap email"],
  ["u-sanjay", "Completed erasure", "PR-011 (lead hard-deleted after 30-day hold)"],
  ["u-nithya", "Approved WhatsApp template", "ecourts_intro_ta (Tamil)"],
];
const audit: AuditEntry[] = AUDIT_ACTIONS.filter(([a]) => TEAM.some((t) => t.id === a) || cfg.idPrefix === "LD").map(([actorId, action, target], i) => ({ id: `AU-${900 - i}`, at: iso(NOW_MS - (i * 9.3 + 0.4) * HOUR), actorId, action, target, ip: `10.24.${(i * 37) % 255}.${(i * 91) % 255}` }));
const syncRuns: SyncRun[] = [];
const SYNC_SET: [string, number, number][] = [["ga4", 24, 0], ["whatsapp", 6, 0], ["mailchimp", 12, 0], ["linkedin", 24, 2], ["meta-ads", 12, 1], ["google-ads", 24, 0], ["gmail", 3, 0]];
let sN = 0;
for (let h = 0; h < 72; h += 3) {
  for (const [id, every, rej] of SYNC_SET) {
    if (h % every !== 0) continue;
    const failed = id === "linkedin" && h === 24;
    syncRuns.push({ id: `SR-${5000 + ++sN}`, integrationId: id, startedAt: iso(NOW_MS - h * HOUR - rng.int(5, 40) * MIN), durationSecs: rng.int(4, 95), status: failed ? "failed" : rej && rng.chance(0.4) ? "partial" : "success", rowsIn: failed ? 0 : rng.int(id === "ga4" ? 90 : 3, id === "ga4" ? 140 : 60), rowsRejected: failed ? 0 : rej ? rng.int(0, rej) : 0, note: failed ? "Token expired (LinkedIn 60-day refresh) — reconnect required" : id === "linkedin" ? "Lead-gen form export (CSV bridge)" : "OK" });
  }
}
syncRuns.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

const conversations = buildConversations(leads, accounts, rng);
const integrations = buildIntegrations(syncRuns);

return {
  now: NOW_ISO, team: TEAM, accounts, leads, activities: acts, deals, campaigns, campaignDays, ga4, ga4Pages, tasks,
  conversations, integrations, consent, privacyRequests, audit, syncRuns,
};
}
