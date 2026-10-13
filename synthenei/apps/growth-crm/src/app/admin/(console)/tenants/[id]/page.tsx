import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, LifeBuoy, Plus, UserPlus } from "lucide-react";
import { requirePlatformAdmin } from "@/lib/auth/server";
import { MEMBERSHIPS, TENANTS, USERS } from "@/lib/tenancy";
import { fmtDateTime, fmtDateY, num, relTime } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dl, Meter } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ACTION_LABEL, USAGE, adminNow, auditRows, tenantSummary, type AuditRow, type WorkspaceStats } from "../../../_components/data";
import { RoleChip, TenantMark, TenantStatus, UserStatus } from "../../../_components/bits";
import { ActionDialog } from "../../../_components/action-dialog";
import { createWorkspace, inviteOwner, setTenantStatus } from "../../../_components/actions";
import { BrandingEditor } from "../../../_components/branding-editor";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = TENANTS.find((x) => x.id === id);
  return { title: t ? t.name : "Tenant" };
}

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  const tenant = TENANTS.find((t) => t.id === id);
  if (!tenant) notFound();
  const sum = tenantSummary(tenant);
  const now = adminNow();
  const wsIds = sum.workspaces.map((w) => w.ws.id);
  const people = USERS.filter((u) => MEMBERSHIPS.some((m) => m.userId === u.id && wsIds.includes(m.workspaceId)));
  const audit = auditRows().filter((a) => a.tenantId === tenant.id);
  const usage = USAGE[tenant.id] ?? { aiCalls: 0, aiCap: 0, storageMb: 0, storageCapMb: 1 };
  const suspended = tenant.status === "suspended";

  const wsCols: Column<WorkspaceStats>[] = [
    { key: "name", header: "Workspace", mobile: "title", cell: (w) => <span className="font-medium">{w.ws.name}</span> },
    { key: "id", header: "ID", cell: (w) => <span className="font-mono text-[12px] text-ink-2">{w.ws.id}</span> },
    { key: "region", header: "Region", cell: (w) => <span className="block max-w-[280px] truncate text-ink-2" title={w.ws.region}>{w.ws.region}</span> },
    { key: "members", header: "Members", align: "right", mobile: "fact", cell: (w) => `${w.members} members` },
    { key: "leads", header: "Leads (total)", align: "right", mobile: "fact", cell: (w) => (w.unavailable ? <span className="text-ink-3">Stats unavailable</span> : `${num(w.leadsTotal)} leads`) },
    { key: "attn", header: "Integrations", align: "right", cell: (w) => w.integrationsAttention ? <Badge tone="warn">{w.integrationsAttention} need attention</Badge> : <span className="text-ink-3">OK</span> },
    { key: "created", header: "Created", cell: (w) => <span className="num text-ink-2">{fmtDateY(w.ws.createdAt)}</span> },
    { key: "support", header: <span className="sr-only">Support</span>, align: "right", mobile: "action", cell: (w) => <Link href={`/admin/support?ws=${w.ws.id}`} className="text-[12px] font-medium text-accent hover:underline">Support session</Link> },
  ];
  const auditCols: Column<AuditRow>[] = [
    { key: "at", header: "When", mobile: "fact", cell: (a) => <span className="num text-ink-2">{fmtDateTime(a.at)}</span> },
    { key: "action", header: "Action", mobile: "title", cell: (a) => <span className="inline-flex items-center gap-2">{ACTION_LABEL[a.action] ?? a.action}{a.supportSessionId && <Badge tone="warn">{a.supportSessionId}</Badge>}</span> },
    { key: "actor", header: "Actor", mobile: "fact", cell: (a) => a.actor },
    { key: "target", header: "Target (masked)", cell: (a) => <span className="text-ink-2">{a.target}</span> },
  ];

  return (
    <>
      <Link href="/admin/tenants" className="mb-3 inline-flex items-center gap-1 text-[12px] font-medium text-ink-3 hover:text-ink"><ChevronLeft className="size-3.5" aria-hidden />Tenants</Link>
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <TenantMark tenant={tenant} size={44} />
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-semibold leading-7 tracking-[-0.02em] sm:text-[24px]">{tenant.name}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
              <span className="font-mono text-[12px] text-ink-3">{tenant.id}</span><TenantStatus status={tenant.status} />
              <span>{tenant.plan} plan · {sum.seatsUsed} of {tenant.seats} seats · {sum.workspaces.length} workspace{sum.workspaces.length > 1 ? "s" : ""}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionDialog trigger="Invite owner" icon={<UserPlus />} title={`Invite an Owner to ${tenant.name}`} submit="Send invitation" action={inviteOwner}
            description="The invitation carries the workspace; the person gets the Owner role there only."
            fields={[
              { name: "ws", label: "Workspace", type: "select", options: sum.workspaces.map((w) => ({ value: w.ws.id, label: w.ws.name })), defaultValue: sum.workspaces[0]?.ws.id },
              { name: "email", label: "Email", type: "email", placeholder: `owner@${tenant.supportEmail.split("@")[1]}` },
            ]} />
          <ActionDialog trigger="Add workspace" icon={<Plus />} title={`Add a workspace to ${tenant.name}`} submit="Create workspace" action={createWorkspace}
            description="A workspace is an isolated data area with its own members, pipeline and SLA. Branding stays tenant-wide."
            fields={[
              { name: "tenant", label: "", type: "hidden", defaultValue: tenant.id },
              { name: "name", label: "Workspace name", placeholder: "Karnataka pilot" },
              { name: "region", label: "Region label", placeholder: "Bengaluru · Mysuru" },
            ]} />
          <ActionDialog trigger={suspended ? "Reactivate tenant" : "Suspend tenant"} danger={!suspended} triggerVariant={suspended ? "secondary" : "danger"}
            title={suspended ? `Reactivate ${tenant.name}` : `Suspend ${tenant.name}`} submit={suspended ? "Reactivate" : "Suspend tenant"} action={setTenantStatus}
            description={suspended ? "Members can sign in again." : `${sum.seatsUsed} members across ${sum.workspaces.length} workspace${sum.workspaces.length > 1 ? "s" : ""} will be signed out and blocked. No data is deleted.`}
            fields={[
              { name: "tenant", label: "", type: "hidden", defaultValue: tenant.id },
              { name: "to", label: "", type: "hidden", defaultValue: suspended ? "active" : "suspended" },
              { name: "confirm", label: `Type ${tenant.id} to confirm`, mono: true, placeholder: tenant.id },
            ]} />
        </div>
      </div>

      <Tabs tabs={[
        { value: "branding", label: "Branding", content: (
          <Card><CardHeader title="Branding" sub="Tenant-wide: every workspace of this tenant uses these tokens." /><CardBody>
            <BrandingEditor tenantId={tenant.id} initial={{ name: tenant.name.replace(" (demo)", ""), product: tenant.product, hue: tenant.hue, monogram: tenant.monogram }} />
          </CardBody></Card>
        ) },
        { value: "workspaces", label: `Workspaces (${sum.workspaces.length})`, content: (
          <Card><CardHeader title="Workspaces" sub="Counts only. Open a support session to see records inside a workspace." />
            <DataTable rows={sum.workspaces} columns={wsCols} rowKey={(w) => w.ws.id} minWidth={900} caption="Workspaces" />
          </Card>
        ) },
        { value: "members", label: `Members (${people.length})`, content: (
          <Card><CardHeader title="Members across workspaces" sub="Roles are per workspace and are changed by that workspace's Owner, not here." />
            <ul className="divide-y divide-line border-t border-line">
              {people.map((u) => (
                <li key={u.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                  <div className="min-w-0 sm:w-64">
                    <div className="flex items-center gap-2 text-[13px] font-medium">{u.name}{u.id === tenant.primaryOwnerId && <Badge tone="navy">Primary owner</Badge>}</div>
                    <div className="text-[12px] text-ink-3">{u.email.replace(/^(.).*(@.*)$/, "$1•••$2")} · {u.status === "invited" ? "not signed in yet" : `signed in ${relTime(u.lastSignIn, now)}`}</div>
                  </div>
                  <div className="flex flex-1 flex-wrap gap-1.5">
                    {MEMBERSHIPS.filter((m) => m.userId === u.id && wsIds.includes(m.workspaceId)).map((m) => <RoleChip key={m.workspaceId} ws={sum.workspaces.find((w) => w.ws.id === m.workspaceId)!.ws.name} role={m.role} />)}
                  </div>
                  <UserStatus status={u.status} />
                </li>
              ))}
            </ul>
          </Card>
        ) },
        { value: "usage", label: "Usage", content: (
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { k: "Seats", v: sum.seatsUsed, max: tenant.seats, fmt: `${sum.seatsUsed} of ${tenant.seats}`, note: `${tenant.plan} plan` },
              { k: "AI calls this month", v: usage.aiCalls, max: usage.aiCap, fmt: `${num(usage.aiCalls)} of ${num(usage.aiCap)}`, note: usage.aiCalls === 0 ? "AI features are off for this tenant" : "Cap resets on the 1st" },
              { k: "Storage", v: usage.storageMb, max: usage.storageCapMb, fmt: `${num(usage.storageMb)} MB of ${num(usage.storageCapMb / 1024)} GB`, note: "Logos and CSV uploads" },
            ].map((x) => (
              <Card key={x.k}><CardBody className="pt-4 sm:pt-5">
                <div className="text-[12px] font-medium text-ink-2">{x.k}</div>
                <div className="mt-1 text-[20px] font-semibold num">{x.fmt}</div>
                <Meter className="mt-3" value={x.v} max={x.max || 1} tone={x.v / (x.max || 1) >= 0.9 ? "warn" : "accent"} />
                <div className="mt-2 text-[12px] text-ink-3">{x.note}</div>
              </CardBody></Card>
            ))}
            <Card className="md:col-span-3"><CardBody className="pt-4 sm:pt-5">
              <Dl items={[["Primary owner", sum.owner], ["Support email", tenant.supportEmail], ["Created", fmtDateY(tenant.createdAt)], ["New leads, 30 days", `${num(sum.leads30d)} (count only)`]]} />
            </CardBody></Card>
          </div>
        ) },
        { value: "audit", label: "Audit", content: (
          <Card><CardHeader title="Tenant audit events" sub="Rows written inside a support session carry its id." action={<Link href={`/admin/audit?tenant=${tenant.id}`} className="text-[12px] font-medium text-accent hover:underline">Open in audit log</Link>} />
            <DataTable rows={audit} columns={auditCols} rowKey={(a) => a.id} minWidth={760} caption="Tenant audit events" rowClassName={(a) => (a.supportSessionId ? "bg-warn-soft/50" : "")} />
          </Card>
        ) },
      ]} />
      <div className="mt-4">
        <Link href={`/admin/support?ws=${sum.workspaces[0]?.ws.id ?? ""}`} className={buttonVariants({ variant: "ghost", size: "sm" })}><LifeBuoy />Open a support session for this tenant</Link>
      </div>
    </>
  );
}
