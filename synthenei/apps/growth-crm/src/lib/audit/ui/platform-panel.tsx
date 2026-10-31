// Platform audit viewer (/admin/audit) and the tenant Audit tab. Real sessions read across tenants through the platform
// admin's own RLS; demo sessions show today's demo platform audit rows and never touch Supabase. PII is always masked here:
// no platform role holds pii.read.
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { dbForRequest } from "@/lib/db/client";
import { getLocale } from "@/i18n/server";
import { platformCtx } from "@/app/admin/_lib/platform-session";
import { roleCan } from "@/app/admin/_lib/platform-authz";
import { ACTION_LABEL, auditRows, type AuditRow } from "@/app/admin/_components/data";
import { exportPlatformAudit } from "../actions";
import { filtersFromParams, maskAuditView, queryAudit } from "../query";
import { makeT } from "../strings";
import type { AuditView } from "../types";
import { AuditCard, AuditViewBody, type AuditScreen } from "./audit-view";
import { ExportButton } from "./export-button";
import type { OrgAuditSearch } from "./org-panel";

const fromDemo = (a: AuditRow): AuditView => ({
  id: a.id, at: a.at, actorId: null, actorLabel: a.actor, actorKind: a.actorKind === "member" ? "user" : a.actorKind, action: a.action,
  summary: `${ACTION_LABEL[a.action] ?? a.action}: ${a.target}`, objectTable: a.action.split(".")[0] ?? "", objectId: null, source: a.supportSessionId ? "support" : a.actorKind === "system" ? "job" : "ui",
  reason: null, requestId: null, ip: "", userAgent: "", supportSessionId: a.supportSessionId ?? null, tenantId: a.tenantId, workspaceId: a.wsId, changes: null, support: !!a.supportSessionId,
});

export async function PlatformAuditPanel({ sp }: { sp: OrgAuditSearch }) {
  const t = makeT(await getLocale());
  const { session, role } = await platformCtx();
  const filters = filtersFromParams(sp);
  const cursor = typeof sp.cursor === "string" ? sp.cursor : undefined;
  const canRead = roleCan(role, "platform.read"), canExport = roleCan(role, "platform.tenants.manage");

  let screen: AuditScreen;
  if (!canRead) screen = { kind: "denied", body: t("deniedPlatformBody") };
  else if (session.demo) {
    const q = typeof sp.q === "string" ? sp.q.toLowerCase() : "";
    const rows = auditRows().map(fromDemo).filter((r) =>
      (!filters.actor || r.actorLabel.toLowerCase().includes(filters.actor.toLowerCase())) && (!filters.action || r.action === filters.action) &&
      (!filters.source || r.source === filters.source) && (!filters.object || r.objectTable === filters.object.split(":")[0]) &&
      (!filters.from || r.at.slice(0, 10) >= filters.from) && (!filters.to || r.at.slice(0, 10) <= filters.to) &&
      (!filters.tenant || r.tenantId === filters.tenant) && (!filters.workspace || r.workspaceId === filters.workspace) &&
      (!q || `${r.summary} ${r.actorLabel} ${r.action}`.toLowerCase().includes(q)));
    screen = { kind: "ok", rows, nextCursor: null };
  } else {
    try {
      const page = await queryAudit(await dbForRequest(), {}, filters, cursor);
      screen = { kind: "ok", rows: page.rows.map((r) => maskAuditView(r, false)), nextCursor: page.nextCursor };
    } catch {
      screen = { kind: "error" };
    }
  }

  return (
    <>
      <PageHeader eyebrow="Synthan platform" title={t("title")} sub={t("subtitlePlatform")}
        actions={<ExportButton action={exportPlatformAudit} filters={filters} label={t("export")} workingLabel={t("exporting")} disabledReason={canExport ? undefined : t("exportDisabledPlatform")} />} />
      <AuditCard t={t} basePath="/admin/audit" filters={filters} platform>
        <AuditViewBody t={t} basePath="/admin/audit" filters={filters} screen={screen} platform piiMasked cursor={cursor} />
      </AuditCard>
    </>
  );
}

/** Tenant detail page, Audit tab, real sessions: the newest events across the tenant's workspaces. */
export async function TenantAuditPanel({ tenantSlug, workspaceIds }: { tenantSlug: string; workspaceIds: string[] }) {
  const t = makeT(await getLocale());
  const head = <CardHeader title={t("tenantTabTitle")} sub={t("tenantTabSub")} action={<Link href={`/admin/audit${workspaceIds[0] ? `?workspace=${workspaceIds[0]}` : ""}`} className="text-12 font-medium text-accent hover:underline">{t("openInLog")}</Link>} />;
  if (!workspaceIds.length) return <Card>{head}<CardBody><EmptyState title={t("empty")} body={t("emptyBody")} /></CardBody></Card>;
  try {
    const page = await queryAudit(await dbForRequest(), { workspaceIds }, {}, undefined, 25);
    const rows = page.rows.map((r) => maskAuditView(r, false));
    return (
      <Card>{head}
        <AuditViewBody t={t} basePath={`/admin/tenants/${tenantSlug}`} filters={{}} screen={{ kind: "ok", rows, nextCursor: null }} platform piiMasked />
      </Card>
    );
  } catch {
    return <Card>{head}<CardBody><ErrorState source={t("errorSource")} message={t("errorMessage")} /></CardBody></Card>;
  }
}
