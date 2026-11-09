// Targets of the server actions for the Sheets import (behind `integrations.manage` + `leads.import` + the object's write permission,
// all from the permission catalogue). The browser sends a link, a range and a mapping, never a token. Preview writes nothing; start
// stores the configuration and audits; the action then enqueues `connector.sync {connection_id, stream: "import", trigger: "manual"}`.
import { randomToken } from "../../core/oauth";
import type { RuntimeDeps } from "../../core/ports";
import { loadSecrets } from "../../core/secrets";
import { CredentialError, type ConnectionRow } from "../../core/types";
import { isImportObject, type DupMode, type Mapping, type PlanSummary, type TargetField } from "@/lib/import/types";
import { SHEET_SOURCE, prepareSheetImport, type Prepared, type SheetImportFail, type SheetsImportPort } from "./import";
import { connectionOf, isUsable, saveSelection, type Actor, type SelectFail } from "../shared/select";
import { sheetsGatewayFor } from "./config";
import { CONFIG_KEY, PREVIEW_ROWS, SHEETS_CONNECTOR_ID, STREAM_IMPORT } from "./constants";
import type { SheetsGateway, SheetTab } from "./gateway";
import { isValidRange, parseSpreadsheetId, serializeSheetConfig, type SheetConfig } from "./source";

export type SheetFail = SelectFail | SheetImportFail | "bad_spreadsheet" | "bad_range" | "bad_object";
export type SheetResult<T> = { ok: true; value: T } | { ok: false; code: SheetFail };

const tokenFail = (e: unknown): SheetResult<never> | null => (e instanceof CredentialError ? { ok: false, code: "token_rejected" } : null);

/** Spreadsheet title and tabs (proves the connected Google user can open it). */
export async function listSheetTabs(d: RuntimeDeps, actor: Actor, connectionId: string, spreadsheet: string, fetchImpl?: typeof fetch): Promise<SheetResult<{ spreadsheetId: string; title: string; tabs: SheetTab[] }>> {
  const conn = await connectionOf(d, actor, connectionId, SHEETS_CONNECTOR_ID);
  if (!conn) return { ok: false, code: "not_found" };
  if (!isUsable(conn)) return { ok: false, code: "not_connected" };
  const spreadsheetId = parseSpreadsheetId(spreadsheet);
  if (!spreadsheetId) return { ok: false, code: "bad_spreadsheet" };
  try {
    const info = await sheetsGatewayFor({ secrets: await loadSecrets(d.vault, conn), env: d.env, fetchImpl }).info(spreadsheetId);
    return { ok: true, value: { spreadsheetId, title: info.title, tabs: info.tabs } };
  } catch (e) { const f = tokenFail(e); if (f) return f; throw e; }
}

export interface SheetInput { spreadsheet: string; range: string; object: string; mode?: DupMode; mapping?: Mapping; resync?: boolean }
export interface SheetPreview { headers: string[]; sample: Record<string, string>[]; mapping: Mapping; targets: Pick<TargetField, "key" | "label" | "kind" | "required">[]; summary: PlanSummary }

type Prep = { ok: false; code: SheetFail } | { ok: true; conn: ConnectionRow; config: SheetConfig; gateway: SheetsGateway; prep: Prepared };
async function prepared(d: RuntimeDeps, actor: Actor, connectionId: string, port: SheetsImportPort, input: SheetInput, fetchImpl?: typeof fetch): Promise<Prep> {
  const conn = await connectionOf(d, actor, connectionId, SHEETS_CONNECTOR_ID);
  if (!conn) return { ok: false, code: "not_found" };
  if (!isUsable(conn)) return { ok: false, code: "not_connected" };
  const spreadsheetId = parseSpreadsheetId(input.spreadsheet);
  if (!spreadsheetId) return { ok: false, code: "bad_spreadsheet" };
  if (!isValidRange(input.range)) return { ok: false, code: "bad_range" };
  if (!isImportObject(input.object)) return { ok: false, code: "bad_object" };
  const config: SheetConfig = { spreadsheetId, range: input.range, object: input.object, mode: input.mode ?? "skip", mapping: input.mapping ?? {}, resync: input.resync === true, nonce: "preview" };
  const gateway = sheetsGatewayFor({ secrets: await loadSecrets(d.vault, conn), env: d.env, fetchImpl });
  const prep = await prepareSheetImport({ conn, gateway, port, config, fieldMap: await d.store.getFieldMap(conn.id) });
  return { ok: true, conn, config, gateway, prep };
}

/** Reads the range and returns headers, a few rows, the suggested mapping and what an import would do. Writes nothing. */
export async function previewSheet(d: RuntimeDeps, actor: Actor, connectionId: string, port: SheetsImportPort, input: SheetInput, fetchImpl?: typeof fetch): Promise<SheetResult<SheetPreview>> {
  try {
    const r = await prepared(d, actor, connectionId, port, input, fetchImpl);
    if (!r.ok) return r;
    if (!r.prep.ok) return { ok: false, code: r.prep.reason };
    const p = r.prep;
    return { ok: true, value: { headers: p.sheet.headers, sample: p.sheet.rows.slice(0, PREVIEW_ROWS).map((x) => x.cells), mapping: p.mapping, targets: p.targets.map(({ key, label, kind, required }) => ({ key, label, kind, required })), summary: p.summary } };
  } catch (e) { const f = tokenFail(e); if (f) return f; throw e; }
}

/**
 * Saves the configuration (with a fresh nonce, so the stream imports once) and audits. The mapping must be complete: a preview that
 * cannot plan (empty range, required column unmapped) is refused here instead of failing later in a scheduled run.
 */
export async function startSheetImport(d: RuntimeDeps, actor: Actor, connectionId: string, port: SheetsImportPort, input: SheetInput, fetchImpl?: typeof fetch): Promise<SheetResult<{ nonce: string; summary: PlanSummary; stream: typeof STREAM_IMPORT }>> {
  try {
    const r = await prepared(d, actor, connectionId, port, input, fetchImpl);
    if (!r.ok) return r;
    if (!r.prep.ok) return { ok: false, code: r.prep.reason };
    const config: SheetConfig = { ...r.config, mapping: r.prep.mapping, nonce: randomToken(12) };
    const info = await r.gateway.info(config.spreadsheetId);
    const saved = await saveSelection(d, r.conn, { [CONFIG_KEY]: serializeSheetConfig(config) }, { id: config.spreadsheetId, label: info.title || config.spreadsheetId }, [],
      { action: "google_sheets.import_requested", summary: "Requested a Google Sheets import", detail: { object: config.object, mode: config.mode, resync: config.resync, rows: r.prep.summary.total, source: SHEET_SOURCE } });
    return saved.ok ? { ok: true, value: { nonce: config.nonce, summary: r.prep.summary, stream: STREAM_IMPORT } } : saved;
  } catch (e) { const f = tokenFail(e); if (f) return f; throw e; }
}
