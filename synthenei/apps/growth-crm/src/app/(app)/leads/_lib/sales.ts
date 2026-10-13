// Page-local helpers shared by the SALES routes (/leads, /leads/[id], /pipeline, /tasks).
// Pure functions only (no server or client APIs) so both server pages and client components can import them.
import type { Account, Lead, Role, TeamMember } from "@/lib/data/types";

export const DAY = 86400e3;

/** Score bands as in spec 6.4 (M51): 0-39, 40-69, 70-100. */
export type Band = "hot" | "warm" | "cool";
export const BAND_LABEL: Record<Band, string> = { hot: "Hot (70–100)", warm: "Warm (40–69)", cool: "Cool (0–39)" };
export const bandOf = (score: number): Band => (score >= 70 ? "hot" : score >= 40 ? "warm" : "cool");

export const isOpenLead = (l: Lead) => l.stage !== "won" && l.stage !== "lost";
export const shortCity = (c: string) => (c === "Tiruchirappalli" ? "Trichy" : c);

/** Saved views on /leads (spec 5). */
export const VIEWS = [
  { key: "mine", label: "My open leads" },
  { key: "unassigned", label: "Unassigned" },
  { key: "today", label: "New today" },
  { key: "sla", label: "SLA breached" },
  { key: "hot", label: "Hot (70+)" },
  { key: "all", label: "All" },
] as const;
export type ViewKey = (typeof VIEWS)[number]["key"];
export const defaultView = (role: Role): ViewKey => (role === "sales_rep" ? "mine" : "all");

export type Result = { ok: boolean; message: string; sub?: string };

/** Ownership rule for "O" actions (spec 10.3): reps act on their own records only. */
export const ownsOrManages = (role: Role, uid: string, ownerId: string | null | undefined) =>
  role === "owner" || role === "sales_manager" || (role === "sales_rep" && ownerId === uid);

export const memberName = (team: TeamMember[], id: string | null | undefined) => team.find((t) => t.id === id)?.name ?? "Unassigned";
export const firmOf = (accounts: Account[], id: string | undefined) => accounts.find((a) => a.id === id);

/** WhatsApp templates, mirrored from the shared quick-actions (spec 3a: Tamil and English, showcase only). */
export const WA_TEMPLATES = [
  { id: "ecourts_intro_ta", lang: "Tamil", body: "வணக்கம் {{1}}, LAWSOME உங்கள் Madras High Court மற்றும் மாவட்ட நீதிமன்ற வழக்குகளின் அடுத்த விசாரணை தேதிகளை காலை 7 மணிக்கு அனுப்பும். டெமோ பார்க்க DEMO என பதில் அனுப்பவும்." },
  { id: "demo_invite_ta", lang: "Tamil", body: "வணக்கம் {{1}}, {{2}} குழுவுக்கு 30 நிமிட LAWSOME டெமோ ஏற்பாடு செய்யலாமா? மாலை 5:30க்கு பிறகு அல்லது சனிக்கிழமை காலை வசதியா? பதில் அனுப்பவும்." },
  { id: "demo_reminder_en", lang: "English", body: "Hi {{1}}, a reminder of your LAWSOME demo for {{2}}. The Meet link is in your email. Reply 1 to confirm or 2 to reschedule." },
  { id: "proposal_followup_en", lang: "English", body: "Hi {{1}}, sharing the annual proposal for {{2}} again. Happy to walk your partners through it this week." },
] as const;

export const CALL_OUTCOMES = [
  { key: "connected", label: "Connected" }, { key: "no_answer", label: "No answer" }, { key: "busy", label: "Busy" },
  { key: "wrong_number", label: "Wrong number" }, { key: "call_back_later", label: "Call back later" },
] as const;

export const LOST_REASONS = [
  { key: "price", label: "Price" }, { key: "competitor", label: "Chose a competitor" }, { key: "no_decision", label: "No decision" },
  { key: "timing", label: "Timing" }, { key: "not_a_fit", label: "Not a fit" }, { key: "in_house_excel", label: "Stayed on in-house Excel" },
] as const;
export const PLANS = ["Practice", "Chambers", "Enterprise"] as const;

/** Field classes for page-local forms (matches the shared quick-actions inputs). */
export const field = "h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";
