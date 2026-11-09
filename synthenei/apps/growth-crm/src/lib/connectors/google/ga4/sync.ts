// GA4 daily report stream. Resumable (cursor = last day loaded + the window and page offset in flight), idempotent (the window is
// replaced, not appended), incremental (after the first backfill only the trailing days are re-read) and never invents a number:
// an unreadable row is rejected, not zeroed.
import type { ConnectionRow, ConnectionSecrets, SyncResult } from "../../core/types";
import { CRED } from "../shared/constants";
import { asDailyCursor, planWindow, type PagedWindow } from "../shared/dates";
import { scopeOf } from "../shared/mode";
import { POLICY, REPORT_PAGE_SIZE } from "./constants";
import type { Ga4Gateway } from "./gateway";
import { mergeRows, normaliseRow, parseReport, type Ga4DailyRow } from "./report";
import type { Ga4Deps } from "./store";

export interface Ga4StreamCtx { deps: Ga4Deps; conn: ConnectionRow; secrets: ConnectionSecrets; gateway: Ga4Gateway; reject: (reason: string) => void }

export async function ga4Step(c: Ga4StreamCtx, cursorIn: unknown, pageSize = REPORT_PAGE_SIZE): Promise<SyncResult> {
  const cur = asDailyCursor(cursorIn), propertyId = c.secrets[CRED.propertyId];
  if (!propertyId) return { cursor: cur, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_property" } };
  const win: PagedWindow | null = cur.win ?? planWindow(c.deps.now(), cur.through, POLICY);
  if (!win) return { cursor: { through: cur.through }, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "up_to_date" } };
  const offset = typeof win.page === "number" ? win.page : 0, source = c.gateway.kind, scope = scopeOf(c.conn);

  if (offset === 0) await c.deps.store.clearWindow(scope, win.since, win.until, source);
  const rep = parseReport(await c.gateway.runReport({ propertyId, since: win.since, until: win.until, offset, limit: pageSize }));
  const rows: Ga4DailyRow[] = [];
  let rejected = 0;
  for (const raw of rep.rows) {
    const n = normaliseRow(raw);
    if (!n.ok) { rejected++; c.reject(n.reason); continue; }
    rows.push(n.row);
  }
  if (rows.length) await c.deps.store.upsertDaily(mergeRows(rows, true), { ...scope, source });

  const sample = { days: `${win.since}..${win.until}`, offset, rows: rows.length, mode: c.gateway.kind, other_row: rep.otherRow, thresholded: rep.thresholded };
  const next = offset + rep.rows.length;
  if (rep.rows.length > 0 && next < rep.rowCount) {
    return { cursor: { through: cur.through, win: { since: win.since, until: win.until, page: next } }, rowsIn: rows.length, rowsRejected: rejected, done: false, sample };
  }
  return { cursor: { through: win.until }, rowsIn: rows.length, rowsRejected: rejected, done: true, sample };
}
