// Loads the real integrations screens: connector_catalog + connector_availability (this environment) + this workspace's
// connections. Request client, so RLS is the second line. Never reads a secret: only the fact that a Vault id exists.
import { buildHospitalityIntegrations } from "@/lib/data/mock/hospitality-integrations";
import { buildIntegrations } from "@/lib/data/mock/integrations";
import { dbForRequest, type Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { env } from "@/lib/env";
import { effectiveMap } from "@/lib/connectors/core/field-map";
import { vendorEnv } from "@/lib/connectors/core/runtime";
import { supabaseStore } from "@/lib/connectors/core/store-supabase";
import { deriveChip, type AvailabilityRow } from "@/lib/connectors/core/status";
import { envConfigured, getConnector, isUsableIn, listConnectors } from "@/lib/connectors/registry";
import type { ConnectionFacts } from "@/lib/connectors/core/status";
import type { FieldMapSpec, IntegrationStatus } from "@/lib/connectors/core/types";
import type { ConnectorRowView, DetailView, MapRowView } from "./types";

type R = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
export const availabilityEnv = () => (env.appEnv === "production" ? "production" : env.appEnv === "demo" ? "demo" : "staging");

interface Catalog { id: string; name: string; category: string; authKind: string; verticals: string[]; sandboxSupported: boolean }
interface Loaded { catalog: Catalog[]; availability: Map<string, AvailabilityRow>; conns: Map<string, R>; failed: string[] }

async function load(db: Db, ws: string): Promise<Loaded | null> {
  const failed: string[] = [];
  const cat = await from(db, "connector_catalog").select().limit(200);
  if (cat.error) return null;
  const catalog = ((cat.data as R[] | null) ?? []).map((r): Catalog => ({ id: String(r.id), name: String(r.name), category: String(r.category), authKind: String(r.auth_kind), verticals: (r.verticals as string[]) ?? [], sandboxSupported: r.sandbox_supported === true }));
  const av = await from(db, "connector_availability").select().eq("env", availabilityEnv()).limit(200);
  const availability = new Map<string, AvailabilityRow>();
  if (av.error) failed.push("availability");
  else for (const r of (av.data as R[] | null) ?? []) availability.set(String(r.connector_id), { mode: r.mode as AvailabilityRow["mode"], gateStatus: r.gate_status as AvailabilityRow["gateStatus"], note: s(r.note) });
  const cn = await from(db, "integrations").select().eq("workspace_id", ws).limit(200);
  const conns = new Map<string, R>();
  if (cn.error) failed.push("connections");
  else for (const r of (cn.data as R[] | null) ?? []) if (r.connector_id) conns.set(String(r.connector_id), r);
  return { catalog, availability, conns, failed };
}

function rowFor(c: Catalog, l: Loaded): ConnectorRowView {
  const def = getConnector(c.id);
  const conn = l.conns.get(c.id) ?? null;
  const facts: ConnectionFacts | null = conn ? { status: String(conn.status) as IntegrationStatus, mode: conn.mode === "live" ? "live" : "sandbox", hasCredentials: !!conn.credential_secret_id } : null;
  const registered = !!def && isUsableIn(def, env.appEnv);
  const chip = registered ? deriveChip({ availability: l.availability.get(c.id) ?? null, connection: facts, envConfigured: def ? envConfigured(def, vendorEnv()) : false }) : { state: "not_available" as const, blockReason: "not_available" as const };
  return {
    id: c.id, name: c.name, category: c.category, chip: chip.state, blockKey: registered ? chip.blockReason : "not_shipped",
    mode: conn ? (conn.mode === "live" ? "live" : "sandbox") : null, connectionId: conn ? String(conn.id) : null,
    lastSyncAt: conn ? s(conn.last_sync_at) : null, lastError: conn ? s(conn.last_error) : null, registered,
  };
}

export type ListResult =
  | { status: "error" }
  | { status: "ok"; rows: ConnectorRowView[]; failed: string[] };

export async function loadList(ws: string, vertical: string): Promise<ListResult> {
  let l: Loaded | null;
  try { l = await load(await dbForRequest(), ws); } catch { return { status: "error" }; }
  if (!l) return { status: "error" };
  const known = new Set(l.catalog.map((c) => c.id));
  // Code-registered connectors that the catalogue does not list yet (the mock connector on non-production): shown, never connectable until a catalogue row exists.
  const extra: Catalog[] = listConnectors().filter((d) => !known.has(d.id) && isUsableIn(d, env.appEnv)).map((d) => ({ id: d.id, name: d.name, category: d.category, authKind: d.auth, verticals: [vertical], sandboxSupported: d.sandbox.supported }));
  const rows = [...l.catalog.filter((c) => c.verticals.includes(vertical) || l!.conns.has(c.id)), ...extra].map((c) => rowFor(c, l!));
  const ORDER: Record<string, number> = { needs_attention: 0, error: 1, connected: 2, sandbox: 3, available: 4, disconnected: 5, needs_vendor_approval: 6, needs_client_credentials: 7, not_configured: 8, not_available: 9 };
  rows.sort((a, b) => (ORDER[a.chip] ?? 9) - (ORDER[b.chip] ?? 9) || a.name.localeCompare(b.name));
  return { status: "ok", rows, failed: l.failed };
}

const staticSpec = (id: string) => [...buildIntegrations([]), ...buildHospitalityIntegrations([])].find((i) => i.id === id) ?? null;
const toMapRow = (f: FieldMapSpec, custom: boolean): MapRowView => ({
  externalObject: f.externalObject, externalField: f.externalField, localTable: f.localTable, localColumn: f.localColumn, direction: f.direction,
  transform: f.transform ?? null, transformArg: f.transformArg ? JSON.stringify(f.transformArg) : "", sample: f.sample ?? "", custom,
});

export type DetailResult = { status: "error" } | { status: "not_found" } | { status: "ok"; view: DetailView; failed: string[] };

export async function loadDetail(ws: string, id: string): Promise<DetailResult> {
  let db: Db, l: Loaded | null;
  try { db = await dbForRequest(); l = await load(db, ws); } catch { return { status: "error" }; }
  if (!l) return { status: "error" };
  const def = getConnector(id);
  const cat = l.catalog.find((c) => c.id === id) ?? (def && isUsableIn(def, env.appEnv) ? { id: def.id, name: def.name, category: def.category, authKind: def.auth, verticals: [], sandboxSupported: def.sandbox.supported } : null);
  if (!cat) return { status: "not_found" };
  const row = rowFor(cat, l);
  const spec = staticSpec(id);
  const store = supabaseStore(db, env.appEnv);
  const failed = [...l.failed];
  let runs: DetailView["runs"] = [];
  let map: MapRowView[] = [];
  if (row.connectionId) {
    try {
      runs = (await store.listRuns(row.connectionId, 25)).map((r) => ({ id: r.id, startedAt: r.startedAt, stream: r.stream, kind: r.kind, status: r.status, rowsIn: r.rowsIn, rowsOut: r.rowsOut, rowsRejected: r.rowsRejected, error: r.error }));
    } catch { failed.push("runs"); }
  }
  if (def) {
    let tenantMap: FieldMapSpec[] = [];
    if (row.connectionId) { try { tenantMap = await store.getFieldMap(row.connectionId); } catch { failed.push("map"); } }
    const custom = new Set(tenantMap.map((f) => `${f.externalObject}\u0000${f.externalField}`));
    map = effectiveMap(def.defaultFieldMap, tenantMap).map((f) => toMapRow(f, custom.has(`${f.externalObject}\u0000${f.externalField}`)));
  } else if (spec) {
    map = spec.fieldMap.map((f) => ({ externalObject: "", externalField: f.source, localTable: f.target.split(".")[0] ?? "", localColumn: f.target.split(".").slice(1).join(".") || f.target, direction: "in", transform: null, transformArg: "", sample: f.note ?? "", custom: false }));
  }
  const flows = [...(spec?.inbound ?? []).map((object) => ({ object, dir: "in" as const })), ...(spec?.outbound ?? []).map((object) => ({ object, dir: "out" as const }))];
  return {
    status: "ok", failed,
    view: {
      row, auth: def?.auth ?? cat.authKind, authKind: (def?.auth ?? cat.authKind) as DetailView["authKind"],
      fields: (def?.credentialFields ?? []).map((f) => ({ key: f.key, label: f.label, secret: f.secret })),
      sandboxSupported: def?.sandbox.supported ?? cat.sandboxSupported, sandboxHowTo: def?.sandbox.howTo ?? null,
      steps: spec?.steps ?? [], flows, runs, map, editable: !!def && !!row.connectionId, accountLabel: null,
      oauthReady: !!def?.oauth && envConfigured(def, vendorEnv()),
    },
  };
}
