// The sync engine: initial import through the T034 planner, incremental pull, push of CRM changes, and per-record reconciliation.
// Everything is scoped by the connection's tenant and workspace. A vendor error that concerns one record rejects that record only.
import { indexRow, remember } from "@/lib/import/dedupe";
import { planImport } from "@/lib/import/plan";
import { SYSTEM_TARGETS, targetsFor } from "@/lib/import/targets";
import { emptyIndex, type ExistingIndex, type ImportObject, type Mapping, type ParsedRow } from "@/lib/import/types";
import { decodeBase, encodeBase, reconcile, shortHash, type Base, type ColumnSpec } from "./conflict";

import { effective, expandDotted, mapIn, mapOut, specsFor, wantedFields } from "./map";
import { LOOKUP_COLUMNS, OBJECT_TABLE, REQUIRED_COLUMNS, RecordRejected, emptyTally, type CrmObject, type EngineCtx, type LinkInfo, type LocalRow, type RemoteRecord, type Tally } from "./types";

const PUSH_BATCH = 50;
type Vals = Record<string, unknown>;

export interface ObjectCtx { object: CrmObject; table: string; vendorObj: string; specs: ColumnSpec[]; columns: string[]; wanted: string[]; required: ReadonlySet<string> }
export function objectCtx(c: EngineCtx, object: CrmObject): ObjectCtx {
  const vendorObj = c.gateway.objectName(object), table = OBJECT_TABLE[object];
  const specs = specsFor(effective([], c.fieldMap), object, vendorObj);
  return { object, table, vendorObj, specs, columns: specs.map((s) => s.column), wanted: wantedFields(specs), required: new Set(REQUIRED_COLUMNS[table] ?? []) };
}

// ---- per-run caches (stages, planner index). Only the latest few runs are kept. ----
interface RunCache { stages?: { byKey: Map<string, string>; byId: Map<string, string> }; index: Partial<Record<ImportObject, ExistingIndex>> }
const caches = new Map<number, RunCache>();
function cacheOf(runId: number): RunCache {
  let k = caches.get(runId);
  if (!k) { k = { index: {} }; caches.set(runId, k); for (const old of [...caches.keys()].slice(0, -4)) caches.delete(old); }
  return k;
}
async function stages(c: EngineCtx) {
  const k = cacheOf(c.runId);
  if (!k.stages) {
    const list = await c.store.listStages(c.conn.workspaceId);
    k.stages = { byKey: new Map(list.map((s) => [s.key, s.id])), byId: new Map(list.map((s) => [s.id, s.key])) };
  }
  return k.stages;
}
async function indexOf(c: EngineCtx, o: ImportObject): Promise<ExistingIndex> {
  const k = cacheOf(c.runId);
  if (!k.index[o]) k.index[o] = (await c.store.existingIndex(c.conn.workspaceId, o)) ?? emptyIndex();
  return k.index[o] as ExistingIndex;
}

// ---- value conversions between the vendor-facing space and the CRM's columns ----
/** Lookup columns: vendor id -> local id. An unresolved one is unknown (left out) and counted. */
async function lookupsIn(c: EngineCtx, oc: ObjectCtx, v: Vals): Promise<void> {
  for (const [col, target] of Object.entries(LOOKUP_COLUMNS[oc.table] ?? {})) {
    if (!(col in v) || v[col] === null) continue;
    const link = await c.store.core.getLink(c.conn.id, c.gateway.objectName(target), String(v[col]));
    if (link) v[col] = link.localId; else { delete v[col]; c.reject(`lookup_pending:${col}`); }
  }
}
async function lookupsOut(c: EngineCtx, oc: ObjectCtx, v: Vals): Promise<void> {
  for (const [col, target] of Object.entries(LOOKUP_COLUMNS[oc.table] ?? {})) {
    if (!(col in v) || v[col] === null) continue;
    const link = await c.store.getLinkByLocal(c.conn.id, OBJECT_TABLE[target], String(v[col]));
    if (link) v[col] = link.externalId; else delete v[col];
  }
}
async function fromLocal(c: EngineCtx, oc: ObjectCtx, row: LocalRow): Promise<Vals> {
  const v: Vals = { ...row.values };
  if (oc.table === "deals" && "stage_id" in v && v.stage_id !== null) v.stage_id = (await stages(c)).byId.get(String(v.stage_id)) ?? null;
  return v;
}
/** Stage key -> stage id; an unknown key is dropped and counted instead of guessed. */
async function toWrite(c: EngineCtx, oc: ObjectCtx, patch: Vals): Promise<Vals> {
  const out = { ...patch };
  if (oc.table === "deals" && "stage_id" in out) {
    const id = out.stage_id === null ? undefined : (await stages(c)).byKey.get(String(out.stage_id));
    if (id) out.stage_id = id; else { delete out.stage_id; c.reject("stage_unmapped"); }
  }
  for (const k of oc.required) if (k in out && out[k] === null) delete out[k];
  return out;
}
async function remoteValues(c: EngineCtx, oc: ObjectCtx, rec: RemoteRecord): Promise<Vals> {
  const m = mapIn(rec.fields, oc.specs);
  for (const r of m.rejected) c.reject(r);
  await lookupsIn(c, oc, m.values);
  return m.values;
}

// ---- reconcile one linked record ----
export async function reconcileLinked(c: EngineCtx, oc: ObjectCtx, link: LinkInfo, remote: RemoteRecord, tally: Tally, preloaded?: LocalRow): Promise<void> {
  const row = preloaded ?? (await c.store.readLocal(oc.table, c.conn.workspaceId, [link.localId], oc.columns))[0];
  if (!row) { c.reject("local_missing"); tally.rejected++; return; }
  const local = await fromLocal(c, oc, row), rv = await remoteValues(c, oc, remote);
  const base = decodeBase(link.hash);
  const plan = reconcile({ specs: oc.specs, local, remote: rv, localAt: row.updatedAt, remoteAt: remote.modifiedAt, base, required: oc.required });
  for (const d of plan.decisions) if (d.decision === "conflict_local" || d.decision === "conflict_remote") tally.conflicts++;

  const next = plan.next;
  const localWrite = await toWrite(c, oc, plan.localPatch);
  if (Object.keys(localWrite).length) { await c.store.core.updateLocal(oc.table, link.localId, localWrite); tally.pulled++; }

  if (Object.keys(plan.remotePatch).length) {
    const rp = { ...plan.remotePatch };
    await lookupsOut(c, oc, rp);
    const out = mapOut(rp, oc.specs);
    for (const s of out.skipped) c.reject(s);
    if (Object.keys(out.fields).length) {
      try { await c.gateway.update(oc.object, remote.id, expandDotted(out.fields)); tally.pushed++; }
      catch (e) {
        if (!(e instanceof RecordRejected)) throw e;
        c.reject(`vendor_rejected:${e.code}`); tally.rejected++;
        // keep the old base for the pushed columns so the push is retried on the next pass
        for (const col of Object.keys(plan.remotePatch)) {
          if (base?.l[col] !== undefined) next.l[col] = base.l[col]; else delete next.l[col];
          if (base?.r[col] !== undefined) next.r[col] = base.r[col]; else delete next.r[col];
        }
      }
    }
  }
  const h = encodeBase(next);
  if (h !== link.hash) await c.store.core.touchLink(link.id, h);
  if (!plan.decisions.length) tally.noop++;
}

// ---- new vendor records: the T034 import pipeline ----
const sysKeys = (o: ImportObject) => new Set(SYSTEM_TARGETS[o].map((t) => t.key));
const cell = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : v instanceof Date ? v.toISOString() : JSON.stringify(v));

function snapshotBase(oc: ObjectCtx, localVals: Vals, remoteVals: Vals): string {
  const b: Base = { l: {}, r: {} };
  for (const s of oc.specs) {
    b.l[s.column] = shortHash(localVals[s.column] ?? null);
    if (s.column in remoteVals) b.r[s.column] = shortHash(remoteVals[s.column]);
  }
  return encodeBase(b);
}

async function putNewLink(c: EngineCtx, oc: ObjectCtx, rec: RemoteRecord, localId: string, hash: string): Promise<void> {
  await c.store.core.putLink({ tenantId: c.conn.tenantId, workspaceId: c.conn.workspaceId, connectionId: c.conn.id, externalObject: oc.vendorObj, externalId: rec.id, localTable: oc.table, localId, contentHash: hash, direction: "both" });
}

export async function ingestNew(c: EngineCtx, oc: ObjectCtx, records: RemoteRecord[], tally: Tally): Promise<void> {
  if (!records.length) return;
  const mapped: { rec: RemoteRecord; vals: Vals }[] = [];
  for (const rec of records) {
    const m = mapIn(rec.fields, oc.specs);
    for (const r of m.rejected) c.reject(r);
    await lookupsIn(c, oc, m.values);
    mapped.push({ rec, vals: m.values });
  }
  if (oc.object === "deal") return ingestDeals(c, oc, mapped, tally);

  const obj = oc.object as ImportObject, known = sysKeys(obj);
  const rows: ParsedRow[] = mapped.map((m, i) => ({ rowNo: i + 1, cells: Object.fromEntries(Object.entries(m.vals).filter(([k, v]) => known.has(k) && v !== null).map(([k, v]) => [k, cell(v)])) }));
  const mapping: Mapping = Object.fromEntries([...known].map((k) => [k, k]));
  const existing = await indexOf(c, obj);
  const { rows: planned } = planImport({ object: obj, rows, mapping, targets: targetsFor(obj, (k) => k, []), existing });

  for (const p of planned) {
    const { rec, vals } = mapped[p.rowNo - 1];
    if (p.status === "invalid") { c.reject(`import_${p.issues[0]?.reason ?? "invalid"}`); tally.rejected++; continue; }
    const extras = Object.fromEntries(Object.entries(vals).filter(([k, v]) => !known.has(k) && v !== null));
    const body: Vals = { ...p.record, ...(await toWrite(c, oc, extras)) };
    if (p.status === "duplicate") {
      if (!p.dupId) { c.reject("duplicate_in_file"); tally.rejected++; continue; }
      if (await c.store.getLinkByLocal(c.conn.id, oc.table, p.dupId)) { c.reject("duplicate_of_linked"); tally.rejected++; continue; }
      if (c.options.importMode === "merge" && Object.keys(body).length) await c.store.core.updateLocal(oc.table, p.dupId, body);
      const row = (await c.store.readLocal(oc.table, c.conn.workspaceId, [p.dupId], oc.columns))[0];
      await putNewLink(c, oc, rec, p.dupId, snapshotBase(oc, row ? await fromLocal(c, oc, row) : {}, vals));
      tally.linked++;
      continue;
    }
    const insert = { ...body, ...(obj === "lead" && body.source === undefined ? { source: c.vendorKey } : {}), external_ids: { [c.vendorKey]: rec.id }, tenant_id: c.conn.tenantId, workspace_id: c.conn.workspaceId };
    const id = await c.store.core.insertLocal(oc.table, insert);
    indexRow(obj, { id, email: body.email as string | undefined, phone: body.phone as string | undefined, name: (body.name ?? body.full_name) as string | undefined, city: body.city as string | undefined }, existing);
    remember(obj, body, existing, id);
    await putNewLink(c, oc, rec, id, snapshotBase(oc, body, vals));
    tally.created++;
  }
}

async function ingestDeals(c: EngineCtx, oc: ObjectCtx, mapped: { rec: RemoteRecord; vals: Vals }[], tally: Tally): Promise<void> {
  for (const { rec, vals } of mapped) {
    const name = typeof vals.name === "string" ? vals.name.trim() : "";
    if (!name) { c.reject("import_name_required"); tally.rejected++; continue; }
    const key = vals.stage_id;
    const stageId = typeof key === "string" ? (await stages(c)).byKey.get(key) : undefined;
    if (!stageId) { c.reject("stage_unmapped"); tally.rejected++; continue; }
    const body: Vals = { ...vals, name, stage_id: stageId };
    if ("value_inr" in body) { const n = Number(body.value_inr); if (body.value_inr === null || !Number.isFinite(n) || n < 0) delete body.value_inr; else body.value_inr = n; }
    for (const k of Object.keys(body)) if (body[k] === null) delete body[k];
    const id = await c.store.core.insertLocal(oc.table, { ...body, external_ids: { [c.vendorKey]: rec.id }, tenant_id: c.conn.tenantId, workspace_id: c.conn.workspaceId });
    await putNewLink(c, oc, rec, id, snapshotBase(oc, { ...body, stage_id: key }, vals));
    tally.created++;
  }
}

/** A batch of vendor records (a page, or the ids of a webhook): linked ones reconcile, the rest are imported. */
export async function applyRemote(c: EngineCtx, oc: ObjectCtx, records: RemoteRecord[], tally: Tally): Promise<void> {
  const fresh: RemoteRecord[] = [];
  for (const rec of records) {
    const l = await c.store.core.getLink(c.conn.id, oc.vendorObj, rec.id);
    if (!l) { fresh.push(rec); continue; }
    if (l.localTable !== oc.table) { c.reject("link_table_mismatch"); tally.rejected++; continue; }   // e.g. the contact target was switched after the import
    const info = await c.store.getLinkByLocal(c.conn.id, oc.table, l.localId);
    await reconcileLinked(c, oc, info ?? { id: l.id, externalObject: oc.vendorObj, externalId: rec.id, localId: l.localId, hash: l.contentHash }, rec, tally);
  }
  await ingestNew(c, oc, fresh, tally);
}

// ---- pull stream ----
export interface PullCursor { i: number; cur: Record<string, unknown> }
export interface StepResult { cursor: unknown; rowsIn: number; rowsRejected: number; done: boolean; sample: unknown }
const asPull = (x: unknown): PullCursor => (x && typeof x === "object" && typeof (x as PullCursor).i === "number" ? { i: (x as PullCursor).i, cur: { ...((x as PullCursor).cur ?? {}) } } : { i: 0, cur: {} });

export async function pullStep(c: EngineCtx, cursor: unknown): Promise<StepResult> {
  const cur = asPull(cursor), tally = emptyTally();
  const object = c.options.objects[cur.i];
  if (!object) return { cursor: { i: 0, cur: cur.cur }, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_objects" } };
  const oc = objectCtx(c, object);
  if (!oc.specs.length) {
    cur.i++;
    const all = cur.i >= c.options.objects.length;
    return { cursor: all ? { i: 0, cur: cur.cur } : cur, rowsIn: 0, rowsRejected: 0, done: all, sample: { skipped: `no_field_map:${object}` } };
  }
  const page = await c.gateway.list(object, cur.cur[object] ?? null, oc.wanted, c.options.importSince);
  await applyRemote(c, oc, page.records, tally);
  cur.cur[object] = page.cursor;
  if (page.done) cur.i++;
  const all = cur.i >= c.options.objects.length;
  return { cursor: all ? { i: 0, cur: cur.cur } : cur, rowsIn: page.records.length, rowsRejected: tally.rejected, done: all, sample: { object, ...tally } };
}

// ---- push stream ----
export interface PushCursor { i: number; after: Record<string, { ts: string; id: string } | null> }
const asPush = (x: unknown): PushCursor => (x && typeof x === "object" && typeof (x as PushCursor).i === "number" ? { i: (x as PushCursor).i, after: { ...((x as PushCursor).after ?? {}) } } : { i: 0, after: {} });

function changedLocally(oc: ObjectCtx, local: Vals, base: Base | null): boolean {
  if (!base) return true;
  return oc.specs.some((s) => s.direction !== "in" && base.l[s.column] !== shortHash(local[s.column] ?? null));
}

async function createRemote(c: EngineCtx, oc: ObjectCtx, row: LocalRow, local: Vals, tally: Tally): Promise<void> {
  const v: Vals = {};
  for (const s of oc.specs) if (s.direction !== "in" && local[s.column] !== null && local[s.column] !== undefined) v[s.column] = local[s.column];
  await lookupsOut(c, oc, v);
  const out = mapOut(v, oc.specs);
  if (!Object.keys(out.fields).length) return;
  const link = (externalId: string, hash: string) => c.store.core.putLink({ tenantId: c.conn.tenantId, workspaceId: c.conn.workspaceId, connectionId: c.conn.id, externalObject: oc.vendorObj, externalId, localTable: oc.table, localId: row.id, contentHash: hash, direction: "both" });
  try {
    const made = await c.gateway.create(oc.object, expandDotted(out.fields));
    const base: Base = { l: {}, r: {} };
    for (const s of oc.specs) { base.l[s.column] = shortHash(local[s.column] ?? null); if (s.column in v) base.r[s.column] = shortHash(v[s.column]); }
    await link(made.id, encodeBase(base));
    tally.pushed++;
  } catch (e) {
    if (!(e instanceof RecordRejected)) throw e;
    if (e.duplicateId) { await link(e.duplicateId, encodeBase({ l: {}, r: {} })); tally.linked++; return; }   // already at the vendor: link, and let the field rules settle differences next pass
    c.reject(`vendor_rejected:${e.code}`); tally.rejected++;
  }
}

export async function pushStep(c: EngineCtx, cursor: unknown): Promise<StepResult> {
  const cur = asPush(cursor), tally = emptyTally();
  const object = c.options.objects[cur.i];
  if (!object) return { cursor: { i: 0, after: cur.after }, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_objects" } };
  const oc = objectCtx(c, object);
  if (!oc.specs.some((s) => s.direction !== "in")) {
    cur.i++;
    const all = cur.i >= c.options.objects.length;
    return { cursor: all ? { i: 0, after: cur.after } : cur, rowsIn: 0, rowsRejected: 0, done: all, sample: { skipped: `no_outbound_fields:${object}` } };
  }
  const rows = await c.store.listChangedLocal(oc.table, c.conn.workspaceId, cur.after[object] ?? null, oc.columns, PUSH_BATCH);
  const due: { row: LocalRow; link: LinkInfo }[] = [];
  for (const row of rows) {
    const local = await fromLocal(c, oc, row);
    const link = await c.store.getLinkByLocal(c.conn.id, oc.table, row.id);
    if (!link) { if (c.options.pushNew) await createRemote(c, oc, row, local, tally); continue; }
    if (!changedLocally(oc, local, decodeBase(link.hash))) { tally.noop++; continue; }
    due.push({ row, link });
  }
  if (due.length) {
    const remotes = new Map((await c.gateway.getMany(object, due.map((d) => d.link.externalId), oc.wanted)).map((r) => [r.id, r]));
    for (const d of due) {
      const remote = remotes.get(d.link.externalId);
      if (!remote) { c.reject("remote_missing"); tally.rejected++; continue; }   // deleted at the vendor: never recreated and never deleted here
      await reconcileLinked(c, oc, d.link, remote, tally, d.row);
    }
  }
  const last = rows[rows.length - 1];
  if (last?.updatedAt) cur.after[object] = { ts: last.updatedAt, id: last.id };
  if (rows.length < PUSH_BATCH) cur.i++;
  const all = cur.i >= c.options.objects.length;
  return { cursor: all ? { i: 0, after: cur.after } : cur, rowsIn: rows.length, rowsRejected: tally.rejected, done: all, sample: { object, ...tally } };
}
