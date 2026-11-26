// Service-role implementation of IntakeStore (public intake runs without a session: the same sanctioned use as the unsubscribe page).
// RLS does not protect this path, so every query is scoped by workspace_id and only the columns the intake needs are read. Row changes
// on privacy_requests and consent_log are audited by their DB triggers (actor = service).
import "server-only";
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { consentRowsForSubject } from "./consent-lookup";
import type { IntakeStore } from "./intake";
import { LEAD_CONSENT_FLAG, type ConsentPurpose, type NoticeConfig, type PublicWorkspace } from "./types";
import { normaliseEmail } from "./subject";

type R = Record<string, unknown>;
const failed = (what: string) => new Error(`privacy store: ${what} failed`);
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function supabaseIntakeStore(db: Db, warn: (m: string) => void = () => undefined): IntakeStore {
  const q = (t: string) => from(db, t);

  async function publicWorkspace(col: "slug" | "id", value: string): Promise<PublicWorkspace | null> {
    const w = await q("workspaces").select("id, slug, tenant_id, name, archived_at").eq(col, value).limit(1);
    if (w.error) throw failed("workspace read");
    const ws = ((w.data as R[] | null) ?? [])[0];
    if (!ws || ws.archived_at) return null;
    const tId = String(ws.tenant_id);
    const t = await q("tenants").select("id, name, brand_name, support_email, dpo_contact, privacy_response_days, data_region, status").eq("id", tId).limit(1);
    if (t.error) throw failed("tenant read");
    const tn = ((t.data as R[] | null) ?? [])[0];
    if (!tn || tn.status === "suspended") return null;
    const c = await q("tenant_config").select("config").eq("tenant_id", tId).limit(1);
    const cfg = ((c.data as R[] | null) ?? [])[0]?.config as R | undefined;
    const notice = (cfg && typeof cfg.privacy === "object" && cfg.privacy ? cfg.privacy : {}) as NoticeConfig;
    const dpo = tn.dpo_contact && typeof tn.dpo_contact === "object" ? (tn.dpo_contact as R) : null;
    return {
      wsUuid: String(ws.id), wsSlug: String(ws.slug), tenantUuid: tId,
      orgName: str(notice.orgName) ?? str(tn.brand_name) ?? str(tn.name) ?? "",
      supportEmail: str(tn.support_email), responseDays: Number(tn.privacy_response_days ?? 30), dataRegion: str(tn.data_region) ?? "ap-southeast-1",
      dpo: dpo ? { name: str(dpo.name) ?? undefined, email: str(dpo.email) ?? undefined, phone: str(dpo.phone) ?? undefined } : null,
      notice,
    };
  }

  return {
    workspaceBySlug: (slug) => (/^[a-z0-9-]{2,40}$/.test(slug) ? publicWorkspace("slug", slug) : Promise.resolve(null)),
    workspaceById: (id) => (/^[0-9a-f-]{36}$/i.test(id) ? publicWorkspace("id", id) : Promise.resolve(null)),

    async leadsByEmail(wsUuid, email) {
      const want = normaliseEmail(email);
      const r = await q("leads").select("id, email").eq("workspace_id", wsUuid).ilike("email", want.replace(/[\\%_]/g, "\\$&")).is("deleted_at", null).limit(50);
      if (r.error) throw failed("lead lookup");
      return ((r.data as R[] | null) ?? []).filter((x) => normaliseEmail(String(x.email ?? "")) === want).map((x) => String(x.id));
    },

    async findOpen(wsUuid, subjectRef, kind, leadId) {
      let b = q("privacy_requests").select("id, due_at").eq("workspace_id", wsUuid).eq("subject_ref", subjectRef).eq("kind", kind).in("status", ["received", "in_progress"]);
      b = leadId ? b.eq("lead_id", leadId) : b.is("lead_id", null);
      const r = await b.limit(1);
      if (r.error) throw failed("request lookup");
      const row = ((r.data as R[] | null) ?? [])[0];
      return row ? { id: String(row.id), dueAt: String(row.due_at) } : null;
    },

    async insertRequest(i) {
      // due_at is left to the DB trigger (received + the tenant's response days). A completed row gets completed_at from the same trigger.
      const notes = [i.autoNote, i.notes].filter(Boolean).join("\n").slice(0, 4000) || null;
      const r = await q("privacy_requests").insert({ workspace_id: i.wsUuid, subject_ref: i.subjectRef, lead_id: i.leadId, kind: i.kind, status: i.status, notes, due_at: null }).select("id, due_at");
      if (r.error) throw failed("request insert");
      const row = ((r.data as R[] | null) ?? [])[0];
      if (!row) throw failed("request insert");
      return { id: String(row.id), dueAt: String(row.due_at) };
    },

    async withdraw(i) {
      // Latest decision per (subject, purpose): a purpose already withdrawn is not logged twice, so replays add nothing.
      const prev = await consentRowsForSubject(db, i.wsUuid, i.subjectRef, "purpose, action, occurred_at", { ascending: false, limit: 200 });
      if (prev.error) throw failed("consent read");
      const latest = new Map<string, string>();
      for (const r of (prev.data as R[] | null) ?? []) if (!latest.has(String(r.purpose))) latest.set(String(r.purpose), String(r.action));
      const todo = i.purposes.filter((p) => latest.get(p) !== "withdrawn");
      const targets: (string | null)[] = i.leadIds.length ? i.leadIds : [null];
      const rows = todo.flatMap((p) => targets.map((leadId) => ({
        tenant_id: i.tenantUuid, workspace_id: i.wsUuid, lead_id: leadId, subject_ref: i.subjectRef, purpose: p, action: "withdrawn",
        notice_version: i.noticeVersion.slice(0, 40), captured_via: "request", note: "Withdrawn by the data principal after email verification",
      })));
      if (rows.length) { const ins = await q("consent_log").insert(rows); if (ins.error) throw failed("consent insert"); }
      const flags: R = {};
      for (const p of i.purposes as ConsentPurpose[]) { const f = LEAD_CONSENT_FLAG[p]; if (f) flags[f] = false; }
      if (i.leadIds.length && Object.keys(flags).length) {
        const u = await q("leads").update(flags).eq("workspace_id", i.wsUuid).in("id", i.leadIds);
        if (u.error) throw failed("lead flags");
      }
      if (i.purposes.includes("marketing_email")) {
        const s = await q("email_suppressions").insert({ tenant_id: i.tenantUuid, workspace_id: i.wsUuid, email: normaliseEmail(i.email), reason: "unsubscribe", source: "privacy_request", lead_id: i.leadIds[0] ?? null });
        if (s.error && s.error.code !== "23505") {
          if (MISSING_TABLE.has(String(s.error.code ?? ""))) warn("email_suppressions table is missing; the withdrawal is still held by consent_log");
          else throw failed("suppression insert");
        }
      }
      return { consentRows: rows.length };
    },
  };
}
