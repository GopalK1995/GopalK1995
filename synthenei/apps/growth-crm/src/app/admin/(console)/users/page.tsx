import { Info, ShieldCheck, ShieldPlus } from "lucide-react";
import { platformCtx } from "../../_lib/platform-session";
import { RealUsers } from "../../_components/real-views";
import { TENANTS } from "@/lib/tenancy";
import { fmtDateY, relTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataTable, type Column } from "@/components/ui/data-table";
import { adminNow, maskEmail, platformAdmins, workspaceUsers, type AdminUser, type PlatformAdminRow } from "../../_components/data";
import { RoleChip, UserStatus } from "../../_components/bits";
import { ActionDialog } from "../../_components/action-dialog";
import { UserRowMenu } from "../../_components/user-menu";
import { grantPlatformAdmin, revokePlatformAdmin } from "../../_components/actions";

export const metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ tenant?: string; status?: string; q?: string }> }) {
  const { session: me, role } = await platformCtx();
  if (!me.demo) return <RealUsers role={role} />;
  const sp = await searchParams;
  const now = adminNow();
  const admins = platformAdmins(me.uid);
  const users = workspaceUsers().filter((u) =>
    (!sp.tenant || u.memberships.some((m) => m.tenantId === sp.tenant)) && (!sp.status || u.status === sp.status) &&
    (!sp.q || `${u.name} ${u.email}`.toLowerCase().includes(sp.q.toLowerCase())));

  const adminCols: Column<PlatformAdminRow>[] = [
    { key: "name", header: "Operator", mobile: "title", cell: (a) => <span className="inline-flex items-center gap-2 font-medium"><ShieldCheck className="size-4 text-accent" aria-hidden />{a.name}{a.self && <Badge tone="outline">You</Badge>}</span> },
    { key: "email", header: "Email", cell: (a) => <span className="text-ink-2">{a.email}</span> },
    { key: "mfa", header: "MFA", mobile: "fact", cell: (a) => (a.mfa ? <Badge tone="success">TOTP · aal2</Badge> : <Badge tone="danger">Off</Badge>) },
    { key: "last", header: "Last sign-in", mobile: "fact", cell: (a) => <span className="text-ink-2">{a.lastSignIn ? relTime(a.lastSignIn, now) : "—"}</span> },
    { key: "added", header: "Added", cell: (a) => <span className="num text-ink-2">{fmtDateY(a.addedAt)}</span> },
    { key: "status", header: "Status", cell: (a) => <UserStatus status={a.status} /> },
    { key: "act", header: <span className="sr-only">Actions</span>, align: "right", mobile: "action", cell: (a) => a.self
      ? <span className="text-[12px] text-ink-3">Another admin must revoke you</span>
      : <ActionDialog trigger="Revoke" triggerVariant="danger" triggerSize="sm" danger title={`Revoke platform admin for ${a.name}?`} submit="Revoke access" action={revokePlatformAdmin}
          description={`${a.name} loses console access immediately and any open support session they hold ends now. This is logged.`}
          fields={[{ name: "user", label: "", type: "hidden", defaultValue: a.id }, { name: "name", label: "", type: "hidden", defaultValue: a.name }]} /> },
  ];
  const userCols: Column<AdminUser>[] = [
    { key: "name", header: "Name", mobile: "title", cell: (u) => <span className="font-medium">{u.name}</span> },
    { key: "email", header: "Email (masked)", cell: (u) => <span className="text-ink-2">{maskEmail(u.email)}</span> },
    { key: "mem", header: "Memberships", mobile: "fact", className: "whitespace-normal py-2", cell: (u) => <span className="flex flex-wrap gap-1">{u.memberships.map((m) => <RoleChip key={m.wsId} ws={m.label} role={m.role} />)}</span> },
    { key: "mfa", header: "MFA", cell: (u) => (u.mfa ? <Badge tone="success">On</Badge> : <Badge tone="outline">Off</Badge>) },
    { key: "last", header: "Last sign-in", mobile: "fact", cell: (u) => <span className="text-ink-2">{u.lastSignIn ? relTime(u.lastSignIn, now) : "Not yet"}</span> },
    { key: "status", header: "Status", cell: (u) => <UserStatus status={u.status} /> },
    { key: "act", header: <span className="sr-only">Actions</span>, align: "right", mobile: "action", cell: (u) => <UserRowMenu userId={u.id} name={u.name} invited={u.status === "invited"} memberships={u.memberships.length} /> },
  ];

  return (
    <>
      <PageHeader eyebrow="Synthan platform" title="Users" sub="Platform admins and workspace members are separate identities. A database trigger rejects a membership for a platform admin, and platform admin for anyone with a membership."
        actions={
          <ActionDialog trigger="Add platform admin" triggerVariant="primary" icon={<ShieldPlus />} title="Add a platform admin" submit="Send invitation" action={grantPlatformAdmin}
            description="Use a dedicated Synthan address. The same person's workspace account, if any, stays separate."
            fields={[
              { name: "name", label: "Full name", placeholder: "Krishna Gopal" },
              { name: "email", label: "Email", type: "email", placeholder: "platform+krishna@synthan.example", hint: "TOTP MFA enrolment is required before the first console sign-in." },
              { name: "confirm", label: "Type GRANT to confirm", mono: true, placeholder: "GRANT" },
              { name: "code", label: "Your current 6-digit code (MFA re-check)", mono: true, placeholder: "000000", hint: "Demo: any 6 digits. The grant is written to the platform audit log." },
            ]} />
        } />

      <Card>
        <CardHeader title={`Platform admins (${admins.length})`} sub="Rows in platform_admins. Not members of any workspace." />
        <DataTable rows={admins} columns={adminCols} rowKey={(a) => a.id} minWidth={860} caption="Platform admins" />
      </Card>

      <Card className="mt-4">
        <CardHeader title={`Workspace users (${users.length})`} sub="Roles are per workspace and are changed by that workspace's Owner." />
        <div className="px-4 pb-3 sm:px-5">
          <FilterBar search="Search name or email" filters={[
            { key: "tenant", label: "Tenant", options: TENANTS.map((t) => ({ value: t.id, label: t.name })) },
            { key: "status", label: "Status", options: [{ value: "active", label: "Active" }, { value: "invited", label: "Invited" }, { value: "deactivated", label: "Deactivated" }] },
          ]} />
        </div>
        <DataTable rows={users} columns={userCols} rowKey={(u) => u.id} minWidth={980} caption="Workspace users" empty="No user matches these filters." />
      </Card>
      <p className="mt-3 flex items-start gap-1.5 text-[12px] text-ink-3"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />To give a workspace member console access, create a separate platform+name@synthan.example identity. Granting it to their workspace account is blocked.</p>
    </>
  );
}
