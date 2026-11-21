// ConnectorDef for the generic iCal fallback (registered in src/lib/connectors/all.ts; id "ical"). No vendor approval, no credentials: the
// connection exists so the 30-minute poll, the sync_runs history and the needs_attention state work like every other connector. The
// calendar links themselves are rows in ical_feeds (URL in the Vault), added through manage.ts.
//   stream import (every 30 min): fetch every feed, reconcile `booking` records (sync.ts).
//   test: re-reads each feed once without importing; success clears the failure counters so a needs_attention connection can resume.
import { CredentialError, type ConnectorDef, type SyncContext, type SyncResult } from "../core/types";
import { ICAL_ID, ICAL_POLL_CRON, ICAL_STREAM } from "./constants";
import { probeFeed } from "./manage";
import { runIcalImport } from "./sync";
import type { FeedScope, IcalDeps } from "./store";

export interface IcalRuntime { deps: IcalDeps }
let factory: (() => Promise<IcalRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setIcalRuntimeFactory(f: (() => Promise<IcalRuntime>) | null): void { factory = f; }
export async function icalRuntime(workspaceId: string | null = null): Promise<IcalRuntime> {
  if (factory) return factory();
  return { deps: (await import("./runtime")).icalServiceDeps(workspaceId) };
}

const scopeOf = (c: SyncContext["conn"]): FeedScope => ({ tenantId: c.tenantId, workspaceId: c.workspaceId, connectionId: c.id });
const zoneOf = (c: SyncContext["conn"]): string => (typeof c.settings?.timezone === "string" ? c.settings.timezone : "UTC");

async function runImport(ctx: SyncContext): Promise<SyncResult> {
  const { deps } = await icalRuntime(ctx.conn.workspaceId);
  const r = await runIcalImport(deps, scopeOf(ctx.conn), zoneOf(ctx.conn));
  for (let i = 0; i < r.rejected; i++) ctx.reject?.("feed_or_event_rejected");
  return { cursor: null, rowsIn: r.rowsIn, rowsRejected: r.rejected, done: true, sample: { feeds: r.feeds, failedFeeds: r.failedFeeds } };
}

export const icalConnector: ConnectorDef = {
  id: ICAL_ID, name: "Calendar feeds (iCal)", category: "ota", auth: "api_key",
  credentialFields: [],
  gate: "none",
  sandbox: { supported: false, howTo: "ical.sandbox" },
  capabilities: { inbound: true, outbound: false, webhooks: false },
  streams: [{ key: ICAL_STREAM, schedule: { cron: ICAL_POLL_CRON, tz: "Asia/Kolkata" }, run: (ctx) => runImport(ctx) }],
  pushes: [],
  defaultFieldMap: [],
  rate: { requestsPerMinute: 30, maxRetries: 1, baseDelayMs: 500, maxDelayMs: 5_000 },
  async test({ conn }) {
    if (conn.id === "pending") return { accountLabel: "0 calendar feeds" };   // first connect: feeds are added afterwards
    const { deps } = await icalRuntime(conn.workspaceId);
    const scope = scopeOf(conn);
    const feeds = await deps.store.listFeeds(scope);
    for (const f of feeds) {
      const url = await deps.store.feedUrl(f);
      const r = url ? await probeFeed(deps, url) : ({ ok: false } as const);
      if (!r.ok) throw new CredentialError("A calendar link no longer works");
    }
    await deps.store.resetFailures(scope);
    return { accountLabel: `${feeds.length} calendar feed${feeds.length === 1 ? "" : "s"}` };
  },
};
