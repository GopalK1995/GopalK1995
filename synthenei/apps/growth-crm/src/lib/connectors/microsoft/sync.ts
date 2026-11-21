// Outlook streams over Graph delta queries. `inbox` and `sent`: mail of the last 30 days, then incremental; only mail with a KNOWN contact
// or lead of this workspace is stored (everything else is skipped and counted, never read further). `calendar`: events of a rolling window
// into calendar_events, deletions cancel the row. Resumable (next link), incremental (delta link), idempotent (external id), tenant scoped.
import type { ConnectionRow, SyncResult } from "../core/types";
import { CAL_FUTURE_DAYS, CAL_PAST_DAYS, MAIL_BACKFILL_DAYS, PAGES_PER_STEP } from "./constants";
import { GraphResyncError } from "./errors";
import type { DeltaPage, GraphGateway } from "./gateway";
import { normaliseEvent, normaliseMessage, type MailRow, type RawEvent, type RawMessage } from "./mappers";
import type { MsDeps, Scope } from "./store";

export interface MsStreamCtx { deps: MsDeps; conn: ConnectionRow; gateway: GraphGateway; reject: (reason: string) => void }
export const scopeOf = (c: ConnectionRow): Scope => ({ tenantId: c.tenantId, workspaceId: c.workspaceId, connectionId: c.id });
const DAY = 86400e3;
/** A calendar delta link is bound to the window it was created with: renewed after this long so the window keeps covering "today". */
const CAL_DELTA_MAX_AGE_MS = 60 * DAY;

interface Tally { stored: number; skipped: number; rejected: number }

/** Stores mail that involves a known contact. Inbound: the sender must be known. Outbound: at least one recipient must be known. */
export async function ingestMail(c: { deps: MsDeps; conn: ConnectionRow; reject: (r: string) => void }, direction: "inbound" | "outbound", rows: MailRow[]): Promise<Tally> {
  const t: Tally = { stored: 0, skipped: 0, rejected: 0 };
  const counterparts = (r: MailRow): string[] => (direction === "inbound" ? (r.from ? [r.from] : []) : [...r.to, ...r.cc]);
  const emails = [...new Set(rows.flatMap(counterparts))];
  const known = emails.length ? await c.deps.store.matchContacts({ tenantId: c.conn.tenantId, workspaceId: c.conn.workspaceId }, emails) : new Map();
  for (const r of rows) {
    const hit = counterparts(r).map((e) => known.get(e)).find((k) => !!k);
    if (!hit) { t.skipped++; continue; }
    await c.deps.store.upsertMail({ ...scopeOf(c.conn), threadId: r.threadId, externalId: r.externalId, direction, subject: r.subject, preview: r.preview, at: r.at, leadId: hit.leadId, contactId: hit.contactId });
    t.stored++;
  }
  return t;
}

export async function ingestMessages(c: { deps: MsDeps; conn: ConnectionRow; reject: (r: string) => void }, direction: "inbound" | "outbound", raw: RawMessage[]): Promise<Tally> {
  const rows: MailRow[] = [], t: Tally = { stored: 0, skipped: 0, rejected: 0 };
  for (const m of raw) {
    const r = normaliseMessage(m);
    if (r.kind === "message") rows.push(r.row);
    else if (r.kind === "reject") { t.rejected++; c.reject(r.reason); }
    else t.skipped++;   // drafts, and mail deleted in Outlook (the CRM keeps its own record of correspondence)
  }
  const w = await ingestMail(c, direction, rows);
  return { stored: w.stored, skipped: t.skipped + w.skipped, rejected: t.rejected };
}

export async function ingestEvents(c: { deps: MsDeps; conn: ConnectionRow; reject: (r: string) => void }, raw: RawEvent[]): Promise<Tally> {
  const t: Tally = { stored: 0, skipped: 0, rejected: 0 };
  const rows = [];
  for (const e of raw) {
    const r = normaliseEvent(e);
    if (r.kind === "event") rows.push(r.row);
    else if (r.kind === "removed") { await c.deps.store.cancelCalendarEvent(scopeOf(c.conn), r.externalId); t.stored++; }
    else { t.rejected++; c.reject(r.reason); }
  }
  const emails = [...new Set(rows.flatMap((r) => r.attendees))];
  const known = emails.length ? await c.deps.store.matchContacts({ tenantId: c.conn.tenantId, workspaceId: c.conn.workspaceId }, emails) : new Map();
  for (const r of rows) {
    const leadId = r.attendees.map((e) => known.get(e)?.leadId ?? null).find((x) => !!x) ?? null;
    await c.deps.store.upsertCalendarEvent({ ...scopeOf(c.conn), externalId: r.externalId, startsAt: r.startsAt, endsAt: r.endsAt, title: r.title, status: r.status, leadId });
    t.stored++;
  }
  return t;
}

// ---------- delta runner ----------
interface DeltaCursor { next?: string; delta?: string; since?: string; at?: string }
const asCursor = (c: unknown): DeltaCursor => {
  const o = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
  const s = (k: string) => (typeof o[k] === "string" && o[k] ? (o[k] as string) : undefined);
  return { next: s("next"), delta: s("delta"), since: s("since"), at: s("at") };
};

async function runDelta<T>(c: MsStreamCtx, cursorIn: unknown, maxAgeMs: number | null, fetchPage: (link: string | null, cur: DeltaCursor) => Promise<DeltaPage<T>>, handle: (items: T[]) => Promise<Tally>): Promise<SyncResult> {
  const cur = asCursor(cursorIn), now = c.deps.now();
  const stale = maxAgeMs !== null && (!cur.at || now.getTime() - Date.parse(cur.at) > maxAgeMs);
  let link: string | null = cur.next ?? (cur.delta && !stale ? cur.delta : null);
  const at = link && cur.at ? cur.at : now.toISOString();
  const tally: Tally = { stored: 0, skipped: 0, rejected: 0 };
  let rows = 0;
  const sample = () => ({ stored: tally.stored, skippedUnknown: tally.skipped, mode: c.gateway.kind });
  for (let n = 0; n < PAGES_PER_STEP; n++) {
    let p: DeltaPage<T>;
    try { p = await fetchPage(link, cur); }
    catch (e) {
      // 410 / unusable link: forget the delta state and start again (rows are idempotent), keeping the mail window start.
      if (e instanceof GraphResyncError) return { cursor: { since: cur.since }, rowsIn: rows, rowsRejected: tally.rejected, done: false, sample: { ...sample(), resync: true } };
      throw e;
    }
    const w = await handle(p.items);
    tally.stored += w.stored; tally.skipped += w.skipped; tally.rejected += w.rejected; rows += p.items.length;
    if (p.next) { link = p.next; continue; }
    return { cursor: { delta: p.delta, since: cur.since, at }, rowsIn: rows, rowsRejected: tally.rejected, done: true, sample: sample() };
  }
  return { cursor: { next: link ?? undefined, since: cur.since, at }, rowsIn: rows, rowsRejected: tally.rejected, done: false, sample: sample() };
}

const sinceOf = (c: MsStreamCtx, cur: DeltaCursor): string => cur.since ?? new Date(c.deps.now().getTime() - MAIL_BACKFILL_DAYS * DAY).toISOString();

export async function mailStep(c: MsStreamCtx, folder: "inbox" | "sent", cursorIn: unknown): Promise<SyncResult> {
  const cur0 = asCursor(cursorIn);
  const since = sinceOf(c, cur0);
  const r = await runDelta<RawMessage>(c, { ...cur0, since }, null, (link) => c.gateway.deltaMessages(folder, link, since), (items) => ingestMessages(c, folder === "inbox" ? "inbound" : "outbound", items));
  return r;
}

export async function calendarStep(c: MsStreamCtx, cursorIn: unknown): Promise<SyncResult> {
  const now = c.deps.now();
  const win = { startIso: new Date(now.getTime() - CAL_PAST_DAYS * DAY).toISOString(), endIso: new Date(now.getTime() + CAL_FUTURE_DAYS * DAY).toISOString() };
  return runDelta<RawEvent>(c, cursorIn, CAL_DELTA_MAX_AGE_MS, (link) => c.gateway.deltaEvents(link, win), (items) => ingestEvents(c, items));
}
