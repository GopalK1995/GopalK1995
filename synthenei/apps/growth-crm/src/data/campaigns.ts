import type { Campaign } from "./types";

// SYNTHETIC. LinkedIn rows are MOCK (no LinkedIn API access). Email spend is 0 because tool cost is not tracked per campaign.
export const campaigns: Campaign[] = [
  { id: "c1", name: "Launch email to partners (Oct)", channel: "email", utmCampaign: "lw-email-launch-oct", audience: "Law-firm owners, TN + Bengaluru list (synthetic)", status: "live", startedOn: "2026-09-15", spend: 0, impressions: 1180, reach: 1180, clicks: 104, platformLeads: 0, dataSource: "csv" },
  { id: "c2", name: "Nurture email: hearing diary pain", channel: "email", utmCampaign: "lw-email-nurture-sep", audience: "Opened launch email, no click", status: "live", startedOn: "2026-09-26", spend: 0, impressions: 640, reach: 640, clicks: 38, platformLeads: 0, dataSource: "csv" },
  { id: "c3", name: "LinkedIn: managing partners", channel: "linkedin", utmCampaign: "lw-li-managing-partners", audience: "Managing partners / owners, firms 6-50", status: "live", startedOn: "2026-09-16", spend: 48000, impressions: 61200, reach: 22400, clicks: 574, platformLeads: 21, dataSource: "mock" },
  { id: "c4", name: "LinkedIn: senior advocates", channel: "linkedin", utmCampaign: "lw-li-senior-advocates", audience: "Senior advocates, chambers", status: "live", startedOn: "2026-09-20", spend: 36000, impressions: 40100, reach: 15800, clicks: 301, platformLeads: 9, dataSource: "mock" },
  { id: "c5", name: "Meta: TN lawyers (video demo)", channel: "meta", utmCampaign: "lw-meta-tn-lawyers", audience: "Tamil Nadu, interest: law, age 28-55", status: "live", startedOn: "2026-09-18", spend: 22000, impressions: 118000, reach: 54000, clicks: 1210, platformLeads: 0, dataSource: "csv" },
  { id: "c6", name: "Meta: retarget site visitors", channel: "meta", utmCampaign: "lw-meta-retarget", audience: "Visited landing page, no form", status: "live", startedOn: "2026-10-01", spend: 6500, impressions: 14300, reach: 3900, clicks: 188, platformLeads: 0, dataSource: "csv" },
];
export const campaignById = (id: string | null) => campaigns.find((c) => c.id === id) ?? null;
