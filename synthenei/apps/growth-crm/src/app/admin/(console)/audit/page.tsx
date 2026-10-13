import { ShieldAlert } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/server";
import { TENANTS, WORKSPACES } from "@/lib/tenancy";
import { fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ACTION_LABEL, auditRows, wsLabelById, type AuditRow } from "../../_components/data";
import { ActionButton } from "../../_components/action-dialog";
import { exportAudit } from "../../_components/actions";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ tenant?: string; ws?: string; actor?: string; action?: string; session?: string; q?: string }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const all = auditRows();
  const rows = all.filter((a) =>
    (!sp.tenant || a.tenantId === sp.tenant) && (!sp.ws || a.wsId === sp.ws) && (!sp.actor || a.actor === sp.actor) && (!sp.action || a.action === sp.action) &&
    (!sp.session || (sp.session === "any" ? !!a.supportSessionId : a.supportSessionId === sp.session)) &&
    (!sp.q || `${a.target} ${a.actor} ${a.action}`.toLowerCase().includes(sp.q.toLowerCase())));
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  const sessions = uniq(all.map((a) => a.supportSessionId ?? "").filter(Boolean));

  const cols: Column<AuditRow>[] = [
    { key: "at", header: "When (IST)", mobile: "fact", cell: (a) => <span className="num text-ink-2">{fmtDateTime(a.at)}</span> },
    { key: "action", header: "Action", mobile: "title", cell: (a) => (
      <span className="inline-flex items-center gap-2">
        {a.supportSessionId && <ShieldAlert className="size-3.5 text-warn-ink" aria-label="Written during a support session" />}
        <span className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</span>
        <span className="hidden font-mono text-[11px] text-ink-3 lg:inline">{a.action}</span>
      </span>
    ) },
    { key: "actor", header: "Actor", mobile: "fact", cell: (a) => <span>{a.actor}{a.actorKind === "platform_admin" && <span className="ml-1.5 text-[11px] text-ink-3">Synthan</span>}</span> },
    { key: "where", header: "Tenant · workspace", cell: (a) => <span className="text-ink-2">{a.wsId ? wsLabelById(a.wsId) : "Platform"}</span> },
    { key: "target", header: "Target (PII masked)", className: "max-w-[320px] truncate", cell: (a) => <span className="text-ink-2" title={a.target}>{a.target}</span> },
    { key: "session", header: "Support session", cell: (a) => (a.supportSessionId ? <Badge tone="warn">{a.supportSessionId}</Badge> : <span className="text-ink-3">—</span>) },
  ];

  return (
    <>
      <PageHeader eyebrow="Synthan platform" title="Audit log" sub="Append-only. Personal fields are stored as masked placeholders. Rows written during a support session carry its id and are highlighted."
        actions={<ActionButton action={exportAudit} data={{}} size="md">Export CSV</ActionButton>} />
      <div className="mb-3">
        <FilterBar search="Search target or action" filters={[
          { key: "tenant", label: "Tenant", options: TENANTS.map((t) => ({ value: t.id, label: t.name })) },
          { key: "ws", label: "Workspace", options: WORKSPACES.map((w) => ({ value: w.id, label: wsLabelById(w.id) })) },
          { key: "actor", label: "Actor", options: uniq(all.map((a) => a.actor)).map((x) => ({ value: x, label: x })) },
          { key: "action", label: "Action", options: uniq(all.map((a) => a.action)).map((x) => ({ value: x, label: ACTION_LABEL[x] ?? x })) },
          { key: "session", label: "Support session", options: [{ value: "any", label: "Any support session" }, ...sessions.map((x) => ({ value: x, label: x }))] },
        ]} />
      </div>
      <Card>
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[12px] text-ink-3 sm:px-5">
          <span className="num">{rows.length} of {all.length} events</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-[2px] bg-warn-soft ring-1 ring-warn/40" aria-hidden />Support-session activity</span>
        </div>
        <DataTable rows={rows} columns={cols} rowKey={(a) => a.id} minWidth={1000} caption="Platform audit log" empty="No events match these filters."
          rowClassName={(a) => (a.supportSessionId ? "bg-warn-soft/60 hover:bg-warn-soft" : "")} />
      </Card>
    </>
  );
}
