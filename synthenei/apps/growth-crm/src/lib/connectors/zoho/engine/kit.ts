// Glue between a vendor connector and the engine: builds the engine context for a stream or a webhook delivery, and the two
// scheduled streams (pull = initial import + incremental, push = CRM changes out). Used by the Zoho and HubSpot connectors.
import type { ConnectionRow, ConnectionSecrets, FieldMapSpec, Logger, StreamDef, SyncContext, SyncResult, VendorHttp } from "../../core/types";
import { effective } from "./map";
import { applyRemote, objectCtx, pullStep, pushStep } from "./run";
import { emptyTally, optionsOf, type CrmGateway, type CrmObject, type CrmStore, type EngineCtx, type SyncOptions } from "./types";
import { stripPii } from "../../core/pii";

type Env = Record<string, string | undefined>;
export interface CrmRuntime { store: CrmStore; env: Env; log: Logger; now: () => Date; fetchImpl?: typeof fetch }

export interface VendorKit {
  vendorKey: "zoho" | "hubspot";
  /** Defaults the tenant's saved rows override; may depend on the connection's options. */
  defaultMap: FieldMapSpec[] | ((o: SyncOptions) => FieldMapSpec[]);
  gatewayFor(i: { conn: ConnectionRow; secrets: ConnectionSecrets; http: VendorHttp; env: Env; apiBase: string; now: () => Date }): CrmGateway;
  /** Limits the objects this vendor can sync for the connection's options (HubSpot has one people object). */
  objectsFor?(o: SyncOptions): CrmObject[];
}

export async function engineFor(rt: CrmRuntime, kit: VendorKit, ctx: SyncContext, secrets: ConnectionSecrets): Promise<EngineCtx> {
  const tenant = await rt.store.core.getFieldMap(ctx.conn.id);
  const options = optionsOf(ctx.conn.settings);
  const objects = kit.objectsFor ? kit.objectsFor(options) : options.objects;
  return {
    store: rt.store, vendorKey: kit.vendorKey, conn: { id: ctx.conn.id, tenantId: ctx.conn.tenantId, workspaceId: ctx.conn.workspaceId },
    gateway: kit.gatewayFor({ conn: ctx.conn, secrets, http: ctx.http, env: rt.env, apiBase: ctx.apiBase, now: rt.now }),
    fieldMap: effective(typeof kit.defaultMap === "function" ? kit.defaultMap(options) : kit.defaultMap, tenant), options: { ...options, objects }, runId: ctx.runId,
    reject: (r) => ctx.reject?.(r), log: rt.log, now: rt.now,
  };
}

/** Pull and push, as scheduled streams. Offsets keep the two from running on the same connection at the same minute. */
export function crmStreams(kit: VendorKit, runtime: () => Promise<CrmRuntime>): StreamDef[] {
  const step = (which: "pull" | "push") => async (ctx: SyncContext, cursor: unknown): Promise<SyncResult> => {
    const rt = await runtime();
    const c = await engineFor(rt, kit, ctx, await ctx.secrets());
    const r = which === "pull" ? await pullStep(c, cursor) : await pushStep(c, cursor);
    return { cursor: r.cursor, rowsIn: r.rowsIn, rowsRejected: r.rowsRejected, done: r.done, sample: stripPii(r.sample) };
  };
  return [
    { key: "pull", schedule: { cron: "*/15 * * * *", tz: "Asia/Kolkata" }, run: step("pull") },
    { key: "push", schedule: { cron: "7,22,37,52 * * * *", tz: "Asia/Kolkata" }, run: step("push") },
  ];
}

/** A webhook delivery names records: fetch them with THIS connection's token and reconcile / import them. */
export async function applyIds(rt: CrmRuntime, kit: VendorKit, ctx: SyncContext, object: CrmObject, ids: string[]): Promise<{ applied: number }> {
  const c = await engineFor(rt, kit, ctx, await ctx.secrets());
  if (!c.options.objects.includes(object)) return { applied: 0 };
  const oc = objectCtx(c, object);
  if (!oc.specs.length || !ids.length) return { applied: 0 };
  const records = await c.gateway.getMany(object, [...new Set(ids)].slice(0, 100), oc.wanted);
  const tally = emptyTally();
  await applyRemote(c, oc, records, tally);
  return { applied: records.length };
}
