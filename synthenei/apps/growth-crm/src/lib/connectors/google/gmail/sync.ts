// Gmail thread stream: for each connected user, search their mailbox for mail to or from KNOWN contacts only (Google does the filtering, in
// chunks of addresses), fetch those threads, run the matcher, and store the kept threads as email conversations. Resumable (cursor =
// time floor + user index + address offset), idempotent (messages are stored by Gmail id), and closed unless the gate is open.
import type { ConnectionRow, ConnectionSecrets, SyncResult } from "../../core/types";
import { liveGrants } from "../calendar/grants";
import { scopeOf } from "../shared/mode";
import { ADDRESS_CHUNK, FIRST_LOOKBACK_DAYS, OPT_IN_KEY, OVERLAP_SEC, THREADS_PER_QUERY } from "./constants";
import type { GmailGateway } from "./gateway";
import { gmailGate } from "./gate";
import { buildQuery, matchThread, parseMessage, type ParsedMessage } from "./matcher";
import type { GmailDeps } from "./store";

type Env = Record<string, string | undefined>;
export interface GmailStreamCtx { deps: GmailDeps; conn: ConnectionRow; secrets: ConnectionSecrets; gateway: GmailGateway; env: Env; reject: (reason: string) => void }
/** Hard cap on known addresses searched per user per cycle (the restricted-scope phase is small by design). */
export const MAX_ADDRESSES = 2000;

interface Cur { after: number | null; startedAt: number | null; gi: number; offset: number }
const asCur = (v: unknown): Cur => { const o = (v && typeof v === "object" ? v : {}) as Partial<Cur>; return { after: typeof o.after === "number" ? o.after : null, startedAt: typeof o.startedAt === "number" ? o.startedAt : null, gi: o.gi ?? 0, offset: o.offset ?? 0 }; };

export const gmailOptedIn = (s: ConnectionSecrets): boolean => !!s[OPT_IN_KEY];

export async function gmailThreadsStep(c: GmailStreamCtx, cursorIn: unknown): Promise<SyncResult> {
  const cur = asCur(cursorIn);
  const gate = gmailGate(c.env, gmailOptedIn(c.secrets));
  if (!gate.open) return { cursor: cur, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "gate_closed", reasons: gate.reasons } };   // nothing is read while closed
  const grants = c.gateway.kind === "mock" ? [] : liveGrants(c.secrets);
  const nowSec = Math.floor(c.deps.now().getTime() / 1000);
  const startedAt = cur.startedAt ?? nowSec;
  const finish = (): SyncResult => ({ cursor: { after: startedAt - OVERLAP_SEC, startedAt: null, gi: 0, offset: 0 }, rowsIn: 0, rowsRejected: 0, done: true, sample: { users: grants.length, mode: c.gateway.kind } });
  const g = grants[cur.gi];
  if (!g) return finish();
  const scope = scopeOf(c.conn);
  const self = (g.email || (await c.gateway.profile(g.access)).email).toLowerCase();
  const addrs = cur.offset >= MAX_ADDRESSES ? [] : await c.deps.store.listKnownEmails(scope, cur.offset, ADDRESS_CHUNK);
  const nextUser: Cur = { after: cur.after, startedAt, gi: cur.gi + 1, offset: 0 };
  if (!addrs.length) return { cursor: nextUser, rowsIn: 0, rowsRejected: 0, done: false, sample: { user: cur.gi, addresses: 0 } };

  const after = cur.after ?? startedAt - FIRST_LOOKBACK_DAYS * 86_400;
  const ids = await c.gateway.listThreadIds(g.access, buildQuery(addrs, after), THREADS_PER_QUERY);
  let kept = 0, added = 0, dropped = 0;
  for (const id of ids) {
    const t = await c.gateway.getThread(g.access, id);
    const msgs = (t?.messages ?? []).map((m) => parseMessage(m, self)).filter((m): m is ParsedMessage => !!m);
    const people = [...new Set(msgs.flatMap((m) => [m.from, ...m.to]).filter((a): a is string => !!a && a !== self))];
    const known = people.length ? await c.deps.store.contactsByEmail(scope, people) : new Map();
    const m = matchThread(msgs, known, self);
    if (!m.matched) { dropped++; continue; }   // never stored, never logged
    const r = await c.deps.store.saveThread(scope, { threadId: id, contact: m.contact, messages: msgs });
    kept++; added += r.added;
  }
  return { cursor: { after: cur.after, startedAt, gi: cur.gi, offset: cur.offset + ADDRESS_CHUNK }, rowsIn: added, rowsRejected: 0, done: false, sample: { user: cur.gi, threads_kept: kept, threads_dropped: dropped, messages_added: added, mode: c.gateway.kind } };
}
