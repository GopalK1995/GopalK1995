"use server";
// Import and export server actions. Every one checks the permission catalogue first (leads.import plus the object's write permission,
// leads.export plus the object's read permission) and relies on RLS and the private bucket's policies as the second line.
// Demo sessions never create a Supabase client and never write: they run the same planner over built-in sample rows.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActive } from "@/lib/auth/server";
import { assertCan } from "@/lib/authz/load";
import { decide } from "@/lib/authz";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { dbForRequest } from "@/lib/db/client";
import { serviceDb } from "@/lib/db/service";
import { from } from "@/lib/db/query";
import { getEffectiveConfig } from "@/lib/config/resolve";
import { applyPatch } from "@/lib/config/apply";
import type { ImportKind } from "@/lib/config/types";
import { enqueue } from "@/lib/jobs/registry";
import { IMPORT_KIND, type ImportRunPayload } from "@/lib/jobs/handlers/import";
import { demoExisting, SAMPLE_CSV } from "@/lib/import/demo";
import { loadExistingIndex } from "@/lib/import/engine";
import { buildExportCsv, exportFileName, type ExportColumn } from "@/lib/import/export";
import { ACCEPT_EXT, IMPORT_BUCKET, MAX_COLUMNS, MAX_EXPORT_ROWS, MAX_FILE_BYTES, MAX_ROWS, SAMPLE_ROWS } from "@/lib/import/limits";
import { autoMap, checkMapping } from "@/lib/import/mapper";
import { ImportError, parseCsvText, parseFile } from "@/lib/import/parse";
import { planImport } from "@/lib/import/plan";
import { importPath, pathBelongsTo } from "@/lib/import/storage";
import { READ_PERM, SYSTEM_TARGETS, TABLE_OF, WRITE_PERM } from "@/lib/import/targets";
import { isImportObject, jobModeOf, type ImportObject, type Mapping, type ParsedSheet } from "@/lib/import/types";
import { importT, targetsOf, tenantUuid, type T } from "./_lib/server";
import type { ExportView, InspectView, JobView, PreviewView, UploadTicket } from "./types";

type Row = Record<string, unknown>;
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const objectSchema = z.string().refine(isImportObject);
const mappingSchema = z.record(z.string().max(200), z.string().max(80)).refine((m) => Object.keys(m).length <= MAX_COLUMNS);

const importError = (t: T, e: unknown): ActionResult<never> => {
  const code = e instanceof ImportError ? e.code : "unreadable";
  const msg: Record<string, string> = {
    too_big: t("tooBig", { mb: MAX_FILE_BYTES / 1024 / 1024 }), too_many_rows: t("tooManyRows", { rows: MAX_ROWS }), too_many_columns: t("tooManyColumns", { cols: MAX_COLUMNS }),
    empty: t("emptyFile"), unsupported: t("unsupported"), unreadable: t("unreadable"),
  };
  return failResult("invalid", msg[code] ?? t("unreadable"));
};

/** Guard for every import action: permission first, then the object's write permission. */
async function guardImport(object: ImportObject) {
  const p = await assertCan("leads.import");
  if (object !== "lead") await assertCan(WRITE_PERM[object]);
  return p;
}

const jobView = (r: Row): JobView => ({
  id: String(r.id), object: String(r.object_type), status: r.status as JobView["status"], mode: String(r.mode), rowsTotal: Number(r.rows_total ?? 0), rowsOk: Number(r.rows_ok ?? 0),
  rowsDup: Number(r.rows_dup ?? 0), rowsInvalid: Number(r.rows_invalid ?? 0), hasReport: !!r.error_report_path, createdAt: String(r.created_at), finishedAt: (r.finished_at as string | null) ?? null,
});

/** Step 1 (real): create the job row and a signed upload URL. The browser uploads straight to the private bucket. */
export async function startUpload(input: { object: string; fileName: string; size: number }): Promise<ActionResult<UploadTicket>> {
  return runAction(async () => {
    const t = await importT();
    const o = objectSchema.safeParse(input.object);
    if (!o.success) return failResult("invalid", t("unreadable"));
    const object = o.data as ImportObject;
    const { session, active } = await requireActive();
    await guardImport(object);
    if (!ACCEPT_EXT.some((e) => input.fileName.toLowerCase().endsWith(e))) return failResult("invalid", t("unsupported"));
    if (!(input.size > 0) || input.size > MAX_FILE_BYTES) return failResult("invalid", t("tooBig", { mb: MAX_FILE_BYTES / 1024 / 1024 }));
    if (session.demo) return okResult("", { data: { jobId: "demo", demo: true } });
    const jobId = crypto.randomUUID();
    const path = importPath((await tenantUuid()), active.ws.uuid, jobId, input.fileName);
    const db = await dbForRequest();
    const ins = await from(db, "import_jobs").insert({ id: jobId, workspace_id: active.ws.uuid, object_type: object, storage_path: path, status: "uploaded" });
    if (ins.error) return failResult("error", t("uploadFailed"));
    const signed = await db.storage.from(IMPORT_BUCKET).createSignedUploadUrl(path);
    if (signed.error || !signed.data) return failResult("error", t("uploadFailed"));
    return okResult("", { data: { jobId, demo: false, path, token: signed.data.token, bucket: IMPORT_BUCKET } });
  });
}

/** Reads the sheet for a job (real: from storage through the user's session) or from sample/demo text. */
async function sheetOf(jobId: string, demoText: string | undefined, demo: boolean, ws: string, tenant: string): Promise<{ sheet: ParsedSheet; path: string | null }> {
  if (demo) return { sheet: parseCsvText(demoText ?? SAMPLE_CSV.lead), path: null };
  if (!uuidRe.test(jobId)) throw new ImportError("unreadable");
  const db = await dbForRequest();
  const q = await from(db, "import_jobs").select("storage_path,status").eq("id", jobId).eq("workspace_id", ws).maybeSingle();
  const job = q.data as Row | null;
  if (!job || !pathBelongsTo(job.storage_path as string, tenant, ws)) throw new ImportError("unreadable");
  const dl = await db.storage.from(IMPORT_BUCKET).download(String(job.storage_path));
  if (dl.error || !dl.data) throw new ImportError("unreadable");
  return { sheet: await parseFile(await dl.data.arrayBuffer(), String(job.storage_path)), path: String(job.storage_path) };
}

const savedKind = (o: ImportObject): ImportKind | null => (o === "lead" ? "leads" : o === "account" ? "accounts" : null);

/** Step 2: header names, a few sample rows, target fields (standard + field_defs) and the suggested mapping (saved importMappings first). */
export async function inspectUpload(input: { jobId: string; object: string; demoText?: string }): Promise<ActionResult<InspectView>> {
  return runAction(async () => {
    const t = await importT();
    const o = objectSchema.safeParse(input.object);
    if (!o.success) return failResult("invalid", t("unreadable"));
    const object = o.data as ImportObject;
    const { session, active } = await requireActive();
    await guardImport(object);
    let sheet: ParsedSheet;
    try { sheet = (await sheetOf(input.jobId, input.demoText ?? (session.demo ? SAMPLE_CSV[object] : undefined), session.demo, active.ws.uuid, (await tenantUuid()))).sheet; }
    catch (e) { return importError(t, e); }
    const targets = await targetsOf(object, t);
    let saved: Mapping = {};
    const kind = savedKind(object);
    if (kind) { try { saved = { ...(await getEffectiveConfig(active.tenant.id)).data.importMappings[kind] }; } catch { saved = {}; } }
    const mapping = autoMap(sheet.headers, targets, saved);
    const savedUsed = Object.entries(saved).some(([h, k]) => k && mapping[h] === k);
    return okResult("", { data: {
      headers: sheet.headers, sample: sheet.rows.slice(0, SAMPLE_ROWS).map((r) => r.cells), rows: sheet.rows.length, mapping, savedUsed,
      targets: targets.map((x) => ({ key: x.key, label: x.label, required: !!x.required, custom: x.key.startsWith("custom.") })),
    } });
  });
}

/** Step 3: dry run of the planner (same code the job uses): new, duplicate and problem counts plus the first few problems. */
export async function previewImport(input: { jobId: string; object: string; mapping: Mapping; demoText?: string }): Promise<ActionResult<PreviewView>> {
  return runAction(async () => {
    const t = await importT();
    const o = objectSchema.safeParse(input.object), m = mappingSchema.safeParse(input.mapping);
    if (!o.success || !m.success) return failResult("invalid", t("unreadable"));
    const object = o.data as ImportObject;
    const { session, active } = await requireActive();
    await guardImport(object);
    let sheet: ParsedSheet;
    try { sheet = (await sheetOf(input.jobId, input.demoText ?? (session.demo ? SAMPLE_CSV[object] : undefined), session.demo, active.ws.uuid, (await tenantUuid()))).sheet; }
    catch (e) { return importError(t, e); }
    const targets = await targetsOf(object, t);
    const chk = checkMapping(m.data, targets, object);
    if (!chk.ok) return failResult("invalid", chk.duplicates.length ? t("duplicateTargets", { fields: chk.duplicates.join(", ") }) : t("missingRequired", { fields: chk.missingRequired.join(", ") }));
    // existing keys come from the whole workspace (not only what this user may see), so duplicates are never missed; only counts leave the server
    const existing = session.demo ? demoExisting(object) : await loadExistingIndex(serviceDb(), active.ws.uuid, object);
    const { rows, summary } = planImport({ object, rows: sheet.rows, mapping: m.data, targets, existing });
    const problems = rows.filter((r) => r.issues.length).slice(0, 5).map((r) => ({ rowNo: r.rowNo, field: r.issues[0].field, message: t(`reasons.${r.issues[0].reason}`) }));
    return okResult("", { data: { summary, problems } });
  });
}

/** Step 4: save the mapping and mode on the job and queue the run. Demo: reports what would happen and saves nothing. */
export async function confirmImport(input: { jobId: string; object: string; mapping: Mapping; mode: string; remember: boolean; demoCounts?: { fresh: number; dup: number; invalid: number } }): Promise<ActionResult<{ jobId: string; demo: boolean }>> {
  return runAction(async () => {
    const t = await importT();
    const o = objectSchema.safeParse(input.object), m = mappingSchema.safeParse(input.mapping);
    if (!o.success || !m.success || !["skip", "merge"].includes(input.mode)) return failResult("invalid", t("startFailed"));
    const object = o.data as ImportObject;
    const { session, active } = await requireActive();
    const p = await guardImport(object);
    const targets = await targetsOf(object, t);
    if (!checkMapping(m.data, targets, object).ok) return failResult("invalid", t("startFailed"));
    const allowed = new Set(targets.map((x) => x.key));
    const mapping: Mapping = Object.fromEntries(Object.entries(m.data).map(([h, k]) => [h, allowed.has(k) ? k : ""]));
    if (session.demo) {
      const c = input.demoCounts ?? { fresh: 0, dup: 0, invalid: 0 };
      return okResult(t("demoResult", c), { sub: t("demoResultSub"), data: { jobId: "demo", demo: true } });
    }
    if (!uuidRe.test(input.jobId)) return failResult("invalid", t("startFailed"));
    const db = await dbForRequest();
    const q = await from(db, "import_jobs").select("id,status,storage_path,object_type").eq("id", input.jobId).eq("workspace_id", active.ws.uuid).maybeSingle();
    const job = q.data as Row | null;
    if (!job || job.object_type !== object || job.status !== "uploaded" || !pathBelongsTo(job.storage_path as string, (await tenantUuid()), active.ws.uuid)) return failResult("not_found", t("startFailed"));
    const upd = await from(db, "import_jobs").update({ mapping, mode: jobModeOf(input.mode === "merge" ? "merge" : "skip"), status: "mapped" }).eq("id", input.jobId).eq("workspace_id", active.ws.uuid).eq("status", "uploaded").select("id").maybeSingle();
    if (upd.error || !upd.data) return failResult("error", t("startFailed"));
    await audit(actorFromPrincipal(p), { action: "import.started", summary: `Import started for ${object}`, object: { table: "import_jobs", id: input.jobId }, detail: { object, mode: input.mode, columns: Object.values(mapping).filter(Boolean).length } });
    const payload: ImportRunPayload = { job_id: input.jobId, tenant_id: (await tenantUuid()), workspace_id: active.ws.uuid };
    await enqueue("import", IMPORT_KIND.run, payload, { tenantId: (await tenantUuid()) });
    let sub: string | undefined;
    const kind = savedKind(object);
    if (input.remember && kind) {
      try {
        const r = await applyPatch({ kind: "org", uid: session.uid, name: session.name, role: active.role, tenantId: active.tenant.id, isPrimaryOwner: active.tenant.primaryOwnerId === session.uid, support: active.support ? { mode: active.support.mode } : null }, active.tenant.id, { data: { importMappings: { [kind]: Object.fromEntries(Object.entries(mapping).filter(([, k]) => k)) } } });
        sub = r.ok ? t("mappingSaved") : t("mappingNotSaved");
      } catch { sub = t("mappingNotSaved"); }
    }
    revalidatePath("/import");
    return okResult(t("queued"), { sub, data: { jobId: input.jobId, demo: false } });
  });
}

/** Progress poll and realtime refetch target. RLS decides what the caller may see. */
export async function getImportJob(jobId: string): Promise<ActionResult<JobView>> {
  return runAction(async () => {
    const t = await importT();
    const { session, active } = await requireActive();
    await assertCan("leads.import");
    if (session.demo || !uuidRe.test(jobId)) return failResult("not_found", t("startFailed"));
    const q = await from(await dbForRequest(), "import_jobs").select().eq("id", jobId).eq("workspace_id", active.ws.uuid).maybeSingle();
    return q.data ? okResult("", { data: jobView(q.data as Row) }) : failResult("not_found", t("startFailed"));
  });
}

export async function listImportJobs(): Promise<ActionResult<JobView[]>> {
  return runAction(async () => {
    const t = await importT();
    const { session, active } = await requireActive();
    await assertCan("leads.import");
    if (session.demo) return okResult("", { data: [] });
    const q = await from(await dbForRequest(), "import_jobs").select().eq("workspace_id", active.ws.uuid).order("created_at", { ascending: false }).limit(50);
    if (q.error) return failResult("error", t("histLoadError"));
    return okResult("", { data: ((q.data as Row[] | null) ?? []).map(jobView) });
  });
}

/** Short-lived signed URL for the problem report of one job (RLS on the job row and on storage.objects). */
export async function errorReportUrl(jobId: string): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const t = await importT();
    const { session, active } = await requireActive();
    await assertCan("leads.import");
    if (session.demo || !uuidRe.test(jobId)) return failResult("not_found", t("errorReportFailed"));
    const db = await dbForRequest();
    const q = await from(db, "import_jobs").select("error_report_path").eq("id", jobId).eq("workspace_id", active.ws.uuid).maybeSingle();
    const path = (q.data as Row | null)?.error_report_path as string | undefined;
    if (!path || !pathBelongsTo(path, (await tenantUuid()), active.ws.uuid)) return failResult("not_found", t("errorReportFailed"));
    const s = await db.storage.from(IMPORT_BUCKET).createSignedUrl(path, 60, { download: "import-problems.csv" });
    return s.data?.signedUrl ? okResult("", { data: { url: s.data.signedUrl } }) : failResult("error", t("errorReportFailed"));
  });
}

/**
 * Export a list as CSV. leads.export is supportBlocked in the catalogue (denied in every support session) and the object's read permission
 * is required too. Personal data is masked when the caller cannot see it (no pii.read or a field mask) or asks for masking. The export is
 * audited first: if the audit row cannot be written, nothing is exported.
 */
export async function exportList(input: { object: string; ids?: string[]; maskPersonal: boolean }): Promise<ActionResult<ExportView>> {
  return runAction(async () => {
    const t = await importT();
    const o = objectSchema.safeParse(input.object);
    if (!o.success || (input.ids && (!Array.isArray(input.ids) || input.ids.length > MAX_EXPORT_ROWS))) return failResult("invalid", t("exportFailed"));
    const object = o.data as ImportObject;
    const { session, active } = await requireActive();
    if (active.support) return failResult("denied", t("exportSupport"));
    const p = await assertCan("leads.export");
    await assertCan(READ_PERM[object]);
    const decision = decide(p, READ_PERM[object]);
    const forced = decision.maskedFields;
    const targets = await targetsOf(object, t);
    const cols: ExportColumn[] = targets.map((x) => ({ key: x.key, label: x.label, isPii: !!x.isPii }));
    const maskKeys = new Set(forced);
    const maskAll = input.maskPersonal;
    const columns = cols.map((c) => ({ ...c, isPii: maskAll ? c.isPii : maskKeys.has(c.key.replace("custom.", "")) }));
    const masked = maskAll || columns.some((c) => c.isPii);

    let rows: Row[] = [];
    if (session.demo) {
      const { pageCtx } = await import("@/lib/data/context");
      const ctx = await pageCtx();
      if (object === "lead") rows = ctx.scope.leads(await ctx.ds.leads()).filter((l) => !input.ids || input.ids.includes(l.id)).map((l) => ({ full_name: l.name, role_title: l.title, email: l.email, phone: l.phone, city: l.city, source: l.channel }));
      else if (object === "account") rows = (await ctx.ds.accounts()).filter((a) => !input.ids || input.ids.includes(a.id)).map((a) => ({ name: a.name, city: a.city, district: a.district, website: a.website }));
    } else {
      const db = await dbForRequest();
      const keys = SYSTEM_TARGETS[object].map((x) => x.key);
      const hasCustom = targets.some((x) => x.key.startsWith("custom."));
      let last: string | null = null, offset = 0;
      for (;;) {
        let q = from(db, TABLE_OF[object]).select(["id", ...keys, ...(hasCustom ? ["custom"] : [])].join(",")).eq("workspace_id", active.ws.uuid).is("deleted_at", null).order("id", { ascending: true }).limit(500);
        if (input.ids) q = q.in("id", input.ids.slice(offset, offset + 500));
        else if (last) q = q.gt("id", last);
        const { data, error } = await q;
        if (error) return failResult("error", t("exportFailed"));
        const page = (data as Row[] | null) ?? [];
        rows.push(...page);
        offset += 500;
        const more = input.ids ? offset < input.ids.length : page.length === 500;
        if (!more || rows.length > MAX_EXPORT_ROWS) break;
        last = String(page[page.length - 1].id);
      }
    }
    const truncated = rows.length > MAX_EXPORT_ROWS;
    if (truncated) rows = rows.slice(0, MAX_EXPORT_ROWS);
    if (!rows.length) return failResult("not_found", t("exportEmpty"));
    await audit(actorFromPrincipal(p, { demo: session.demo }), { action: "export.csv", summary: `Exported ${rows.length} ${object} rows`, detail: { object, count: rows.length, masked, filtered: !!input.ids } });
    const sub = masked ? t("exportDoneMasked") : t("exportDoneOpen");
    return okResult(t("exportDone", { n: rows.length }), { sub: truncated ? `${sub} ${t("exportTruncated", { n: MAX_EXPORT_ROWS })}` : sub, data: { csv: buildExportCsv(columns, rows, { maskPii: masked }), filename: exportFileName(object, new Date()), rows: rows.length, masked, truncated } });
  });
}

