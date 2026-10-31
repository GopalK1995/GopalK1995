"use server";
// Audit CSV export (server actions). Rules: permission first (assertCan / assertPlatform), never inside a support session,
// PII masked unless the caller has pii.read, and the export is itself audited BEFORE any data is returned: if the audit
// row cannot be written the export is cancelled (fail closed). Demo sessions export nothing and never touch Supabase.
import { headers } from "next/headers";
import { requireActive } from "@/lib/auth/server";
import { assertCan } from "@/lib/authz/load";
import { runAction, failResult, okResult, type ActionResult } from "@/lib/actions/result";
import { dbForRequest } from "@/lib/db/client";
import { getLocale } from "@/i18n/server";
import { assertPlatform } from "@/app/admin/_lib/platform-session";
import { audit, actorFromPrincipal, platformActor } from "./record";
import { auditCsv, cleanFilters, maskAuditView, queryAuditAll } from "./query";
import { AuditError, type AuditFilters } from "./types";
import { makeT } from "./strings";

export interface AuditExportFile { filename: string; csv: string }

async function requestCtx() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || undefined;
  return { requestId: h.get("x-request-id") ?? h.get("x-vercel-id") ?? undefined, ip, userAgent: h.get("user-agent") ?? undefined };
}
const stamp = () => new Date().toISOString().slice(0, 10);

/** Org viewer export. Needs audit.read, is blocked in support sessions, masks PII without pii.read. */
export async function exportOrgAudit(input: AuditFilters): Promise<ActionResult<AuditExportFile>> {
  return runAction<AuditExportFile>(async () => {
    const t = makeT(await getLocale());
    const filters = cleanFilters(input ?? {});
    const p = await assertCan("audit.read");
    if (p.support) return failResult("denied", t("exportSupportBlocked"));
    const { session } = await requireActive();
    if (session.demo) return okResult(t("exportDemo"));
    const piiRead = !!p.grants["pii.read"] && p.grants["pii.read"].scope !== "none";
    const db = await dbForRequest();
    const { rows, truncated } = await queryAuditAll(db, { workspaceId: p.workspaceId }, filters);
    try {
      await audit(actorFromPrincipal(p, await requestCtx()), {
        action: "audit.exported", summary: `Exported ${rows.length} audit events as CSV`, object: { table: "audit_log" },
        detail: { filters, count: rows.length, truncated, piiMasked: !piiRead },
      });
    } catch (e) {
      if (e instanceof AuditError) return failResult("error", t("exportAuditFailed"));
      throw e;
    }
    const csv = auditCsv(rows.map((r) => maskAuditView(r, piiRead)));
    return okResult(truncated ? t("exportTruncated", { n: rows.length }) : t("exportDone", { n: rows.length }), { sub: t("exportDoneSub"), data: { filename: `audit-${stamp()}.csv`, csv } });
  });
}

/** Platform viewer export across tenants. Super admin only (platform.tenants.manage); PII always masked (no platform admin has pii.read). */
export async function exportPlatformAudit(input: AuditFilters): Promise<ActionResult<AuditExportFile>> {
  return runAction<AuditExportFile>(async () => {
    const t = makeT(await getLocale());
    const filters = cleanFilters(input ?? {});
    const ctx = await assertPlatform("platform.tenants.manage");
    if (ctx.session.demo) return okResult(t("exportDemo"));
    const db = await dbForRequest();
    const { rows, truncated } = await queryAuditAll(db, {}, filters);
    try {
      await audit(platformActor(ctx.session.uid, await requestCtx()), {
        action: "audit.exported", summary: `Exported ${rows.length} platform audit events as CSV`, object: { table: "audit_log" },
        detail: { filters, count: rows.length, truncated, scope: "platform" },
      });
    } catch (e) {
      if (e instanceof AuditError) return failResult("error", t("exportAuditFailed"));
      throw e;
    }
    const csv = auditCsv(rows.map((r) => maskAuditView(r, false)));
    return okResult(truncated ? t("exportTruncated", { n: rows.length }) : t("exportDone", { n: rows.length }), { sub: t("exportDoneSub"), data: { filename: `platform-audit-${stamp()}.csv`, csv } });
  });
}
