// Persistence port for the Google Ads connector. Supabase implementation in store-supabase.ts (service role); tests pass a fake.
import type { ConnScope } from "../shared/mode";
import type { AdsDailyRow } from "./report";

export interface AdsStore {
  /** Finds the campaign for a Google campaign id in this workspace, creating it when unknown. `synthetic` marks Showcase rows. */
  ensureCampaign(i: { tenantId: string; workspaceId: string; externalId: string; name: string; synthetic: boolean }): Promise<string>;
  /** Upserts on (campaign, day): re-running a day replaces it, never doubles it. `source` is api for the real gateway, mock for Showcase. */
  upsertDailyMetrics(rows: AdsDailyRow[], ctx: ConnScope & { source: "api" | "mock" }): Promise<void>;
}
export interface AdsDeps {
  store: AdsStore;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
}
