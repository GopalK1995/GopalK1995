// Sheets import stream. One stream (`import`), scheduled daily and also run by "Run sync now". It runs the saved configuration when
//   (a) the owner asked for an import: the config carries a fresh `nonce` the cursor has not seen (one-time import), or
//   (b) the owner enabled scheduled re-sync and today (IST) has not been synced yet.
// The cursor {nonce, day} is the only state, so the stream never needs to write the credential bundle. Duplicates are handled by the
// T034 planner (email, E.164 phone, account name + city), so a re-sync never doubles a record: skip keeps the stored record, merge
// writes the mapped non-empty values over it.
import type { ConnectionRow, ConnectionSecrets, FieldMapSpec, SyncResult } from "../../core/types";
import { istDay } from "../shared/dates";
import { CONFIG_KEY } from "./constants";
import type { SheetsGateway } from "./gateway";
import { runSheetImport, type SheetsImportPort } from "./import";
import { parseSheetConfig } from "./source";

export interface SheetsDeps {
  port: SheetsImportPort;
  /** The tenant's saved field-mapping rows for this connection (object "Row"). */
  fieldMap(connectionId: string): Promise<FieldMapSpec[]>;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
}
export interface SheetsStreamCtx { deps: SheetsDeps; conn: ConnectionRow; secrets: ConnectionSecrets; gateway: SheetsGateway; fieldMap: FieldMapSpec[]; reject: (reason: string) => void }
export interface SheetsCursor { nonce?: string; day?: string }
const asCursor = (c: unknown): SheetsCursor => {
  const o = c && typeof c === "object" ? (c as SheetsCursor) : {};
  return { nonce: typeof o.nonce === "string" ? o.nonce : undefined, day: typeof o.day === "string" ? o.day : undefined };
};

/** Whether a run is due for this cursor and config (exported for the unit tests). */
export function isDue(cur: SheetsCursor, cfg: { nonce: string; resync: boolean }, now: Date): boolean {
  return cur.nonce !== cfg.nonce || (cfg.resync && cur.day !== istDay(now));
}

export async function sheetsStep(c: SheetsStreamCtx, cursorIn: unknown): Promise<SyncResult> {
  const cfg = parseSheetConfig(c.secrets[CONFIG_KEY]), cur = asCursor(cursorIn);
  if (!cfg) return { cursor: cur, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_sheet" } };
  if (!isDue(cur, cfg, c.deps.now())) return { cursor: cur, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "not_due" } };

  const res = await runSheetImport({ conn: c.conn, gateway: c.gateway, port: c.deps.port, config: cfg, fieldMap: c.fieldMap });
  const next: SheetsCursor = { nonce: cfg.nonce, day: istDay(c.deps.now()) };
  if (!res.ok) {
    // A configuration problem (empty range, unmapped required column, too many rows) will not fix itself: record it, advance the cursor
    // so it is not retried every scan, and let the run show as partial with the reason. The owner fixes the config and imports again.
    c.reject(res.reason ?? "failed");
    return { cursor: next, rowsIn: 0, rowsRejected: 1, done: true, sample: { failed: res.reason, mode: c.gateway.kind } };
  }
  let rejected = 0;
  for (const [reason, n] of Object.entries(res.rejected)) for (let i = 0; i < n; i++) { rejected++; c.reject(reason); }
  return {
    cursor: next, rowsIn: res.created + res.merged, rowsRejected: rejected, done: true,
    sample: { mode: c.gateway.kind, created: res.created, merged: res.merged, skipped_duplicates: res.skipped, invalid: res.summary?.invalid ?? 0, duplicates: res.summary?.duplicates ?? 0 },
  };
}
