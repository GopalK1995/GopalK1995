// Data access for pipelines / pipeline_stages (migration 0017; stages also carry `version` from 0014).
// Every function takes the Db provider so tests inject a mock; defaults to the request client, so RLS applies
// (`pipelines.manage` to write). Stage writes are version-guarded; pipelines have no version column (see
// docs/migrations-backlog.md "T032 needs"), so pipeline rename/archive is last-write-wins.
import { dbForRequest, type Db } from "@/lib/db/client";
import { updateVersioned } from "@/lib/db/concurrency";
import { DbError, throwIfError } from "@/lib/db/errors";
import { toSnakeKey } from "@/lib/db/map";
import { from } from "@/lib/db/query";
import { STAGE_COLORS, type StageColor } from "@/lib/config/types";
import type { Outcome } from "@/lib/config/types";
import type { Pipeline, PipelineObject, Stage } from "./pipelines";
import type { I18nLabel } from "./types";

type Row = Record<string, unknown>;
export type DbProvider = () => Promise<Db>;

const asLabel = (v: unknown, fallback: string): I18nLabel => {
  const o = (v && typeof v === "object" ? v : {}) as { en?: unknown; ta?: unknown };
  return { en: typeof o.en === "string" && o.en ? o.en : fallback, ...(typeof o.ta === "string" && o.ta ? { ta: o.ta } : {}) };
};
const OUTCOME_COLOR: Record<Outcome, StageColor> = { open: "neutral", won: "success", lost: "danger" };

export function stageFromRow(r: Row): Stage {
  const outcome = (r.outcome === "won" || r.outcome === "lost" ? r.outcome : "open") as Outcome;
  const color = (STAGE_COLORS as readonly string[]).includes(String(r.color)) ? (r.color as StageColor) : OUTCOME_COLOR[outcome];
  return {
    id: String(r.id), key: String(r.key), name: asLabel(r.name, String(r.label ?? r.key)), position: Number(r.position ?? 0), probability: Number(r.probability ?? 0),
    color, outcome, slaHours: typeof r.sla_hours === "number" ? r.sla_hours : null, requiredFields: Array.isArray(r.required_fields) ? (r.required_fields as unknown[]).map(String) : [],
    archived: !!r.archived_at, version: Number(r.version ?? 1),
  };
}

/** Pipelines of one object type with their stages (archived ones included, flagged). Default first. */
export async function listPipelines(ws: string, objectType: PipelineObject, getDb: DbProvider = dbForRequest): Promise<Pipeline[]> {
  const db = await getDb();
  const p = await from(db, "pipelines").select("id,key,name,is_default,position,archived_at,object_type").eq("workspace_id", ws).eq("object_type", objectType).order("position", { ascending: true });
  throwIfError(p.error);
  const prow = (p.data as Row[] | null) ?? [];
  if (!prow.length) return [];
  const s = await from(db, "pipeline_stages").select("id,pipeline_id,key,label,name,position,probability,color,outcome,sla_hours,required_fields,archived_at,version").eq("workspace_id", ws).in("pipeline_id", prow.map((r) => r.id)).order("position", { ascending: true });
  throwIfError(s.error);
  const srows = (s.data as Row[] | null) ?? [];
  return prow.map((r): Pipeline => ({
    id: String(r.id), key: String(r.key), objectType, name: asLabel(r.name, String(r.key)), isDefault: r.is_default === true, position: Number(r.position ?? 0), archived: !!r.archived_at,
    stages: srows.filter((x) => x.pipeline_id === r.id).map(stageFromRow),
  })).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.position - b.position);
}

export async function tenantOfWorkspace(ws: string, getDb: DbProvider = dbForRequest): Promise<string> {
  const r = await from(await getDb(), "workspaces").select("tenant_id").eq("id", ws).maybeSingle();
  throwIfError(r.error);
  const t = (r.data as { tenant_id?: string } | null)?.tenant_id;
  if (!t) throw new DbError("not_found", "not_found");
  return t;
}

export async function insertPipeline(a: { ws: string; tenantId: string; objectType: PipelineObject; key: string; name: I18nLabel; position: number }, getDb: DbProvider = dbForRequest): Promise<string> {
  const r = await from(await getDb(), "pipelines").insert({ tenant_id: a.tenantId, workspace_id: a.ws, object_type: a.objectType, key: a.key, name: a.name, is_default: false, position: a.position }).select("id").single();
  throwIfError(r.error);
  return String((r.data as Row).id);
}

export async function updatePipeline(ws: string, id: string, patch: { name?: I18nLabel; archivedAt?: string | null }, getDb: DbProvider = dbForRequest): Promise<void> {
  const body: Row = {};
  if (patch.name) body.name = patch.name;
  if (patch.archivedAt !== undefined) body.archived_at = patch.archivedAt;
  const r = await from(await getDb(), "pipelines").update(body).eq("id", id).eq("workspace_id", ws).select("id");
  throwIfError(r.error);
  if (!((r.data as Row[] | null) ?? []).length) throw new DbError("not_found", "not_found");
}

export interface StageWrite { name: I18nLabel; position: number; probability: number; color: StageColor; outcome: Outcome; slaHours: number | null; requiredFields: string[]; archived: boolean }
const stageBody = (w: StageWrite): Row => ({
  label: w.name.en, name: w.name, position: w.position, probability: w.probability, color: w.color, outcome: w.outcome,
  sla_hours: w.slaHours, required_fields: w.requiredFields, archived_at: w.archived ? new Date().toISOString() : null,
});

export async function insertStage(a: { ws: string; tenantId: string; pipelineId: string; key: string; write: StageWrite }, getDb: DbProvider = dbForRequest): Promise<Stage> {
  const r = await from(await getDb(), "pipeline_stages").insert({ tenant_id: a.tenantId, workspace_id: a.ws, pipeline_id: a.pipelineId, key: a.key, ...stageBody(a.write) }).select().single();
  throwIfError(r.error);
  return stageFromRow(r.data as Row);
}

/** Update where `version` still equals what the editor loaded. 0 rows: missing -> not_found, otherwise conflict. */
export async function updateStageGuarded(ws: string, id: string, version: number, w: StageWrite, prevArchived: boolean, getDb: DbProvider = dbForRequest): Promise<Stage> {
  const db = await getDb();
  const body = stageBody(w);
  if (prevArchived === w.archived) delete body.archived_at; // keep the original retirement time
  const row = await updateVersioned<Row>("pipeline_stages", id, version, body, { db, ws });
  return stageFromRow(Object.fromEntries(Object.entries(row).map(([k, v]) => [toSnakeKey(k), v])));
}

/** (pipeline_id, position) is unique and not deferrable: park moving rows above the range, then write the final positions. */
export async function setStagePositions(ws: string, items: { id: string; position: number }[], getDb: DbProvider = dbForRequest): Promise<void> {
  const db = await getDb();
  const OFFSET = 1000;
  for (const it of items) { const r = await from(db, "pipeline_stages").update({ position: it.position + OFFSET }).eq("id", it.id).eq("workspace_id", ws); throwIfError(r.error); }
  for (const it of items) { const r = await from(db, "pipeline_stages").update({ position: it.position }).eq("id", it.id).eq("workspace_id", ws); throwIfError(r.error); }
}

/** Records (the caller can see) still sitting in the stage, capped. Archiving such a stage is refused. */
export async function countInStage(objectType: PipelineObject, stageId: string, cap = 50, getDb: DbProvider = dbForRequest): Promise<number> {
  const r = await from(await getDb(), objectType === "deal" ? "deals" : "leads").select("id").eq("stage_id", stageId).is("deleted_at", null).limit(cap);
  throwIfError(r.error);
  return ((r.data as Row[] | null) ?? []).length;
}

export async function listCustomFieldKeys(tenantId: string, objectKey: string, getDb: DbProvider = dbForRequest): Promise<{ key: string; label: string }[]> {
  const db = await getDb();
  const o = await from(db, "object_types").select("id").eq("tenant_id", tenantId).eq("key", objectKey).maybeSingle();
  throwIfError(o.error);
  const id = (o.data as { id?: string } | null)?.id;
  if (!id) return [];
  const f = await from(db, "field_defs").select("key,label").eq("object_type_id", id).is("archived_at", null).order("position", { ascending: true });
  throwIfError(f.error);
  return ((f.data as Row[] | null) ?? []).map((r) => ({ key: String(r.key), label: asLabel(r.label, String(r.key)).en }));
}
