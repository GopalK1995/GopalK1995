import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, LifeBuoy } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/server";
import { SUPPORT_COOKIE, verifySupport } from "@/lib/auth/session";
import { getBackupAdapter } from "@/lib/data/backup";
import { USERS, WORKSPACES } from "@/lib/tenancy";
import { fmtDateTime, num, relTime } from "@/lib/format";
import { PageHeader, Meter } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Kpi } from "@/components/ui/kpi";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { HBar } from "@/components/charts/hbar";
import { ACTION_LABEL, ADMIN_NOW, adminNow, allTenants, auditRows, supportSessions, wsLabelById } from "../_components/data";
import { SessionState, TenantMark } from "../_components/bits";

export const metadata = { title: "Overview" };

export default async function AdminOverview({ searchParams }: { searchParams: Promise<{ support?: string }> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const live = await verifySupport((await cookies()).get(SUPPORT_COOKIE)?.value);
  const tenants = allTenants();
  const sessions = supportSessions(live);
  const audit = auditRows().slice(0, 6);
  const now = new Date(ADMIN_NOW).getTime();
  const active7 = USERS.filter((u) => !u.platformAdmin && u.status === "active" && now - new Date(u.lastSignIn).getTime() <= 7 * 86400e3).length;
  const members = USERS.filter((u) => !u.platformAdmin).length;
  const ws = tenants.flatMap((t) => t.workspaces);
  const attention = ws.reduce((a, w) => a + w.integrationsAttention, 0);
  const failed = ws.reduce((a, w) => a + w.failedSyncs24h, 0);
  const snap = await getBackupAdapter().getSnapshot();
  const dump = snap.checks.find((c) => c.kind === "logical_dump");
  const dumpMins = dump?.takenAt ? (new Date(snap.generatedAt).getTime() - new Date(dump.takenAt).getTime()) / 60e3 : NaN;
  const open = sessions.filter((s) => s.state === "active").length;
  const byStatus = (st: string) => tenants.filter((t) => t.tenant.status === st).length;

  return (
    <>
      <PageHeader eyebrow="Synthan platform" title="Overview" sub="Tenants, workspaces and health across the platform. Counts only: lead, contact and message records stay inside each workspace."
        actions={<Link href="/admin/support" className={buttonVariants({ variant: "primary" })}><LifeBuoy />Start support session</Link>} />
      {sp.support === "ended" && <p role="status" className="mb-4 rounded-sm border border-line bg-surface px-3 py-2 text-[13px] text-ink-2">Support session ended and logged. The workspace owner sees it in their audit tab.</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Tenants" value={tenants.length} foot={`${byStatus("active")} active · ${byStatus("trial")} trial · ${byStatus("suspended")} suspended`} />
        <Kpi label="Workspaces" value={WORKSPACES.length} foot={tenants.map((t) => `${t.tenant.name.replace(" (demo)", "").split(" ")[0]} ${t.workspaces.length}`).join(" · ")} />
        <Kpi label="Active users, 7 days" value={active7} foot={`of ${members} workspace members`} />
        <Kpi label="Open support sessions" value={open} foot={open ? "Amber banner showing in the workspace" : "None open"} />
        <Kpi label="Integrations needing attention" value={attention} metric="M56" foot={`${failed} failed sync run${failed === 1 ? "" : "s"} in 24 h`} />
        <Kpi label="Last logical backup" value={dumpMins} format="mins" metric="M24" foot={dump?.status === "success" ? "pg_dump ok · alert after 26 h" : "Check the backup job"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader title="Which workspaces are bringing in leads?" sub="New leads created in the last 30 days, per workspace. Aggregate count only." />
          <CardBody>
            <HBar label="New leads in the last 30 days by workspace" valueLabel="New leads" highlight="all" labelWidth={176}
              data={ws.map((w) => ({ label: wsLabelById(w.ws.id), value: w.leads30d, note: w.unavailable ? "Stats unavailable" : undefined }))} />
            <p className="mt-2 text-[12px] text-ink-3">Per tenant: {tenants.map((t) => `${t.tenant.name}: ${num(t.leads30d)}`).join(" · ")}</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Seats used vs plan" sub="Distinct people with a membership in any of the tenant's workspaces." />
          <CardBody className="space-y-4">
            {tenants.map((t) => {
              const ratio = t.seatsUsed / t.tenant.seats;
              return (
                <div key={t.tenant.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]">
                    <Link href={`/admin/tenants/${t.tenant.id}`} className="flex min-w-0 items-center gap-2 font-medium text-ink hover:underline"><TenantMark tenant={t.tenant} size={20} /><span className="truncate">{t.tenant.name}</span></Link>
                    <span className="shrink-0 num text-ink-2">{t.seatsUsed} of {t.tenant.seats} seats</span>
                  </div>
                  <Meter value={t.seatsUsed} max={t.tenant.seats} tone={ratio >= 0.9 ? "warn" : "accent"} />
                  <div className="mt-1 text-[11px] text-ink-3">{t.tenant.plan} plan · {t.tenant.seats - t.seatsUsed} free</div>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent support sessions" sub="Every session has a typed reason and is visible to the workspace owner." action={<Link href="/admin/support" className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">All sessions<ArrowRight className="size-3.5" aria-hidden /></Link>} />
          <ul className="divide-y divide-line border-t border-line">
            {sessions.slice(0, 4).map((s) => (
              <li key={s.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-mono text-[12px] text-ink-3">{s.id}</span>
                  <span className="font-medium text-ink">{wsLabelById(s.wsId)}</span>
                  <Badge tone="outline">{s.mode === "read_write" ? "read-write" : "read-only"}</Badge>
                  <SessionState state={s.state} />
                  <span className="ml-auto text-[12px] text-ink-3 num">{fmtDateTime(s.startedAt)}</span>
                </div>
                <p className="mt-1 truncate text-[12px] text-ink-2">{s.admin} · “{s.reason}”</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Recent platform audit events" action={<Link href="/admin/audit" className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">Audit log<ArrowRight className="size-3.5" aria-hidden /></Link>} />
          <ul className="divide-y divide-line border-t border-line">
            {audit.map((a) => (
              <li key={a.id} className={a.supportSessionId ? "border-l-2 border-l-warn px-4 py-2.5 sm:px-5" : "px-4 py-2.5 sm:px-5"}>
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 truncate font-medium text-ink">{ACTION_LABEL[a.action] ?? a.action}</span>
                  {a.supportSessionId && <Badge tone="warn">{a.supportSessionId}</Badge>}
                  <span className="ml-auto shrink-0 text-[12px] text-ink-3 num">{relTime(a.at, adminNow())}</span>
                </div>
                <p className="truncate text-[12px] text-ink-3">{a.actor} · {a.wsId ? wsLabelById(a.wsId) : "Platform"} · {a.target}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
