// ConnectorDef for Google Sheets import, registered in src/lib/connectors/all.ts. OAuth (read-only spreadsheets scope) per workspace.
// The owner pastes a spreadsheet link and a range, maps the columns (preview in select.ts; the mapping can also come from the field-mapping
// editor, rows of object "Row"), and the `import` stream feeds the rows through the T034 planner and writer: validate, dedupe, write.
// Optional daily re-sync. Showcase: one fictional sheet, rows flagged synthetic, no network.
import type { ConnectorDef, ConnectionSecrets, SyncContext } from "../../core/types";
import { CredentialError } from "../../core/types";
import { GOOGLE_AUTH_PARAMS, GOOGLE_AUTH_URL, GOOGLE_ENV, GOOGLE_TOKEN_URL, SCOPE } from "../shared/constants";
import { isMockCredentials } from "../shared/mode";
import { refreshGoogleToken } from "../shared/token";
import { sheetsGatewayFor } from "./config";
import { CONFIG_KEY, SHEETS_CONNECTOR_ID, STREAM_IMPORT } from "./constants";
import { parseSheetConfig } from "./source";
import { sheetsStep, type SheetsDeps } from "./sync";
import { MOCK_SHEET_ID } from "./mock";

type Env = Record<string, string | undefined>;
export interface SheetsRuntime { deps: SheetsDeps; env: Env; fetchImpl?: typeof fetch }

let factory: (() => Promise<SheetsRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setSheetsRuntimeFactory(f: (() => Promise<SheetsRuntime>) | null): void { factory = f; }
async function runtime(): Promise<SheetsRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).sheetsRuntime();
}

async function importStream(ctx: SyncContext, cursor: unknown) {
  const rt = await runtime(), secrets = await ctx.secrets();
  const gateway = sheetsGatewayFor({ secrets, env: rt.env, fetchImpl: rt.fetchImpl });
  return sheetsStep({ deps: rt.deps, conn: ctx.conn, secrets, gateway, fieldMap: await rt.deps.fieldMap(ctx.conn.id), reject: (r) => ctx.reject?.(r) }, cursor);
}

export const googleSheetsConnector: ConnectorDef = {
  id: SHEETS_CONNECTOR_ID, name: "Google Sheets import", category: "data", auth: "oauth2",
  oauth: { authorizeUrl: GOOGLE_AUTH_URL, tokenUrl: GOOGLE_TOKEN_URL, scopes: [SCOPE.sheets], pkce: true, extraAuthParams: GOOGLE_AUTH_PARAMS, clientIdEnv: GOOGLE_ENV.clientId, clientSecretEnv: GOOGLE_ENV.clientSecret },
  gate: "none",
  sandbox: { supported: true, howTo: "google-sheets.sandbox" },
  capabilities: { inbound: true, outbound: false, webhooks: false },
  // Daily slot (03:40 IST). The step runs only when an import was requested (new nonce) or scheduled re-sync is on and today is not done.
  streams: [{ key: STREAM_IMPORT, schedule: { cron: "40 3 * * *", tz: "Asia/Kolkata" }, run: importStream }],
  pushes: [],
  // The field-mapping editor edits these rows: externalField = column header, localColumn = CRM field. None by default; headers auto-map.
  defaultFieldMap: [],
  rate: { requestsPerMinute: 60, maxRetries: 4, baseDelayMs: 800, maxDelayMs: 30_000 },
  async test({ secrets }) {
    const g = sheetsGatewayFor({ secrets, env: process.env as Env });
    const id = parseSheetConfig(secrets[CONFIG_KEY])?.spreadsheetId;
    if (g.kind === "mock") return { accountId: id ?? MOCK_SHEET_ID, accountLabel: "Sample spreadsheet" };
    if (!secrets.access_token) throw new CredentialError("Google credentials are incomplete. Reconnect to continue.");
    if (!id) return {};   // connected, nothing chosen yet: the token itself was verified by the refresh path
    return { accountId: id, accountLabel: (await g.info(id)).title };
  },
  async refresh({ secrets }) { return refreshGoogleToken({ secrets, env: process.env as Env }); },
};

/** For the UI layer: true when this connection runs on the Showcase (mock) gateway. */
export function isShowcaseConnection(secrets: ConnectionSecrets, env: Env): boolean { return isMockCredentials(secrets) || env.APP_ENV === "demo"; }
