// Search engine for the palette. Everything goes through the caller's own session client (db = dbForRequest), so Postgres RLS
// is the enforcement; the `can()` checks here only avoid pointless queries and trim rows the scope rules would hide anyway.
// Viewers without pii.read read the masked views (v_leads_masked, v_contacts_masked): names come back as initials, and only
// the masked columns are ever searched, so a viewer cannot probe for a full name by typing it.
import { can, type Principal } from "@/lib/authz";
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { FIELD_KEY_RE, type FieldDef, type ObjectTypeDef } from "@/lib/metadata/types";
import { HIT_LIMIT, type HitType, type SearchHit } from "./types";
import { likePattern } from "./sanitize";

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const TEXTY = new Set(["text", "long_text", "email", "phone", "url"]);

export interface ObjectSearchDef { object: ObjectTypeDef; fields: FieldDef[] }
export interface RealDeps {
  db: () => Promise<Db>;
  principal: Principal;
  /** Workspace uuid (database) and key (session). */
  ws: { uuid: string; id: string };
  objects: ObjectSearchDef[];
}
export interface SourceResult { hits: SearchHit[]; failed: boolean }

const ref = (type: "lead" | "contact" | "account", d: RealDeps, ownerId: unknown) => ({ type, workspaceId: d.ws.id, ownerId: typeof ownerId === "string" ? ownerId : null });
const piiOk = (p: Principal) => can(p, "pii.read");

/** Which hit types and custom objects this viewer may search. Used for the bootstrap response and to skip queries. */
export function searchableTypes(p: Principal, objects: ObjectSearchDef[]): { types: HitType[]; objects: ObjectSearchDef[] } {
  // List-level checks (no record): a scoped grant (own, team) passes here and is applied per row by RLS and by the row filters below.
  const types: HitType[] = [];
  if (can(p, "leads.read")) types.push("lead");
  if (can(p, "accounts.read")) types.push("account");
  if (can(p, "contacts.read")) types.push("contact");
  const objs = objects.filter((o) => can(p, `obj:${o.object.key}.read`));
  if (objs.length) types.push("record");
  return { types, objects: objs };
}

async function guarded(fn: () => Promise<SearchHit[]>): Promise<SourceResult> {
  try { return { hits: await fn(), failed: false }; } catch { return { hits: [], failed: true }; }
}

export async function searchLeads(d: RealDeps, q: string): Promise<SourceResult> {
  return guarded(async () => {
    const pat = likePattern(q);
    const pii = piiOk(d.principal);
    const b = from(await d.db(), pii ? "leads" : "v_leads_masked")
      .select(pii ? "id,full_name,role_title,firm_name,city,owner_id" : "id,display_name,role_title,firm_name,city,owner_id")
      .eq("workspace_id", d.ws.uuid);
    const r = await (pii ? b.is("deleted_at", null).or(`full_name.ilike.${pat},firm_name.ilike.${pat},role_title.ilike.${pat}`) : b.or(`display_name.ilike.${pat},firm_name.ilike.${pat}`)).limit(HIT_LIMIT);
    if (r.error) throw new Error("leads");
    return ((r.data ?? []) as Row[]).filter((x) => can(d.principal, "leads.read", ref("lead", d, x.owner_id))).map((x): SearchHit => ({
      key: `lead:${str(x.id)}`, type: "lead", title: str(pii ? x.full_name : x.display_name), subtitle: [x.role_title, x.firm_name].map(str).filter(Boolean).join(" · ") || undefined,
      href: `/leads/${str(x.id)}`, masked: !pii,
    }));
  });
}

export async function searchAccounts(d: RealDeps, q: string): Promise<SourceResult> {
  return guarded(async () => {
    const pat = likePattern(q);
    const r = await from(await d.db(), "accounts").select("id,name,city,district,owner_id").eq("workspace_id", d.ws.uuid).is("deleted_at", null)
      .or(`name.ilike.${pat},city.ilike.${pat}`).limit(HIT_LIMIT);
    if (r.error) throw new Error("accounts");
    return ((r.data ?? []) as Row[]).filter((x) => can(d.principal, "accounts.read", ref("account", d, x.owner_id))).map((x): SearchHit => ({
      key: `account:${str(x.id)}`, type: "account", title: str(x.name), subtitle: [x.city, x.district].map(str).filter(Boolean).join(", ") || undefined, href: `/accounts/${str(x.id)}`,
    }));
  });
}

export async function searchContacts(d: RealDeps, q: string): Promise<SourceResult> {
  return guarded(async () => {
    const pat = likePattern(q);
    const pii = piiOk(d.principal);
    const b = from(await d.db(), pii ? "contacts" : "v_contacts_masked")
      .select(pii ? "id,full_name,role_title,account_id,owner_id" : "id,display_name,role_title,account_id,owner_id").eq("workspace_id", d.ws.uuid);
    const r = await (pii ? b.is("deleted_at", null).or(`full_name.ilike.${pat},role_title.ilike.${pat}`) : b.or(`display_name.ilike.${pat},role_title.ilike.${pat}`)).limit(HIT_LIMIT);
    if (r.error) throw new Error("contacts");
    return ((r.data ?? []) as Row[]).filter((x) => can(d.principal, "contacts.read", ref("contact", d, x.owner_id))).map((x): SearchHit => ({
      key: `contact:${str(x.id)}`, type: "contact", title: str(pii ? x.full_name : x.display_name), subtitle: str(x.role_title) || undefined,
      href: x.account_id ? `/accounts/${str(x.account_id)}` : "/contacts", masked: !pii,
    }));
  });
}

/** Text-like, live, searchable fields. PII fields are only searched for viewers who hold pii.read (no probing of hidden values). */
export function searchableKeys(o: ObjectSearchDef, pii: boolean): string[] {
  return o.fields.filter((f) => !f.archivedAt && f.isSearchable && TEXTY.has(f.type) && (pii || !f.isPii) && FIELD_KEY_RE.test(f.key)).map((f) => f.key);
}

export async function searchRecords(d: RealDeps, q: string, objs: ObjectSearchDef[], locale: "en" | "ta"): Promise<SourceResult> {
  const pii = piiOk(d.principal);
  const per = await Promise.all(objs.slice(0, 8).map((o) => guarded(async () => {
    const pat = likePattern(q);
    const primary = o.fields.find((f) => f.key === o.object.primaryField);
    const titleMasked = !!primary?.isPii && !pii;
    const clauses = [...(titleMasked ? [] : ["title"]), ...searchableKeys(o, pii).map((k) => `data->>${k}`)].map((c) => `${c}.ilike.${pat}`);
    if (!clauses.length) return [];
    const r = await from(await d.db(), "records").select("id,title,owner_id").eq("workspace_id", d.ws.uuid).eq("object_type_id", o.object.id).is("deleted_at", null)
      .or(clauses.join(",")).limit(HIT_LIMIT);
    if (r.error) throw new Error("records");
    const label = (locale === "ta" ? o.object.label.ta?.one : undefined) ?? o.object.label.en.one;
    return ((r.data ?? []) as Row[])
      .filter((x) => can(d.principal, `obj:${o.object.key}.read`, { type: `obj:${o.object.key}`, workspaceId: d.ws.id, ownerId: typeof x.owner_id === "string" ? x.owner_id : null }))
      .map((x): SearchHit => ({
        key: `obj:${o.object.key}:${str(x.id)}`, type: "record", objectKey: o.object.key, title: titleMasked ? "••••" : str(x.title) || label, subtitle: label,
        href: `/o/${o.object.key}/${str(x.id)}`, masked: titleMasked || undefined,
      }));
  })));
  return { hits: per.flatMap((p) => p.hits), failed: per.some((p) => p.failed) };
}

export async function searchReal(d: RealDeps, q: string, locale: "en" | "ta"): Promise<{ hits: SearchHit[]; partial: boolean }> {
  const { types, objects } = searchableTypes(d.principal, d.objects);
  const jobs: Promise<SourceResult>[] = [];
  if (types.includes("lead")) jobs.push(searchLeads(d, q));
  if (types.includes("account")) jobs.push(searchAccounts(d, q));
  if (types.includes("contact")) jobs.push(searchContacts(d, q));
  if (types.includes("record")) jobs.push(searchRecords(d, q, objects, locale));
  const done = await Promise.all(jobs);
  return { hits: done.flatMap((r) => r.hits), partial: done.some((r) => r.failed) };
}
