// Calendar two-way sync. Two streams:
//   pull: Google -> calendar_events, per connected user, incremental by Google sync token (full window first, 410 restarts it);
//         only CRM-related events are kept (see mapper.ts); last write wins against a locally edited row.
//   push: calendar_events -> Google. Rows created in the CRM (demos, meetings, room holds) are inserted into the primary grant's
//         calendar and linked; linked rows changed in the CRM are patched when their content differs (no echo of our own pulls).
import type { ConnectionRow, ConnectionSecrets, SyncResult } from "../../core/types";
import { scopeOf } from "../shared/mode";
import { LOOKAHEAD_DAYS, LOOKBACK_DAYS, PUSH_BATCH } from "./constants";
import { SyncTokenGone, type CalendarGateway } from "./gateway";
import { liveGrants, type Grant } from "./grants";
import { decideInbound, kindForLocal, mapEvent, sigOf, toGoogleEvent } from "./mapper";
import type { CalendarDeps } from "./store";
import type { CalRow, GEvent } from "./types";

export interface CalendarStreamCtx { deps: CalendarDeps; conn: ConnectionRow; secrets: ConnectionSecrets; gateway: CalendarGateway; reject: (reason: string) => void }

const SHOWCASE: Grant = { uid: "showcase", access: "mock", refresh: "mock", dead: false, primary: true };
const grantsFor = (c: CalendarStreamCtx): Grant[] => (c.gateway.kind === "mock" ? [SHOWCASE] : liveGrants(c.secrets));
const DAY = 86_400_000;

interface PullState { syncToken?: string; pageToken?: string; timeMin?: string; timeMax?: string }
interface PullCursor { g: Record<string, PullState> }
const asPull = (v: unknown): PullCursor => (v && typeof v === "object" && (v as PullCursor).g && typeof (v as PullCursor).g === "object" ? (v as PullCursor) : { g: {} });

export async function calendarPullStep(c: CalendarStreamCtx, cursorIn: unknown): Promise<SyncResult> {
  const cur = asPull(cursorIn), grants = grantsFor(c), scope = scopeOf(c.conn), now = c.deps.now();
  const next: PullCursor = { g: {} };
  let rowsIn = 0, rejected = 0, more = false, ignored = 0, kept = 0, resync = 0, conflicts = 0, cancelled = 0;
  if (!grants.length) return { cursor: cursorIn ?? { g: {} }, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_live_grant" } };

  for (const g of grants) {
    let st: PullState = cur.g[g.uid] ?? {};
    if (st.pageToken === undefined && st.syncToken === undefined) st = { timeMin: new Date(now.getTime() - LOOKBACK_DAYS * DAY).toISOString(), timeMax: new Date(now.getTime() + LOOKAHEAD_DAYS * DAY).toISOString() };
    let page;
    try { page = await c.gateway.listEvents({ token: g.access, syncToken: st.syncToken, pageToken: st.pageToken, timeMin: st.timeMin, timeMax: st.timeMax }); }
    catch (e) {
      if (!(e instanceof SyncTokenGone)) throw e;
      resync++;
      next.g[g.uid] = {};   // a full window next step
      more = true;
      continue;
    }
    const emails = new Set<string>();
    for (const ev of page.items) for (const a of ev.attendees ?? []) if (a.email && !a.self) emails.add(a.email.toLowerCase());
    const contacts = emails.size ? await c.deps.store.contactsByEmail(scope, [...emails]) : new Map();
    const upserts: CalRow[] = [], cancels: string[] = [];
    for (const ev of page.items as GEvent[]) {
      const m = mapEvent(ev, { userKey: g.uid, calendarTz: page.timeZone, contacts });
      if (!m.ok) { if (m.reason === "not_crm_related" || m.reason === "private_event") ignored++; else { rejected++; c.reject(m.reason); } continue; }
      if (m.kind === "cancel") cancels.push(m.externalId); else upserts.push(m.row);
    }
    const existing = await c.deps.store.findByExternal(scope, [...upserts.map((r) => r.externalId)]);
    const apply: CalRow[] = [];
    for (const r of upserts) {
      const d = decideInbound(existing.get(r.externalId), r);
      if (d === "apply") apply.push(r); else if (d === "keep_local") conflicts++;
    }
    if (apply.length) await c.deps.store.upsertRemote(scope, apply, existing);
    for (const id of cancels) if (await c.deps.store.cancelRemote(scope, id)) cancelled++;
    kept += apply.length; rowsIn += apply.length + cancelled;
    if (page.nextPageToken) { next.g[g.uid] = { pageToken: page.nextPageToken, syncToken: st.syncToken, timeMin: st.timeMin, timeMax: st.timeMax }; more = true; }
    else next.g[g.uid] = page.nextSyncToken ? { syncToken: page.nextSyncToken } : {};
  }
  return { cursor: next, rowsIn, rowsRejected: rejected, done: !more, sample: { users: grants.length, kept, ignored, conflicts_kept_local: conflicts, cancelled, resync, mode: c.gateway.kind } };
}

interface PushCursor { since: string | null }
const asPush = (v: unknown): PushCursor => ({ since: v && typeof v === "object" && typeof (v as PushCursor).since === "string" ? (v as PushCursor).since : null });

export async function calendarPushStep(c: CalendarStreamCtx, cursorIn: unknown, batch = PUSH_BATCH): Promise<SyncResult> {
  const cur = asPush(cursorIn), scope = scopeOf(c.conn), t0 = c.deps.now().toISOString();
  const primary = grantsFor(c).find((g) => g.primary) ?? grantsFor(c)[0];
  if (!primary) return { cursor: cur, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_live_grant" } };
  const rows = await c.deps.store.listPushCandidates(scope, cur.since, batch + 1);
  const slice = rows.slice(0, batch);
  let created = 0, patched = 0, same = 0, skipped = 0, rejected = 0, last: string | null = null;
  for (const l of slice) {
    last = l.updatedAt;
    const kind = kindForLocal(l);
    if (!l.externalId) {
      const made = await c.gateway.insertEvent(primary.access, toGoogleEvent(l, kind));
      await c.deps.store.markLinked(scope, l.id, `${primary.uid}:${made.id}`);
      created++; continue;
    }
    const sep = l.externalId.indexOf(":");
    const uid = l.externalId.slice(0, sep), gid = l.externalId.slice(sep + 1);
    const grant = sep > 0 ? liveGrants(c.secrets).find((g) => g.uid === uid) ?? (c.gateway.kind === "mock" ? SHOWCASE : undefined) : undefined;
    if (!grant) { rejected++; c.reject("no_live_grant_for_event"); continue; }
    const remote = await c.gateway.getEvent(grant.access, gid);
    if (!remote) { skipped++; continue; }   // deleted in Google: the pull side reports it as cancelled
    const remoteRow = mapEvent(remote, { userKey: uid, contacts: new Map([]) });
    if (remoteRow.ok && remoteRow.kind === "upsert" && sigOf(remoteRow.row) === sigOf(l)) { same++; continue; }
    if (remote.updated && Date.parse(remote.updated) > Date.parse(l.updatedAt)) { skipped++; continue; }   // Google is newer: the pull overwrites the local row
    await c.gateway.patchEvent(grant.access, gid, toGoogleEvent(l, kind));
    patched++;
  }
  const truncated = rows.length > batch;
  return { cursor: { since: truncated ? last : t0 }, rowsIn: 0, rowsRejected: rejected, done: !truncated, sample: { created, patched, unchanged: same, skipped, mode: c.gateway.kind } };
}

