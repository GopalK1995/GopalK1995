// Import engine: loads the workspace's existing duplicate keys and writes a plan. Takes the Db so the job (service role) and tests share it.
// Writes are batched; a failing batch is retried row by row so one bad row never loses its neighbours.
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { indexRow } from "./dedupe";
import { WRITE_BATCH } from "./limits";
import { TABLE_OF } from "./targets";
import { emptyIndex, type DupMode, type ExistingIndex, type ImportObject, type PlannedRow } from "./types";

type Row = Record<string, unknown>;
const PAGE = 1000;

/** Every live record's duplicate keys in the workspace (keyset by id; never loads whole rows). */
export async function loadExistingIndex(db: Db, ws: string, object: ImportObject): Promise<ExistingIndex> {
  const idx = emptyIndex();
  const cols = object === "account" ? "id,name,city" : "id,email,phone";
  let last: string | null = null;
  for (;;) {
    let q = from(db, TABLE_OF[object]).select(cols).eq("workspace_id", ws).is("deleted_at", null).order("id", { ascending: true }).limit(PAGE);
    if (last) q = q.gt("id", last);
    const { data, error } = await q;
    if (error) throw new Error("existing keys could not be read");
    const rows = (data as Row[] | null) ?? [];
    for (const r of rows) indexRow(object, { id: String(r.id), email: r.email as string | null, phone: r.phone as string | null, name: r.name as string | null, city: r.city as string | null }, idx);
    if (rows.length < PAGE) return idx;
    last = String(rows[rows.length - 1].id);
  }
}

export interface WriteResult { created: number; merged: number; skipped: number; failed: { rowNo: number; reason: "write_failed" }[] }
export interface WriteOptions { db: Db; ws: string; tenantId: string; object: ImportObject; mode: DupMode; source: string; onProgress?: (done: number) => Promise<void> | void; shouldStop?: () => boolean }

const insertBody = (p: PlannedRow, o: WriteOptions): Row => ({
  ...p.record,
  ...(o.object === "lead" && p.record.source === undefined ? { source: o.source } : {}),
  ...(Object.keys(p.custom).length ? { custom: p.custom } : {}),
  workspace_id: o.ws, tenant_id: o.tenantId,
});

/** Writes new rows, and (merge mode) updates the existing record of each duplicate. Invalid and in-file duplicates are never written. */
export async function writePlan(rows: PlannedRow[], o: WriteOptions): Promise<WriteResult> {
  const table = TABLE_OF[o.object];
  const res: WriteResult = { created: 0, merged: 0, skipped: 0, failed: [] };
  const fresh = rows.filter((r) => r.status === "new");
  for (let i = 0; i < fresh.length; i += WRITE_BATCH) {
    if (o.shouldStop?.()) return res;
    const batch = fresh.slice(i, i + WRITE_BATCH);
    const { error } = await from(o.db, table).insert(batch.map((p) => insertBody(p, o)));
    if (!error) res.created += batch.length;
    else for (const p of batch) {
      const one = await from(o.db, table).insert(insertBody(p, o));
      if (one.error) res.failed.push({ rowNo: p.rowNo, reason: "write_failed" }); else res.created++;
    }
    await o.onProgress?.(res.created + res.merged);
  }
  const dups = rows.filter((r) => r.status === "duplicate");
  for (const p of dups) {
    if (o.mode === "skip" || !p.dupId) { res.skipped++; continue; }
    if (o.shouldStop?.()) return res;
    const patch: Row = { ...p.record };
    if (Object.keys(p.custom).length) {
      const cur = await from(o.db, table).select("custom").eq("workspace_id", o.ws).eq("id", p.dupId).maybeSingle();
      patch.custom = { ...(((cur.data as Row | null)?.custom as Row | undefined) ?? {}), ...p.custom };
    }
    if (!Object.keys(patch).length) { res.skipped++; continue; }
    const { error } = await from(o.db, table).update(patch).eq("workspace_id", o.ws).eq("id", p.dupId);
    if (error) res.failed.push({ rowNo: p.rowNo, reason: "write_failed" }); else res.merged++;
    if ((res.merged + res.skipped) % 25 === 0) await o.onProgress?.(res.created + res.merged);
  }
  await o.onProgress?.(res.created + res.merged);
  return res;
}
