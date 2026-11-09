// Google Ads daily campaign metrics into campaign_daily_metrics. Resumable (cursor = last day loaded + the window and GAQL page token),
// idempotent (upsert on campaign + day), incremental (trailing 7 days re-read because conversions are restated) and never invents a
// number: an unreadable row is rejected, not zeroed; a non-INR account without the tenant's fx_to_inr rate is rejected, not guessed.
import type { ConnectionRow, ConnectionSecrets, SyncResult } from "../../core/types";
import { CRED } from "../shared/constants";
import { asDailyCursor, planWindow, type PagedWindow } from "../shared/dates";
import { scopeOf } from "../shared/mode";
import { POLICY } from "./constants";
import type { AdsGateway } from "./gateway";
import { fxRatesOf, normaliseRow, type AdsDailyRow } from "./report";
import type { AdsDeps } from "./store";

export interface AdsStreamCtx { deps: AdsDeps; conn: ConnectionRow; secrets: ConnectionSecrets; gateway: AdsGateway; reject: (reason: string) => void }

export async function adsStep(c: AdsStreamCtx, cursorIn: unknown): Promise<SyncResult> {
  const cur = asDailyCursor(cursorIn), customerId = c.secrets[CRED.customerId];
  if (!customerId) return { cursor: cur, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_customer" } };
  const win: PagedWindow | null = cur.win ?? planWindow(c.deps.now(), cur.through, POLICY);
  if (!win) return { cursor: { through: cur.through }, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "up_to_date" } };

  const page = await c.gateway.campaignMetrics({ customerId, loginCustomerId: c.secrets[CRED.loginCustomerId], since: win.since, until: win.until, pageToken: typeof win.page === "string" ? win.page : undefined });
  const fx = fxRatesOf(c.conn.settings), currency = c.secrets[CRED.currency], campaigns = new Map<string, string>(), rows: AdsDailyRow[] = [];
  let rejected = 0;
  for (const raw of page.results) {
    const n = normaliseRow(raw, currency, fx);
    if (!n.ok) { rejected++; c.reject(n.reason); continue; }
    let campaignId = campaigns.get(n.row.externalCampaignId);
    if (!campaignId) {
      campaignId = await c.deps.store.ensureCampaign({ tenantId: c.conn.tenantId, workspaceId: c.conn.workspaceId, externalId: n.row.externalCampaignId, name: n.name, synthetic: c.gateway.kind === "mock" });
      campaigns.set(n.row.externalCampaignId, campaignId);
    }
    rows.push({ ...n.row, campaignId });
  }
  if (rows.length) await c.deps.store.upsertDailyMetrics(rows, { ...scopeOf(c.conn), source: c.gateway.kind });
  const sample = { days: `${win.since}..${win.until}`, rows: rows.length, mode: c.gateway.kind };
  if (page.nextPageToken) return { cursor: { through: cur.through, win: { since: win.since, until: win.until, page: page.nextPageToken } }, rowsIn: rows.length, rowsRejected: rejected, done: false, sample };
  return { cursor: { through: win.until }, rowsIn: rows.length, rowsRejected: rejected, done: true, sample };
}
