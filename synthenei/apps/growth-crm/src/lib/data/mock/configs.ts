// Per-workspace dataset configs. Tamil Nadu is the main demo; Kerala pilot and Kaveri LegalTech are small tenants
// that prove workspace isolation. ALL NAMES ARE FICTIONAL.
import type { PracticeArea, TeamMember } from "../types";
import { CAMPAIGNS, CITY_META, FIRMS, TEAM, repForCity, type CampaignSeed } from "./catalog";

export interface DatasetConfig {
  seed: number; idPrefix: string; leadCount: number; maxDeals: number; ga4Base: number; eventLabel: string;
  firms: [string, string, string, PracticeArea[]][]; team: TeamMember[]; campaigns: CampaignSeed[];
  cityMeta: Record<string, { district: string; courts: string[] }>; repForCity: (city: string) => string;
  channelWeights: [string, number][]; cityBias: Record<string, string[] | null>;
  preCustomers: (readonly [number, number, "Practice" | "Chambers" | "Enterprise"])[]; churnedIdx: number | null;
  firstNames?: string[]; surnames?: string[];
}

export const TN: DatasetConfig = {
  seed: 20261013, idPrefix: "LD", leadCount: 120, maxDeals: 25, ga4Base: 410, eventLabel: "Madras Bar Association meetup",
  firms: FIRMS, team: TEAM, campaigns: CAMPAIGNS, cityMeta: CITY_META, repForCity: (c) => repForCity(c as never),
  channelWeights: [["cmp-hearing-day", 20], ["cmp-ecourts-madurai", 13], ["cmp-ask-nidhi", 9], ["cmp-kovai-meta", 15], ["cmp-google-search", 18], ["cmp-causelist-trichy", 5], ["cmp-dpdp-webinar", 8], ["cmp-retarget-meta", 6], ["organic", 10], ["referral", 7], ["event", 4]],
  cityBias: { "cmp-hearing-day": ["Chennai"], "cmp-ecourts-madurai": ["Madurai", "Tirunelveli"], "cmp-kovai-meta": ["Coimbatore"], "cmp-causelist-trichy": ["Tiruchirappalli", "Salem"] },
  preCustomers: [[0, 14, "Chambers"], [16, 9, "Practice"], [23, 11, "Chambers"], [29, 6, "Practice"], [33, 7, "Practice"]], churnedIdx: 37,
};

const KL_TEAM: TeamMember[] = [
  { id: "u-meenakshi", name: "Meenakshi Sundaram", role: "owner", title: "Owner / Admin (demo)", email: "meenakshi@lawsome.example", monthlyTarget: 0 },
  { id: "u-anoop", name: "Anoop Mathew", role: "sales_rep", title: "Account Executive · Kerala", email: "anoop@lawsome.example", monthlyTarget: 150000 },
  { id: "u-nithya", name: "Nithya Balan", role: "marketing", title: "Growth Marketing Lead", email: "nithya@lawsome.example", monthlyTarget: 0 },
  { id: "u-arun", name: "Arun Kumar", role: "viewer", title: "Observer from TN team", email: "arun@lawsome.example", monthlyTarget: 0 },
];
const klCampaign = (c: Partial<CampaignSeed> & Pick<CampaignSeed, "id" | "name" | "channel" | "utmCampaign">): CampaignSeed => ({
  status: "live", objective: "Kerala pilot demand test", startDate: "", endDate: null, budget: 60000, startOffset: -40, endOffset: null, dailyBudget: 1500,
  audience: "Advocates and firm partners, Kerala", audienceSize: 6000, ownerId: "u-nithya", dataSource: "mock",
  creative: { format: "Single image", headline: "Your Kerala High Court diary, synced", body: "Cause lists from the High Court of Kerala and district courts in one calendar.", cta: "Book a demo" }, ...c,
});
export const KERALA: DatasetConfig = {
  seed: 7302, idPrefix: "KL", leadCount: 16, maxDeals: 4, ga4Base: 70, eventLabel: "Kerala High Court Advocates' Association meetup",
  firms: [
    ["Periyar Law Chambers", "Ernakulam", "Kaloor", ["Civil", "Property"]], ["Marine Drive Legal LLP", "Ernakulam", "Marine Drive", ["Corporate", "Tax"]],
    ["Vembanad Advocates", "Ernakulam", "Kadavanthra", ["Family", "Civil"]], ["Padmanabha Law Offices", "Thiruvananthapuram", "Vazhuthacaud", ["Civil", "Criminal"]],
    ["Kowdiar Legal Associates", "Thiruvananthapuram", "Kowdiar", ["Labour", "Civil"]], ["Malabar Law Partners", "Kozhikode", "Mavoor Road", ["Property", "Civil"]],
    ["Kallai Chambers", "Kozhikode", "Kallai", ["Criminal"]], ["Round North Advocates", "Thrissur", "Round North", ["Civil", "Family"]],
  ],
  team: KL_TEAM,
  campaigns: [
    klCampaign({ id: "cmp-kl-hc-diary", name: "Kerala High Court diary — Kochi partners", channel: "linkedin", utmCampaign: "li_klhc_diary", budget: 90000, dailyBudget: 2100 }),
    klCampaign({ id: "cmp-kl-wa-malayalam", name: "Malayalam WhatsApp pilot — Kozhikode", channel: "whatsapp", utmCampaign: "wa_ml_kzk", budget: 25000, dailyBudget: 600, startOffset: -28 }),
    klCampaign({ id: "cmp-kl-search", name: "Google Search — Kerala", channel: "google_ads", utmCampaign: "gads_kerala", budget: 70000, dailyBudget: 1700 }),
  ],
  cityMeta: {
    Ernakulam: { district: "Ernakulam", courts: ["High Court of Kerala", "District Court, Ernakulam", "Family Court, Ernakulam"] },
    Thiruvananthapuram: { district: "Thiruvananthapuram", courts: ["District Court, Thiruvananthapuram", "High Court of Kerala"] },
    Kozhikode: { district: "Kozhikode", courts: ["District Court, Kozhikode", "High Court of Kerala"] },
    Thrissur: { district: "Thrissur", courts: ["District Court, Thrissur"] },
  },
  repForCity: () => "u-anoop",
  channelWeights: [["cmp-kl-hc-diary", 6], ["cmp-kl-wa-malayalam", 3], ["cmp-kl-search", 5], ["organic", 2], ["referral", 2]],
  cityBias: { "cmp-kl-hc-diary": ["Ernakulam"], "cmp-kl-wa-malayalam": ["Kozhikode"] },
  preCustomers: [], churnedIdx: null,
  firstNames: ["Anjali", "Rahul", "Deepthi", "Joseph", "Lakshmi", "Arjun", "Meera", "Thomas", "Sreeja", "Nikhil", "Aswathy", "George", "Divya", "Vishnu", "Reshma", "Shibu"],
  surnames: ["Menon", "Nair", "Pillai", "Kurian", "Varghese", "Panicker", "Thomas", "Warrier", "Krishnan", "Mathew"],
};

const KAVERI_TEAM: TeamMember[] = [
  { id: "u-lavanya", name: "Lavanya Prakash", role: "owner", title: "Owner / Admin (demo)", email: "lavanya@kaverilegal.example", monthlyTarget: 0 },
  { id: "u-suresh", name: "Suresh Babu", role: "sales_rep", title: "Sales Executive · Coimbatore", email: "suresh@kaverilegal.example", monthlyTarget: 120000 },
];
export const KAVERI: DatasetConfig = {
  seed: 4411, idPrefix: "KV", leadCount: 10, maxDeals: 3, ga4Base: 45, eventLabel: "Coimbatore Bar Association evening",
  firms: [
    ["Ukkadam Law Chambers", "Coimbatore", "Ukkadam", ["Civil", "Family"]], ["Singanallur Advocates", "Coimbatore", "Singanallur", ["Labour", "Corporate"]],
    ["Saravanampatti Legal LLP", "Coimbatore", "Saravanampatti", ["Property"]], ["Town Hall Chambers", "Coimbatore", "Town Hall", ["Criminal", "Civil"]],
    ["Ganapathy Legal Associates", "Coimbatore", "Ganapathy", ["Tax", "Corporate"]], ["Tiruppur Road Law Offices", "Coimbatore", "Avinashi Road", ["Civil"]],
  ],
  team: KAVERI_TEAM,
  campaigns: [
    { ...CAMPAIGNS[3], id: "cmp-kv-meta", name: "Coimbatore advocates — Meta lead ads", utmCampaign: "kv_meta_cbe", budget: 40000, dailyBudget: 1100, startOffset: -21, ownerId: "u-lavanya", audience: "Advocates, Coimbatore + Tiruppur" },
    { ...CAMPAIGNS[4], id: "cmp-kv-search", name: "Google Search — e-filing software", utmCampaign: "kv_gads_efiling", budget: 30000, dailyBudget: 900, startOffset: -21, ownerId: "u-lavanya", audience: "Keywords: e-filing software, madras high court e-filing" },
  ],
  cityMeta: { Coimbatore: CITY_META.Coimbatore },
  repForCity: () => "u-suresh",
  channelWeights: [["cmp-kv-meta", 5], ["cmp-kv-search", 4], ["referral", 2]],
  cityBias: {}, preCustomers: [[0, 4, "Practice"]], churnedIdx: null,
};
