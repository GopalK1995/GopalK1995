import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, LifeBuoy, Plus, UserPlus } from "lucide-react";
import { MEMBERSHIPS, TENANTS, USERS } from "@/lib/tenancy";
import { fmtDateTime, fmtDateY, num, relTime } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dl, Meter } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { ACTION_LABEL, USAGE, adminNow, auditRows, type AuditRow, type WorkspaceStats } from "../../../_components/data";
import { RoleChip, TenantMark, TenantStatus, UserStatus } from "../../../_components/bits";
import { ActionDialog } from "../../../_components/action-dialog";
import { createWorkspace, inviteOwner, saveOrgAdminPolicy, setTenantStatus } from "../../../_components/actions";
import { BrandingEditor } from "../../../_components/branding-editor";
import { Denied } from "../../../_components/denied";
import { PolicyEditor } from "../../../_components/policy-editor";
import { MODULE_CHOICES } from "../../../_lib/policy";
import { roleCan } from "../../../_lib/platform-authz";
import { platformCtx } from "../../../_lib/platform-session";
import { at } from "../../../_lib/strings";
import { loadConnectorMatrix, loadTenantSummary } from "../../../_lib/view";
import { TenantConfigTab } from "./_components/config-tab";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = TENANTS.find((x) => x.id === id);
  return { title: t ? t.name : "Tenant" };
}

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, role } = await platformCtx();
  if (!roleCan(role, "platform.read")) return <Denied title={at("policyLockedTitle")}>{role === "billing" ? at("billingOnly") : at("denied")}</Denied>;
  const canManage = roleCan(role, "platform.tenants.manage"), canPolicy = roleCan(role, "platform.policies.manage"), canSupport = roleCan(role, "platform.support");
  const { id } = await params;
  const loaded = await loadTenantSummary(session.demo, id);
  if (!loaded.ok) return <ErrorState source="this tenant" message={loaded.error} />;
  if (!loaded.data) notFound();
  const { summary: sum, policy, policyError } = loaded.data;
  const tenant = sum.tenant;
  const now = adminNow();
  const demo = session.demo;
  const wsIds = sum.workspaces.map((w) => w.ws.id);
  const people = demo ? USERS.filter((u) => MEMBERSHIPS.some((m) => m.userId === u.id && wsIds.includes(m.workspaceId))) : [];
  const audit = demo ? auditRows().filter((a) => a.tenantId === tenant.id) : [];
  const usage = USAGE[tenant.id] ?? { aiCalls: 0, aiCap: 0, storageMb: 0, storageCapMb: 1 };
  const suspended = tenant.status === "suspended";
  const matrix = await loadConnectorMatrix(demo);
  const connectors = matrix.ok ? matrix.data.map((c) => ({ id: c.id, name: c.name })) : [];
  const seatsLabel = tenant.seats ? `${sum.seatsUsed} of ${tenant.seats}` : `${sum.seatsUsed}, no cap`;
  const gated = (label: string, perm: string, icon?: React.ReactNode) => <Button variant="secondary" disabled disabledReason={at("disabledNeedsPermission", { perm })}>{icon}{label}</Button>;

  const wsCols: Column<WorkspaceStats>[] = [
    { key: "name", header: "Workspace", mobile: "title", cell: (w) => <span className="font-medium">{w.ws.name}</span> },
    { key: "id", header: "ID", cell: (w) => <span className="font-mono text-[12px] text-ink-2">{w.ws.id}</span> },
    { key: "region", header: "Region", cell: (w) => <span className="block max-w-[280px] truncate text-ink-2" title={w.ws.region}>{w.ws.region || "—"}</span> },
    { key: "members", header: "Members", align: "right", mobile: "fact", cell: (w) => `${w.members} members` },
    { key: "leads", header: "Leads (total)", align: "right", mobile: "fact", cell: (w) => (w.unavailable ? <span className="text-ink-3">Stats unavailable</span> : `${num(w.leadsTotal)} leads`) },
    { key: "attn", header: "Integrations", align: "right", cell: (w) => w.integrationsAttention ? <Badge tone="warn">{w.integrationsAttention} need attention</Badge> : <span className="text-ink-3">OK</span> },
    { key: "created", header: "Created", cell: (w) => <span className="num text-ink-2">{w.ws.createdAt ? fmtDateY(w.ws.createdAt) : "—"}</span> },
    { key: "support", header: <span className="sr-only">Support</span>, align: "right", mobile: "action", cell: (w) => (canSupport
      ? <Link href={`/admin/support?ws=${w.ws.id}`} className="text-[12px] font-medium text-accent hover:underline">Support session</Link>
      : <span className="text-[12px] text-ink-3" title={at("disabledNeedsPermission", { perm: "platform.support" })}>No access</span>) },
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
      {loaded.partial && <p role="status" className="mb-3 rounded-sm border border-warn/40 bg-warn-soft px-3 py-2 text-[12px] text-warn-ink">{loaded.partial}</p>}
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <TenantMark tenant={tenant} size={44} />
          <div className="min-w-0">
            <h1 className="truncate text-[22px] font-semibold leading-7 tracking-[-0.02em] sm:text-[24px]">{tenant.name}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
              <span className="font-mono text-[12px] text-ink-3">{tenant.id}</span><TenantStatus status={tenant.status} />
              <span>{tenant.plan} plan · {seatsLabel} seats · {sum.workspaces.length} workspace{sum.workspaces.length === 1 ? "" : "s"}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? (
            <>
              <ActionDialog trigger="Invite owner" icon={<UserPlus />} title={`Invite an Owner to ${tenant.name}`} submit="Send invitation" action={inviteOwner}
                description="The invitation carries the workspace; the person gets the Owner role there only. Platform admins can seat an Owner only where none exists."
                fields={[
                  { name: "ws", label: "Workspace", type: "select", options: sum.workspaces.map((w) => ({ value: w.ws.id, label: w.ws.name })), defaultValue: sum.workspaces[0]?.ws.id },
                  { name: "email", label: "Email", type: "email", placeholder: `owner@${(tenant.supportEmail.split("@")[1] ?? "client.example")}` },
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
                description={suspended ? "Members can sign in again." : `${sum.seatsUsed} members across ${sum.workspaces.length} workspace${sum.workspaces.length === 1 ? "" : "s"} will be blocked from writes. No data is deleted.`}
                fields={[
                  { name: "tenant", label: "", type: "hidden", defaultValue: tenant.id },
                  { name: "to", label: "", type: "hidden", defaultValue: suspended ? "active" : "suspended" },
                  { name: "confirm", label: `Type ${tenant.id} to confirm`, mono: true, placeholder: tenant.id },
                ]} />
            </>
          ) : (
            <>{gated("Invite owner", "platform.tenants.manage", <UserPlus />)}{gated("Add workspace", "platform.tenants.manage", <Plus />)}{gated(suspended ? "Reactivate tenant" : "Suspend tenant", "platform.tenants.manage")}</>
          )}
        </div>
      </div>

      <Tabs tabs={[
        { value: "policy", label: "Org-admin policy", content: (
          <Card><CardHeader title="What org admins may configure" sub="Enforced through the authorization engine for this tenant's admins. Changes are audited with your reason." /><CardBody>
            {policyError ? <ErrorState source="the org-admin policy" message={policyError} />
              : <PolicyEditor tenantSlug={tenant.id} policy={policy ?? { tenantId: tenant.id, allowCustomRoles: true, allowCustomObjects: true, allowApiKeys: true, allowWebhooks: true, allowByok: false, allowConnectors: null, allowedModules: null, maxSeats: null, maxWorkspaces: null, maxCustomFields: null, updatedAt: null, persisted: false }}
                modules={[...MODULE_CHOICES]} connectors={connectors} canEdit={canPolicy} action={saveOrgAdminPolicy} />}
          </CardBody></Card>
        ) },
        { value: "branding", label: "Branding", content: (
          <Card><CardHeader title="Branding" sub="Tenant-wide: every workspace of this tenant uses these tokens." /><CardBody>
            <BrandingEditor tenantId={tenant.id} initial={{ name: tenant.name.replace(" (demo)", ""), product: tenant.product, hue: tenant.hue, monogram: tenant.monogram }} />
          </CardBody></Card>
        ) },
        { value: "config", label: "Configuration", content: <TenantConfigTab tenantId={tenant.id} /> },
        { value: "workspaces", label: `Workspaces (${sum.workspaces.length})`, content: (
          <Card><CardHeader title="Workspaces" sub="Counts only. Open a support session to see records inside a workspace." />
            {sum.workspaces.length ? <DataTable rows={sum.workspaces} columns={wsCols} rowKey={(w) => w.ws.id} minWidth={900} caption="Workspaces" /> : <CardBody><EmptyState title="No workspaces" body="Add the first workspace, or the counts could not be read (see the notice above)." /></CardBody>}
          </Card>
        ) },
        { value: "members", label: demo ? `Members (${people.length})` : "Members", content: demo ? (
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
        ) : (
          <Card><CardHeader title="Members" sub={`${sum.seatsUsed} workspace memberships across ${sum.workspaces.length} workspace${sum.workspaces.length === 1 ? "" : "s"} (count only).`} /><CardBody>
            <p className="text-[13px] text-ink-2">Names and roles are managed by the organisation&apos;s own Owner in Settings. To look at them, open a read-only support session.</p>
          </CardBody></Card>
        ) },
        { value: "usage", label: "Usage", content: (
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { k: "Seats", v: sum.seatsUsed, max: tenant.seats || sum.seatsUsed || 1, fmt: seatsLabel, note: `${tenant.plan} plan` },
              ...(demo ? [
                { k: "AI calls this month", v: usage.aiCalls, max: usage.aiCap, fmt: `${num(usage.aiCalls)} of ${num(usage.aiCap)}`, note: usage.aiCalls === 0 ? "AI features are off for this tenant" : "Cap resets on the 1st" },
                { k: "Storage", v: usage.storageMb, max: usage.storageCapMb, fmt: `${num(usage.storageMb)} MB of ${num(usage.storageCapMb / 1024)} GB`, note: "Logos and CSV uploads" },
              ] : []),
            ].map((x) => (
              <Card key={x.k}><CardBody className="pt-4 sm:pt-5">
                <div className="text-[12px] font-medium text-ink-2">{x.k}</div>
                <div className="mt-1 text-[20px] font-semibold num">{x.fmt}</div>
                <Meter className="mt-3" value={x.v} max={x.max || 1} tone={x.v / (x.max || 1) >= 0.9 ? "warn" : "accent"} />
                <div className="mt-2 text-[12px] text-ink-3">{x.note}</div>
              </CardBody></Card>
            ))}
            <Card className={demo ? "md:col-span-3" : "md:col-span-2"}><CardBody className="pt-4 sm:pt-5">
              <Dl items={[["Primary owner", sum.owner], ["Support email", tenant.supportEmail || "—"], ["Created", tenant.createdAt ? fmtDateY(tenant.createdAt) : "—"], ["New leads, 30 days", `${num(sum.leads30d)} (count only)`]]} />
              {!demo && <p className="mt-3 text-[12px] text-ink-3">AI call and storage meters arrive with the usage counters migration.</p>}
            </CardBody></Card>
          </div>
        ) },
        { value: "audit", label: "Audit", content: demo ? (
          <Card><CardHeader title="Tenant audit events" sub="Rows written inside a support session carry its id." action={<Link href={`/admin/audit?tenant=${tenant.id}`} className="text-[12px] font-medium text-accent hover:underline">Open in audit log</Link>} />
            <DataTable rows={audit} columns={auditCols} rowKey={(a) => a.id} minWidth={760} caption="Tenant audit events" rowClassName={(a) => (a.supportSessionId ? "bg-warn-soft/50" : "")} />
          </Card>
        ) : (
          <Card><CardHeader title="Tenant audit events" sub="Rows written inside a support session carry its id." /><CardBody>
            <Link href={`/admin/audit?tenant=${tenant.id}`} className="text-[13px] font-medium text-accent hover:underline">Open this tenant in the platform audit log</Link>
          </CardBody></Card>
        ) },
      ]} />
      <div className="mt-4">
        {canSupport && sum.workspaces[0]
          ? <Link href={`/admin/support?ws=${sum.workspaces[0].ws.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}><LifeBuoy />Open a support session for this tenant</Link>
          : <Button variant="ghost" size="sm" disabled disabledReason={canSupport ? "This tenant has no workspace yet" : at("disabledNeedsPermission", { perm: "platform.support" })}><LifeBuoy />Open a support session for this tenant</Button>}
      </div>
    </>
  );
}
