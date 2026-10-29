// Pure mappers: camelCased DB rows (see src/lib/db/map.ts) -> domain types in src/lib/data/types.ts.
// No I/O here so they are unit-testable. Unknown or missing columns degrade to honest empty values, never to invented data.
import type {
  Activity, ActivityKind, AuditEntry, ConsentEntry, Conversation, Ga4Channel, Ga4Day, Ga4Page, Holiday, Integration,
  IntegrationCategory, IntegrationStatus, Message, Role, SyncRun, TeamMember,
} from "../types";

export type Row = Record<string, unknown>;
const s = (v: unknown, d = ""): string => (typeof v === "string" ? v : v == null ? d : String(v));
const n = (v: unknown, d = 0): number => { const x = typeof v === "number" ? v : Number(v); return Number.isFinite(x) ? x : d; };
const sn = (v: unknown): string | null => (v == null ? null : String(v));
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});

const ROLE_TITLE: Record<Role, string> = {
  owner: "Owner", sales_manager: "Sales manager", sales_rep: "Sales rep", marketing: "Marketing", data: "Data analyst", viewer: "Viewer",
};
const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, "$1***$2");

/** membership + profile (+ this month's sales target) -> TeamMember. Email is masked without pii.read. */
export function teamMember(m: Row, p: Row | undefined, target: Row | undefined, piiRead: boolean): TeamMember {
  const role = s(m.role, "viewer") as Role;
  const email = s(p?.email);
  return {
    id: s(m.userId), name: s(p?.fullName, "Unnamed member"), role, title: ROLE_TITLE[role] ?? role,
    email: piiRead || !email ? email : maskEmail(email), monthlyTarget: n(target?.wonValueInr),
  };
}

export function activityKind(r: Row): ActivityKind {
  const kind = s(r.kind), dir = s(r.direction);
  switch (kind) {
    case "call": return "call";
    case "whatsapp": return dir === "inbound" ? "whatsapp_in" : "whatsapp_out";
    case "email": return dir === "inbound" ? "email_open" : "email_sent";
    case "meeting": return s(r.meetingType) === "demo" ? (r.doneAt ? "demo_done" : "demo_booked") : "note";
    default: return "note";
  }
}

export function activity(r: Row): Activity {
  return {
    id: s(r.id), leadId: s(r.leadId), kind: activityKind(r), at: s(r.doneAt ?? r.scheduledAt ?? r.createdAt),
    title: s(r.subject) || s(r.kind, "activity"), detail: r.body ? s(r.body) : undefined, byId: r.ownerId ? s(r.ownerId) : undefined,
  };
}

const GA4_CHANNELS: Ga4Channel[] = ["Organic Search", "Paid Search", "Paid Social", "Email", "Direct", "Referral"];
const emptyChannels = (): Record<Ga4Channel, number> => ({ "Organic Search": 0, "Paid Search": 0, "Paid Social": 0, Email: 0, Direct: 0, Referral: 0 });

/** ga4_daily rows (one per day x channel x device x page) -> per-day totals and per-page totals. */
export function ga4Rollup(rows: Row[]): { days: Ga4Day[]; pages: Ga4Page[] } {
  const days = new Map<string, Ga4Day & { engSecs: number }>();
  const pages = new Map<string, { sessions: number; engaged: number; secs: number; conv: number }>();
  for (const r of rows) {
    const date = s(r.day).slice(0, 10), sessions = n(r.sessions);
    let d = days.get(date);
    if (!d) {
      d = { date, sessions: 0, users: 0, engagedSessions: 0, avgEngagementSecs: 0, keyEvents: 0, byChannel: emptyChannels(), byDevice: { mobile: 0, desktop: 0, tablet: 0 }, engSecs: 0 };
      days.set(date, d);
    }
    d.sessions += sessions; d.users += n(r.totalUsers); d.engagedSessions += n(r.engagedSessions); d.keyEvents += n(r.keyEvents);
    d.engSecs += n(r.avgEngagementSecs) * sessions;
    const ch = s(r.channelGroup) as Ga4Channel;
    if (GA4_CHANNELS.includes(ch)) d.byChannel[ch] += sessions;
    const dev = s(r.deviceCategory).toLowerCase();
    if (dev === "mobile" || dev === "desktop" || dev === "tablet") d.byDevice[dev] += sessions;
    const path = s(r.landingPage);
    if (path) {
      const p = pages.get(path) ?? { sessions: 0, engaged: 0, secs: 0, conv: 0 };
      p.sessions += sessions; p.engaged += n(r.engagedSessions); p.secs += n(r.avgEngagementSecs) * sessions; p.conv += n(r.keyEvents);
      pages.set(path, p);
    }
  }
  const outDays: Ga4Day[] = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((x) => {
    const { engSecs, ...rest } = x;
    return { ...rest, avgEngagementSecs: rest.sessions ? Math.round((engSecs / rest.sessions) * 10) / 10 : 0 };
  });
  const outPages: Ga4Page[] = [...pages.entries()].map(([path, p]) => ({
    path, title: path, sessions: p.sessions, engagementRate: p.sessions ? p.engaged / p.sessions : 0,
    avgSecs: p.sessions ? Math.round(p.secs / p.sessions) : 0, conversions: p.conv,
  })).sort((a, b) => b.sessions - a.sessions);
  return { days: outDays, pages: outPages };
}

/** Domain Message from a messages row; internal notes are not part of the thread view. */
export function message(r: Row): Message | null {
  if (r.isInternalNote === true) return null;
  const st = s(r.status);
  return {
    id: s(r.id), from: s(r.direction) === "inbound" ? "lead" : "us", authorId: r.sentBy ? s(r.sentBy) : undefined, at: s(r.createdAt), body: s(r.body),
    status: st === "read" || st === "delivered" || st === "sent" ? st : undefined,
  };
}

export function conversation(r: Row, msgs: Row[]): Conversation {
  const thread = msgs.map(message).filter((m): m is Message => m !== null).sort((a, b) => a.at.localeCompare(b.at));
  const readAt = r.lastReadAt ? s(r.lastReadAt) : "";
  const unread = thread.filter((m) => m.from === "lead" && (!readAt || m.at > readAt)).length;
  return {
    id: s(r.id), leadId: s(r.leadId), channel: s(r.channel, "whatsapp") as Conversation["channel"], subject: "",
    unread, lastAt: s(r.lastMessageAt ?? r.createdAt), messages: thread,
    aiDraft: { body: "", rationale: [], basedOn: "" }, // no AI drafts are stored until the AI tables exist
  };
}

const CATEGORY: Record<string, IntegrationCategory> = {
  crm: "CRM", messaging: "Messaging", email: "Email", ads: "Ads", analytics: "Analytics", scheduling: "Scheduling", payments: "Payments", automation: "Automation", internal: "Automation",
};
const TRIGGER: Record<string, Integration["trigger"]> = { both: "Two-way sync", in: "Scheduled sync", out: "On demand" };
const tone = (key: string): Integration["tone"] => ((([...key].reduce((a, c) => a + c.charCodeAt(0), 0) % 5) + 1) as Integration["tone"]);
const syncStatus = (v: unknown): SyncRun["status"] => (v === "success" || v === "failed" ? v : "partial"); // 'running' shows as partial

export function integration(r: Row, maps: Row[] = [], runs: Row[] = []): Integration {
  const provider = s(r.provider), label = s(r.label, provider), settings = obj(r.settings);
  return {
    id: provider.replace(/_/g, "-"), name: label, vendor: label, category: CATEGORY[s(r.category)] ?? "Automation",
    status: s(r.status, "not_configured") as IntegrationStatus,
    sampleFeed: settings.sample_feed === true || settings.sampleFeed === true || undefined,
    monogram: label.slice(0, 2).toUpperCase(), tone: tone(provider), summary: "",
    trigger: TRIGGER[s(r.direction)] ?? "On demand", inbound: [], outbound: [], steps: [],
    fieldMap: maps.map((m) => ({ source: `${s(m.externalObject)}.${s(m.externalField)}`, target: `${s(m.localTable)}.${s(m.localColumn)}`, note: m.transform ? s(m.transform) : undefined })),
    lastSyncAt: sn(r.lastSyncAt),
    syncLog: runs.map((x) => ({ at: s(x.startedAt), status: syncStatus(x.status), rows: n(x.rowsIn), note: s(x.error) })),
  };
}

export function syncRun(r: Row): SyncRun {
  const start = s(r.startedAt), end = r.finishedAt ? s(r.finishedAt) : "";
  const secs = start && end ? Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000)) : 0;
  return { id: s(r.id), integrationId: s(r.integrationId), startedAt: start, durationSecs: secs, status: syncStatus(r.status), rowsIn: n(r.rowsIn), rowsRejected: n(r.rowsRejected), note: s(r.error) };
}

const PURPOSES = ["demo_followup", "marketing_email", "whatsapp"] as const;
/** Only the three purposes the UI models; analytics/AI consent and erasure rows are not shown on this screen. */
export function consentEntry(r: Row): ConsentEntry | null {
  const purpose = s(r.purpose), action = s(r.action);
  if (!(PURPOSES as readonly string[]).includes(purpose) || (action !== "granted" && action !== "withdrawn")) return null;
  return { id: s(r.id), leadId: s(r.leadId), purpose: purpose as ConsentEntry["purpose"], action, noticeVersion: s(r.noticeVersion), via: s(r.capturedVia), at: s(r.occurredAt) };
}

export function auditEntry(r: Row, piiRead: boolean): AuditEntry {
  const table = s(r.tableName), row = r.rowId ? `:${s(r.rowId)}` : "";
  return {
    id: s(r.id), at: s(r.occurredAt), actorId: s(r.actorId) || s(r.actorLabel, "system"), action: s(r.action),
    target: `${table}${row}`, ip: piiRead ? s(r.ip) : "",
  };
}

export function holidays(dates: unknown): Holiday[] {
  return (Array.isArray(dates) ? dates : []).map((d) => ({ date: s(d).slice(0, 10), name: "Holiday" })).sort((a, b) => a.date.localeCompare(b.date));
}
