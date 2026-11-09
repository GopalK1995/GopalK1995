// Google Sheets import connector constants. No spreadsheet ids, brands or URLs of any tenant live here.
export const SHEETS_CONNECTOR_ID = "google-sheets" as const;
export const DEFAULT_SHEETS_API_BASE = "https://sheets.googleapis.com/v4";
export const STREAM_IMPORT = "import" as const;

/** Field-map external object for sheet columns (the field-mapping editor edits rows of this object: externalField = column header). */
export const SHEET_OBJECT = "Row";
/** Credential-bundle key holding the saved import configuration (JSON). Not a secret, but it is per connection and needs no table. */
export const CONFIG_KEY = "sheet_config";

export const SPREADSHEET_ID = /^[A-Za-z0-9_-]{10,100}$/;
/** A1 notation: optional `Tab!` or `'Tab name'!` prefix, then A1, A:F, A1:F500 ... Rejects anything that could alter the request path. */
export const A1_RANGE = /^(?:(?:'[^'\\!]{1,100}'|[A-Za-z0-9_.-]{1,100})!)?[A-Za-z]{1,3}\d{0,7}(?::[A-Za-z]{1,3}\d{0,7})?$/;
export const MAX_RANGE_LEN = 220;
export const MAX_TABS = 200;
export const PREVIEW_ROWS = 5;
