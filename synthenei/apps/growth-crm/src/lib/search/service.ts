// Request-level search service: resolves the caller (session, active workspace, principal) and runs the right engine.
// Real sessions query through the user's own client (RLS applies); demo sessions read the in-memory dataset.
import "server-only";
import { requireActive } from "@/lib/auth/server";
import { can as roleCan } from "@/lib/auth/roles";
import { loadPrincipal } from "@/lib/authz/load";
import { can } from "@/lib/authz";
import { dbForRequest } from "@/lib/db/client";
import { getDataSource } from "@/lib/data/source";
import { getLocale } from "@/i18n/server";
import { listFields, listObjectTypes, tenantOfWorkspace } from "@/lib/metadata/repo";
import { demoAccess, demoFields, demoObject, demoRecords } from "@/app/(app)/o/_lib/demo";
import { allowedActions } from "./actions";
import { searchDemo } from "./demo";
import { searchableKeys, searchableTypes, searchReal, type ObjectSearchDef } from "./engine";
import type { HitType, SearchResponse } from "./types";

async function realObjects(wsUuid: string): Promise<ObjectSearchDef[]> {
  const types = (await listObjectTypes(await tenantOfWorkspace(wsUuid))).filter((o) => o.kind === "custom" && o.isEnabled).slice(0, 8);
  return Promise.all(types.map(async (object) => ({ object, fields: await listFields(object.id) })));
}

/** `q` is already sanitised (see sanitizeQuery). An empty q is the bootstrap call: actions and the types the viewer may search. */
export async function runSearch(q: string): Promise<SearchResponse> {
  const { session, active } = await requireActive();
  const locale = (await getLocale()) === "ta" ? "ta" : "en";
  const principal = await loadPrincipal();
  const ws = { uuid: active.ws.uuid, id: active.ws.id };

  if (session.demo) {
    const obj = demoObject();
    const objDef = { object: obj, fields: demoFields() };
    const recordsOk = demoAccess(active.role).read;
    const types: HitType[] = [];
    const leadsOk = can(principal, "leads.read", { type: "lead", workspaceId: ws.id }), accountsOk = can(principal, "accounts.read", { type: "account", workspaceId: ws.id });
    if (leadsOk) types.push("lead");
    if (accountsOk) types.push("account");
    if (recordsOk) types.push("record");
    const base = { actions: allowedActions(principal, ws.id), types, objects: recordsOk ? [obj.key] : [] };
    if (!q) return { hits: [], ...base };
    const pii = roleCan("seePersonalData", { role: active.role, support: active.support });
    const ds = getDataSource(active.ws, { demo: true, piiRead: pii });
    const [leads, accounts] = await Promise.all([leadsOk ? ds.leads() : null, accountsOk ? ds.accounts() : null]);
    const label = obj.label.en.one;
    const hits = searchDemo({
      q, pii, leads, accounts, ownOnly: active.role === "sales_rep" ? { uid: session.uid } : null,
      records: recordsOk ? { rows: demoRecords().map((r) => ({ id: r.id, title: r.title, data: r.data, objectKey: obj.key, label })), searchableKeys: searchableKeys(objDef, pii), piiKeys: objDef.fields.filter((f) => f.isPii).map((f) => f.key) } : null,
    });
    return { hits, ...base };
  }

  let objects: ObjectSearchDef[] = [];
  let partial = false;
  try { objects = await realObjects(ws.uuid); } catch { partial = true; }
  const deps = { db: dbForRequest, principal, ws, objects };
  const { types, objects: allowed } = searchableTypes(principal, ws.id, objects);
  if (!q) return { hits: [], actions: allowedActions(principal, ws.id), types, objects: allowed.map((o) => o.object.key), ...(partial ? { partial } : {}) };
  const r = await searchReal(deps, q, locale);
  return { hits: r.hits, types, objects: allowed.map((o) => o.object.key), ...(partial || r.partial ? { partial: true } : {}) };
}
