// Real-database versions of the Overview and Users screens (demo sessions keep the demo read model in their own pages).
// Counts and metadata only. Every state is drawn: error (failing source named), partial, empty, permission-denied.
import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { relTime } from "@/lib/format";
import { PageHeader, Meter } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Kpi } from "@/components/ui/kpi";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Denied } from "./denied";
import { TenantMark } from "./bits";
import { adminNow } from "./data";
import { roleCan, type PlatformRole } from "../_lib/platform-authz";
import { at } from "../_lib/strings";
import { realDb, loadTenantSummaries } from "../_lib/view";
import * as repo from "../_lib/repo";

export async function RealOverview({ role }: { role: PlatformRole }) {
  if (!roleCan(role, "platform.read")) {
    return (
      <>
        <PageHeader eyebrow="Synthan platform" title="Overview" />
        <Denied title={at("policyLockedTitle")}>{role === "billing" ? at("billingOnly") : at("denied")}</Denied>
      </>
    );
  }
  const loaded = await loadTenantSummaries(false);
  const db = await realDb();
  let sessions: repo.SupportSessionRow[] | null = null, sessErr: string | null = null;
  if (db) { try { sessions = await repo.listSupportSessions(db, 50); } catch (e) { sessErr = e instanceof Error ? e.message : "unknown error"; } }
  const header = (
    <PageHeader eyebrow="Synthan platform" title="Overview" sub="Tenants and workspaces across the platform. Counts only: lead, contact and message records stay inside each workspace."
      actions={roleCan(role, "platform.support") ? <Link href="/admin/support" className={buttonVariants({ variant: "primary" })}><LifeBuoy />Start support session</Link> : undefined} />
  );
  if (!loaded.ok) return <>{header}<ErrorState source="tenants" message={loaded.error} /></>;
  const tenants = loaded.data;
  if (!tenants.length) return <>{header}<EmptyState title={at("emptyTenants")} body="Create the first tenant from the Tenants page." action={<Link href="/admin/tenants" className={buttonVariants({ variant: "secondary" })}>Go to tenants</Link>} /></>;
  const ws = tenants.flatMap((t) => t.workspaces);
  const by = (st: string) => tenants.filter((t) => t.tenant.status === st).length;
  const open = sessions?.filter((s) => s.state === "active").length ?? 0;
  const attention = ws.reduce((a, w) => a + w.integrationsAttention, 0), failed = ws.reduce((a, w) => a + w.failedSyncs24h, 0);
  const max = Math.max(1, ...ws.map((w) => w.leads30d));
  const sCols: Column<repo.SupportSessionRow>[] = [
    { key: "id", header: "Session", cell: (s) => <span className="font-mono text-[12px] text-ink-2">{s.id.slice(0, 8)}</span> },
    { key: "mode", header: "Mode", cell: (s) => <Badge tone="outline">{s.mode === "read_write" ? "read-write" : "read-only"}</Badge> },
    { key: "state", header: "State", cell: (s) => (s.state === "active" ? <Badge tone="warn">Open</Badge> : s.state === "ended" ? <Badge tone="neutral">Ended</Badge> : <Badge tone="outline">Expired</Badge>) },
    { key: "reason", header: "Reason", className: "max-w-[320px] truncate", cell: (s) => <span className="text-ink-2" title={s.reason}>{s.reason}</span> },
    { key: "at", header: "Started", align: "right", cell: (s) => <span className="num text-ink-2">{relTime(s.startedAt, adminNow())}</span> },
  ];
  return (
    <>
      {header}
      {loaded.partial && <p role="status" className="mb-3 rounded-sm border border-warn/40 bg-warn-soft px-3 py-2 text-[12px] text-warn-ink">{loaded.partial}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Tenants" value={tenants.length} foot={`${by("active")} active · ${by("suspended")} suspended`} />
        <Kpi label="Workspaces" value={ws.length} foot={tenants.map((t) => `${t.tenant.name.split(" ")[0]} ${t.workspaces.length}`).join(" · ")} />
        <Kpi label="Open support sessions" value={open} foot={sessErr ? "Could not read sessions" : open ? "Amber banner showing in the workspace" : "None open"} />
        <Kpi label="Integrations needing attention" value={attention} foot={`${failed} failed sync run${failed === 1 ? "" : "s"} in 24 h`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader title="Which workspaces are bringing in leads?" sub="New leads created in the last 30 days, per workspace. Aggregate count only." />
          <CardBody>
            {ws.length ? (
              <ul aria-label="New leads in the last 30 days by workspace" className="space-y-3">
                {ws.map((w) => (
                  <li key={w.ws.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[176px_minmax(0,1fr)_48px]">
                    <span className="truncate text-[12px] text-ink-2">{w.ws.tenantId} · {w.ws.name}</span>
                    <span className="order-3 col-span-2 h-[18px] rounded-r-[4px] bg-paper-2 sm:order-none sm:col-span-1" aria-hidden><span className="block h-full rounded-r-[4px] bg-chart-1" style={{ width: `${(w.leads30d / max) * 100}%` }} /></span>
                    <span className="text-right text-[12px] font-semibold text-ink-2 num">{w.leads30d}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-ink-3">No workspace counts available.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Seats used vs policy cap" sub="Workspace memberships per tenant against max_seats in the org-admin policy." />
          <CardBody className="space-y-4">
            {tenants.map((t) => (
              <div key={t.tenant.id}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]">
                  <Link href={`/admin/tenants/${t.tenant.id}`} className="flex min-w-0 items-center gap-2 font-medium text-ink hover:underline"><TenantMark tenant={t.tenant} size={20} /><span className="truncate">{t.tenant.name}</span></Link>
                  <span className="shrink-0 num text-ink-2">{t.seatsUsed} seats</span>
                </div>
                <Meter value={t.seatsUsed} max={Math.max(t.seatsUsed, 1)} tone="accent" />
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Recent support sessions" sub="Every session has a typed reason and is visible to the workspace owner." action={<Link href="/admin/support" className="text-[12px] font-medium text-accent hover:underline">All sessions</Link>} />
        {sessErr ? <CardBody><ErrorState source="support sessions" message={sessErr} /></CardBody>
          : <DataTable rows={(sessions ?? []).slice(0, 5)} columns={sCols} rowKey={(s) => s.id} minWidth={640} caption="Recent support sessions" empty={at("emptySessions")} />}
      </Card>
    </>
  );
}

export async function RealUsers({ role }: { role: PlatformRole }) {
  const head = <PageHeader eyebrow="Synthan platform" title="Users" sub="Platform admins and workspace members are separate identities. Workspace members are managed by each organisation's own Owner." />;
  if (!roleCan(role, "platform.read")) return <>{head}<Denied title={at("policyLockedTitle")}>{role === "billing" ? at("billingOnly") : at("denied")}</Denied></>;
  const db = await realDb();
  if (!db) return <>{head}<ErrorState source="platform admins" message={at("notConfigured")} /></>;
  let rows: repo.PlatformAdminDbRow[];
  try { rows = await repo.listPlatformAdmins(db); } catch (e) { return <>{head}<ErrorState source="platform admins" message={e instanceof Error ? e.message : "unknown error"} /></>; }
  const cols: Column<repo.PlatformAdminDbRow>[] = [
    { key: "id", header: "User id", mobile: "title", cell: (a) => <span className="font-mono text-[12px]">{a.userId}</span> },
    { key: "role", header: "Platform role", mobile: "fact", cell: (a) => <Badge tone="navy">{a.role}</Badge> },
    { key: "status", header: "Status", mobile: "fact", cell: (a) => (a.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Revoked</Badge>) },
    { key: "added", header: "Added", cell: (a) => <span className="num text-ink-2">{a.createdAt ? relTime(a.createdAt, adminNow()) : "—"}</span> },
  ];
  return (
    <>
      {head}
      <Card>
        <CardHeader title={`Platform admins (${rows.length})`} sub="Rows in platform_admins. Granting and revoking is SQL-only by design." />
        <DataTable rows={rows} columns={cols} rowKey={(a) => a.userId} minWidth={640} caption="Platform admins" empty="No platform admins found." />
      </Card>
      <p className="mt-3 text-[12px] text-ink-3">Workspace users are not listed here. Open a read-only support session to see a workspace&apos;s members.</p>
    </>
  );
}
