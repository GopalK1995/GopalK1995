"use server";
// Record, link and saved-view actions for custom objects. Every action: zod -> permission from the catalogue
// (obj:<key>.write|delete, views.share; never a role name, never in a read-only support session) -> src/app/(app)/o/_lib/service.ts
// (validation, version guard, audit). Demo sessions validate and return the demo notice and never create a Supabase client.
// RLS re-checks every write (obj:<key>.*, views.share).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { can } from "@/lib/authz";
import { assertCan } from "@/lib/authz/load";
import { requireActive } from "@/lib/auth/server";
import { getLocale } from "@/i18n/server";
import { DbError } from "@/lib/db/errors";
import { trFor, type Tr } from "@/lib/layouts/strings";
import { validateCustom } from "@/lib/metadata/validate";
import { FIELD_KEY_RE } from "@/lib/metadata/types";
import { objectNoun } from "@/lib/metadata/labels";
import { vocabFor } from "@/lib/vertical";
import { listObjectTypes } from "@/lib/metadata/repo";
import { loadObjectCtx, objPerm, objType } from "../_lib/ctx";
import { DEMO_OBJECT_KEY, demoRecords } from "../_lib/demo";
import * as repo from "../_lib/repo";
import { createRecordFlow, deleteRecordFlow, renameRecordFlow, type RecordCtx, type RecordDeps } from "../_lib/service";
import { canEditView, sanitizeView } from "../_lib/views";
import type { LinkCandidate, SavedView } from "../_lib/types";

const keyS = z.string().regex(FIELD_KEY_RE);
const idS = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

const deps: RecordDeps = {
  insert: (r) => repo.insertRecord(r),
  get: async () => null,   // replaced per call (needs the object type and workspace)
  update: async () => ({ version: 0 }),
  audit: (a, i) => audit(a, i),
};

async function gate(objectKey: string) {
  const { session, active } = await requireActive();
  const res = await loadObjectCtx(objectKey);
  if (res.status !== "ok") throw new DbError("not_found", "not_found");
  const ctx = res.ctx;
  const tr: Tr = trFor(ctx.locale);
  const noun = objectNoun(vocabFor(active.tenant), objectKey, ctx.object);
  const t: Tr = (k, v = {}) => tr(k, { noun: noun.one, nouns: noun.many, ...v });
  return { ctx, t, demo: session.demo === true, uid: session.uid, active };
}
type G = Awaited<ReturnType<typeof gate>>;

function recordCtx(g: G, principalUid: string): RecordCtx {
  const real: RecordDeps = {
    ...deps,
    get: (id) => repo.getRecord(id, g.ctx.object.id, g.ctx.wsUuid),
    update: (id, v, patch) => repo.updateRecordGuarded(id, v, patch, g.ctx.wsUuid),
  };
  return {
    ws: g.ctx.wsUuid, objectKey: g.ctx.object.key, objectTypeId: g.ctx.object.id, fields: g.ctx.fields, primaryKey: g.ctx.object.primaryField,
    actor: actorFromPrincipal(g.ctx.principal), ownerId: principalUid, locale: g.ctx.locale, t: g.t, deps: real, log: (m, e) => console.error(`[objects] ${m}`, e),
  };
}

/** Catalogue check (obj:<key>.<mode>). Demo uses the demo grants; real sessions also run the engine through assertCan. Throws "denied". */
async function need(g: G, mode: "read" | "write" | "delete", rec?: { id?: string; ownerId?: string | null }): Promise<void> {
  if (!g.ctx.can(mode, rec)) throw new DbError("denied", "denied");
  if (!g.demo) await assertCan(objPerm(g.ctx.object.key, mode), { type: objType(g.ctx.object.key), workspaceId: g.ctx.wsKey, ...(rec ?? {}) });
}

/** Maps authz and db failures to this namespace's wording; conflicts carry only the new version, never the row. */
async function guarded<T>(objectKey: string, paths: string[], body: (g: G) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const res = await runAction<T>(async () => body(await gate(objectKey)));
  if (res.ok) { for (const p of paths) revalidatePath(p.replace("{key}", objectKey)); return res; }
  const tr = trFor(await loadLocale());
  if (res.code === "denied") return { ...res, message: tr("deniedAction"), sub: tr("deniedActionBody") };
  if (res.code === "error") return { ...res, message: tr("errorTitle"), sub: tr("errorBody") };
  if (res.code === "not_found") return { ...res, message: tr("recordGone") };
  if (res.code === "conflict") return { ...res, message: tr("conflictTitle"), sub: tr("conflictBody") };
  return res;
}
async function loadLocale(): Promise<"en" | "ta"> {
  return (await getLocale()) === "ta" ? "ta" : "en";
}
const bad = (t: Tr, e: { issues: { path: PropertyKey[]; message: string }[] }): ActionResult<never> =>
  failResult("invalid", t("invalidBody"), { issues: e.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });

// ---------- records ----------
const createSchema = z.object({ objectKey: keyS, values: z.record(z.string().regex(FIELD_KEY_RE), z.unknown()).refine((v) => Object.keys(v).length <= 100, "too many fields") });
export async function createRecord(raw: unknown): Promise<ActionResult<{ id: string; version: number }>> {
  const p = createSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !FIELD_KEY_RE.test(objectKey)) return failResult("invalid", trFor("en")("invalidBody"));
  return guarded(objectKey, ["/o/{key}"], async (g) => {
    if (!p.success) return bad(g.t, p.error);
    await need(g, "write");
    if (g.demo) {
      const v = validateCustom(g.ctx.fields, p.data.values, "create");
      if (v.issues.length) return failResult("invalid", g.t("fixFields", { n: v.issues.length }), { issues: v.issues });
      return okResult(g.t("recordCreated", { title: String(v.value[g.ctx.object.primaryField] ?? "") }), { sub: g.t("demoNotSaved") });
    }
    return createRecordFlow(recordCtx(g, g.uid), p.data.values);
  });
}

const renameSchema = z.object({ objectKey: keyS, id: idS, version: z.number().int().min(0), title: z.string().max(300) });
export async function renameRecord(raw: unknown): Promise<ActionResult<{ version: number; title: string }>> {
  const p = renameSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !FIELD_KEY_RE.test(objectKey)) return failResult("invalid", trFor("en")("invalidBody"));
  return guarded(objectKey, ["/o/{key}", "/o/{key}/" + String((raw as { id?: string }).id ?? "")], async (g) => {
    if (!p.success) return bad(g.t, p.error);
    await need(g, "write", { id: p.data.id });
    if (g.demo) {
      if (!p.data.title.trim()) return failResult("invalid", g.t("titleRequired"), { issues: [{ path: g.ctx.object.primaryField, message: g.t("titleRequired") }] });
      return okResult(g.t("recordRenamed"), { sub: g.t("demoNotSaved"), data: { version: p.data.version, title: p.data.title.trim() } });
    }
    const rc = recordCtx(g, g.uid);
    const cur = await repo.getRecord(p.data.id, g.ctx.object.id, g.ctx.wsUuid);
    if (cur && !g.ctx.can("write", { id: cur.id, ownerId: cur.ownerId })) return failResult("denied", g.t("deniedAction"));
    return renameRecordFlow(rc, p.data.id, p.data.version, p.data.title);
  });
}

const deleteSchema = z.object({ objectKey: keyS, id: idS, version: z.number().int().min(0) });
export async function deleteRecord(raw: unknown): Promise<ActionResult> {
  const p = deleteSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !FIELD_KEY_RE.test(objectKey)) return failResult("invalid", trFor("en")("invalidBody"));
  return guarded(objectKey, ["/o/{key}"], async (g) => {
    if (!p.success) return bad(g.t, p.error);
    await need(g, "delete", { id: p.data.id });
    if (g.demo) return okResult(g.t("recordDeleted"), { sub: g.t("demoNotSaved") });
    const cur = await repo.getRecord(p.data.id, g.ctx.object.id, g.ctx.wsUuid);
    if (cur && !g.ctx.can("delete", { id: cur.id, ownerId: cur.ownerId })) return failResult("denied", g.t("deniedAction"));
    return deleteRecordFlow(recordCtx(g, g.uid), p.data.id, p.data.version);
  });
}

// ---------- links ----------
const linkSchema = z.object({ objectKey: keyS, id: idS, targetKey: keyS, targetId: idS, relation: z.string().trim().min(1).max(60).default("related") });
export async function addLink(raw: unknown): Promise<ActionResult<{ linkId: string }>> {
  const p = linkSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !FIELD_KEY_RE.test(objectKey)) return failResult("invalid", trFor("en")("invalidBody"));
  return guarded(objectKey, ["/o/{key}/" + String((raw as { id?: string }).id ?? "")], async (g) => {
    if (!p.success) return bad(g.t, p.error);
    const d = p.data;
    await need(g, "write", { id: d.id });
    if (d.targetKey === objectKey && d.targetId === d.id) return failResult("invalid", g.t("linkSelf"));
    if (g.demo) return okResult(g.t("linkAdded"), { sub: g.t("demoNotSaved"), data: { linkId: "demo-link-new" } });
    if (!can(g.ctx.principal, objPerm(d.targetKey, "read"), { type: objType(d.targetKey), workspaceId: g.ctx.wsKey })) return failResult("denied", g.t("linkTargetDenied"));
    const [target] = await repo.recordsByIds(g.ctx.wsUuid, [d.targetId]);
    const types = await listObjectTypes(g.ctx.tenantId);
    if (!target || types.find((x) => x.id === target.objectTypeId)?.key !== d.targetKey) return failResult("not_found", g.t("linkTargetGone"));
    const src = await repo.getRecord(d.id, g.ctx.object.id, g.ctx.wsUuid);
    if (!src) return failResult("not_found", g.t("recordGone"));
    const link = await repo.insertLink({ workspaceId: g.ctx.wsUuid, fromType: objType(objectKey), fromId: d.id, toType: objType(d.targetKey), toId: d.targetId, relation: d.relation });
    let sub: string | undefined;
    try { await audit(actorFromPrincipal(g.ctx.principal), { action: "records.linked", summary: `Linked a ${objectKey} record to a ${d.targetKey} record`, object: { table: "record_links", id: link.id }, detail: { from: objectKey, to: d.targetKey, relation: d.relation } }); } catch { sub = g.t("auditFailed"); }
    return okResult(g.t("linkAdded"), { sub, data: { linkId: link.id } });
  });
}

const unlinkSchema = z.object({ objectKey: keyS, id: idS, linkId: idS });
export async function removeLink(raw: unknown): Promise<ActionResult> {
  const p = unlinkSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !FIELD_KEY_RE.test(objectKey)) return failResult("invalid", trFor("en")("invalidBody"));
  return guarded(objectKey, ["/o/{key}/" + String((raw as { id?: string }).id ?? "")], async (g) => {
    if (!p.success) return bad(g.t, p.error);
    await need(g, "write", { id: p.data.id });
    if (g.demo) return okResult(g.t("linkRemoved"), { sub: g.t("demoNotSaved") });
    const link = await repo.getLink(p.data.linkId, g.ctx.wsUuid);
    if (!link) return failResult("not_found", g.t("linkGone"));
    await repo.deleteLink(link.id, g.ctx.wsUuid);
    let sub: string | undefined;
    try { await audit(actorFromPrincipal(g.ctx.principal), { action: "records.unlinked", summary: `Removed a link from a ${objectKey} record`, object: { table: "record_links", id: link.id }, detail: { from: link.fromType, to: link.toType } }); } catch { sub = g.t("auditFailed"); }
    return okResult(g.t("linkRemoved"), { sub });
  });
}

const searchSchema = z.object({ objectKey: keyS, id: idS, q: z.string().max(80) });
export async function searchLinkTargets(raw: unknown): Promise<ActionResult<{ items: LinkCandidate[] }>> {
  const p = searchSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !FIELD_KEY_RE.test(objectKey)) return failResult("invalid", trFor("en")("invalidBody"));
  return guarded(objectKey, [], async (g) => {
    if (!p.success) return bad(g.t, p.error);
    await need(g, "write");
    if (g.demo) {
      const q = p.data.q.trim().toLowerCase();
      return okResult("", { data: { items: demoRecords().filter((r) => r.id !== p.data.id && r.title.toLowerCase().includes(q)).map((r) => ({ key: DEMO_OBJECT_KEY, id: r.id, label: r.title })) } });
    }
    const [rows, types] = await Promise.all([repo.searchRecords(g.ctx.wsUuid, p.data.q), listObjectTypes(g.ctx.tenantId)]);
    const items: LinkCandidate[] = [];
    for (const r of rows) {
      const ot = types.find((x) => x.id === r.objectTypeId);
      if (!ot || ot.kind !== "custom" || r.id === p.data.id) continue;
      if (!can(g.ctx.principal, objPerm(ot.key, "read"), { type: objType(ot.key), workspaceId: g.ctx.wsKey })) continue;
      items.push({ key: ot.key, id: r.id, label: r.title });
    }
    return okResult("", { data: { items } });
  });
}

// ---------- saved views ----------
const viewBody = { name: z.string().max(200), visibility: z.string().optional(), filters: z.unknown(), sort: z.unknown(), columns: z.unknown() };
const saveViewSchema = z.object({ objectKey: keyS, ...viewBody });
export async function saveView(raw: unknown): Promise<ActionResult<{ view: SavedView }>> {
  const p = saveViewSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !FIELD_KEY_RE.test(objectKey)) return failResult("invalid", trFor("en")("invalidBody"));
  return guarded(objectKey, ["/o/{key}"], async (g) => {
    if (!p.success) return bad(g.t, p.error);
    await need(g, "read");
    const clean = sanitizeView(g.ctx.fields, p.data, g.ctx.canShareViews);
    if (clean.issues.length) {
      const first = clean.issues[0];
      return failResult("invalid", g.t(first.code === "share" ? "viewShareDenied" : first.code === "name" ? "viewNameInvalid" : "invalidBody"), { issues: clean.issues.map((i) => ({ path: i.path, message: g.t(i.code === "share" ? "viewShareDenied" : "viewNameInvalid") })) });
    }
    if (g.demo) return okResult(g.t("viewSaved", { name: clean.value.name }), { sub: g.t("demoNotSaved") });
    if (g.ctx.support) return failResult("denied", g.t("deniedAction"), { sub: g.t("deniedSupport") });
    const view = await repo.insertView({ workspaceId: g.ctx.wsUuid, objectTypeId: g.ctx.object.id, ownerId: g.uid, ...clean.value });
    return okResult(g.t("viewSaved", { name: view.name }), { data: { view } });
  });
}

const updateViewSchema = z.object({ objectKey: keyS, id: idS, name: z.string().max(200), visibility: z.string() });
export async function updateView(raw: unknown): Promise<ActionResult<{ view: SavedView }>> {
  const p = updateViewSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !FIELD_KEY_RE.test(objectKey)) return failResult("invalid", trFor("en")("invalidBody"));
  return guarded(objectKey, ["/o/{key}"], async (g) => {
    if (!p.success) return bad(g.t, p.error);
    await need(g, "read");
    const clean = sanitizeView(g.ctx.fields, { name: p.data.name, visibility: p.data.visibility }, g.ctx.canShareViews);
    if (clean.issues.length) return failResult("invalid", g.t(clean.issues[0].code === "share" ? "viewShareDenied" : "viewNameInvalid"));
    if (g.demo) return okResult(g.t("viewUpdated", { name: clean.value.name }), { sub: g.t("demoNotSaved") });
    const cur = await repo.getView(p.data.id, g.ctx.wsUuid);
    if (!cur) return failResult("not_found", g.t("viewGone"));
    if (!canEditView(cur, g.uid, g.ctx.canShareViews)) return failResult("denied", g.t("deniedAction"));
    const view = await repo.updateViewRow(cur.id, g.ctx.wsUuid, { name: clean.value.name, visibility: clean.value.visibility });
    return okResult(g.t("viewUpdated", { name: view.name }), { data: { view } });
  });
}

const deleteViewSchema = z.object({ objectKey: keyS, id: idS });
export async function deleteView(raw: unknown): Promise<ActionResult> {
  const p = deleteViewSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !FIELD_KEY_RE.test(objectKey)) return failResult("invalid", trFor("en")("invalidBody"));
  return guarded(objectKey, ["/o/{key}"], async (g) => {
    if (!p.success) return bad(g.t, p.error);
    await need(g, "read");
    if (g.demo) return okResult(g.t("viewDeleted"), { sub: g.t("demoNotSaved") });
    const cur = await repo.getView(p.data.id, g.ctx.wsUuid);
    if (!cur) return failResult("not_found", g.t("viewGone"));
    if (!canEditView(cur, g.uid, g.ctx.canShareViews)) return failResult("denied", g.t("deniedAction"));
    await repo.deleteViewRow(cur.id, g.ctx.wsUuid);
    return okResult(g.t("viewDeleted"));
  });
}

