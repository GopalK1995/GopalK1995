// The seam between the Sheets import and Google. Two implementations: api.ts (Google Sheets API v4) and mock.ts (Showcase, no network).
export interface SheetTab { title: string; rows: number; cols: number }
export interface SpreadsheetInfo { title: string; tabs: SheetTab[] }

export interface SheetsGateway {
  /** "mock" never touches the network; the UI shows the Showcase label for it. */
  readonly kind: "api" | "mock";
  /** Spreadsheet title and its tabs (also proves the connected Google user can open it). */
  info(spreadsheetId: string): Promise<SpreadsheetInfo>;
  /** Cell values of an A1 range as displayed (strings), rows of possibly different length (Google omits trailing empty cells). */
  readRange(spreadsheetId: string, range: string): Promise<string[][]>;
}
