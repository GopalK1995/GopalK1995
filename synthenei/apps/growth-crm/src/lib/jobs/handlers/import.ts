// import queue: `import.run` {job_id, tenant_id, workspace_id}. Downloads the upload from the private bucket, parses it (papaparse or
// exceljs), plans (map, clean, dedupe), writes in batches, updates import_jobs for progress (the table's change broadcast drives the
// UI, see "T034 needs"), then stores the error report. Authorisation happened when the action enqueued the job; this handler re-checks
// that the job row, the payload and the storage path all name the same tenant and workspace before it touches any data.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { getObjectType, listFields } from "@/lib/metadata/repo";
import { loadExistingIndex, writePlan } from "@/lib/import/engine";
import { IMPORT_BUCKET } from "@/lib/import/limits";
import { ImportError, parseFile } from "@/lib/import/parse";
import { planImport } from "@/lib/import/plan";
import { buildErrorReport } from "@/lib/import/report";
import { pathBelongsTo, reportPath } from "@/lib/import/storage";
import { targetsFor } from "@/lib/import/targets";
import { BASE } from "@/i18n/registry";
import { dupModeOf, isImportObject, type Mapping, type PlannedRow } from "@/lib/import/types";
import { registerHandler, type JobHandler } from "../registry";

export const IMPORT_KIND = { run: "import.run" } as const;
export interface ImportRunPayload { job_id: string; tenant_id: string; workspace_id: string }

type Row = Record<string, unknown>;
const fieldLabels = (): Record<string, string> => ((BASE.en.imports as { fields?: Record<string, string> } | undefined)?.fields ?? {});

export const importRun: JobHandler<ImportRunPayload> = async (p, ctx) => {
  const db = ctx.db as unknown as Db;
  const jobQ = await from(db, "import_jobs").select().eq("id", p.job_id).maybeSingle();
  const job = jobQ.data as Row | null;
  if (!job) return "done";
  // tenant isolation: the payload, the row and the path must agree
  if (job.tenant_id !== p.tenant_id || job.workspace_id !== p.workspace_id || !pathBelongsTo(job.storage_path as string, p.tenant_id, p.workspace_id)) {
    ctx.log.error("import job does not match its payload", { job: p.job_id });
    await setJob(db, p.job_id, { status: "failed", finished_at: new Date().toISOString() });
    return "done";
  }
  if (!["mapped", "validating", "running"].includes(String(job.status))) return "done"; // done, failed or cancelled: nothing to do
  if (!isImportObject(String(job.object_type))) { await setJob(db, p.job_id, { status: "failed", finished_at: new Date().toISOString() }); return "done"; }
  const object = job.object_type as "lead" | "contact" | "account";

  await setJob(db, p.job_id, { status: "validating" });
  let sheet;
  try {
    const dl = await db.storage.from(IMPORT_BUCKET).download(String(job.storage_path));
    if (dl.error || !dl.data) throw new ImportError("unreadable");
    sheet = await parseFile(await dl.data.arrayBuffer(), String(job.storage_path));
  } catch (e) {
    if (e instanceof ImportError) { await setJob(db, p.job_id, { status: "failed", finished_at: new Date().toISOString() }); return "done"; }
    ctx.log.warn("import download failed, will retry", { job: p.job_id });
    return "retry";
  }

  const ot = await getObjectType(p.tenant_id, object, async () => db);
  const defs = ot ? await listFields(ot.id, {}, async () => db) : [];
  const labels = fieldLabels();
  const targets = targetsFor(object, (k) => labels[k] ?? k, defs);
  const existing = await loadExistingIndex(db, p.workspace_id, object);
  const mode = dupModeOf(String(job.mode));
  const { rows: planned, summary } = planImport({ object, rows: sheet.rows, mapping: (job.mapping ?? {}) as Mapping, targets, existing });
  await setJob(db, p.job_id, { status: "running", rows_total: summary.total, rows_dup: summary.duplicates, rows_invalid: summary.invalid, rows_ok: 0 });

  const res = await writePlan(planned, {
    db, ws: p.workspace_id, tenantId: p.tenant_id, object, mode, source: "csv",
    shouldStop: () => Date.now() > ctx.deadline - 15_000,
    onProgress: (n) => setJob(db, p.job_id, { rows_ok: n }),
  });
  if (Date.now() > ctx.deadline - 15_000 && res.created + res.merged + res.skipped < summary.fresh + summary.duplicates) return "retry"; // resumes: finished rows then show up as duplicates

  const failedNos = new Set(res.failed.map((f) => f.rowNo));
  const finalRows: PlannedRow[] = planned.map((r) => failedNos.has(r.rowNo) ? { ...r, status: "invalid", issues: [{ field: "row", reason: "write_failed" }] } : r);
  const rep = buildErrorReport(sheet.headers, sheet.rows, finalRows);
  let errPath: string | null = null;
  if (rep.lines > 0) {
    errPath = reportPath(p.tenant_id, p.workspace_id, p.job_id);
    const up = await db.storage.from(IMPORT_BUCKET).upload(errPath, new Blob([rep.csv], { type: "text/csv" }), { upsert: true, contentType: "text/csv" });
    if (up.error) errPath = null;
  }
  await setJob(db, p.job_id, {
    status: "done", rows_ok: res.created + res.merged, rows_invalid: summary.invalid + res.failed.length,
    error_report_path: errPath, finished_at: new Date().toISOString(),
  });
  ctx.log.info("import finished", { job: p.job_id, created: res.created, merged: res.merged, failed: res.failed.length });
  return "done";
};

async function setJob(db: Db, id: string, patch: Row): Promise<void> {
  await from(db, "import_jobs").update(patch).eq("id", id);
}

registerHandler("import", IMPORT_KIND.run, importRun);
