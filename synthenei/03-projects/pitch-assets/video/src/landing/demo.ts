// SYNTHETIC demo data (fictional firm, parties and people). Never put real client data here.
// VIDEO COPY: statusBars Open changed 17 -> 16 so status counts sum to stats.total (24). Landing source still has 17.
// VIDEO COPY: CNRs shortened to the real 16-character format (landing has 18-char values for two rows).
export const firm = {
  name: "Raghavan Law Chambers",
  tags: ["Law Firm", "Litigation", "Criminal Law", "Family & Personal Law", "Property"],
  since: "14 Aug 2026",
  key: "RLC",
};

export const stats = { total: 24, thisMonth: 7, upcoming: 6, resolved: 3, team: 9, sites: 2 };

export const statusBars = [
  { label: "Open", n: 16, color: "var(--c-open)" },
  { label: "In Progress", n: 4, color: "var(--c-progress)" },
  { label: "On Hold", n: 1, color: "var(--c-hold)" },
  { label: "Closed", n: 3, color: "var(--c-closed)" },
];

export const growth = [0, 0, 1, 1, 2, 3, 4, 6, 5, 9]; // Jan..Oct incoming cases
export const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];

export const upcomingHearings = [
  { d: "20", m: "OCT", title: "Menon Estates vs Kumar Builders", where: "Commercial Court, Chennai · Adv Meera" },
  { d: "27", m: "OCT", title: "Lakshmi Textiles vs State Bank Branch", where: "Madras High Court · Adv Karthik" },
  { d: "03", m: "NOV", title: "Selvam vs Thangaraj (Sale Deed)", where: "Sub Court, Madurai · Adv Ananya" },
];

export const sites = [
  { name: "Egmore Office", key: "RLC-EGM", where: "Egmore, Chennai, Tamil Nadu - 600008", cases: 15, staff: 6 },
  { name: "Madurai Bench Office", key: "RLC-MDU", where: "KK Nagar, Madurai, Tamil Nadu - 625020", cases: 9, staff: 3 },
];

export type CaseRow = { title: string; ref: string; no: string; hearing: string | null; site: string; status: string; who: string };
export const cases: CaseRow[] = [
  { title: "Menon Estates vs Kumar Builders", ref: "RLC-EGM-12", no: "CS/142/2026", hearing: "20 Oct 2026", site: "Egmore Office", status: "Open", who: "Adv Meera" },
  { title: "Selvam vs Thangaraj (Sale Deed)", ref: "RLC-MDU-4", no: "OS/387/2026", hearing: "03 Nov 2026", site: "Madurai Bench Office", status: "In Progress", who: "Adv Ananya" },
  { title: "Lakshmi Textiles vs State Bank Branch", ref: "RLC-EGM-11", no: "W.P./21540/2026", hearing: "27 Oct 2026", site: "Egmore Office", status: "Open", who: "Adv Karthik" },
  { title: "State vs Rajasekar", ref: "RLC-EGM-10", no: "CC/1021/2025", hearing: null, site: "Egmore Office", status: "Open", who: "Adv Imran" },
  { title: "Fathima Begum vs Abdul Rahim", ref: "RLC-EGM-9", no: "FDA/48/2025", hearing: null, site: "Egmore Office", status: "Open", who: "Adv Divya" },
  { title: "Bright Logistics vs Southern Cargo", ref: "RLC-MDU-3", no: "Crl.MP/1567/2025", hearing: null, site: "Madurai Bench Office", status: "On Hold", who: "Adv Ananya" },
  { title: "Gomathi vs Palaniappan", ref: "RLC-EGM-8", no: "RCA/19/2025", hearing: "11 Nov 2026", site: "Egmore Office", status: "Open", who: "Adv Karthik" },
  { title: "Annamalai Traders vs Revenue Dept", ref: "RLC-MDU-2", no: "WA/311/2024", hearing: null, site: "Madurai Bench Office", status: "In Progress", who: "Adv Imran" },
];

export const calendarEvents: Record<string, { kind: "hearing" | "task" | "note"; text: string }[]> = {
  "2026-10-06": [{ kind: "hearing", text: "Gomathi vs Palaniappan" }],
  "2026-10-08": [{ kind: "hearing", text: "Menon Estates vs …" }, { kind: "note", text: "Hearing updates" }],
  "2026-10-15": [{ kind: "task", text: "Follow up on …" }, { kind: "task", text: "Coordinate with …" }, { kind: "task", text: "Review hearing …" }],
  "2026-10-20": [{ kind: "hearing", text: "Menon Estates vs …" }, { kind: "task", text: "Draft written s…" }],
  "2026-10-27": [{ kind: "hearing", text: "Lakshmi Textiles …" }],
  "2026-10-29": [{ kind: "task", text: "Review previous …" }],
};

export const hearingsList = [
  { when: "20 Oct 2026, 10:30 am", title: "Menon Estates vs Kumar Builders", loc: "Commercial Court, Chennai", status: "Open", who: "Adv Meera", notes: "Purpose: Arguments" },
  { when: "03 Nov 2026, 11:00 am", title: "Selvam vs Thangaraj (Sale Deed)", loc: "Sub Court, Madurai", status: "Open", who: "Adv Ananya", notes: "Purpose: Written Statement | Judge: Sub Judge-I" },
  { when: "22 Sep 2026, 03:15 pm", title: "Gomathi vs Palaniappan", loc: "District Court, Chennai", status: "Completed", who: "Adv Karthik", notes: "Purpose: Evidence" },
];

export const team = [
  { initials: "AR", name: "Adv Ananya Raghavan", role: "Organization Admin, Site Admin", site: "Head Office" },
  { initials: "KS", name: "Adv Karthik Subramanian", role: "Senior Legal Expert", site: "Egmore Office" },
  { initials: "MI", name: "Adv Meera Iyer", role: "Senior Legal Expert", site: "Egmore Office" },
  { initials: "IB", name: "Adv Imran Basha", role: "Associate", site: "Madurai Bench Office" },
  { initials: "DL", name: "Divya Lakshmi", role: "Legal Support Staff", site: "Egmore Office" },
  { initials: "OA", name: "Office Administrator", role: "Organization Admin", site: "Head Office" },
];

export const savedCases = [
  { cnr: "TNCH010023452026", title: "Menon Estates vs Kumar Builders", court: "Commercial Court, Chennai", status: "PENDING" },
  { cnr: "TNMD010045672025", title: "Selvam vs Thangaraj", court: "Sub Court, Madurai", status: "PENDING" },
  { cnr: "TNCH0A0031822019", title: "State vs Rajasekar", court: "Metropolitan Magistrate, Saidapet", status: "DISPOSED" },
  { cnr: "TNCH0C0193492023", title: "Fathima Begum vs Abdul Rahim", court: "Family Court, Chennai", status: "PENDING" },
];
