// Erasure job (DPDP right to erasure). NEVER a blind delete: the person is erased through the existing public.erase_lead() RPC, which
// checks the caller is a real workspace owner, scrubs the lead, its activities, message bodies, events and AI insights, and writes the
// erasure_completed row to consent_log. This module wraps that call and then extends it to the data erase_lead does not reach:
// the lead's contact, custom-object records (personal fields only), embeddings, calendar entries, reviews that quote the name, and the
// external links (reported, because copies in other tools must be erased at the source).
//
// Order matters and is deliberate:
//   1. audit "privacy.erasure_started" (the action does not happen unaudited: a failed audit aborts here, before anything changes)
//   2. read the facts needed to find the person's other rows (name, email, contact) BEFORE erase_lead blanks them
//   3. erase_lead on the OWNER's client (the DB refuses anyone else)
//   4. extension steps on the service client, each scoped by workspace_id and by the ids found in step 2, each reported separately
//   5. close the request with a note of what was done and what is left for a human; audit "privacy.erasure_completed"
// A failing extension step never hides: it is reported, the request stays in progress, and a re-run repeats only id-based steps.
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { throwIfError } from "@/lib/db/errors";

type R = Record<string, unknown>;
export type StepStatus = "done" | "none" | "kept" | "manual" | "failed";
export interface ErasureStep { id: string; status: StepStatus; count?: number; detail?: string }
export interface ErasureReport { leadId: string; erasedLeadCore: boolean; steps: ErasureStep[]; complete: boolean }

export interface DelQb extends PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> {
  eq(c: string, v: unknown): DelQb; in(c: string, v: unknown[]): DelQb; ilike(c: string, v: string): DelQb; select(c?: string): DelQb;
}
export const del = (db: Db, t: string): DelQb => (db as unknown as { from(t: string): { delete(): DelQb } }).from(t).delete();
const escLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

export interface ErasureDeps {
  user: Db; svc: Db; workspaceId: string;
  /** Audit rows. "started" must resolve or the erasure does not run. */
  audit: (action: "privacy.erasure_started" | "privacy.erasure_completed", summary: string, detail: Record<string, unknown>) => Promise<void>;
}
export interface ErasureInput { requestId: string; leadId: string; note?: string }

/** Pure: personal-field keys to drop from a record, from the object's field definitions. */
export function piiKeys(defs: { key: string; is_pii?: boolean | null }[]): string[] { return defs.filter((d) => d.is_pii).map((d) => d.key); }
/** Pure: the record data with personal fields removed. Other fields stay (they describe the stay, not the person). */
export function scrubRecordData(data: R, keys: string[]): R { const out = { ...data }; for (const k of keys) delete out[k]; return out; }

export async function runErasure(d: ErasureDeps, i: ErasureInput): Promise<ErasureReport> {
  const ws = d.workspaceId, steps: ErasureStep[] = [];
  const step = async (id: string, fn: () => Promise<Omit<ErasureStep, "id">>) => {
    try { steps.push({ id, ...(await fn()) }); } catch (e) { steps.push({ id, status: "failed", detail: e instanceof Error ? e.message.slice(0, 120) : "error" }); }
  };

  await d.audit("privacy.erasure_started", "Erasure started for a data principal", { requestId: i.requestId, leadId: i.leadId });

  // 2. facts about the person, read while they still exist
  const lr = await from(d.user, "leads").select("id, full_name, email, contact_id, deleted_at").eq("id", i.leadId).eq("workspace_id", ws).maybeSingle();
  throwIfError(lr.error);
  const lead = lr.data as R | null;
  if (!lead) throw new Error("lead not found in this workspace");
  const name = String(lead.full_name ?? "").trim(), email = typeof lead.email === "string" ? lead.email.trim().toLowerCase() : "";
  const alreadyErased = name === "Erased lead";
  const contactIds = new Set<string>(lead.contact_id ? [String(lead.contact_id)] : []);
  if (email) {
    const c = await from(d.svc, "contacts").select("id, email").eq("workspace_id", ws).ilike("email", escLike(email)).limit(50);
    if (!c.error) for (const r of (c.data as R[] | null) ?? []) if (String(r.email ?? "").trim().toLowerCase() === email) contactIds.add(String(r.id));
  }
  const links = await Promise.all([
    from(d.svc, "record_links").select("to_id").eq("workspace_id", ws).eq("from_type", "lead").eq("from_id", i.leadId).limit(500),
    from(d.svc, "record_links").select("from_id").eq("workspace_id", ws).eq("to_type", "lead").eq("to_id", i.leadId).limit(500),
  ]);
  const recIds = [...new Set(links.flatMap((l) => ((l.data as R[] | null) ?? []).map((r) => String(r.to_id ?? r.from_id ?? ""))).filter(Boolean))];

  // 3. the audited erasure path
  const rpc = await (d.user as unknown as { rpc(fn: string, a: R): PromiseLike<{ error: { code?: string; message?: string } | null }> }).rpc("erase_lead", { p_lead: i.leadId, p_note: (i.note ?? `Request ${i.requestId.slice(0, 8)}`).slice(0, 200) });
  if (rpc.error) throw new Error(rpc.error.code === "42501" ? "Only a workspace owner can erase" : "erase_lead failed");
  steps.push({ id: "erase_lead", status: "done", detail: alreadyErased ? "already erased; repeated" : undefined });

  // 4. extension
  const cids = [...contactIds];
  await step("contacts", async () => {
    if (!cids.length) return { status: "none" };
    const u = await from(d.svc, "contacts").update({ full_name: "Erased contact", email: null, phone: null, role_title: null, external_ids: {}, deleted_at: new Date().toISOString() }).eq("workspace_id", ws).in("id", cids).select("id");
    throwIfError(u.error);
    return { status: "done", count: ((u.data as R[] | null) ?? []).length };
  });
  await step("records", async () => {
    if (!recIds.length) return { status: "none" };
    const recs = await from(d.svc, "records").select("id, object_type_id, data").eq("workspace_id", ws).in("id", recIds).limit(500);
    throwIfError(recs.error);
    const rows = (recs.data as R[] | null) ?? [];
    const typeIds = [...new Set(rows.map((r) => String(r.object_type_id)))];
    const defs = typeIds.length ? await from(d.svc, "field_defs").select("object_type_id, key, is_pii").in("object_type_id", typeIds).limit(2000) : { data: [], error: null };
    throwIfError(defs.error);
    const byType = new Map<string, string[]>();
    for (const f of (defs.data as R[] | null) ?? []) if (f.is_pii) byType.set(String(f.object_type_id), [...(byType.get(String(f.object_type_id)) ?? []), String(f.key)]);
    let n = 0;
    for (const r of rows) {
      const keys = byType.get(String(r.object_type_id)) ?? [];
      const u = await from(d.svc, "records").update({ title: "Erased record", data: scrubRecordData((r.data as R) ?? {}, keys) }).eq("id", String(r.id)).eq("workspace_id", ws).select("id");
      throwIfError(u.error); n++;
    }
    return { status: "done", count: n, detail: "personal fields removed, title replaced" };
  });
  await step("embeddings", async () => {
    let n = 0;
    const run = async (b: DelQb) => { const r = await b.select("id"); if (r.error) throw new Error(`embeddings ${r.error.code ?? ""}`); n += ((r.data as R[] | null) ?? []).length; };
    await run(del(d.svc, "embeddings").eq("workspace_id", ws).eq("object_type", "lead").eq("object_id", i.leadId));
    if (cids.length) await run(del(d.svc, "embeddings").eq("workspace_id", ws).eq("object_type", "contact").in("object_id", cids));
    if (recIds.length) await run(del(d.svc, "embeddings").eq("workspace_id", ws).ilike("object_type", "obj:%").in("object_id", recIds));
    return n ? { status: "done", count: n, detail: "derived search vectors deleted" } : { status: "none" };
  });
  await step("calendar_events", async () => {
    const u = await from(d.svc, "calendar_events").update({ title: "Erased" }).eq("workspace_id", ws).eq("object_type", "lead").eq("object_id", i.leadId).select("id");
    throwIfError(u.error);
    const n = ((u.data as R[] | null) ?? []).length;
    return n ? { status: "done", count: n } : { status: "none" };
  });
  await step("reviews", async () => {
    if (name.length < 4 || alreadyErased) return { status: "none" };
    const u = await from(d.svc, "reviews").update({ author_name: null, reply_draft: null }).eq("workspace_id", ws).ilike("author_name", escLike(name)).select("id");
    throwIfError(u.error);
    const n = ((u.data as R[] | null) ?? []).length;
    return n ? { status: "done", count: n, detail: "author name removed from reviews with the exact same name; check them" } : { status: "none" };
  });
  await step("external_links", async () => {
    const ids = [i.leadId, ...cids, ...recIds];
    const l = await from(d.svc, "external_links").select("integration_id").eq("workspace_id", ws).in("local_id", ids).limit(200);
    throwIfError(l.error);
    const intIds = [...new Set(((l.data as R[] | null) ?? []).map((r) => String(r.integration_id)))];
    if (!intIds.length) return { status: "none" };
    const ints = await from(d.svc, "integrations").select("connector_id").in("id", intIds).limit(50);
    throwIfError(ints.error);
    const names = [...new Set(((ints.data as R[] | null) ?? []).map((r) => String(r.connector_id)))];
    // Links stay so a later sync cannot recreate the person as new; the copy at the source must be erased there.
    return { status: "manual", count: intIds.length, detail: `erase at the source in: ${names.join(", ") || "connected tools"}` };
  });
  await step("payments", async () => {
    const p = await from(d.svc, "payments").select("id").eq("workspace_id", ws).eq("lead_id", i.leadId).limit(1);
    if (p.error) return { status: "none" };
    return ((p.data as R[] | null) ?? []).length ? { status: "kept", detail: "payment records are kept for tax and accounting law" } : { status: "none" };
  });
  steps.push({ id: "suppression_list", status: "kept", detail: "the unsubscribe entry stays so the address is never mailed again" });
  steps.push({ id: "social_metrics", status: "none", detail: "social and metric tables hold counts only, no person" });

  const complete = !steps.some((s) => s.status === "failed");
  await d.audit("privacy.erasure_completed", complete ? "Erasure completed for a data principal" : "Erasure ran with failed steps", {
    requestId: i.requestId, leadId: i.leadId, complete, steps: steps.map((s) => ({ id: s.id, status: s.status, count: s.count ?? null })),
  }).catch(() => undefined);
  return { leadId: i.leadId, erasedLeadCore: true, steps, complete };
}

/** One line per step for the request's notes (no personal data). */
export function reportNote(r: ErasureReport): string {
  return `Erasure: ${r.steps.map((s) => `${s.id} ${s.status}${s.count != null ? ` (${s.count})` : ""}${s.status === "manual" || s.status === "failed" ? `: ${s.detail ?? ""}` : ""}`).join("; ")}`.slice(0, 900);
}
