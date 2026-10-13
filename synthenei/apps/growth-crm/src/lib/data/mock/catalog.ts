// Fixed, hand-written reference data for the synthetic dataset.
// ALL NAMES ARE FICTIONAL. Domains use the reserved ".example" TLD. Phone numbers are masked placeholders.
import type { Account, Campaign, City, PracticeArea, TeamMember } from "../types";

export const TEAM: TeamMember[] = [
  { id: "u-meenakshi", name: "Meenakshi Sundaram", role: "owner", title: "Owner / Admin (demo)", email: "meenakshi@lawsome.example", monthlyTarget: 0 },
  { id: "u-priya", name: "Priya Raman", role: "sales_manager", title: "Head of Sales", email: "priya@lawsome.example", monthlyTarget: 900000 },
  { id: "u-arun", name: "Arun Kumar", role: "sales_rep", title: "Account Executive · Chennai", email: "arun@lawsome.example", monthlyTarget: 350000 },
  { id: "u-divya", name: "Divya Sekar", role: "sales_rep", title: "Account Executive · Kongu & Salem", email: "divya@lawsome.example", monthlyTarget: 275000 },
  { id: "u-karthik", name: "Karthik Raja", role: "sales_rep", title: "Account Executive · South TN", email: "karthik@lawsome.example", monthlyTarget: 275000 },
  { id: "u-nithya", name: "Nithya Balan", role: "marketing", title: "Growth Marketing Lead", email: "nithya@lawsome.example", monthlyTarget: 0 },
  { id: "u-sanjay", name: "Sanjay Iyer", role: "data", title: "Data & Integrations", email: "sanjay@lawsome.example", monthlyTarget: 0 },
  { id: "u-rahul", name: "Rahul Varma", role: "viewer", title: "Board advisor (read-only)", email: "rahul@lawsome.example", monthlyTarget: 0 },
];
export const REPS = ["u-arun", "u-divya", "u-karthik"] as const;
export const repForCity = (c: City) => (c === "Chennai" ? "u-arun" : c === "Coimbatore" || c === "Salem" ? "u-divya" : "u-karthik");

export const CITY_META: Record<string, { district: string; courts: string[] }> = {
  Chennai: { district: "Chennai", courts: ["Madras High Court", "City Civil Court, Chennai", "Family Court, Chennai", "NCLT Chennai Bench", "Debts Recovery Tribunal-II", "Labour Court, Chennai"] },
  Coimbatore: { district: "Coimbatore", courts: ["Principal District Court, Coimbatore", "Labour Court, Coimbatore", "Madras High Court"] },
  Madurai: { district: "Madurai", courts: ["Madras High Court, Madurai Bench", "Principal District Court, Madurai", "Family Court, Madurai"] },
  Tiruchirappalli: { district: "Tiruchirappalli", courts: ["Principal District Court, Tiruchirappalli", "Madras High Court, Madurai Bench"] },
  Salem: { district: "Salem", courts: ["Principal District Court, Salem", "Madras High Court"] },
  Tirunelveli: { district: "Tirunelveli", courts: ["Principal District Court, Tirunelveli", "Madras High Court, Madurai Bench"] },
};

/** [name, city, locality, primary practice areas] */
export const FIRMS: [string, City, string, PracticeArea[]][] = [
  ["Ramanathan & Associates", "Chennai", "Mylapore", ["Civil", "Property"]],
  ["Cauvery Delta Legal LLP", "Chennai", "T. Nagar", ["Corporate", "Tax"]],
  ["Marina Law Partners", "Chennai", "Egmore", ["Civil", "Criminal"]],
  ["Srinivasan Law Chambers", "Chennai", "Mylapore", ["Property", "Family"]],
  ["Arcot Road Chambers", "Chennai", "T. Nagar", ["Criminal"]],
  ["Venkatraman & Co. Advocates", "Chennai", "Egmore", ["Civil", "Labour"]],
  ["Lakshmi Narayanan Legal", "Chennai", "Anna Nagar", ["Family", "Civil"]],
  ["Thillai Law Associates", "Chennai", "Anna Nagar", ["Property", "Civil"]],
  ["Pallavan Legal Partners", "Chennai", "Egmore", ["Corporate", "Labour"]],
  ["Santhome Law Offices", "Chennai", "Mylapore", ["Family", "Property"]],
  ["Rajaratnam Chambers", "Chennai", "T. Nagar", ["Tax", "Corporate"]],
  ["Natarajan & Sekar Advocates", "Chennai", "Egmore", ["Criminal", "Civil"]],
  ["Coromandel Legal LLP", "Chennai", "Anna Nagar", ["Corporate", "Tax", "Labour"]],
  ["Krishnaswamy Law Group", "Chennai", "T. Nagar", ["Civil", "Property", "Tax"]],
  ["Elango & Partners", "Chennai", "Mylapore", ["Labour", "Civil"]],
  ["Bharathi Legal Associates", "Chennai", "Anna Nagar", ["Criminal", "Family"]],
  ["Kovai Legal Associates", "Coimbatore", "R.S. Puram", ["Civil", "Property"]],
  ["Noyyal Law Chambers", "Coimbatore", "Gandhipuram", ["Labour", "Corporate"]],
  ["Palaniappan & Co.", "Coimbatore", "Race Course", ["Tax", "Corporate"]],
  ["Siruvani Advocates", "Coimbatore", "Saibaba Colony", ["Family", "Civil"]],
  ["Velusamy Law Offices", "Coimbatore", "R.S. Puram", ["Property"]],
  ["Kongu Legal Partners", "Coimbatore", "Peelamedu", ["Corporate", "Labour"]],
  ["Annamalai & Associates", "Coimbatore", "Gandhipuram", ["Criminal", "Civil"]],
  ["Vaigai Advocates", "Madurai", "K.K. Nagar", ["Civil", "Criminal"]],
  ["Pandian Law Chambers", "Madurai", "Anna Nagar", ["Property", "Civil"]],
  ["Alagar Legal Associates", "Madurai", "Tallakulam", ["Family", "Criminal"]],
  ["Sellur Law Offices", "Madurai", "Sellur", ["Labour"]],
  ["Mariappan & Co.", "Madurai", "K.K. Nagar", ["Tax", "Civil"]],
  ["Tamukkam Chambers", "Madurai", "Tallakulam", ["Criminal"]],
  ["Rockfort Chambers", "Tiruchirappalli", "Cantonment", ["Civil", "Property"]],
  ["Kollidam Legal", "Tiruchirappalli", "Thillai Nagar", ["Family", "Civil"]],
  ["Srirangam Law Associates", "Tiruchirappalli", "Srirangam", ["Property"]],
  ["Uraiyur Advocates", "Tiruchirappalli", "Thillai Nagar", ["Criminal", "Labour"]],
  ["Shevaroy Legal", "Salem", "Fairlands", ["Corporate", "Civil"]],
  ["Yercaud Road Chambers", "Salem", "Hasthampatti", ["Property", "Family"]],
  ["Thirumanimuthar Law Offices", "Salem", "Fairlands", ["Civil"]],
  ["Ramasamy & Partners", "Salem", "Swarnapuri", ["Tax", "Labour"]],
  ["Thamirabarani Law Offices", "Tirunelveli", "Palayamkottai", ["Civil", "Property"]],
  ["Nellai Legal Associates", "Tirunelveli", "Palayamkottai", ["Criminal", "Family"]],
  ["Kuttalam Chambers", "Tirunelveli", "Vannarpettai", ["Civil"]],
];

export const FIRST_NAMES = [
  "Karthikeyan", "Saravanan", "Lakshmi", "Revathi", "Senthil", "Gayathri", "Murugan", "Deepa", "Vignesh", "Sangeetha",
  "Balaji", "Kavitha", "Prakash", "Anitha", "Ramesh", "Janani", "Ganesh", "Bhuvana", "Harish", "Nandhini",
  "Selvam", "Priyadharshini", "Arvind", "Malathi", "Dinesh", "Shalini", "Mohan", "Keerthana", "Suresh", "Vidhya",
  "Rajesh", "Hema", "Kumaran", "Sowmya", "Elango", "Abirami", "Thirumalai", "Pavithra", "Ilango", "Yamuna",
];
export const SURNAMES = [
  "Subramanian", "Krishnan", "Natarajan", "Ramasamy", "Palanisamy", "Venkatesan", "Murugesan", "Rajendran", "Shanmugam",
  "Balasubramanian", "Chandrasekaran", "Ganesan", "Raghavan", "Thangaraj", "Kannan", "Periyasamy", "Arumugam", "Selvaraj",
];
export const TITLES: [string, number][] = [
  ["Managing Partner", 22], ["Senior Advocate", 16], ["Partner", 16], ["Founding Advocate", 10],
  ["Associate", 18], ["Practice Manager", 8], ["Office Manager", 10],
];

const d = (n: number) => n; // readability: day offsets
export type CampaignSeed = Campaign & { startOffset: number; endOffset: number | null; dailyBudget: number };
export const CAMPAIGNS: CampaignSeed[] = [
  {
    id: "cmp-hearing-day", name: "Hearing-day visibility — Chennai partners", channel: "linkedin", status: "live",
    objective: "Demo requests from managing partners", startDate: "", endDate: null, budget: 320000, startOffset: d(-78), endOffset: null, dailyBudget: 4100,
    audience: "Partners & senior advocates, firms of 6–40 lawyers, Chennai metro, Madras High Court practice", audienceSize: 18400,
    creative: { format: "Single image + lead gen form", headline: "Know every hearing before your junior does", body: "LAWSOME syncs eCourts and Madras High Court cause lists into one calendar for the whole chamber. No more 9 pm WhatsApp forwards.", cta: "Book a 20-min demo" },
    utmCampaign: "li_hearing_day_chn", ownerId: "u-nithya", dataSource: "mock",
  },
  {
    id: "cmp-ecourts-madurai", name: "eCourts made easy — Madurai advocates", channel: "whatsapp", status: "live",
    objective: "Conversations with Madurai Bench practitioners", startDate: "", endDate: null, budget: 85000, startOffset: d(-62), endOffset: null, dailyBudget: 1300,
    audience: "Opted-in advocates from the Madurai bar association event list and website sign-ups (Tamil + English templates)", audienceSize: 3200,
    creative: { format: "WhatsApp template (marketing)", headline: "Your Madurai Bench hearings, in one calendar", body: "Vanakkam {{1}}, see your next hearings across courts in one calendar, in Tamil or English. Reply DEMO for a 20-minute walk-through.", cta: "Reply DEMO" },
    utmCampaign: "wa_ecourts_mdu", ownerId: "u-nithya", dataSource: "mock",
  },
  {
    id: "cmp-ask-nidhi", name: "Ask Nidhi launch — Mailchimp", channel: "email", status: "ended",
    objective: "Re-engage dormant leads with the Ask Nidhi research assistant", startDate: "", endDate: "", budget: 22000, startOffset: d(-44), endOffset: d(-12), dailyBudget: 650,
    audience: "All consented leads and newsletter subscribers in Tamil Nadu (4 sends)", audienceSize: 6900,
    creative: { format: "4-step email sequence", headline: "Meet Nidhi: drafts the first cut of your case summary", body: "Ask Nidhi reads your uploaded pleadings and prepares a hearing brief your associate can check in minutes. Your files never leave your workspace.", cta: "Try Ask Nidhi on a sample brief" },
    utmCampaign: "em_ask_nidhi_launch", ownerId: "u-nithya", dataSource: "mock",
  },
  {
    id: "cmp-kovai-meta", name: "Coimbatore firms — Meta lead ads", channel: "meta", status: "live",
    objective: "Lead form submissions from Coimbatore & Tiruppur firms", startDate: "", endDate: null, budget: 240000, startOffset: d(-56), endOffset: null, dailyBudget: 3900,
    audience: "Lawyers & law-firm admins, 25–60, Coimbatore + 40 km, interests: Bar Council, legal research", audienceSize: 52000,
    creative: { format: "Carousel (3 cards) + instant form", headline: "Run your chamber from your phone", body: "Case diary, client updates and fee tracking in one app built for Tamil Nadu courts.", cta: "Get a callback" },
    utmCampaign: "meta_kovai_firms", ownerId: "u-nithya", dataSource: "mock",
  },
  {
    id: "cmp-google-search", name: "Google Search — legal practice software", channel: "google_ads", status: "live",
    objective: "High-intent search demand across Tamil Nadu", startDate: "", endDate: null, budget: 360000, startOffset: d(-89), endOffset: null, dailyBudget: 3800,
    audience: "Keywords: law firm software, advocate diary app, case management software india, ecourts case tracker", audienceSize: 0,
    creative: { format: "Responsive search ads", headline: "Case Management for Indian Law Firms | LAWSOME", body: "Hearing calendar, eCourts sync, billing in INR. Built in Chennai. Free 14-day trial.", cta: "Start free trial" },
    utmCampaign: "gads_practice_sw", ownerId: "u-nithya", dataSource: "mock",
  },
  {
    id: "cmp-causelist-trichy", name: "Cause-list alerts — Trichy & Salem", channel: "whatsapp", status: "paused",
    objective: "Test WhatsApp alerts offer outside Chennai", startDate: "", endDate: null, budget: 40000, startOffset: d(-36), endOffset: d(-9), dailyBudget: 1100,
    audience: "Opted-in advocates, Tiruchirappalli and Salem district courts", audienceSize: 1400,
    creative: { format: "WhatsApp template", headline: "District court listings, before you leave home", body: "Get your next-day district court listings on WhatsApp, free for 30 days.", cta: "Reply START" },
    utmCampaign: "wa_causelist_try_slm", ownerId: "u-nithya", dataSource: "mock",
  },
  {
    id: "cmp-dpdp-webinar", name: "DPDP for law firms — partner webinar", channel: "linkedin", status: "ended",
    objective: "Webinar registrations, then demo follow-up", startDate: "", endDate: "", budget: 110000, startOffset: d(-88), endOffset: d(-52), dailyBudget: 3000,
    audience: "Managing partners and practice managers, Tamil Nadu, firms 6+ lawyers", audienceSize: 9800,
    creative: { format: "Event ad + LinkedIn Live", headline: "DPDP Act: what changes for your client files", body: "A 45-minute session with practising advocates on consent, retention and breach duties for chambers.", cta: "Register free" },
    utmCampaign: "li_dpdp_webinar", ownerId: "u-nithya", dataSource: "mock",
  },
  {
    id: "cmp-retarget-meta", name: "Site retargeting — Meta", channel: "meta", status: "live",
    objective: "Bring back pricing-page visitors", startDate: "", endDate: null, budget: 90000, startOffset: d(-30), endOffset: null, dailyBudget: 2600,
    audience: "Website visitors (consented) last 30 days who viewed /pricing or /demo, excluding customers", audienceSize: 4100,
    creative: { format: "Single video (30s product tour)", headline: "Saw the pricing? See it on your own cases", body: "A 30-second look at the hearing calendar and Ask Nidhi.", cta: "Book a demo" },
    utmCampaign: "meta_retarget_pricing", ownerId: "u-nithya", dataSource: "mock",
  },
];

/** PLACEHOLDER per-seat annual prices (INR) until LAWSOME shares real pricing. */
export const PRICE_PER_SEAT: Record<"Practice" | "Chambers" | "Enterprise", number> = { Practice: 14400, Chambers: 21600, Enterprise: 30000 };

export type FirmSeed = Account;
