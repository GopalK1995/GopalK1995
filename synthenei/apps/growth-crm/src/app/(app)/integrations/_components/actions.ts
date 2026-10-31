"use server";
// Integration mutations. Every action: zod-validates input, calls assertCan("integrations.manage") (support sessions are
// blocked by the catalogue), has a demo branch that never touches Supabase, and relies on RLS as the second line.
// Credentials are passed once to the Vault through the framework and never come back in any result.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActive } from "@/lib/auth/server";
import { can } from "@/lib/auth/roles";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { connectWithCredentials, disconnect, testConnection, type LifecycleFail } from "@/lib/connectors/core/lifecycle";
import { applyFieldMap, effectiveMap, encodeTransform, validateFieldMap } from "@/lib/connectors/core/field-map";
import { isTransformKey } from "@/lib/connectors/core/transforms";
import { requestRuntime } from "@/lib/connectors/core/runtime";
import { isRunnable } from "@/lib/connectors/core/sync";
import { getConnector } from "@/lib/connectors/registry";
import type { FieldMapSpec } from "@/lib/connectors/core/types";
import { from } from "@/lib/db/query";
import { throwIfError } from "@/lib/db/errors";
import { enqueue } from "@/lib/jobs/registry";
import { getIntT } from "../_lib/strings";
import { manageCtx, type IntCtx } from "../_lib/ctx";
import { MAP_TABLES } from "../_lib/types";

// ---- Demo showcase actions (unchanged behaviour: nothing is stored, no vendor is called) ----
type DemoResult = { ok: boolean; message: string; detail?: string };

export async function connectIntegration(id: string): Promise<DemoResult> {
  const { active } = await requireActive();
  if (active.support) return { ok: false, message: "Not available in a support session", detail: "Connecting integrations is on the support never-list." };
  if (!can("connectIntegrations", { role: active.role, support: active.support })) return { ok: false, message: "Only the workspace Owner can connect integrations." };
  return { ok: true, message: `Connect request noted for ${id}`, detail: "Showcase: no credentials stored, no vendor called. Going live needs the listed account access and a vault secret." };
}

export async function runSyncNow(id: string): Promise<DemoResult> {
  const { active } = await requireActive();
  if (active.support?.mode === "read_only") return { ok: false, message: "Read-only support session", detail: "Syncs cannot be started." };
  if (!(active.role === "owner" || active.role === "data")) return { ok: false, message: "Only Owner or Data can run a sync." };
  return { ok: true, message: `Sync for ${id} not started`, detail: "Showcase connector: there is nothing to sync until it is connected. CSV import is the live path." };
}

// ---- Real actions ----
const CODE: Record<LifecycleFail, "invalid" | "not_found" | "conflict" | "error"> = {
  unknown_connector: "not_found", not_found: "not_found", invalid_input: "invalid", credentials_rejected: "invalid", wrong_auth: "invalid",
  already_connected: "conflict", not_available: "error", not_configured: "error", needs_vendor_approval: "error", needs_client_credentials: "error", vault_failed: "error", audit_failed: "error",
};

async function runtimeFor(c: IntCtx) {
  return requestRuntime(async (e) => {
    await audit(actorFromPrincipal(c.principal), { action: e.action, summary: e.summary, object: { table: "integrations", id: e.connectionId }, detail: e.detail });
  });
}
const demoDone = async (): Promise<ActionResult> => { const t = await getIntT(); return okResult(t("demoNotSaved")); };
const idSchema = z.string().min(1).max(64);

export async function connectConnector(connectorId: string, credentials: Record<string, string>): Promise<ActionResult> {
  return runAction(async () => {
    const input = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/), creds: z.record(z.string().max(64), z.string().max(4096)) }).parse({ id: connectorId, creds: credentials });
    const c = await manageCtx();
    if (c.demo) return demoDone();
    const t = await getIntT();
    const def = getConnector(input.id);
    const r = await connectWithCredentials(await runtimeFor(c), { uid: c.uid, tenantId: c.tenant, workspaceId: c.ws }, input.id, input.creds);
    if (!r.ok) return failResult(CODE[r.code], t(`err.${r.code}`, { field: r.field ?? "" }), r.field ? { issues: [{ path: r.field, message: t("err.invalid_input", { field: r.field }) }] } : undefined);
    revalidatePath("/integrations");
    return okResult(t(r.value.mode === "sandbox" ? "connectedSandboxMsg" : "connectedMsg", { name: def?.name ?? input.id }), { sub: r.value.mode === "sandbox" ? t("chipHint.sandbox") : undefined });
  });
}

async function connectionOf(c: IntCtx, connectionId: string) {
  const rt = await runtimeFor(c);
  const conn = await rt.store.getConnection(connectionId);
  return conn && conn.workspaceId === c.ws ? { rt, conn } : null;
}

export async function testConnector(connectionId: string): Promise<ActionResult<{ healthy: boolean }>> {
  return runAction(async () => {
    const id = idSchema.parse(connectionId);
    const c = await manageCtx();
    if (c.demo) return demoDone() as Promise<ActionResult<{ healthy: boolean }>>;
    const t = await getIntT();
    const found = await connectionOf(c, id);
    if (!found) return failResult("not_found", t("err.not_found"));
    const r = await testConnection(found.rt, id);
    revalidatePath("/integrations");
    if (!r.ok) return failResult(CODE[r.code], t(`err.${r.code}`));
    return r.value.healthy ? okResult(t("testOkMsg"), { data: { healthy: true } }) : failResult("error", t("testFailMsg"), { sub: t("testFailSub") });
  });
}

export async function disconnectConnector(connectionId: string): Promise<ActionResult> {
  return runAction(async () => {
    const id = idSchema.parse(connectionId);
    const c = await manageCtx();
    if (c.demo) return demoDone();
    const t = await getIntT();
    const found = await connectionOf(c, id);
    if (!found) return failResult("not_found", t("err.not_found"));
    const r = await disconnect(found.rt, id, c.uid);
    if (!r.ok) return failResult(CODE[r.code], t(`err.${r.code}`));
    revalidatePath("/integrations");
    return okResult(t("disconnectedMsg", { name: getConnector(found.conn.connectorId)?.name ?? found.conn.connectorId }));
  });
}

/** Queues a manual sync on connector_sync. The tick runs it (idempotent: a stream already running is skipped). */
export async function runSyncConnector(connectionId: string): Promise<ActionResult> {
  return runAction(async () => {
    const id = idSchema.parse(connectionId);
    const c = await manageCtx();
    if (c.demo) return demoDone();
    const t = await getIntT();
    const found = await connectionOf(c, id);
    if (!found) return failResult("not_found", t("err.not_found"));
    if (!isRunnable(found.conn)) return failResult("invalid", t("blocked.not_connected"));
    await enqueue("connector_sync", "connector.sync", { connection_id: id, trigger: "manual", started_by: c.uid, dedupe: `manual:${id}:${Date.now()}` }, { tenantId: c.tenant });
    revalidatePath("/integrations");
    return okResult(t("syncQueuedMsg"), { sub: t("syncQueuedSub") });
  });
}

// ---- Field mapping ----
const mapRow = z.object({
  externalObject: z.string().min(1).max(80), externalField: z.string().min(1).max(120), localTable: z.string().max(40), localColumn: z.string().max(63),
  direction: z.enum(["in", "out", "both"]), transform: z.string().max(40).nullable(), transformArg: z.string().max(2000),
});
const mapInput = z.object({ connectionId: idSchema, rows: z.array(mapRow).max(200) });

function toSpecs(rows: z.infer<typeof mapRow>[]): { specs: FieldMapSpec[]; badArg: number | null } {
  let badArg: number | null = null;
  const specs = rows.map((r, i): FieldMapSpec => {
    let arg: Record<string, unknown> | null = null;
    if (r.transformArg.trim()) { try { const v = JSON.parse(r.transformArg) as unknown; if (v && typeof v === "object" && !Array.isArray(v)) arg = v as Record<string, unknown>; else badArg ??= i; } catch { badArg ??= i; } }
    return { externalObject: r.externalObject.trim(), externalField: r.externalField.trim(), localTable: r.localTable, localColumn: r.localColumn.trim(), direction: r.direction, transform: r.transform && isTransformKey(r.transform) ? r.transform : (r.transform as never), transformArg: arg };
  });
  return { specs, badArg };
}

type Del = { delete(): { eq(c: string, v: unknown): PromiseLike<{ error: { message?: string } | null }> } };
type Ups = { upsert(v: Record<string, unknown>[], o: { onConflict: string }): PromiseLike<{ error: { message?: string } | null }> };

export async function saveFieldMap(input: { connectionId: string; rows: z.infer<typeof mapRow>[] }): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = mapInput.parse(input);
    const c = await manageCtx();
    if (c.demo) return demoDone();
    const t = await getIntT();
    const found = await connectionOf(c, parsed.connectionId);
    if (!found || !c.db) return failResult("not_found", t("err.not_found"));
    const { specs, badArg } = toSpecs(parsed.rows);
    const issues = validateFieldMap(specs, MAP_TABLES).map((i) => ({ path: String(i.index), message: t(`map.${i.message}`) }));
    if (badArg !== null) issues.push({ path: String(badArg), message: t("map.stage_map_required") });
    if (issues.length) return failResult("invalid", t("err.generic"), { issues });
    const def = getConnector(found.conn.connectorId);
    // Store only rows that differ from the connector default (the default stays in code); a row equal to the default is dropped.
    const key = (f: FieldMapSpec) => `${f.externalObject}\u0000${f.externalField}`;
    const defaults = new Map((def?.defaultFieldMap ?? []).map((f) => [key(f), f]));
    const same = (a: FieldMapSpec, b?: FieldMapSpec) => !!b && a.localTable === b.localTable && a.localColumn === b.localColumn && a.direction === b.direction && (a.transform ?? null) === (b.transform ?? null) && JSON.stringify(a.transformArg ?? null) === JSON.stringify(b.transformArg ?? null);
    const custom = specs.filter((f) => !same(f, defaults.get(key(f))));
    const wanted = custom.map((f) => ({
      tenant_id: c.tenant, workspace_id: c.ws, integration_id: found.conn.id, external_object: f.externalObject, external_field: f.externalField, local_table: f.localTable,
      local_column: f.localColumn, direction: f.direction, transform: encodeTransform(f.transform, f.transformArg),
    }));
    const tbl = (from(c.db, "integration_field_maps") as unknown) as Ups & Del;
    if (wanted.length) throwIfError((await tbl.upsert(wanted, { onConflict: "integration_id,external_object,external_field" })).error as never);
    // Remove saved rows that are no longer custom.
    const existing = await found.rt.store.getFieldMap(found.conn.id);
    const keep = new Set(custom.map(key));
    for (const e of existing) if (!keep.has(key(e))) {
      const del = (from(c.db, "integration_field_maps") as unknown) as { delete(): { eq(c: string, v: unknown): { eq(c: string, v: unknown): { eq(c: string, v: unknown): PromiseLike<{ error: { message?: string } | null }> } } } };
      throwIfError((await del.delete().eq("integration_id", found.conn.id).eq("external_object", e.externalObject).eq("external_field", e.externalField)).error as never);
    }
    await audit(actorFromPrincipal(c.principal), { action: "connector.mapping_changed", summary: `Changed the field mapping for ${def?.name ?? found.conn.connectorId}`, object: { table: "integrations", id: found.conn.id }, detail: { rows: custom.length } });
    revalidatePath(`/integrations/${found.conn.connectorId}`);
    return okResult(t("mapSavedMsg"));
  });
}

/** Applies an unsaved map to a sample record so the editor can show the result. No data is read or written. */
export async function previewFieldMap(input: { connectorId: string; rows: z.infer<typeof mapRow>[]; sample: string }): Promise<ActionResult<{ mapped: Record<string, Record<string, unknown>>; rejected: string[] }>> {
  return runAction(async () => {
    const p = z.object({ connectorId: idSchema, rows: z.array(mapRow).max(200), sample: z.string().max(4000) }).parse(input);
    await manageCtx();
    const t = await getIntT();
    let rec: unknown;
    try { rec = JSON.parse(p.sample); } catch { return failResult("invalid", t("mapPreviewInvalid")); }
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) return failResult("invalid", t("mapPreviewInvalid"));
    const { specs } = toSpecs(p.rows);
    const objects = [...new Set(specs.map((s) => s.externalObject))];
    const merged = effectiveMap([], specs);
    const mapped: Record<string, Record<string, unknown>> = {};
    const rejected: string[] = [];
    for (const o of objects) {
      const r = applyFieldMap(merged, o, rec as Record<string, unknown>);
      for (const [tb, cols] of Object.entries(r.byTable)) mapped[tb] = { ...(mapped[tb] ?? {}), ...cols };
      rejected.push(...r.rejected.map((x) => x.field));
    }
    return okResult("", { data: { mapped, rejected } });
  });
}
