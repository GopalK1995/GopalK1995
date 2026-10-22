// Shola Mist Guesthouse (Coonoor, the Nilgiris) — dataset "wg". ALL DATA IS FICTIONAL: invented names, ".example" emails,
// masked phone numbers. Real place names only. Deterministic (seeded), same shapes as the LAWSOME generator so every
// page and metric works unchanged; hospitality specifics live in the optional `stay`, `guestKind`, `interests` fields.
//
// Field reuse (UI relabels): Lead = enquiry, Account = guest/partner, Deal = booking (seats = nights, plan unused).
// Lead stages: new=New enquiry, contacted=Replied, qualified=Dates confirmed, demo_booked=Quote sent, demo_done=Advance pending,
//   proposal=Hold, won=Booked, lost=Lost. Deal stages: discovery=Dates confirmed, demo_scheduled=Quote sent, demo_done=Advance pending,
//   proposal/negotiation=Hold, won=Booked, lost=Lost/cancelled.
// Account.size (FirmSize) = party size: Solo=1-2, 2–5=3-5, 6–20=6-10, 21–50=11-25, 50+=25+. Account.lawyers = typical guests per stay.
import type {
  Account, Activity, ActivityKind, AuditEntry, BookingStay, Campaign, CampaignDay, Channel, ConsentEntry, Dataset, Deal, DealStage,
  FirmSize, Ga4Channel, Ga4Day, Ga4Page, GuestKind, Lead, LeadStage, PrivacyRequest, ScoreFactor, StayInfo, SyncRun, Task, TeamMember, TripType,
} from "../types";
import type { CampaignSeed } from "./catalog";
import { DAY, HOUR, MIN, NOW_ISO, NOW_MS, istAt, istDate, iso, makeRng } from "./seed";
import { buildHospitalityConversations } from "./hospitality-conversations";
import { buildHospitalityIntegrations } from "./hospitality-integrations";

const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const ymd = (ms: number) => new Date(ms + 5.5 * HOUR).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => ymd(new Date(d + "T12:00:00Z").getTime() - 5.5 * HOUR + n * DAY);
const dowOf = (d: string) => new Date(d + "T12:00:00Z").getUTCDay();

export const WG_TEAM: TeamMember[] = [
  { id: "u-kavitha", name: "Kavitha Ramesh", role: "owner", title: "Owner", email: "kavitha@sholamist.example", monthlyTarget: 0 },
  { id: "u-bala", name: "Balamurugan S.", role: "sales_rep", title: "Enquiries & Bookings", email: "bala@sholamist.example", monthlyTarget: 450000 },
  { id: "u-sneha", name: "Sneha Joseph", role: "marketing", title: "Freelance Marketing", email: "sneha@sholamist.example", monthlyTarget: 0 },
  { id: "u-rameshi", name: "Ramesh Iyer", role: "viewer", title: "Manager (read-only)", email: "ramesh@sholamist.example", monthlyTarget: 0 },
];

// Rooms (14 in total) and base nightly rates in INR.
export const ROOMS = { valley: "Valley-view Room", cottage: "Garden Cottage", suite: "Family Suite", heritage: "Heritage Room", loft: "Dorm loft" } as const;
const BASE_RATE: Record<string, number> = { [ROOMS.valley]: 5200, [ROOMS.cottage]: 3500, [ROOMS.suite]: 8200, [ROOMS.heritage]: 6800, [ROOMS.loft]: 4500 };

const FESTIVAL: [string, string, string][] = [
  ["2026-10-02", "2026-10-04", "Gandhi Jayanti long weekend"], ["2026-10-17", "2026-10-21", "Ayudha Puja / Dussehra"],
  ["2026-11-06", "2026-11-10", "Diwali"], ["2026-12-23", "2027-01-02", "Christmas / New Year"], ["2027-01-13", "2027-01-17", "Pongal"],
];
const festivalOn = (d: string) => FESTIVAL.find(([a, b]) => d >= a && d <= b)?.[2];
const rateFor = (room: string, checkIn: string) => {
  const m = Number(checkIn.slice(5, 7));
  let r = BASE_RATE[room] ?? 5200;
  if (festivalOn(checkIn)) r *= 1.25; else if (dowOf(checkIn) === 5 || dowOf(checkIn) === 6) r *= 1.1;
  if (m >= 7 && m <= 9) r *= 0.92; // monsoon lull
  return Math.min(9500, Math.max(3500, Math.round(r / 100) * 100));
};

const LOST_REASONS = [
  "Chose a resort with a pool", "Dates not available (full on the long weekend)", "Wanted under Rs 3,000 a night",
  "Cancelled: ghat-road landslide advisory", "Booked a Kodaikanal stay instead", "Cancelled: family emergency, advance kept as credit",
];

// ------------------------------------------------------------------ campaigns
const camp = (c: Partial<CampaignSeed> & Pick<CampaignSeed, "id" | "name" | "channel" | "utmCampaign" | "creative" | "startOffset" | "dailyBudget" | "budget">): CampaignSeed => ({
  status: "live", objective: "Enquiries for direct bookings", startDate: "", endDate: null, endOffset: null,
  audience: "Weekend travellers, Bengaluru / Chennai / Coimbatore", audienceSize: 120000, ownerId: "u-sneha", dataSource: "mock", ...c,
});
export const WG_CAMPAIGNS: CampaignSeed[] = [
  camp({ id: "cmp-wg-reels", name: "Instagram Reels: Monsoon mist weekends", channel: "meta", utmCampaign: "ig_reels_monsoon", objective: "Weekend enquiries via Instagram DMs", startOffset: -88, endOffset: -22, status: "ended", dailyBudget: 150, budget: 12000, audience: "Couples and friends 24-40, Bengaluru, Chennai, Coimbatore; interests: travel, hill stations", audienceSize: 410000,
    creative: { format: "Instagram Reel (15s)", headline: "Wake up above the clouds", body: "Mist over the Coonoor valley, filter coffee on the verandah, no ghat-road rush. Monsoon weekends at Shola Mist from Rs 3,500 a night.", cta: "Send message" } }),
  camp({ id: "cmp-wg-leadads", name: "Meta lead ads: Bengaluru / Chennai / Coimbatore weekenders", channel: "meta", utmCampaign: "meta_leadads_weekender", startOffset: -60, dailyBudget: 250, budget: 20000, audience: "Families and couples, 28-50, within 6 hours' drive", audienceSize: 560000,
    creative: { format: "Single image + instant form", headline: "Your weekend away starts at 4,000 ft", body: "Five hours from Bengaluru, three from Coimbatore. Garden cottages and valley-view rooms, breakfast included. Tell us your dates and we reply on WhatsApp.", cta: "Get tariff" } }),
  camp({ id: "cmp-wg-pongal", name: "Click-to-WhatsApp: Pongal long weekend", channel: "whatsapp", utmCampaign: "ctwa_pongal_2027", objective: "Pongal 14-17 Jan bookings", startOffset: -14, dailyBudget: 150, budget: 6000, audience: "Families, Chennai, Coimbatore, Tiruppur, Madurai", audienceSize: 220000,
    creative: { format: "Click-to-WhatsApp ad", headline: "Pongal in the hills: 14 to 17 January", body: "Family Suites and Garden Cottages are filling. Message us your dates and number of guests and we quote the same day.", cta: "Message on WhatsApp" } }),
  camp({ id: "cmp-wg-diwali", name: "Repeat-guest Diwali offer (WhatsApp broadcast)", channel: "whatsapp", utmCampaign: "wa_repeat_diwali", objective: "Rebook past guests for Diwali week", startOffset: -9, dailyBudget: 100, budget: 2500, audience: "Past guests who opted in to WhatsApp updates", audienceSize: 420,
    creative: { format: "WhatsApp template broadcast", headline: "Welcome back: Diwali week, 6 to 10 November", body: "Thank you for staying with us before. Repeat guests get 10% off and a bonfire evening on us. Reply YES and we hold your room for 48 hours.", cta: "Reply YES" } }),
  camp({ id: "cmp-wg-gbp", name: "Google Business Profile + Search: homestay in Coonoor", channel: "google_ads", utmCampaign: "gads_coonoor_homestay", objective: "Calls, directions and enquiries from search", startOffset: -85, dailyBudget: 200, budget: 22000, audience: "Searches: homestay in Coonoor, guest house Coonoor, Ooty weekend stay", audienceSize: 38000,
    creative: { format: "Search ad + Business Profile", headline: "Homestay in Coonoor | Shola Mist Guesthouse", body: "14 rooms, home-cooked breakfast, free parking. Book direct and skip OTA fees. Call or WhatsApp.", cta: "Call now" } }),
  camp({ id: "cmp-wg-agents", name: "Travel-agent partner programme (travel agents)", channel: "referral", utmCampaign: "partner_agents_circuit", objective: "Group and circuit nights from agents", startOffset: -75, dailyBudget: 80, budget: 8000, ownerId: "u-sneha", audience: "Tour operators on Ooty-Coonoor-Kodaikanal circuits", audienceSize: 60, dataSource: "csv",
    creative: { format: "Partner rate sheet + WhatsApp group", headline: "A reliable Coonoor night stop on your circuit", body: "Net rates for groups of 8+, 10% commission on confirmed bookings, pickup help from Mettupalayam. Rate sheet on request.", cta: "Request rate sheet" } }),
  camp({ id: "cmp-wg-ota", name: "OTA boost: Booking.com / MakeMyTrip (OTA, commission)", channel: "referral", utmCampaign: "ota_boost_midweek", objective: "Fill midweek gaps; commission-based", startOffset: -80, dailyBudget: 150, budget: 14000, audience: "OTA search traffic, Nilgiris", audienceSize: 90000, dataSource: "csv",
    creative: { format: "OTA listing boost", headline: "Valley-view Room · free cancellation", body: "Visibility boost on Booking.com and MakeMyTrip for midweek dates. Paid as commission; repeat guests are invited to book direct next time.", cta: "Book now" } }),
  camp({ id: "cmp-wg-workation", name: "Workation midweek offer", channel: "meta", utmCampaign: "meta_workation_midweek", objective: "Mon-Thu stays of 4+ nights", startOffset: -30, dailyBudget: 200, budget: 7000, audience: "Remote workers and freelancers, Bengaluru, Chennai, Hyderabad", audienceSize: 190000,
    creative: { format: "Carousel", headline: "Work from the hills: midweek from Rs 3,500 a night", body: "Fibre wifi, a desk with a valley view, weekday rates for 4+ nights. Monday to Thursday stays only.", cta: "Ask about workation" } }),
];

// ------------------------------------------------------------------ people
const FIRST = ["Lakshmi", "Suresh", "Anitha", "Ravi", "Divya", "Karthik", "Meena", "Arvind", "Priya", "Naveen", "Deepa", "Vinod", "Shalini", "Mohan", "Revathi", "Sathish", "Kavya", "Prakash", "Janani", "Harish", "Nithya", "Ganesh", "Sowmya", "Rohit", "Pooja", "Ajay", "Smitha", "Vikram", "Aishwarya", "Manoj", "Bhavana", "Sandeep", "Rekha", "Gautham", "Neha", "Tarun"];
const FAMILIES: [string, string, string][] = [
  ["Narayanan", "Chennai", "Adyar"], ["Rajagopal", "Chennai", "Velachery"], ["Subbiah", "Chennai", "Nungambakkam"], ["Thangavel", "Chennai", "Anna Nagar"], ["Natesan", "Chennai", "Porur"], ["Mehta", "Chennai", "Mylapore"],
  ["Fernandes", "Bengaluru", "Indiranagar"], ["Gowda", "Bengaluru", "Jayanagar"], ["Hegde", "Bengaluru", "Whitefield"], ["Reddy", "Bengaluru", "HSR Layout"], ["Prabhu", "Bengaluru", "Koramangala"], ["Lobo", "Bengaluru", "Frazer Town"], ["Kulkarni", "Bengaluru", "Banashankari"], ["Basu", "Bengaluru", "Marathahalli"],
  ["Menon", "Kochi", "Edappally"], ["Kurian", "Kochi", "Kakkanad"], ["Nambiar", "Kochi", "Panampilly Nagar"], ["Varghese", "Kochi", "Fort Kochi"],
  ["Sundaram", "Coimbatore", "Race Course"], ["Chinnasamy", "Coimbatore", "Peelamedu"], ["Ramanujam", "Coimbatore", "Saibaba Colony"], ["Selvaraj", "Coimbatore", "Singanallur"], ["Abdullah", "Coimbatore", "Podanur"],
  ["Palaniswamy", "Tiruppur", "Kumaran Road"], ["Govindarajan", "Tiruppur", "Avinashi Road"], ["Karthikeyan", "Salem", "Fairlands"], ["Arumugam", "Erode", "Perundurai Road"], ["Chandran", "Madurai", "K.K. Nagar"],
  ["Iyengar", "Hyderabad", "Banjara Hills"], ["Rao", "Hyderabad", "Kondapur"], ["Joshi", "Pune", "Kothrud"], ["Desai", "Mumbai", "Powai"], ["Shetty", "Mangaluru", "Kadri"], ["Balakrishnan", "Puducherry", "White Town"], ["Kapoor", "Bengaluru", "Hebbal"], ["Sebastian", "Kochi", "Vyttila"],
];
const PARTNERS: { name: string; kind: GuestKind; city: string; locality: string; guests: number }[] = [
  { name: "Nilgiri Trails Holidays", kind: "travel_agent", city: "Coimbatore", locality: "Gandhipuram", guests: 14 },
  { name: "Blue Hills Circuit Tours", kind: "travel_agent", city: "Ooty", locality: "Charing Cross", guests: 18 },
  { name: "Ghat Road Journeys", kind: "travel_agent", city: "Mettupalayam", locality: "Bus Stand Road", guests: 12 },
  { name: "Tea Valley Getaways", kind: "travel_agent", city: "Kodaikanal", locality: "Anna Salai", guests: 16 },
  { name: "Western Ghats Escapes", kind: "travel_agent", city: "Kochi", locality: "MG Road", guests: 20 },
  { name: "Southern Circuit Travels", kind: "travel_agent", city: "Chennai", locality: "T. Nagar", guests: 22 },
  { name: "Orchid Analytics (team offsites)", kind: "corporate", city: "Bengaluru", locality: "Bellandur", guests: 18 },
  { name: "Pearl Knitwear Exports", kind: "corporate", city: "Tiruppur", locality: "Mangalam Road", guests: 24 },
  { name: "Meridian Pharma Sales Team", kind: "corporate", city: "Chennai", locality: "Guindy", guests: 30 },
  { name: "Anaimalai Auto Components", kind: "corporate", city: "Coimbatore", locality: "Kuniyamuthur", guests: 16 },
  { name: "Vows & Valleys Events", kind: "wedding_planner", city: "Coimbatore", locality: "R.S. Puram", guests: 60 },
  { name: "Mandap Stories", kind: "wedding_planner", city: "Kochi", locality: "Kaloor", guests: 80 },
];
const SIZE_FOR = (g: number): FirmSize => (g <= 2 ? "Solo" : g <= 5 ? "2–5" : g <= 10 ? "6–20" : g <= 25 ? "21–50" : "50+");

// Enquiry volume by day (monsoon lull Jul-Sep, Oct-Jan peak starting, festival and long-weekend spikes).
function dayWeight(off: number): number {
  const d = istDate(off), m = Number(d.slice(5, 7)), day = Number(d.slice(8, 10));
  let w = m === 7 ? 0.55 : m === 8 ? 0.7 : m === 9 ? 0.9 : 1.3 + day * 0.07;
  if (m === 8 && day >= 8 && day <= 14) w *= 1.8; // Independence Day long weekend
  if (m === 8 && day >= 22 && day <= 26) w *= 1.5; // Onam
  if (m === 9 && day >= 10 && day <= 13) w *= 1.4; // Ganesh Chaturthi weekend
  if ((m === 9 && day >= 28) || (m === 10 && day <= 1)) w *= 1.6; // Gandhi Jayanti long weekend
  if (m === 10 && day >= 6) w *= 1.5; // Dussehra / Diwali planning
  const dow = dowOf(d);
  return w * (dow === 0 || dow === 6 ? 1.15 : 1);
}

export function buildHospitality(): Dataset {
  const rng = makeRng(20261030);
  const TEAM = WG_TEAM;
  const CAMPAIGNS = WG_CAMPAIGNS;
  const campaignById = new Map(CAMPAIGNS.map((c) => [c.id, c]));

  // ---------------------------------------------------------------- accounts (48: 36 families, 6 agents, 4 corporate, 2 wedding planners)
  const accounts: Account[] = [];
  const TRIP_POOL: TripType[] = ["Couples", "Family", "Friends group", "Workation", "Trekking"];
  FAMILIES.forEach(([sn, city, locality], i) => {
    const repeat = i % 3 !== 2 && i < 30; // ~20 repeat families; the rest are first-time
    const guests = rng.weighted([[2, 3], [4, 5], [5, 4], [6, 2], [8, 1]] as const);
    const stays = repeat ? rng.int(2, 6) : 0;
    accounts.push({
      id: `acc-${slug(sn)}-family`, name: `${sn}, ${city}`, city, locality, district: city, courts: [], practiceAreas: [], size: SIZE_FOR(guests), lawyers: guests,
      founded: repeat ? rng.int(2019, 2025) : 2026, website: `${slug(sn)}family.example`, ownerId: "u-bala",
      status: repeat ? (i === 5 || i === 17 ? "churned" : "customer") : "prospect", icpTier: repeat ? (stays >= 4 ? "A" : "B") : "C", arr: repeat ? stays * rng.int(14000, 36000) : 0, lastActivityAt: NOW_ISO,
      guestKind: "family", interests: rng.sample(TRIP_POOL, rng.int(1, 2)), roomsOfInterest: rng.sample([ROOMS.suite, ROOMS.cottage, ROOMS.valley, ROOMS.heritage], rng.int(1, 2)), stays, repeatGuest: repeat,
    });
  });
  PARTNERS.forEach((p, i) => {
    const customer = p.kind === "travel_agent" ? i < 4 : p.kind === "corporate" ? i < 8 : i === 10;
    const stays = customer ? rng.int(3, 12) : 0;
    accounts.push({
      id: `acc-${slug(p.name)}`, name: p.name, city: p.city, locality: p.locality, district: p.city, courts: [], practiceAreas: [], size: SIZE_FOR(p.guests), lawyers: p.guests,
      founded: rng.int(2008, 2022), website: `${slug(p.name).replace(/-/g, "")}.example`, ownerId: p.kind === "travel_agent" ? "u-bala" : "u-kavitha",
      status: customer ? "customer" : "prospect", icpTier: "A", arr: customer ? stays * rng.int(30000, 90000) : 0, lastActivityAt: NOW_ISO,
      guestKind: p.kind,
      interests: p.kind === "wedding_planner" ? ["Wedding & events"] : p.kind === "corporate" ? ["Corporate retreat", "Workation"] : ["Friends group", "Family", "Trekking"],
      roomsOfInterest: p.kind === "travel_agent" ? [ROOMS.valley, ROOMS.cottage, ROOMS.loft] : [ROOMS.loft, ROOMS.cottage, ROOMS.heritage], stays, repeatGuest: customer,
    });
  });
  const famAccounts = accounts.filter((a) => a.guestKind === "family");
  const byKind = (k: GuestKind) => accounts.filter((a) => a.guestKind === k);

  // ---------------------------------------------------------------- enquiries (140)
  const WEIGHTS: [string, number][] = [["cmp-wg-reels", 14], ["cmp-wg-leadads", 18], ["cmp-wg-pongal", 9], ["cmp-wg-diwali", 6], ["cmp-wg-gbp", 15], ["cmp-wg-agents", 7], ["cmp-wg-ota", 14], ["cmp-wg-workation", 8], ["organic", 16], ["referral", 18], ["whatsapp", 15]];
  const UTM: Record<Channel, [string, string]> = {
    linkedin: ["linkedin", "paid_social"], whatsapp: ["whatsapp", "messaging"], email: ["mailchimp", "email"], meta: ["instagram", "paid_social"],
    google_ads: ["google", "cpc"], organic: ["google", "organic"], referral: ["referral", "referral"], event: ["event", "offline"],
  };
  const dayCdf = (lo: number, hi: number) => { const ws: number[] = []; let t = 0; for (let o = lo; o <= hi; o++) { t += dayWeight(o); ws.push(t); } return { ws, t, lo }; };
  const sampleDay = (lo: number, hi: number) => { const { ws, t } = dayCdf(lo, hi); const x = rng.next() * t; const i = ws.findIndex((v) => v >= x); return lo + (i < 0 ? ws.length - 1 : i); };

  const leads: Lead[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < 140; i++) {
    const src = rng.weighted(WEIGHTS);
    const cmp = campaignById.get(src) ?? null;
    const channel: Channel = cmp ? cmp.channel : src === "whatsapp" ? "whatsapp" : (src as Channel);
    // trip type, party and account
    let tripType: TripType; let acc: Account; let guests: number; let nights: number; let room: string;
    const pickFamily = (preferRepeat: boolean) => rng.pick(preferRepeat ? famAccounts.filter((a) => a.repeatGuest && a.status !== "churned") : famAccounts);
    if (src === "cmp-wg-agents") {
      tripType = rng.pick(["Friends group", "Family", "Trekking"]); acc = rng.pick(byKind("travel_agent")); guests = rng.int(8, 24); nights = rng.int(1, 3);
    } else if (src === "cmp-wg-pongal") {
      tripType = "Family"; acc = pickFamily(rng.chance(0.4)); guests = rng.int(4, 9); nights = rng.int(3, 4);
    } else if (src === "cmp-wg-diwali") {
      tripType = rng.pick(["Family", "Family", "Couples"]); acc = pickFamily(true); guests = tripType === "Couples" ? 2 : rng.int(3, 6); nights = rng.int(2, 4);
    } else if (src === "cmp-wg-workation") {
      tripType = "Workation"; acc = pickFamily(rng.chance(0.2)); guests = rng.int(1, 3); nights = rng.int(4, 7);
    } else {
      tripType = rng.weighted([["Couples", 26], ["Family", 34], ["Friends group", 14], ["Workation", 6], ["Wedding & events", 5], ["Corporate retreat", 6], ["Trekking", 6]] as const);
      if (src === "cmp-wg-reels") tripType = rng.weighted([["Couples", 45], ["Friends group", 30], ["Family", 25]] as const);
      if (tripType === "Wedding & events") { acc = rng.pick(byKind("wedding_planner")); guests = rng.int(25, 70); nights = rng.int(2, 3); }
      else if (tripType === "Corporate retreat") { acc = rng.pick(byKind("corporate")); guests = rng.int(12, 32); nights = rng.int(2, 3); }
      else {
        const repeatPref = src === "referral" || src === "whatsapp" ? 0.6 : 0.2;
        acc = pickFamily(rng.chance(repeatPref));
        guests = tripType === "Couples" ? 2 : tripType === "Friends group" ? rng.int(4, 9) : tripType === "Workation" ? rng.int(1, 3) : tripType === "Trekking" ? rng.int(5, 10) : rng.int(3, 7);
        nights = tripType === "Workation" ? rng.int(4, 7) : rng.weighted([[2, 6], [3, 3], [4, 1]] as const);
      }
    }
    room = tripType === "Couples" ? rng.pick([ROOMS.valley, ROOMS.heritage, ROOMS.cottage]) : tripType === "Family" ? (guests >= 4 ? ROOMS.suite : rng.pick([ROOMS.cottage, ROOMS.valley])) : tripType === "Workation" ? rng.pick([ROOMS.valley, ROOMS.cottage])
      : tripType === "Wedding & events" ? rng.pick([ROOMS.heritage, ROOMS.loft]) : ROOMS.loft;
    if (tripType === "Friends group" && guests < 5) room = ROOMS.cottage;
    const rooms = room === ROOMS.loft ? Math.max(1, Math.ceil(guests / 8)) + (tripType === "Wedding & events" ? 3 : 0) : room === ROOMS.suite ? Math.ceil(guests / 5) : Math.ceil(guests / 2);
    // when
    const lo = cmp ? Math.max(cmp.startOffset, -89) : -89;
    const hi = cmp && cmp.endOffset !== null ? cmp.endOffset : 0;
    const dayOff = sampleDay(lo, hi);
    const created = new Date(istAt(dayOff, rng.int(8, 22), rng.int(0, 59))).getTime();
    const createdAt = iso(Math.min(created, NOW_MS - 25 * MIN));
    const cDate = ymd(new Date(createdAt).getTime());
    let checkIn: string;
    if (src === "cmp-wg-pongal") checkIn = `2027-01-${rng.pick(["13", "14", "14", "15"])}`;
    else if (src === "cmp-wg-diwali") checkIn = `2026-11-${rng.pick(["06", "07", "08"])}`;
    else if (tripType === "Workation") checkIn = addDays(cDate, rng.int(7, 40));
    else {
      let lead = rng.weighted([[rng.int(4, 12), 5], [rng.int(13, 30), 4], [rng.int(31, 75), 2]] as const);
      if (cDate >= "2026-10-05" && rng.chance(0.35)) lead = rng.int(10, 40);
      checkIn = addDays(cDate, lead);
      if (rng.chance(0.55)) { const dw = dowOf(checkIn); checkIn = addDays(checkIn, (5 - dw + 7) % 7); }
    }
    const originRepeat = !!acc.repeatGuest && acc.guestKind === "family" && acc.status !== "churned";
    const origin: StayInfo["origin"] = originRepeat ? "repeat" : channel === "referral" && src === "referral" ? "referral" : acc.guestKind !== "family" && acc.repeatGuest ? "repeat" : "new";
    let name = "";
    const surname = acc.guestKind === "family" ? acc.name.split(",")[0] : "";
    do { name = `${rng.pick(FIRST)} ${surname || rng.pick(["Krishnan", "Pillai", "Iyer", "Raghunath", "Menon", "Gupta", "Thomas", "Murugan", "Kannan", "Das"])}`; } while (usedNames.has(name));
    usedNames.add(name);
    const [first, last] = name.split(" ");
    const personal = acc.guestKind === "family" || rng.chance(0.15);
    const email = personal ? `${first.toLowerCase()}.${last.toLowerCase().slice(0, 4)}${rng.int(11, 98)}@mail.example` : `${first.toLowerCase()}@${acc.website}`;
    const stay: StayInfo = {
      checkIn, nights, guests, rooms, room, tripType, origin, flexibleDates: rng.chance(0.3),
      occasion: festivalOn(checkIn) ?? (tripType === "Couples" && rng.chance(0.3) ? "Anniversary" : undefined),
    };
    const title = ({ Couples: "Couple's getaway", Family: "Family trip", "Friends group": "Friends group", Workation: "Workation", "Wedding & events": "Wedding party", "Corporate retreat": "Corporate retreat", Trekking: "Trekking group" } as Record<string, string>)[tripType] + `, ${guests} guest${guests > 1 ? "s" : ""}`;
    const [utmSource, utmMedium] = UTM[channel];
    const lastTouch: Channel = rng.chance(0.65) ? channel : rng.pick(["whatsapp", "organic", "meta"] as Channel[]);
    leads.push({
      id: `EQ-${1001 + i}`, name, title, accountId: acc.id, email, phone: `+91 9${rng.int(1, 9)}xxx xx${rng.int(100, 999)}`, city: acc.city,
      stage: "new", status: "new", ownerId: acc.ownerId, channel, campaignId: cmp?.id ?? null,
      utm: { source: utmSource, medium: utmMedium, campaign: cmp ? cmp.utmCampaign : null },
      firstTouch: channel, lastTouch, createdAt, lastTouchAt: createdAt, firstResponseMins: null, nextActionAt: null, nextAction: null,
      score: 0, scoreFactors: [], consent: { followup: true, marketing: rng.chance(0.55), whatsapp: channel === "whatsapp" || rng.chance(0.7), at: createdAt, noticeVersion: "v1.3" },
      potentialValue: rooms * nights * rateFor(room, checkIn), tags: [], stay,
    });
  }
  leads.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const accOf = (id: string) => accounts.find((a) => a.id === id)!;
  const ageOf = (l: Lead) => (NOW_MS - new Date(l.createdAt).getTime()) / DAY;

  // ---------------------------------------------------------------- stages and deals (30 bookings)
  const shuffled = rng.sample(leads, leads.length);
  const used = new Set<string>();
  const perAcc = new Map<string, number>();
  const take = (pred: (l: Lead) => boolean, n: number, stage: LeadStage, pref?: (l: Lead) => boolean) => {
    const pool = shuffled.filter((l) => !used.has(l.id) && pred(l) && (perAcc.get(l.accountId) ?? 0) < 2);
    const ordered = pref ? [...pool.filter(pref), ...pool.filter((l) => !pref(l))] : pool;
    for (const l of ordered.slice(0, n)) { used.add(l.id); perAcc.set(l.accountId, (perAcc.get(l.accountId) ?? 0) + 1); l.stage = stage; }
  };
  // 22 booked: 12 from repeat/referral guests (about 55%), 10 new guests; 3 lost; 8 open (dates confirmed, quote, advance pending, hold).
  take((l) => ageOf(l) > 6 && l.stay!.origin !== "new", 12, "won");
  take((l) => ageOf(l) > 6 && l.stay!.origin === "new", 10, "won");
  take((l) => ageOf(l) > 5, 3, "lost");
  take((l) => ageOf(l) < 25, 2, "qualified");
  take((l) => ageOf(l) < 22, 2, "demo_booked");
  take((l) => ageOf(l) < 18, 2, "demo_done");
  take((l) => ageOf(l) < 14, 2, "proposal");
  const dealLeadIds = new Set(used);
  for (const l of leads) {
    if (dealLeadIds.has(l.id)) continue;
    const age = ageOf(l), r = rng.next();
    l.stage = age < 2 ? (r < 0.65 ? "new" : "contacted") : age <= 14 ? (r < 0.25 ? "new" : r < 0.65 ? "contacted" : r < 0.93 ? "qualified" : "lost") : (r < 0.1 ? "new" : r < 0.35 ? "contacted" : r < 0.5 ? "qualified" : "lost");
    if (l.stage === "qualified") { /* dates confirmed, quote not yet sent */ }
  }
  const STAGE_ORDER: LeadStage[] = ["new", "contacted", "qualified", "demo_booked", "demo_done", "proposal", "won"];
  for (const l of leads) {
    const age = ageOf(l), acc = accOf(l.accountId), st = l.stage;
    const active = st !== "won" && st !== "lost";
    l.firstResponseMins = st === "new" ? (rng.chance(0.4) ? null : rng.int(8, 160)) : Math.round(Math.exp(rng.float(1.9, 5.6)));
    if (l.channel === "whatsapp" && l.firstResponseMins !== null) l.firstResponseMins = Math.max(2, Math.round(l.firstResponseMins * 0.5));
    const sinceTouch = !active ? rng.float(2, 20) : Math.min(age, rng.float(0.1, st === "new" ? 1.5 : 7));
    l.lastTouchAt = iso(Math.max(new Date(l.createdAt).getTime(), NOW_MS - sinceTouch * DAY));
    l.status = st === "new" ? "new" : st === "contacted" ? ((NOW_MS - new Date(l.lastTouchAt).getTime()) / DAY > 12 ? "nurturing" : "contacted") : st === "qualified" ? "qualified" : st === "lost" ? "disqualified" : "converted";
    if (active) {
      const bucket = rng.weighted([["overdue", 18], ["today", 32], ["soon", 50]] as const);
      l.nextActionAt = bucket === "overdue" ? istAt(-rng.int(1, 3), rng.int(10, 19), rng.pick([0, 30])) : bucket === "today" ? istAt(0, rng.int(9, 18), rng.pick([0, 15, 30, 45])) : istAt(rng.int(1, 6), rng.int(10, 19), rng.pick([0, 30]));
      l.nextAction = ({
        new: rng.pick(["First reply on WhatsApp: confirm dates and room", "Call back: asked for rates over phone", "Reply with tariff PDF within SLA"]),
        contacted: rng.pick(["Ask for check-in date and number of guests", "Share room photos and Valley-view tariff on WhatsApp", "Follow up: went quiet after tariff"]),
        qualified: rng.pick(["Send quote with advance link (40%)", "Check room availability for those dates", "Confirm extra bed and meal plan"]),
        demo_booked: rng.pick(["Follow up on quote: nudge on WhatsApp", "Offer a video walk-through of the rooms", "Quote expires tomorrow: remind guest"]),
        demo_done: rng.pick(["Chase advance payment (Razorpay link)", "Resend UPI link for the advance", "Confirm advance received and block the room"]),
        proposal: rng.pick(["Hold expires in 24 hours: confirm or release", "Confirm hold and arrival time", "Call about group rate for extra rooms"]),
      } as Record<string, string>)[st];
    }
    const adv = STAGE_ORDER.indexOf(st === "lost" ? "contacted" : st);
    const festival = !!festivalOn(l.stay!.checkIn);
    const replied = adv >= 1 && (l.channel === "whatsapp" || rng.chance(0.6));
    const recencyDays = (NOW_MS - new Date(l.lastTouchAt).getTime()) / DAY;
    const quiet = active && recencyDays > 10;
    const stay = l.stay!;
    const factors: ScoreFactor[] = ([
      stay.origin === "repeat" && { label: "Repeat guest", points: 25, detail: `${acc.stays ?? 2} earlier stays` },
      stay.origin === "referral" && { label: "Referral", points: 15, detail: "Came through a past guest" },
      acc.guestKind && acc.guestKind !== "family" && { label: "Partner / group account", points: 15, detail: acc.name },
      festival && { label: "Peak dates", points: 10, detail: festivalOn(stay.checkIn)! },
      stay.rooms >= 3 && { label: "3+ rooms", points: 10, detail: `${stay.rooms} rooms for ${stay.guests} guests` },
      l.channel === "whatsapp" && { label: "Direct on WhatsApp", points: 10, detail: "Messaged the property number" },
      (adv >= 2 || rng.chance(0.3)) && { label: "Dates and guests shared", points: 10, detail: `${stay.nights} nights from ${stay.checkIn}` },
      replied && { label: "Replied to our message", points: 15, detail: "Two-way conversation started" },
      adv >= 3 && { label: "Asked for a quote", points: 10, detail: `${stay.room}` },
      quiet && { label: "No reply in 10 days", points: -15, detail: `Last touch ${Math.round(recencyDays)} days ago` },
      acc.guestKind === "family" && !acc.repeatGuest && l.channel === "referral" && l.campaignId && { label: "OTA enquiry (commission)", points: -5, detail: "Booked through a listing" },
    ].filter(Boolean) as ScoreFactor[]);
    l.scoreFactors = factors;
    l.score = Math.max(0, Math.min(100, factors.reduce((a, f) => a + f.points, 0)));
    l.tags = [stay.origin === "repeat" ? "Repeat guest" : "", festival ? "Festival dates" : "", stay.rooms >= 3 ? "Group" : "", l.campaignId === "cmp-wg-ota" ? "OTA" : "", acc.guestKind === "travel_agent" ? "Travel agent" : "", l.email.endsWith("@mail.example") ? "Personal email" : ""].filter(Boolean);
  }

  const DEAL_FROM: Partial<Record<LeadStage, DealStage[]>> = { qualified: ["discovery"], demo_booked: ["demo_scheduled"], demo_done: ["demo_done"], proposal: ["proposal", "negotiation"], won: ["won"], lost: ["lost"] };
  const PROB: Record<DealStage, number> = { discovery: 0.15, demo_scheduled: 0.35, demo_done: 0.6, proposal: 0.7, negotiation: 0.8, won: 1, lost: 0 };
  const dealLeads = leads.filter((l) => dealLeadIds.has(l.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const deals: Deal[] = dealLeads.map((l, i) => {
    const acc = accOf(l.accountId), stay = l.stay!;
    const stage = DEAL_FROM[l.stage]![i % DEAL_FROM[l.stage]!.length];
    const createdAt = iso(Math.min(new Date(l.createdAt).getTime() + rng.float(0.1, 2) * DAY, NOW_MS - 3 * HOUR));
    let wonAt: string | undefined;
    if (stage === "won") {
      wonAt = iso(Math.min(new Date(createdAt).getTime() + rng.float(1, 6) * DAY, NOW_MS - DAY + rng.int(0, 5) * HOUR));
      const wd = ymd(new Date(wonAt).getTime());
      if (stay.checkIn <= wd) stay.checkIn = addDays(wd, rng.int(3, 24));
      // Recent bookings are mostly for upcoming dates (keeps 30-day forward occupancy realistic for the festival run-up).
      if (wd >= addDays(ymd(NOW_MS), -26) && stay.checkIn < addDays(ymd(NOW_MS), 20) && rng.chance(0.85)) { const c = addDays(ymd(NOW_MS), rng.int(2, 28)); stay.checkIn = rng.chance(0.6) ? addDays(c, (5 - dowOf(c) + 7) % 7) : c; if (stay.checkIn <= wd) stay.checkIn = addDays(wd, 3); }
    }
    const rate = rateFor(stay.room, stay.checkIn);
    const value = rate * stay.rooms * stay.nights;
    const viaOta = l.campaignId === "cmp-wg-ota";
    const advancePct = rng.pick([30, 40, 40, 50]);
    const co = ymd(new Date(stay.checkIn + "T12:00:00Z").getTime());
    const ended = addDays(co, stay.nights) < ymd(NOW_MS);
    const status: BookingStay["status"] = stage === "won" ? (ended ? "completed" : stay.checkIn <= ymd(NOW_MS) ? "checked_in" : "confirmed") : stage === "lost" ? "cancelled" : stage === "proposal" || stage === "negotiation" ? "hold" : "enquiry";
    const bStay: BookingStay = { ...stay, ratePerNight: rate, advancePct, advancePaid: stage === "won" ? Math.round(value * advancePct / 100 / 100) * 100 : stage === "lost" && rng.chance(0.3) ? Math.round(value * 0.3 / 100) * 100 : 0, viaOta, commissionPct: viaOta ? rng.pick([15, 17, 18]) : acc.guestKind === "travel_agent" ? 10 : 0, status };
    return {
      id: `BK-${301 + i}`, name: `${acc.name}: ${stay.room}${stay.rooms > 1 ? ` x${stay.rooms}` : ""}, ${stay.nights} nights`, accountId: acc.id, leadId: l.id, ownerId: l.ownerId,
      stage, value, seats: stay.nights, plan: "Practice", probability: PROB[stage], createdAt, stageEnteredAt: wonAt ?? iso(NOW_MS - rng.int(1, 9) * DAY - rng.int(0, 8) * HOUR),
      expectedClose: stage === "won" ? wonAt! : istAt(rng.int(2, 14), 17), wonAt, lostReason: stage === "lost" ? LOST_REASONS[i % LOST_REASONS.length] : undefined, stay: bStay,
    } satisfies Deal;
  });
  deals.sort((a, b) => a.id.localeCompare(b.id));
  // ---- forward occupancy plan: CRM bookings fill the next weeks, Diwali weekend (7-9 Nov) near full, shoulders moderate.
  {
    const todayS = ymd(NOW_MS), N = 39; // nights today .. today+38
    const occ = new Array<number>(N).fill(0);
    const nightIdx = (d: string) => Math.round((new Date(d + "T12:00:00Z").getTime() - new Date(todayS + "T12:00:00Z").getTime()) / DAY);
    const target = (n: number) => { const d = addDays(todayS, n); if (d >= "2026-11-06" && d <= "2026-11-10") return 13; if (n >= 30) return 6; if (d >= "2026-11-02" && d < "2026-11-06") return 9; const w = dowOf(d); return w === 5 || w === 6 ? 11 : 8; };
    const apply = (d: Deal, rooms: number, nights: number, checkIn: string) => {
      const st = d.stay!, l = leads.find((x) => x.id === d.leadId)!;
      if (rooms !== st.rooms || nights !== st.nights) {
        st.guests = Math.max(st.guests, rooms * 2 + rng.int(0, 1));
        if (st.tripType === "Couples" || st.tripType === "Workation") st.tripType = rooms >= 4 ? "Friends group" : "Family";
        if (rooms > 2 && st.room === ROOMS.suite) st.room = ROOMS.valley;
        if (rooms > 2 && st.room === ROOMS.heritage) st.room = ROOMS.cottage;
      }
      st.rooms = rooms; st.nights = nights; st.checkIn = checkIn; d.seats = nights;
      const rate = rateFor(st.room, checkIn); st.ratePerNight = rate; d.value = rate * rooms * nights;
      st.advancePaid = Math.round(d.value * st.advancePct / 100 / 100) * 100;
      const ended = addDays(checkIn, nights) < todayS;
      st.status = ended ? "completed" : checkIn <= todayS ? "checked_in" : "confirmed";
      const acc = accOf(d.accountId);
      d.name = `${acc.name}: ${st.room}${rooms > 1 ? ` x${rooms}` : ""}, ${nights} nights`;
      const tt = ({ Couples: "Couple's getaway", Family: "Family trip", "Friends group": "Friends group", Workation: "Workation", "Wedding & events": "Wedding party", "Corporate retreat": "Corporate retreat", Trekking: "Trekking group" } as Record<string, string>)[st.tripType as string];
      l.title = `${tt}, ${st.guests} guest${st.guests > 1 ? "s" : ""}`;
      l.stay = { ...st }; l.potentialValue = d.value;
    };
    const place = (d: Deal, rooms: number, nights: number, checkIn: string) => { apply(d, rooms, nights, checkIn); const i0 = nightIdx(checkIn); for (let k = 0; k < nights; k++) if (i0 + k >= 0 && i0 + k < N) occ[i0 + k] += rooms; };
    const won = deals.filter((d) => d.stage === "won").sort((a, b) => a.wonAt!.localeCompare(b.wonAt!));
    won.slice(0, 5).forEach((d) => { // completed stays from the lean season
      const nights = d.stay!.nights, wd = ymd(new Date(d.wonAt!).getTime());
      let ci = addDays(wd, rng.int(4, 20)); if (ci > addDays(todayS, -nights - 2)) ci = addDays(todayS, -nights - rng.int(2, 6));
      if (ci <= wd) ci = addDays(wd, 2);
      apply(d, d.stay!.rooms, nights, ci);
    });
    const fwd = won.slice(5);
    const anchors: [number, string, number][] = [[3, "2026-11-06", 4], [3, "2026-11-06", 4], [3, "2026-11-07", 3], [3, "2026-11-07", 3], [1, "2026-11-07", 4]];
    fwd.slice(0, anchors.length).forEach((d, i) => place(d, anchors[i][0], anchors[i][2], anchors[i][1]));
    fwd.slice(anchors.length).sort((a, b) => (a.wonAt! < "2026-10-01" ? 0 : 1) - (b.wonAt! < "2026-10-01" ? 0 : 1) || b.value - a.value).forEach((d) => {
      const wd = ymd(new Date(d.wonAt!).getTime()), recent = wd >= "2026-10-01"; // recent wins are small, earlier festival bookings are big groups
      const rooms = recent ? rng.int(3,3) : rng.int(7,8), nights = recent ? rng.int(3,4) : 5;
      let bestI = -1, bestScore = -1e9;
      for (let i0 = Math.max(0, nightIdx(addDays(wd, 2))); i0 <= 36; i0++) {
        let ok = true, score = 0;
        for (let k = 0; k < nights; k++) { const n = i0 + k; if (n >= N || occ[n] + rooms > 14) { ok = false; break; } if (target(n) === 13) { ok = false; break; } score += Math.min(rooms, Math.max(0, target(n) - occ[n])) - Math.max(0, occ[n] + rooms - target(n)) * 0.6; }
        if (ok && score > bestScore) { bestScore = score; bestI = i0; }
      }
      if (bestI < 0) bestI = 12;
      place(d, rooms, nights, addDays(todayS, bestI));
    });
    // Open deals: quotes expiring, holds ending, advances due this week (tasks below come from these next actions).
    for (const d of deals) {
      const l = leads.find((x) => x.id === d.leadId)!;
      if (d.stage === "demo_done") { l.nextAction = `Collect advance (Razorpay link): Rs ${(Math.round(d.value * (d.stay!.advancePct) / 100 / 100) * 100).toLocaleString("en-IN")} due`; l.nextActionAt = istAt(rng.int(0, 3), 11, 30); }
      if (d.stage === "proposal" || d.stage === "negotiation") { l.nextAction = "Hold expires in 24 hours: confirm or release"; l.nextActionAt = istAt(rng.int(0, 1), 16); }
      if (d.stage === "demo_scheduled") { l.nextAction = "Quote expires tomorrow: remind guest on WhatsApp"; l.nextActionAt = istAt(rng.int(0, 2), 12); }
    }
  }
  for (const dl of deals) {
    const acc = accOf(dl.accountId), l = leads.find((x) => x.id === dl.leadId)!;
    const { ratePerNight: _r, advancePct: _a, advancePaid: _p, viaOta: _v, commissionPct: _c, status: _s, ...base } = dl.stay!; l.stay = { ...l.stay!, ...base };
    l.potentialValue = dl.value;
    if (dl.stage === "won") { acc.status = "customer"; acc.arr += dl.value; acc.repeatGuest = acc.repeatGuest ?? false; acc.stays = (acc.stays ?? 0) + 1; }
    else if ((dl.stage === "proposal" || dl.stage === "negotiation") && acc.status === "prospect") acc.status = "trial";
  }

  // ---------------------------------------------------------------- activities
  const acts: Activity[] = [];
  let actN = 0;
  const pushAct = (leadId: string, kind: ActivityKind, at: number, title: string, detail?: string, byId?: string) => {
    if (at > NOW_MS) return;
    acts.push({ id: `ac-${++actN}`, leadId, kind, at: iso(at), title, detail, byId });
  };
  const CH_LABEL: Record<Channel, string> = { linkedin: "ad", whatsapp: "WhatsApp message to the property number", email: "email", meta: "Instagram ad", google_ads: "Google search ad", organic: "Google Business Profile listing", referral: "referral / listing", event: "event" };
  const STAGE_NAME: Record<LeadStage, string> = { new: "New enquiry", contacted: "Replied", qualified: "Dates confirmed", demo_booked: "Quote sent", demo_done: "Advance pending", proposal: "Hold", won: "Booked", lost: "Lost" };
  for (const l of leads) {
    const c0 = new Date(l.createdAt).getTime(), stay = l.stay!, first = l.name.split(" ")[0];
    const cmp = l.campaignId ? campaignById.get(l.campaignId) : null;
    const deal = deals.find((d) => d.leadId === l.id);
    pushAct(l.id, "ad_click", c0 - rng.int(3, 40) * MIN, `Came from ${CH_LABEL[l.channel]}`, cmp ? `Campaign: ${cmp.name}` : undefined);
    pushAct(l.id, "page_view", c0 - rng.int(1, 3) * MIN, rng.pick(["Viewed /rooms/valley-view", "Viewed /tariff", "Viewed /rooms/family-suite", "Viewed /offers/pongal", "Viewed /gallery"]));
    pushAct(l.id, "form_submit", c0, l.channel === "meta" ? "Submitted Instagram instant form" : l.channel === "whatsapp" ? "First WhatsApp message received" : "Submitted enquiry form", `${l.title} · ${stay.rooms} room(s) · from ${stay.checkIn}, ${stay.nights} nights`);
    const idx = STAGE_ORDER.indexOf(l.stage === "lost" ? "contacted" : l.stage);
    let t = c0 + (l.firstResponseMins ?? 60) * MIN;
    if (l.firstResponseMins !== null) {
      if (rng.chance(0.45)) pushAct(l.id, "call", t, `Call · ${rng.int(3, 11)} min`, `Spoke to ${first}. ${rng.pick(["Wants a quiet room away from the road.", "Asked about the drive up the ghat road.", "Travelling with two children and a grandparent.", "Wants to know if breakfast is included."])}`, l.ownerId);
      else pushAct(l.id, "whatsapp_out", t, "WhatsApp reply sent with tariff", "Vanakkam, thank you for writing to Shola Mist. Sharing room photos and rates for your dates.", l.ownerId);
    }
    if (idx >= 1) { t += rng.float(0.05, 1.2) * DAY; pushAct(l.id, "whatsapp_in", t, `${first} replied on WhatsApp`, rng.pick(["Is the Family Suite free on those dates?", "Can you do a lower rate for 3 nights?", "Is there parking and a pickup from Mettupalayam?", "Please send the Tamil menu and room photos."])); pushAct(l.id, "stage_change", t + 20 * MIN, `Stage: ${STAGE_NAME.new} → ${STAGE_NAME.contacted}`, undefined, l.ownerId); }
    if (idx >= 2) { t += rng.float(0.3, 2) * DAY; pushAct(l.id, "note", t, "Dates confirmed", `${stay.guests} guests, ${stay.rooms} room(s), ${stay.checkIn} for ${stay.nights} nights`, l.ownerId); pushAct(l.id, "stage_change", t + HOUR, `Stage: ${STAGE_NAME.contacted} → ${STAGE_NAME.qualified}`, undefined, l.ownerId); }
    if (idx >= 3) { t += rng.float(0.2, 1.5) * DAY; pushAct(l.id, "proposal_sent", t, `Quote sent: Rs ${(deal?.value ?? l.potentialValue).toLocaleString("en-IN")}`, `${stay.room}, ${stay.nights} nights, ${deal?.stay?.advancePct ?? 40}% advance to confirm`, l.ownerId); }
    if (idx >= 4) { t += rng.float(0.3, 2) * DAY; pushAct(l.id, "email_sent", t, "Advance payment link sent", "Razorpay link, valid 48 hours", l.ownerId); }
    if (idx >= 5) { t += rng.float(0.2, 1) * DAY; pushAct(l.id, "note", t, "Dates held for 48 hours", "Room blocked on the calendar until the advance arrives", l.ownerId); }
    if (l.stage === "won") pushAct(l.id, "stage_change", new Date(deal?.wonAt ?? l.lastTouchAt).getTime(), "Stage: Hold → Booked", `Advance of Rs ${(deal?.stay?.advancePaid ?? 0).toLocaleString("en-IN")} received on Razorpay`, l.ownerId);
    if (l.stage === "lost") pushAct(l.id, "stage_change", new Date(l.lastTouchAt).getTime(), "Stage → Lost", deal?.lostReason ?? rng.pick(LOST_REASONS), l.ownerId);
    if (rng.chance(0.35)) pushAct(l.id, "note", new Date(l.lastTouchAt).getTime() - 30 * MIN, "Note", rng.pick(["Vegetarian household; breakfast only.", "Celebrating a 25th anniversary, wants a quiet table.", "Asked if the Dorm loft can sleep 10 with mattresses.", "Prefers calls after 7 pm.", "Arriving late by the Mettupalayam road; keep dinner warm."]), l.ownerId);
  }
  acts.sort((a, b) => b.at.localeCompare(a.at));
  for (const a of accounts) {
    const ids = new Set(leads.filter((l) => l.accountId === a.id).map((l) => l.id));
    a.lastActivityAt = acts.find((x) => ids.has(x.leadId))?.at ?? istAt(-rng.int(40, 85), 12);
  }

  // ---------------------------------------------------------------- campaign daily metrics
  const CH_RATES: Record<string, { cpm: number; ctr: number; reachPerImp: number; eng: number }> = {
    meta: { cpm: 95, ctr: 0.014, reachPerImp: 0.4, eng: 0.034 },
    google_ads: { cpm: 0, ctr: 0.062, reachPerImp: 0.8, eng: 0.07 },
    whatsapp: { cpm: 0, ctr: 0.22, reachPerImp: 0.97, eng: 0.34 },
    referral: { cpm: 0, ctr: 0.045, reachPerImp: 0.7, eng: 0.05 },
  };
  const campaignDays: CampaignDay[] = [];
  for (const c of CAMPAIGNS) {
    const end = c.endOffset ?? 0;
    for (let off = c.startOffset; off <= end; off++) {
      const date = istDate(off), dow = dowOf(date);
      const wk = dow === 0 ? 0.85 : dow === 6 ? 1.2 : dow === 5 ? 1.1 : 1;
      const rate = CH_RATES[c.channel];
      const spend = Math.round(c.dailyBudget * wk * rng.float(0.82, 1.12));
      let impressions: number;
      if (c.channel === "google_ads") impressions = Math.round(spend / rng.float(14, 20) / rate.ctr);
      else if (c.channel === "whatsapp") impressions = Math.max(c.audienceSize < 1000 ? 0 : 1, Math.round(c.audienceSize < 1000 ? (off === c.startOffset ? c.audienceSize * 0.93 : off === c.startOffset + 4 ? c.audienceSize * 0.3 : 0) : spend / rng.float(0.8, 0.95)));
      else if (c.channel === "referral") impressions = Math.round(spend * (c.audienceSize < 1000 ? rng.float(0.25, 0.5) : rng.float(4, 7)));
      else impressions = Math.round((spend / rate.cpm) * 1000);
      const clicks = Math.round(impressions * rate.ctr * rng.float(0.85, 1.15));
      const crmLeads = leads.filter((l) => l.campaignId === c.id && l.createdAt.slice(0, 10) === date).length;
      campaignDays.push({ campaignId: c.id, date, spend, impressions, reach: Math.round(impressions * rate.reachPerImp), clicks, platformLeads: crmLeads + (rng.chance(0.06) ? 1 : 0), engagements: Math.round(impressions * rate.eng * rng.float(0.8, 1.2)) });
    }
  }
  const campaigns: Campaign[] = CAMPAIGNS.map(({ startOffset, endOffset, dailyBudget: _d, ...c }) => ({ ...c, startDate: istDate(startOffset), endDate: endOffset === null ? null : istDate(endOffset) }));

  // ---------------------------------------------------------------- GA4 (base ~260 sessions/day)
  const SHARE: Record<Ga4Channel, number> = { "Organic Search": 0.33, "Paid Search": 0.1, "Paid Social": 0.26, Email: 0.02, Direct: 0.21, Referral: 0.08 };
  const ga4: Ga4Day[] = [];
  for (let off = -89; off <= 0; off++) {
    const date = istDate(off), dow = dowOf(date);
    const season = 0.75 + Math.min(1, dayWeight(off) / 2.4) * 0.55;
    const wk = dow === 0 ? 1.1 : dow === 6 ? 1.15 : dow === 5 ? 1.05 : 0.92;
    const sessions = Math.round(260 * season * wk * rng.float(0.9, 1.1) * (off === 0 ? 0.45 : 1));
    const byChannel = {} as Record<Ga4Channel, number>;
    let left = sessions;
    (Object.keys(SHARE) as Ga4Channel[]).forEach((ch, i, arr) => {
      const v = i === arr.length - 1 ? left : Math.round(sessions * SHARE[ch] * rng.float(0.86, 1.14));
      byChannel[ch] = Math.max(0, Math.min(v, left)); left -= byChannel[ch];
    });
    const mobile = Math.round(sessions * rng.float(0.72, 0.8)), tablet = Math.round(sessions * 0.02);
    ga4.push({ date, sessions, users: Math.round(sessions * 0.82), engagedSessions: Math.round(sessions * rng.float(0.5, 0.6)), avgEngagementSecs: Math.round(rng.float(55, 78)),
      keyEvents: leads.filter((l) => l.createdAt.slice(0, 10) === date && l.channel !== "meta" && l.channel !== "whatsapp").length + (rng.chance(0.25) ? 1 : 0), byChannel, byDevice: { mobile, tablet, desktop: sessions - mobile - tablet } });
  }
  const totalSessions = ga4.reduce((a, d) => a + d.sessions, 0);
  const ga4Pages: Ga4Page[] = ([
    ["/", "Shola Mist Guesthouse, Coonoor", 0.3, 0.5, 44, 22], ["/rooms/valley-view", "Valley-view Room", 0.13, 0.66, 92, 18], ["/tariff", "Tariff and seasons", 0.11, 0.7, 78, 24],
    ["/book", "Book or enquire", 0.1, 0.8, 70, 41], ["/rooms/family-suite", "Family Suite", 0.08, 0.64, 88, 11], ["/offers/pongal", "Pongal long weekend offer", 0.06, 0.62, 60, 14],
    ["/rooms/garden-cottage", "Garden Cottage", 0.06, 0.63, 84, 8], ["/offers/workation", "Workation midweek offer", 0.05, 0.6, 96, 6], ["/things-to-do/coonoor", "Things to do around Coonoor", 0.07, 0.58, 126, 3], ["/gallery", "Photo gallery", 0.04, 0.55, 74, 2],
  ] as [string, string, number, number, number, number][]).map(([path, title, share, er, secs, conv]) => ({ path, title, sessions: Math.round(totalSessions * share * rng.float(0.95, 1.05)), engagementRate: er, avgSecs: secs, conversions: conv }));

  // ---------------------------------------------------------------- tasks
  const tasks: Task[] = [];
  let tN = 0;
  for (const l of leads.filter((x) => x.nextActionAt && x.nextAction)) {
    const a = l.nextAction!.toLowerCase();
    const kind: Task["kind"] = a.includes("video") ? "demo" : a.includes("whatsapp") || a.includes("nudge") ? "whatsapp" : a.includes("quote") || a.includes("advance") || a.includes("hold") || a.includes("tariff") ? "proposal" : a.includes("call") ? "call" : "follow_up";
    tasks.push({ id: `T-${++tN}`, leadId: l.id, dealId: deals.find((d) => d.leadId === l.id)?.id ?? null, title: l.nextAction!, kind, ownerId: l.ownerId, dueAt: l.nextActionAt!, status: "open", priority: l.score >= 60 ? "high" : l.score < 25 ? "low" : "normal" });
  }
  for (let i = 0; i < 14; i++) {
    const l = leads[(i * 7) % leads.length];
    tasks.push({ id: `T-${++tN}`, leadId: l.id, dealId: null, title: rng.pick(["Logged call outcome", "Sent room photos on WhatsApp", "Sent quote PDF", "Sent advance reminder"]), kind: rng.pick(["call", "email", "whatsapp"] as const), ownerId: l.ownerId, dueAt: istAt(-rng.int(0, 3), rng.int(9, 18)), status: "done", priority: "normal" });
  }
  // Arrivals this week appear on the calendar strip as site visit / call tasks.
  deals.filter((d) => d.stage === "won" && d.stay && d.stay.checkIn >= ymd(NOW_MS) && d.stay.checkIn <= addDays(ymd(NOW_MS), 7)).forEach((d, i) => {
    tasks.push({ id: `T-${++tN}`, leadId: d.leadId, dealId: d.id, title: `Arrival: ${accOf(d.accountId).name}, ${d.stay!.room}`, kind: "demo", ownerId: d.ownerId, dueAt: istAt(Math.max(0, Math.round((new Date(d.stay!.checkIn + "T12:00:00Z").getTime() - NOW_MS) / DAY)), 14, i % 2 ? 30 : 0), status: "open", priority: "high" });
  });

  // ---------------------------------------------------------------- consent, privacy, audit, sync
  const consent: ConsentEntry[] = [];
  let cN = 0;
  for (const l of leads) {
    const via = l.channel === "meta" ? "Instagram instant form" : l.channel === "whatsapp" ? "WhatsApp first message" : l.channel === "referral" && !l.campaignId ? "Phone call (verbal, noted)" : "Website enquiry form";
    consent.push({ id: `CN-${++cN}`, leadId: l.id, purpose: "demo_followup", action: "granted", noticeVersion: l.consent.noticeVersion, via, at: l.createdAt });
    if (l.consent.marketing) consent.push({ id: `CN-${++cN}`, leadId: l.id, purpose: "marketing_email", action: "granted", noticeVersion: l.consent.noticeVersion, via: "Enquiry form checkbox", at: l.createdAt });
    if (l.consent.whatsapp) consent.push({ id: `CN-${++cN}`, leadId: l.id, purpose: "whatsapp", action: "granted", noticeVersion: l.consent.noticeVersion, via: "WhatsApp opt-in reply", at: iso(new Date(l.createdAt).getTime() + 2 * HOUR) });
  }
  for (const l of leads.filter((_, i) => i % 19 === 4)) consent.push({ id: `CN-${++cN}`, leadId: l.id, purpose: "whatsapp", action: "withdrawn", noticeVersion: "v1.3", via: "Replied STOP to broadcast", at: iso(NOW_MS - rng.int(1, 20) * DAY) });
  consent.sort((a, b) => b.at.localeCompare(a.at));
  const privacyRequests: PrivacyRequest[] = [
    { id: "PR-006", leadId: leads[17].id, kind: "erasure", receivedAt: istAt(-6, 11), dueAt: istAt(24, 11), status: "in_progress" },
    { id: "PR-005", leadId: leads[42].id, kind: "withdrawal", receivedAt: istAt(-9, 15), dueAt: istAt(21, 15), status: "open" },
    { id: "PR-004", leadId: leads[63].id, kind: "access", receivedAt: istAt(-19, 10), dueAt: istAt(11, 10), status: "open" },
    { id: "PR-003", leadId: leads[88].id, kind: "erasure", receivedAt: istAt(-41, 12), dueAt: istAt(-11, 12), status: "done" },
    { id: "PR-002", leadId: leads[101].id, kind: "withdrawal", receivedAt: istAt(-57, 16), dueAt: istAt(-27, 16), status: "done" },
  ];
  const bk = deals.find((d) => d.stage === "won")?.id ?? "BK-301";
  const AUDIT: [string, string, string][] = [
    ["u-bala", "Moved booking to Hold", deals.find((d) => d.stage === "proposal" || d.stage === "negotiation")?.id ?? "BK-320"],
    ["u-sneha", "Ran CSV import", "Meta Instant Form export (23 rows, 1 rejected)"],
    ["u-kavitha", "Changed role", "Ramesh Iyer: Viewer (unchanged scope)"],
    ["u-sneha", "Paused campaign", "Instagram Reels: Monsoon mist weekends"],
    ["u-bala", "Imported WhatsApp chat export", "Tamil enquiries, 11 conversations"],
    ["u-kavitha", "Exported CSV", "Consent log (access request PR-004)"],
    ["u-bala", "Logged call", leads[3].id],
    ["u-sneha", "Ran CSV import", "Google Business Profile insights (28 days)"],
    ["u-kavitha", "Updated branding", "Accent hue 152, monogram S"],
    ["u-bala", "Confirmed advance", bk],
    ["u-sneha", "Approved WhatsApp template", "diwali_repeat_guest_en"],
    ["u-kavitha", "Completed erasure", "PR-003 (guest record deleted after 30-day hold)"],
  ];
  const audit: AuditEntry[] = AUDIT.map(([actorId, action, target], i) => ({ id: `AU-${700 - i}`, at: iso(NOW_MS - (i * 9.3 + 0.4) * HOUR), actorId, action, target, ip: `10.31.${(i * 37) % 255}.${(i * 91) % 255}` }));
  const syncRuns: SyncRun[] = [];
  const SYNC_SET: [string, number, number][] = [["ga4", 24, 0], ["whatsapp", 6, 0], ["meta-ads", 12, 1], ["google-ads", 24, 0], ["booking-com", 6, 1], ["makemytrip", 12, 0], ["razorpay", 3, 0], ["mailchimp", 24, 0], ["gmail", 3, 0]];
  let sN = 0;
  for (let h = 0; h < 72; h += 3) {
    for (const [id, every, rej] of SYNC_SET) {
      if (h % every !== 0) continue;
      const failed = id === "makemytrip" && h === 24;
      syncRuns.push({ id: `SR-${6000 + ++sN}`, integrationId: id, startedAt: iso(NOW_MS - h * HOUR - rng.int(5, 40) * MIN), durationSecs: rng.int(3, 80), status: failed ? "failed" : rej && rng.chance(0.4) ? "partial" : "success", rowsIn: failed ? 0 : rng.int(id === "ga4" ? 70 : 1, id === "ga4" ? 110 : 30), rowsRejected: failed ? 0 : rej ? rng.int(0, rej) : 0,
        note: failed ? "Extranet session expired: reconnect required" : id === "meta-ads" ? "Instant-form leads (CSV bridge)" : id === "booking-com" ? "Reservations feed: new and modified bookings" : "OK" });
    }
  }
  syncRuns.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const conversations = buildHospitalityConversations(leads, accounts, deals);
  const integrations = buildHospitalityIntegrations(syncRuns);
  return { now: NOW_ISO, team: TEAM, accounts, leads, activities: acts, deals, campaigns, campaignDays, ga4, ga4Pages, tasks, conversations, integrations, consent, privacyRequests, audit, syncRuns };
}
