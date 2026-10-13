// ALL DATA HERE IS SYNTHETIC. Fictional people and firms, reserved ".example" domains, no phone numbers.
import type { Channel, Lead, LeadEvent, Stage } from "./types";
import { campaigns } from "./campaigns";

/** Fixed "now" so server renders are deterministic: 2026-10-13 09:30 IST. */
export const NOW_ISO = "2026-10-13T04:00:00.000Z";
const NOW = new Date(NOW_ISO).getTime();
const H = 3600e3, D = 24 * H, M = 60e3;
export const STAGES: Stage[] = ["new", "contacted", "demo_booked", "demo_done", "proposal", "won", "lost"];
const FUNNEL_ORDER: Stage[] = ["new", "contacted", "demo_booked", "demo_done", "proposal", "won"];

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng(20261013);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
function weighted<T>(xs: readonly (readonly [T, number])[]): T {
  const total = xs.reduce((a, [, w]) => a + w, 0); let r = rand() * total;
  for (const [x, w] of xs) { if ((r -= w) <= 0) return x; }
  return xs[xs.length - 1][0];
}

const FIRST = ["Aarav", "Meera", "Karthik", "Divya", "Rohan", "Lakshmi", "Imran", "Sneha", "Vikram", "Anitha", "Naveen", "Pooja", "Suresh", "Farah", "Arjun", "Revathi", "Dinesh", "Kavya"];
const LAST = ["Iyer", "Nair", "Menon", "Rao", "Pillai", "Khan", "Sharma", "Reddy", "Gupta", "Subramanian", "Das", "Joshi", "Naidu", "Verma"];
const FIRM_A = ["Harbor", "Kestrel", "Juniper", "Sandstone", "Tamarind", "Banyan", "Quillon", "Ironwood", "Bluebell", "Marigold", "Larkspur", "Cobalt"];
const FIRM_B = ["& Associates", "Legal Chambers", "Law Offices", "Advocates LLP", "Counsel"];
const CITIES: readonly (readonly [[string, string], number])[] = [
  [["Chennai", "Tamil Nadu"], 30], [["Madurai", "Tamil Nadu"], 8], [["Coimbatore", "Tamil Nadu"], 8], [["Tiruchirappalli", "Tamil Nadu"], 4],
  [["Bengaluru", "Karnataka"], 14], [["Hyderabad", "Telangana"], 10], [["Mumbai", "Maharashtra"], 8], [["Delhi", "Delhi"], 8], [["Kochi", "Kerala"], 6],
];
const ROLES: readonly (readonly [string, number])[] = [
  ["Managing partner / owner", 36], ["Senior advocate / practice head", 20], ["Associate / lawyer", 24], ["Legal operations / admin", 12], ["Other", 8],
];
const AREAS = ["Civil litigation", "Corporate & commercial", "Property & land", "Criminal", "Family", "IP", "Banking & recovery", "Labour & service"];
const SIZES = ["1-5", "6-20", "21-50", "50+"];
const OWNERS = ["Venket", "Ashique", "Kiruba"];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const iso = (ms: number) => new Date(ms).toISOString();

const channelOf = (c: string | null): Channel => (c ? (campaigns.find((x) => x.utmCampaign === c)?.channel ?? "direct") : "direct");

function stageFor(daysAgo: number): { stage: Stage; max: number } {
  const s = rand() * 0.75 + (Math.min(daysAgo, 30) / 30) * 0.3;
  let idx = s < 0.2 ? 0 : s < 0.42 ? 1 : s < 0.58 ? 2 : s < 0.72 ? 3 : s < 0.82 ? 4 : s < 0.93 ? 5 : -1;
  if (daysAgo > 4 && idx === 0) idx = 1;
  if (daysAgo < 2 && idx > 1) idx = 1;
  if (idx === -1) return { stage: "lost", max: Math.floor(rand() * 4) };
  return { stage: FUNNEL_ORDER[idx], max: idx };
}

const COUNT = 64;
const raw: Lead[] = [];
for (let i = 0; i < COUNT; i++) {
  const daysAgo = Math.floor(rand() ** 1.2 * 29.5);
  const created = NOW - daysAgo * D - Math.floor(rand() * 9 * H) - 1 * H;
  const [city, state] = weighted(CITIES);
  const role = weighted(ROLES);
  const first = pick(FIRST), last = pick(LAST), firmName = `${pick(FIRM_A)} ${pick(FIRM_B)}`;
  const personal = rand() < 0.2;
  const camp = weighted<string | null>([["c3", 22], ["c4", 10], ["c1", 17], ["c2", 7], ["c5", 14], ["c6", 5], [null, 25]]);
  const utm = camp ? campaigns.find((c) => c.id === camp)!.utmCampaign : null;
  const firstChannel: Channel = utm ? channelOf(utm) : weighted<Channel>([["organic", 5], ["direct", 6], ["referral", 3]]);
  // ~30% of tagged leads converted via a different last touch (retarget or direct)
  const lastUtm = utm && rand() < 0.3 ? (rand() < 0.5 ? "lw-meta-retarget" : null) : utm;
  const lastChannel: Channel = lastUtm ? channelOf(lastUtm) : utm ? "direct" : firstChannel;
  const { stage, max } = stageFor(daysAgo);
  const responded = stage !== "new";
  const firstResp = responded ? created + (20 + Math.floor(rand() ** 2 * 900)) * M : null;
  const enriched = responded;
  const n = i + 1;
  const events: LeadEvent[] = [];
  const t0 = created;
  events.push({ name: "page_view", at: iso(t0 - 14 * M), note: "Landing page" });
  events.push({ name: "cta_click", at: iso(t0 - 10 * M), note: "Request a demo" });
  events.push({ name: "form_start", at: iso(t0 - 7 * M) });
  if (rand() < 0.45) events.push({ name: "tour_play", at: iso(t0 - 4 * M), note: "Product tour" });
  events.push({ name: "form_submit", at: iso(t0), note: "Consent recorded: demo follow-up" });
  if (firstResp) events.push({ name: rand() < 0.6 ? "email_sent" : "call_logged", at: iso(firstResp), note: "First response" });
  if (max >= 2) events.push({ name: "demo_booked", at: iso(t0 + (1 + Math.floor(rand() * 2)) * D), note: "Slot confirmed" });
  if (max >= 3) events.push({ name: "demo_done", at: iso(t0 + (3 + Math.floor(rand() * 3)) * D), note: "Demo delivered" });
  if (stage === "won") events.push({ name: "stage_changed", at: iso(t0 + 9 * D), note: "Moved to Won" });
  if (stage === "lost") events.push({ name: "stage_changed", at: iso(t0 + 6 * D), note: "Moved to Lost" });
  const evs = events.filter((e) => new Date(e.at).getTime() <= NOW).sort((a, b) => a.at.localeCompare(b.at));

  const parts: { label: string; pts: number }[] = [];
  if (role.startsWith("Managing")) parts.push({ label: "Owner / managing partner", pts: 40 });
  else if (role.startsWith("Senior")) parts.push({ label: "Senior advocate", pts: 25 });
  else if (role.startsWith("Associate")) parts.push({ label: "Associate", pts: 10 });
  if (!personal) parts.push({ label: "Work email", pts: 15 });
  if (evs.some((e) => e.name === "tour_play")) parts.push({ label: "Watched product tour", pts: 10 });
  if (evs.some((e) => e.name === "demo_booked")) parts.push({ label: "Demo booked", pts: 20 });
  const score = parts.reduce((a, p) => a + p.pts, 0);

  const area = enriched ? pick(AREAS) : null;
  raw.push({
    id: `LD-${1000 + n}`, name: `${first} ${last}`,
    email: `${slug(first)}.${slug(last)}${n}@${personal ? "personal-mail" : slug(firmName)}.example`,
    organisation: firmName, role, firmSize: enriched ? pick(SIZES) : null, city, state, practiceArea: area,
    personalEmail: personal, stage, maxStageIdx: max, owner: pick(OWNERS), campaignId: camp,
    firstTouch: { channel: firstChannel, campaign: utm }, lastTouch: { channel: lastChannel, campaign: lastUtm },
    createdAt: iso(created), firstResponseAt: firstResp ? iso(firstResp) : null,
    consent: { demoFollowup: true, marketingEmail: rand() < 0.6 }, score, scoreParts: parts,
    aiSummary: "", events: evs,
  });
}
// Template text, NOT model output. Real AI summaries are behind FEATURE_AI_SUMMARIES.
export const leads: Lead[] = raw
  .map((l) => ({
    ...l,
    aiSummary: `${l.role} at ${l.organisation} (${l.city}). Arrived via ${l.firstTouch.campaign ?? l.firstTouch.channel}; ${l.events.some((e) => e.name === "tour_play") ? "watched the product tour" : "did not watch the tour"}. Current stage: ${l.stage.replace("_", " ")}.`,
  }))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const leadById = (id: string) => leads.find((l) => l.id === id) ?? null;
export const minutesBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / M);
export const nowMs = NOW;
