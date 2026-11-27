// Consent log paging and search for Settings > Consent & privacy (AUD-048). Keyset paging on (occurred_at desc, id desc):
// no row cap, no offset, one page of PAGE_SIZE rows per request. Search matches the lead's name on the server; the page
// only ever carries a masked label and the lead id (a link to the record), never a name, email, phone or subject hash.
import { from, type Qb } from "@/lib/db/query";
import type { Db } from "@/lib/db/client";
import type { ConsentEntry } from "@/lib/data/types";

export const CONSENT_PAGE_SIZE = 25;
const PURPOSES = ["demo_followup", "marketing_email", "whatsapp"] as const;
const ACTIONS = ["granted", "withdrawn"] as const;
const DAY = 864e5;

export interface ConsentLogRow { id: string; leadId: string | null; subject: string; purpose: ConsentEntry["purpose"]; action: ConsentEntry["action"]; noticeVersion: string; via: string; at: string }
export interface ConsentLogPage {
  rows: ConsentLogRow[]; total: number; withdrawn30: number; nextCursor: string | null;
  /** True when the search matched more leads than the lookup reads; the owner should narrow the search. */
  searchCapped: boolean;
}
export interface ConsentLogQuery { q?: string; cursor?: string; limit?: number }

interface Cur { at: string; id: string; q: string }
export const normaliseQuery = (q?: string): string => (q ?? "").trim().slice(0, 80);
export function encodeConsentCursor(c: Cur): string { return Buffer.from(JSON.stringify(c), "utf8").toString("base64url"); }
/** A cursor made for a different search is ignored (the pager starts again from the newest entry). */
export function decodeConsentCursor(s: string | undefined, q: string): Cur | null {
  if (!s) return null;
  try {
    const o = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as Partial<Cur>;
    if (typeof o.at !== "string" || typeof o.id !== "string" || typeof o.q !== "string" || o.q !== q || Number.isNaN(Date.parse(o.at))) return null;
    return { at: o.at, id: o.id, q };
  } catch { return null; }
}
const clampLimit = (n?: number) => (n && Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), 100) : CONSENT_PAGE_SIZE);

/** "Arun Kumar" -> "Arun K." : enough to recognise the person in the owner's own workspace, not a full name. */
export function maskSubject(name: string | null | undefined, erased: string): string {
  const n = (name ?? "").trim();
  if (!n || n === "Erased lead" || n === erased) return erased;
  const parts = n.split(/\s+/);
  return parts.length === 1 ? `${parts[0][0]}.` : `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

const cmp = (a: { at: string; id: string }, b: { at: string; id: string }) => (a.at === b.at ? (Number(b.id) - Number(a.id) || b.id.localeCompare(a.id)) : b.at.localeCompare(a.at));

/** In-memory paging (demo sessions and tests): same ordering, cursor and search semantics as the database path. */
export function pageConsentMemory(entries: ConsentEntry[], names: Map<string, string>, erased: string, now: number, o: ConsentLogQuery = {}): ConsentLogPage {
  const q = normaliseQuery(o.q), limit = clampLimit(o.limit), needle = q.toLowerCase();
  const visible = entries.filter((e) => !needle || (names.get(e.leadId) ?? "").toLowerCase().includes(needle) || e.leadId.toLowerCase() === needle);
  const sorted = [...visible].sort(cmp);
  const cur = decodeConsentCursor(o.cursor, q);
  const after = cur ? sorted.filter((e) => cmp(e, cur) > 0) : sorted;
  const rows = after.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    rows: rows.map((e) => ({ id: e.id, leadId: e.leadId || null, subject: maskSubject(names.get(e.leadId), erased), purpose: e.purpose, action: e.action, noticeVersion: e.noticeVersion, via: e.via, at: e.at })),
    total: visible.length, withdrawn30: entries.filter((e) => e.action === "withdrawn" && now - Date.parse(e.at) < 30 * DAY).length,
    nextCursor: after.length > rows.length && last ? encodeConsentCursor({ at: last.at, id: last.id, q }) : null, searchCapped: false,
  };
}

type R = Record<string, unknown>;
const LEAD_LOOKUP = 200;
const like = (q: string) => `%${q.replace(/[\%_]/g, "\$&")}%`;
async function count(db: Db, apply: (b: Qb) => Qb): Promise<number> {
  const base = (db as unknown as { from(t: string): { select(c: string, o: { count: "exact"; head: true }): Qb } }).from("consent_log").select("id", { count: "exact", head: true });
  const r = (await apply(base)) as unknown as { count: number | null; error: { message: string } | null };
  if (r.error) throw new Error("consent count failed");
  return r.count ?? 0;
}

/** Real sessions: one page from consent_log through the signed-in user's client (RLS decides who may read). Throws on a read failure. */
export async function pageConsentDb(db: Db, ws: string, erased: string, now: number, o: ConsentLogQuery = {}): Promise<ConsentLogPage> {
  const q = normaliseQuery(o.q), limit = clampLimit(o.limit);
  const scope = (b: Qb) => b.eq("workspace_id", ws).in("purpose", [...PURPOSES]).in("action", [...ACTIONS]);
  let leadIds: string[] | null = null, searchCapped = false;
  if (q) {
    const l = await from(db, "leads").select("id").eq("workspace_id", ws).ilike("full_name", like(q)).limit(LEAD_LOOKUP + 1);
    if (l.error) throw new Error("lead search failed");
    const ids = ((l.data as R[] | null) ?? []).map((x) => String(x.id));
    searchCapped = ids.length > LEAD_LOOKUP;
    leadIds = ids.slice(0, LEAD_LOOKUP);
  }
  const filtered = (b: Qb) => (leadIds ? b.in("lead_id", leadIds) : b);
  if (leadIds && !leadIds.length) return { rows: [], total: 0, withdrawn30: 0, nextCursor: null, searchCapped };
  const cur = decodeConsentCursor(o.cursor, q);
  let b = filtered(scope(from(db, "consent_log").select("id, lead_id, purpose, action, notice_version, captured_via, occurred_at")));
  if (cur) b = b.or(`occurred_at.lt.${cur.at},and(occurred_at.eq.${cur.at},id.lt.${cur.id})`);
  const [res, total, w30] = await Promise.all([
    b.order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1),
    count(db, (c) => filtered(scope(c))),
    count(db, (c) => filtered(scope(c)).eq("action", "withdrawn").gte("occurred_at", new Date(now - 30 * DAY).toISOString())),
  ]);
  if (res.error) throw new Error("consent read failed");
  const raw = (res.data as R[] | null) ?? [];
  const page = raw.slice(0, limit);
  const ids = [...new Set(page.map((r) => r.lead_id).filter((x): x is string => typeof x === "string"))];
  const names = new Map<string, string>();
  if (ids.length) {
    const l = await from(db, "leads").select("id, full_name").eq("workspace_id", ws).in("id", ids).limit(limit);
    if (!l.error) for (const x of (l.data as R[] | null) ?? []) names.set(String(x.id), String(x.full_name ?? ""));
  }
  const last = page[page.length - 1];
  return {
    rows: page.map((r) => ({
      id: String(r.id), leadId: typeof r.lead_id === "string" ? r.lead_id : null, subject: maskSubject(typeof r.lead_id === "string" ? names.get(r.lead_id) : null, erased),
      purpose: r.purpose as ConsentEntry["purpose"], action: r.action as ConsentEntry["action"], noticeVersion: String(r.notice_version ?? ""), via: String(r.captured_via ?? ""), at: String(r.occurred_at ?? ""),
    })),
    total, withdrawn30: w30, searchCapped,
    nextCursor: raw.length > limit && last ? encodeConsentCursor({ at: String(last.occurred_at), id: String(last.id), q }) : null,
  };
}
