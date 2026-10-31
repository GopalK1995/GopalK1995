// Org audit viewer (server component). Real sessions read audit_log through the request-scoped client (RLS applies);
// demo sessions show today's demo audit data and never touch Supabase.
import { requireActive } from "@/lib/auth/server";
import { decide } from "@/lib/authz/engine";
import { loadPrincipal } from "@/lib/authz/load";
import { dbForRequest } from "@/lib/db/client";
import { getDataSource } from "@/lib/data/source";
import { userById } from "@/lib/tenancy";
import { supportEvents } from "@/lib/support-log";
import { getLocale } from "@/i18n/server";
import { PageHeader } from "@/components/ui/misc";
import { maskAuditView, filtersFromParams, queryAudit } from "../query";
import { makeT } from "../strings";
import type { AuditView } from "../types";
import { exportOrgAudit } from "../actions";
import { AuditCard, AuditViewBody, type AuditScreen } from "./audit-view";
import { ExportButton } from "./export-button";

export type OrgAuditSearch = Record<string, string | string[] | undefined>;

async function demoRows(wsId: string): Promise<AuditView[]> {
  const { active } = await requireActive();
  const ds = getDataSource(active.ws, { demo: true });
  const entries = await ds.audit();
  const rows: AuditView[] = entries.map((e) => ({
    id: e.id, at: e.at, actorId: e.actorId, actorLabel: userById(e.actorId)?.name ?? e.actorId, actorKind: "user", action: e.action.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "event",
    summary: e.action, objectTable: e.target, objectId: null, source: "ui", reason: null, requestId: null, ip: e.ip, userAgent: "", supportSessionId: null, tenantId: null, workspaceId: wsId, changes: null, support: false,
  }));
  for (const e of supportEvents(wsId)) {
    rows.push({
      id: e.id, at: e.at, actorId: null, actorLabel: `${e.admin} (Synthan)`, actorKind: "support", action: e.action === "support_started" ? "support.started" : "support.ended",
      summary: e.action === "support_started" ? `Support session started, ${e.mode === "read_write" ? "read-write" : "read-only"}${e.minutes ? `, ${e.minutes} min` : ""}` : "Support session ended",
      objectTable: "support_sessions", objectId: e.id, source: "support", reason: e.reason ?? null, requestId: null, ip: "platform", userAgent: "", supportSessionId: e.id, tenantId: null, workspaceId: wsId, changes: null, support: true,
    });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

export async function OrgAuditPanel({ sp, basePath = "/settings/audit", withHeader = true, fixed }: { sp: OrgAuditSearch; basePath?: string; withHeader?: boolean; fixed?: Record<string, string> }) {
  const t = makeT(await getLocale());
  const { session, active } = await requireActive();
  const filters = filtersFromParams(sp);
  const cursor = typeof sp.cursor === "string" ? sp.cursor : undefined;
  const p = await loadPrincipal();
  const canRead = decide(p, "audit.read").allow;
  const piiRead = !!p.grants["pii.read"] && p.grants["pii.read"].scope !== "none";
  const inSupport = p.support != null;

  let screen: AuditScreen;
  if (!canRead) screen = { kind: "denied", body: t("deniedBody") };
  else if (session.demo) {
    const all = await demoRows(active.ws.id);
    const rows = all
      .filter((r) => (!filters.actor || r.actorLabel.toLowerCase().includes(filters.actor.toLowerCase())) && (!filters.action || r.action === filters.action) &&
        (!filters.source || r.source === filters.source) && (!filters.object || r.objectTable.startsWith(filters.object)) &&
        (!filters.from || r.at.slice(0, 10) >= filters.from) && (!filters.to || r.at.slice(0, 10) <= filters.to))
      .map((r) => maskAuditView(r, piiRead));
    screen = { kind: "ok", rows, nextCursor: null };
  } else {
    try {
      const page = await queryAudit(await dbForRequest(), { workspaceId: p.workspaceId }, filters, cursor);
      screen = { kind: "ok", rows: page.rows.map((r) => maskAuditView(r, piiRead)), nextCursor: page.nextCursor };
    } catch {
      screen = { kind: "error" };
    }
  }

  const exportReason = !canRead ? t("exportDisabledPermission") : inSupport ? t("exportDisabledSupport") : undefined;
  return (
    <>
      {withHeader && (
        <PageHeader eyebrow={`${active.tenant.name} · ${active.ws.name}`} title={t("title")} sub={t("subtitleOrg", { workspace: active.ws.name })}
          actions={<ExportButton action={exportOrgAudit} filters={filters} label={t("export")} workingLabel={t("exporting")} disabledReason={exportReason} />} />
      )}
      {!withHeader && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <p className="max-w-2xl text-13 text-ink-2">{t("subtitleOrg", { workspace: active.ws.name })}</p>
          <ExportButton action={exportOrgAudit} filters={filters} label={t("export")} workingLabel={t("exporting")} disabledReason={exportReason} />
        </div>
      )}
      <AuditCard t={t} basePath={basePath} filters={filters} fixed={fixed}>
        <AuditViewBody t={t} basePath={basePath} filters={filters} screen={screen} piiMasked={!piiRead} cursor={cursor} fixed={fixed} />
      </AuditCard>
    </>
  );
}
