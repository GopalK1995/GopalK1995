// Access export bundle (DPDP right of access): everything the workspace holds about one lead, as one JSON document the owner hands to the
// data principal. Built on the SIGNED-IN user's client, so RLS decides what can be read; a section that cannot be read says so in the
// manifest instead of silently shrinking the bundle. Internal plumbing columns are dropped; the person's own data is kept.
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";

type R = Record<string, unknown>;
export const BUNDLE_ROW_CAP = 5000;
/** Columns that are system plumbing, not the person's data. */
const INTERNAL = new Set(["tenant_id", "workspace_id", "created_by", "ai_insight_id", "is_synthetic", "owner_id", "assignee_id", "sent_by", "recorded_by"]);
export const stripInternal = (r: R): R => Object.fromEntries(Object.entries(r).filter(([k]) => !INTERNAL.has(k)));

export interface BundleSection { name: string; count: number; truncated: boolean; error: string | null }
export interface AccessBundle {
  manifest: { format: "access-bundle/v1"; generatedAt: string; workspace: string; requestId: string; subjectRef: string; leadId: string; sections: BundleSection[]; notes: string[] };
  data: Record<string, R[]>;
}

export async function buildAccessBundle(db: Db, i: { workspaceId: string; requestId: string; subjectRef: string; leadId: string; now?: Date }): Promise<AccessBundle> {
  const data: Record<string, R[]> = {}, sections: BundleSection[] = [];
  const take = async (name: string, run: () => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>) => {
    try {
      const r = await run();
      if (r.error) { sections.push({ name, count: 0, truncated: false, error: `unreadable (${r.error.code ?? "error"})` }); data[name] = []; return []; }
      const rows = ((r.data as R[] | null) ?? []).map(stripInternal);
      data[name] = rows.slice(0, BUNDLE_ROW_CAP);
      sections.push({ name, count: data[name].length, truncated: rows.length > BUNDLE_ROW_CAP, error: null });
      return rows;
    } catch { sections.push({ name, count: 0, truncated: false, error: "unreadable" }); data[name] = []; return []; }
  };
  const ws = i.workspaceId, lead = i.leadId, cap = BUNDLE_ROW_CAP + 1;
  const T = (t: string) => from(db, t);

  const leadRows = await take("lead", () => T("leads").select("*").eq("id", lead).eq("workspace_id", ws).limit(1));
  const l = leadRows[0] as R | undefined;
  await take("activities", () => T("activities").select("*").eq("workspace_id", ws).eq("lead_id", lead).order("created_at", { ascending: true }).limit(cap));
  const convs = await take("conversations", () => T("conversations").select("*").eq("workspace_id", ws).eq("lead_id", lead).limit(cap));
  const convIds = convs.map((c) => String(c.id));
  if (convIds.length) await take("messages", () => T("messages").select("*").in("conversation_id", convIds).order("created_at", { ascending: true }).limit(cap));
  else { data.messages = []; sections.push({ name: "messages", count: 0, truncated: false, error: null }); }
  await take("consent_log", () => T("consent_log").select("purpose, action, notice_version, captured_via, occurred_at, note").eq("workspace_id", ws).eq("subject_ref", i.subjectRef).order("occurred_at", { ascending: true }).limit(cap));
  await take("lead_events", () => T("lead_events").select("*").eq("workspace_id", ws).eq("lead_id", lead).order("occurred_at", { ascending: true }).limit(cap));
  await take("tasks", () => T("tasks").select("*").eq("workspace_id", ws).eq("lead_id", lead).limit(cap));
  await take("deals", () => T("deals").select("*").eq("workspace_id", ws).eq("lead_id", lead).limit(cap));
  await take("payments", () => T("payments").select("id, provider, amount_paise, currency, status, paid_at, created_at").eq("workspace_id", ws).eq("lead_id", lead).limit(cap));
  await take("calendar_events", () => T("calendar_events").select("starts_at, ends_at, title, status").eq("workspace_id", ws).eq("object_type", "lead").eq("object_id", lead).limit(cap));
  const contactId = l?.contact_id ? String(l.contact_id) : null;
  if (contactId) await take("contact", () => T("contacts").select("*").eq("id", contactId).eq("workspace_id", ws).limit(1));
  // Custom-object records linked to the lead, either direction.
  const links = [
    ...(await take("record_links_from", () => T("record_links").select("to_id, to_type, relation").eq("workspace_id", ws).eq("from_type", "lead").eq("from_id", lead).limit(cap))),
    ...(await take("record_links_to", () => T("record_links").select("from_id, from_type, relation").eq("workspace_id", ws).eq("to_type", "lead").eq("to_id", lead).limit(cap))),
  ];
  const recIds = [...new Set(links.map((x) => String(x.to_id ?? x.from_id ?? "")).filter(Boolean))];
  delete data.record_links_from; delete data.record_links_to;
  for (const n of ["record_links_from", "record_links_to"]) { const ix = sections.findIndex((s) => s.name === n); if (ix >= 0) sections.splice(ix, 1); }
  if (recIds.length) await take("records", () => T("records").select("id, object_type_id, title, data, created_at, updated_at").eq("workspace_id", ws).in("id", recIds).is("deleted_at", null).limit(cap));
  else { data.records = []; sections.push({ name: "records", count: 0, truncated: false, error: null }); }
  await take("privacy_requests", () => T("privacy_requests").select("kind, received_at, due_at, status, completed_at").eq("workspace_id", ws).eq("subject_ref", i.subjectRef).order("received_at", { ascending: true }).limit(cap));

  return {
    manifest: {
      format: "access-bundle/v1", generatedAt: (i.now ?? new Date()).toISOString(), workspace: ws, requestId: i.requestId, subjectRef: i.subjectRef, leadId: lead, sections,
      notes: [
        "Only data held in this workspace is included. Copies in connected tools (email provider, CRM sync, ad platforms) are not part of this bundle.",
        "Embeddings and other derived search data are not listed: they are generated from the records above and deleted with them.",
        ...sections.filter((s) => s.error).map((s) => `Section "${s.name}" could not be read and is empty.`),
        ...sections.filter((s) => s.truncated).map((s) => `Section "${s.name}" was cut at ${BUNDLE_ROW_CAP} rows.`),
      ],
    },
    data,
  };
}
