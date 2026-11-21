// ConnectorDef for the channel manager (registered in src/lib/connectors/all.ts; id "channel-manager"). The partner is not chosen (B-6), so
// the adapter is the generic shell (generic.ts); picking a partner means writing one more `ChannelManager` and returning it from the runtime.
//   stream reservations (every 15 min): pull changes since the cursor and apply them to `booking` records. Webhooks are the fast path,
//                                        this is the safety net; both go through applyReservationEvent, so a repeat is a no-op.
//   stream availability (every 30 min): push the closed ranges per room when they changed since the last successful push.
//   webhook: signature already verified by the receiver; this parses and applies.
// Sandbox: the fixture token (or APP_ENV=demo without a key) serves scripted data, no network; refused in production.
import { CredentialError, type ConnectorDef, type SyncContext, type SyncResult, type VendorHttp } from "../core/types";
import { applyReservationEvent, type ApplyOutcome } from "./apply";
import { buildSnapshot, snapshotHash } from "./availability";
import type { BookingRecordStore, Log, RecordScope } from "./booking-store";
import { CM_AVAILABILITY_CRON, CM_CRED, CM_ENV, CM_FIXTURE_TOKEN, CM_ID, CM_RESERVATIONS_CRON, CM_STREAMS } from "./constants";
import { fixtureHttp } from "./fixtures";
import { genericChannelManager } from "./generic";
import { dateInZone, validZone } from "./tz";
import type { AdapterContext, ChannelManager, ReservationEvent } from "./types";

type Env = Record<string, string | undefined>;
export interface CmRuntime { store: BookingRecordStore; log: Log; now: () => Date; env: Env; adapter: ChannelManager }
let factory: (() => Promise<CmRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setChannelManagerRuntimeFactory(f: (() => Promise<CmRuntime>) | null): void { factory = f; }
export async function channelManagerRuntime(): Promise<CmRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).channelManagerServiceRuntime();
}

/** True when the fixture gateway serves this connection. The sandbox token is refused in production: a tenant presenting it there gets a credential error. */
export function useFixtures(secrets: Record<string, string>, env: Env): boolean {
  const demo = env.APP_ENV === "demo" && !secrets[CM_CRED.apiKey];
  if (secrets[CM_CRED.apiKey] === CM_FIXTURE_TOKEN || demo) {
    if (env.APP_ENV === "production") throw new CredentialError("The sandbox token is not accepted in production");
    return true;
  }
  return false;
}

const scopeOf = (c: SyncContext["conn"]): RecordScope => ({ tenantId: c.tenantId, workspaceId: c.workspaceId, connectionId: c.id });
const settingsZone = (c: SyncContext["conn"]): string => { const z = c.settings?.timezone; return typeof z === "string" && validZone(z) ? z : "UTC"; };

async function adapterCtx(ctx: SyncContext, rt: CmRuntime): Promise<AdapterContext> {
  const secrets = await ctx.secrets();
  const http: VendorHttp = useFixtures(secrets, rt.env) ? fixtureHttp() : ctx.http;
  return { secrets, apiBase: useFixtures(secrets, rt.env) ? "https://fixture.invalid" : ctx.apiBase, http };
}

const COUNT_AS_ROW = new Set<ApplyOutcome["outcome"]>(["created", "updated", "cancelled"]);

async function applyAll(rt: CmRuntime, ctx: SyncContext, events: ReservationEvent[]): Promise<{ rowsIn: number; rejected: number }> {
  let rowsIn = 0, rejected = 0;
  for (const ev of events) {
    const r = await applyReservationEvent({ store: rt.store, log: rt.log }, scopeOf(ctx.conn), ev);
    if (r.outcome === "no_booking_object") throw new Error("This workspace has no Booking object. Enable the hospitality preset, then retry.");
    if (r.outcome === "rejected") { rejected++; ctx.reject?.(r.reason); continue; }
    if (COUNT_AS_ROW.has(r.outcome)) rowsIn++;
  }
  return { rowsIn, rejected };
}

async function runReservations(ctx: SyncContext, cursor: unknown): Promise<SyncResult> {
  const rt = await channelManagerRuntime();
  const a = await adapterCtx(ctx, rt);
  const page = await rt.adapter.listChanges(a, typeof cursor === "string" ? cursor : null);
  for (let i = 0; i < page.rejected; i++) ctx.reject?.("unreadable_item");
  const { rowsIn, rejected } = await applyAll(rt, ctx, page.events);
  return { cursor: page.nextCursor, rowsIn, rowsRejected: rejected + page.rejected, done: page.done, sample: page.events.slice(0, 3).map((e) => ({ kind: e.kind, channel: e.reservation.channel, room: e.reservation.room })) };
}

async function runAvailability(ctx: SyncContext, cursor: unknown): Promise<SyncResult> {
  const rt = await channelManagerRuntime();
  const a = await adapterCtx(ctx, rt);
  const today = dateInZone(rt.now().getTime(), settingsZone(ctx.conn));
  const blocking = await rt.store.listBlocking({ tenantId: ctx.conn.tenantId, workspaceId: ctx.conn.workspaceId }, { fromDate: today, limit: 5000 });
  const { snapshot, unassigned } = buildSnapshot(blocking, today);
  const hash = snapshotHash(snapshot);
  const last = cursor && typeof cursor === "object" ? (cursor as { hash?: unknown }).hash : null;
  if (last === hash) return { cursor, rowsIn: 0, rowsRejected: 0, done: true, sample: { pushed: false, unassigned } };
  await rt.adapter.pushAvailability(a, snapshot);   // a failure throws: the cursor does not advance and the next run pushes again
  return { cursor: { hash }, rowsIn: 0, rowsRejected: 0, done: true, sample: { pushed: true, ranges: snapshot.closed.length, unassigned } };
}

export const channelManagerConnector: ConnectorDef = {
  id: CM_ID, name: "Channel manager", category: "ota", auth: "api_key",
  credentialFields: [
    { key: CM_CRED.apiKey, label: "API key", secret: true },
    { key: CM_CRED.webhookSecret, label: "Webhook secret (any long random string)", secret: true, pattern: "^[A-Za-z0-9_\\-]{24,128}$" },
  ],
  gate: "needs_vendor_approval",
  sandbox: { supported: true, howTo: "channelManager.sandbox" },
  capabilities: { inbound: true, outbound: true, webhooks: true },
  streams: [
    { key: CM_STREAMS.reservations, schedule: { cron: CM_RESERVATIONS_CRON, tz: "Asia/Kolkata" }, run: runReservations },
    { key: CM_STREAMS.availability, schedule: { cron: CM_AVAILABILITY_CRON, tz: "Asia/Kolkata" }, run: runAvailability },
  ],
  pushes: [],
  webhook: {
    // The receiver verified the signature on the raw body; this only parses it (unreadable input yields no events).
    async verify(req) { return genericChannelManager.parseWebhook(req.rawBody).events; },
    async handle(ctx, evt) {
      const rt = await channelManagerRuntime();
      await applyAll(rt, ctx, [evt as ReservationEvent]);
    },
  },
  defaultFieldMap: [],
  rate: { requestsPerMinute: 60, maxRetries: 3, baseDelayMs: 500, maxDelayMs: 15_000 },
  requiredEnv: [],
  apiBaseEnv: CM_ENV.apiBase,
  async test({ secrets, http, apiBase }) {
    if (useFixtures(secrets, process.env)) return genericChannelManager.test({ secrets, http: fixtureHttp(), apiBase: "https://fixture.invalid" });
    return genericChannelManager.test({ secrets, http, apiBase });
  },
};
