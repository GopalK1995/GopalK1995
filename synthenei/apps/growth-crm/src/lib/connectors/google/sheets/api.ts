// Real Google Sheets gateway (read-only): spreadsheets.get for the tab list, spreadsheets.values.get for a range. Quota (429) backs
// off inside googleJson; a spreadsheet the user cannot open is a CredentialError (reconnect with the right Google account).
import { googleJson, joinUrl, type GoogleHttpDeps } from "../shared/api";
import { A1_RANGE, MAX_RANGE_LEN, MAX_TABS, SPREADSHEET_ID } from "./constants";
import type { SheetsGateway } from "./gateway";

export interface SheetsApiOptions extends GoogleHttpDeps { base: string; token: string }

interface SpreadsheetResponse { properties?: { title?: string }; sheets?: { properties?: { title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[] }
interface ValuesResponse { values?: unknown[][] }

export function makeSheetsApi(o: SheetsApiOptions): SheetsGateway {
  const idOk = (id: string) => { if (!SPREADSHEET_ID.test(id)) throw new Error("sheets: bad spreadsheet id"); return id; };
  return {
    kind: "api",
    async info(spreadsheetId) {
      const fields = encodeURIComponent("properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))");
      const r = await googleJson<SpreadsheetResponse>({ method: "GET", url: `${joinUrl(o.base, `spreadsheets/${idOk(spreadsheetId)}`)}?fields=${fields}`, token: o.token }, o);
      const tabs = (r.sheets ?? []).slice(0, MAX_TABS).flatMap((s) => (s.properties?.title ? [{ title: s.properties.title, rows: s.properties.gridProperties?.rowCount ?? 0, cols: s.properties.gridProperties?.columnCount ?? 0 }] : []));
      return { title: r.properties?.title ?? "", tabs };
    },
    async readRange(spreadsheetId, range) {
      if (range.length > MAX_RANGE_LEN || !A1_RANGE.test(range)) throw new Error("sheets: bad range");
      const qs = new URLSearchParams({ majorDimension: "ROWS", valueRenderOption: "FORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
      const r = await googleJson<ValuesResponse>({ method: "GET", url: `${joinUrl(o.base, `spreadsheets/${idOk(spreadsheetId)}/values/${encodeURIComponent(range)}`)}?${qs}`, token: o.token }, o);
      return (r.values ?? []).map((row) => (Array.isArray(row) ? row.map((c) => (c === null || c === undefined ? "" : String(c))) : []));
    },
  };
}
