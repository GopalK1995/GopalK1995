// Firm-level derivations for /accounts. Pure functions over Account (server-safe).
// Sites, clerks and current tools are not on the Account type yet; they are derived deterministically from the
// firm record until the `account_sites` table is wired (requested from BUILD).
import type { Account, Deal } from "@/lib/data/types";

const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

/** Court focus chips (spec: Madras HC, Madurai Bench, City Civil, District, Tribunals). */
export function courtFocus(courts: string[]): string[] {
  const out = new Set<string>();
  for (const c of courts) {
    if (/Madurai Bench/i.test(c)) out.add("Madurai Bench");
    else if (/High Court/i.test(c)) out.add(c.replace(/\s*High Court.*/i, " HC"));
    else if (/City Civil/i.test(c)) out.add("City Civil Court");
    else if (/NCLT|Tribunal|DRT/i.test(c)) out.add("Tribunals");
    else out.add("District courts");
  }
  return [...out];
}
export const COURT_FILTERS = ["Madras HC", "Madurai Bench", "City Civil Court", "District courts", "Tribunals", "Kerala HC"];

export type Site = { label: string; hq?: boolean; note?: string };
export function firmSites(a: Account): Site[] {
  const h = hash(a.id);
  const sites: Site[] = [{ label: `${a.locality}, ${a.city}`, hq: true }];
  const hasBench = a.courts.some((c) => /Madurai Bench/i.test(c));
  const hasHc = a.courts.some((c) => /High Court/i.test(c) && !/Madurai Bench/i.test(c));
  if (a.lawyers >= 16 || (a.lawyers >= 8 && h % 3 === 0)) {
    if (a.city === "Chennai") sites.push(hasBench || h % 2 ? { label: "Madurai", note: "near Madurai Bench" } : { label: "Coimbatore", note: "district court practice" });
    else if (hasHc && a.city !== "Chennai") sites.push({ label: "Chennai", note: "near Madras High Court" });
    else sites.push({ label: `${a.district} district court complex`, note: "chamber annexe" });
  }
  if (a.lawyers >= 42) sites.push({ label: "Tiruchirappalli", note: "satellite office" });
  return sites;
}
export const clerksFor = (a: Account) => Math.max(1, Math.round(a.lawyers * 0.35));
const TOOLS = ["Excel diary + WhatsApp groups", "Paper diary + cause-list forwards", "Generic case-diary app (renews in March)", "Google Sheets shared by juniors"];
const TOOL_PHRASE = ["an Excel diary and WhatsApp groups", "a paper diary and cause-list forwards", "a generic case-diary app", "Google Sheets shared by juniors"];
export const currentTools = (a: Account) => TOOLS[hash(a.id) % TOOLS.length];
export const hearingsPerMonth = (a: Account) => Math.max(10, Math.round((a.lawyers * 11) / 10) * 10);

export type Plan = "Practice" | "Chambers" | "Enterprise";
export const planFor = (seats: number): Plan => (seats >= 20 ? "Enterprise" : seats >= 7 ? "Chambers" : "Practice");

/** Per-seat annual price observed on this workspace's deals (placeholder prices until LAWSOME shares pricing). */
export function seatPrices(deals: Deal[]): Record<Plan, number> {
  const out = { Practice: 14400, Chambers: 21600, Enterprise: 30000 } as Record<Plan, number>;
  for (const p of Object.keys(out) as Plan[]) {
    const ds = deals.filter((d) => d.plan === p && d.seats > 0);
    if (ds.length) out[p] = Math.round(ds.reduce((a, d) => a + d.value / d.seats, 0) / ds.length);
  }
  return out;
}

export function fitNotes(a: Account): string[] {
  const n = hearingsPerMonth(a), courts = a.courts.length;
  const notes = [`Tracks about ${n} hearings a month across ${courts} court${courts > 1 ? "s" : ""} in ${TOOL_PHRASE[hash(a.id) % TOOLS.length]}.`];
  if (a.courts.some((c) => /Madurai Bench/i.test(c))) notes.push("Madurai Bench listings are the main pain: juniors forward the cause list on WhatsApp each evening.");
  else if (a.courts.some((c) => /High Court/i.test(c))) notes.push("Regular Madras High Court practice, our strongest module (cause-list sync at 7 am and 7 pm).");
  else notes.push("District-court practice only: lead with eCourts sync, not High Court alerts.");
  if (firmSites(a).length > 1) notes.push(`${firmSites(a).length} sites: one shared calendar across offices is the opening.`);
  if (a.practiceAreas.includes("Corporate") || a.practiceAreas.includes("Tax")) notes.push("Corporate/tax work: billing in INR with GST invoices will come up.");
  return notes;
}

export const STATUS_LABEL: Record<Account["status"], string> = { prospect: "Prospect", trial: "Trial", customer: "Customer", churned: "Churned" };
export const STATUS_TONE: Record<Account["status"], "outline" | "accent" | "success" | "danger"> = { prospect: "outline", trial: "accent", customer: "success", churned: "danger" };
export const shortCity = (c: string) => (c === "Tiruchirappalli" ? "Trichy" : c);
