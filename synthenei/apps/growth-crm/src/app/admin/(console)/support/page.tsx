import { cookies } from "next/headers";
import { Ban, ShieldAlert } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/server";
import { SUPPORT_COOKIE, verifySupport } from "@/lib/auth/session";
import { endSupport } from "@/lib/auth/actions";
import { TENANTS, WORKSPACES } from "@/lib/tenancy";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { NEVER_LIST, supportSessions, wsLabelById, type SupportRow } from "../../_components/data";
import { SessionState } from "../../_components/bits";
import { SupportForm } from "../../_components/support-form";

export const metadata = { title: "Support sessions" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ ws?: string; error?: string }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const live = await verifySupport((await cookies()).get(SUPPORT_COOKIE)?.value);
  const rows = supportSessions(live);
  const options = TENANTS.map((t) => ({ tenantId: t.id, tenantName: t.name, workspaces: WORKSPACES.filter((w) => w.tenantId === t.id).map((w) => ({ id: w.id, name: w.name })) }));
  const cols: Column<SupportRow>[] = [
    { key: "id", header: "Session", cell: (s) => <span className="font-mono text-[12px] text-ink-2">{s.id}</span> },
    { key: "ws", header: "Workspace", mobile: "title", cell: (s) => <span className="font-medium">{wsLabelById(s.wsId)}</span> },
    { key: "admin", header: "Admin", cell: (s) => s.admin },
    { key: "mode", header: "Mode", mobile: "fact", cell: (s) => <Badge tone={s.mode === "read_write" ? "warn" : "outline"}>{s.mode === "read_write" ? "read-write" : "read-only"}</Badge> },
    { key: "reason", header: "Reason", className: "max-w-[340px] truncate", cell: (s) => <span className="text-ink-2" title={s.reason}>{s.reason}</span> },
    { key: "started", header: "Started", mobile: "fact", cell: (s) => <span className="num text-ink-2">{fmtDateTime(s.startedAt)}</span> },
    { key: "ended", header: "Ended", cell: (s) => <span className="num text-ink-2">{s.endedAt ? fmtTime(s.endedAt) : "—"}</span> },
    { key: "actions", header: "Actions logged", align: "right", cell: (s) => s.actions },
    { key: "state", header: "State", align: "right", mobile: "action", cell: (s) => <SessionState state={s.state} /> },
  ];
  return (
    <>
      <PageHeader eyebrow="Synthan platform" title="Support sessions" sub="Audited, time-boxed access to one workspace. Without an open session the console shows counts only, never records." />

      {live && (
        <section aria-label="Open support session" className="mb-4 flex flex-col gap-3 rounded-md border border-warn/40 bg-warn-soft p-4 text-warn-ink sm:flex-row sm:items-center">
          <ShieldAlert className="size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="font-semibold">Open: {wsLabelById(live.ws)} · {live.mode === "read_only" ? "read-only" : "read-write"} · ends {fmtTime(new Date(live.endsAt).toISOString())} IST</div>
            <div className="truncate">Reason: “{live.reason}”</div>
          </div>
          <div className="flex gap-2">
            <a href="/" className="inline-flex h-9 items-center rounded-sm border border-warn/50 bg-surface px-3 text-[13px] font-medium hover:bg-paper">Open workspace</a>
            <form action={endSupport}><Button variant="secondary">End now</Button></form>
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Start a support session" sub="Opens the workspace in this tab with the amber support banner." />
          <CardBody><SupportForm options={options} initialWs={sp.ws} error={sp.error} blocked={live ? `End the open session on ${wsLabelById(live.ws)} before starting another.` : undefined} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Never allowed in a support session" sub="Blocked in read-only and read-write. The database enforces this with has_member_role(), which ignores support sessions." />
          <CardBody>
            <ul className="space-y-2">
              {NEVER_LIST.map((x) => <li key={x} className="flex items-start gap-2 text-[13px] text-ink"><Ban className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />{x}</li>)}
            </ul>
            <p className="mt-4 border-t border-line pt-3 text-[12px] text-ink-3">Read-only acts as Viewer (masked personal data). Read-write acts as Owner for everything else. Every write is stamped with the session id in the audit log.</p>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Session history" sub="Visible to the workspace owner in Settings → Audit." />
        <DataTable rows={rows} columns={cols} rowKey={(s) => s.id} minWidth={1040} caption="Support session history" empty="No support sessions yet." />
      </Card>
    </>
  );
}
