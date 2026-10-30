import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, PartialState } from "@/components/ui/states";
import { relTime } from "@/lib/format";
import { TabBar } from "../_components/tab-bar";
import { UsersTab, type MemberRow, type RoleOption } from "../_components/users-tab";
import { RolesTab, type RoleView } from "../_components/roles-tab";
import { TeamsTab, type TeamView } from "../_components/teams-tab";
import { checkRoleAssignment } from "./_lib/guards";
import { sa } from "./_lib/strings";
import { loadAccess, type AccessData } from "./_lib/view";
import Link from "next/link";

export const metadata = { title: "Users, roles and teams" };
type SP = { tab?: string };
const TABS = ["members", "roles", "teams"] as const;

export default async function AccessPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const res = await loadAccess();
  const header = <PageHeader title={sa("pageTitle")} sub={sa("pageSub")} />;
  if (res.status === "denied") {
    return <>{header}<EmptyState title={sa("deniedTitle")} body={res.reason === "support" ? sa("deniedSupport") : sa("deniedBody", { role: res.roleLabel.replace("_", " ") })} /></>;
  }
  if (res.status === "error") {
    return <>{header}<ErrorState source={sa("loadErrorSource")} message={sa("loadErrorBody")} retry={<Link href="/settings/roles"><Button>{sa("retry")}</Button></Link>} /></>;
  }
  const d = res.data;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "members";
  const labels = { members: sa("tabMembers"), roles: sa("tabRoles"), teams: sa("tabTeams") };
  const now = new Date().toISOString();
  return (
    <>
      {header}
      {res.failed.length > 0 && (
        <div className="mb-4">
          <PartialState done={4 - res.failed.length} total={4} noun={sa("partialNoun")}
            items={["members", "roles", "teams", "policy"].map((k) => ({ label: k, status: res.failed.includes(k) ? "failed" as const : "ok" as const }))} />
        </div>
      )}
      <TabBar tabs={TABS.map((v) => ({ value: v, label: labels[v] }))} current={tab} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="outline-none">
        {tab === "members" && <Members d={d} now={now} />}
        {tab === "roles" && <Roles d={d} />}
        {tab === "teams" && <Teams d={d} />}
      </div>
    </>
  );
}

function roleViews(d: AccessData): RoleView[] {
  return d.roles.map((r) => ({ id: r.id, name: r.name, description: r.description, baseRole: r.baseRole, isSystem: r.isSystem, updatedAt: r.updatedAt, grants: r.grants,
    people: d.members.filter((m) => (m.roleId ?? m.baseRole) === r.id).length }));
}

function Members({ d, now }: { d: AccessData; now: string }) {
  const actor = { uid: d.uid, baseRole: d.baseRole, held: d.held };
  const options: RoleOption[] = d.roles.map((r) => ({ id: r.id, name: r.name, baseRole: r.baseRole, custom: !r.isSystem,
    assignable: checkRoleAssignment(actor, { baseRole: r.baseRole, custom: !r.isSystem, grants: r.grants }).ok && (r.isSystem || d.policy.allowCustomRoles) }));
  const rows: MemberRow[] = d.members.map((m) => {
    const role = d.roles.find((r) => r.id === m.roleId) ?? d.roles.find((r) => r.isSystem && r.key === m.baseRole);
    return { userId: m.userId, name: m.name, email: m.email, role: m.baseRole, roleId: role?.id, roleName: role?.name, custom: role ? !role.isSystem : false, districts: m.districts, regions: m.regions,
      otherWs: 0, status: m.isActive ? "active" : "deactivated", lastSignIn: m.lastSeenAt ? relTime(m.lastSeenAt, now) : sa("neverSeen") };
  });
  return <UsersTab rows={rows} wsName={d.wsName} tenantName={d.tenantName} roleOptions={options} activeOwners={d.activeOwners} canInvite={d.perms.invite} showRolesLink={false} />;
}

function Roles({ d }: { d: AccessData }) {
  return <RolesTab roles={roleViews(d)} held={d.held} baseRole={d.baseRole} uid={d.uid} canManage={d.perms.roles} customAllowed={d.policy.allowCustomRoles} demo={d.demo} />;
}

function Teams({ d }: { d: AccessData }) {
  const name = (id: string) => d.members.find((m) => m.userId === id)?.name ?? id;
  const teams: TeamView[] = d.teams.map((t) => ({ id: t.id, name: t.name, parentTeamId: t.parentTeamId, members: t.members.map((m) => ({ userId: m.userId, name: name(m.userId), isManager: m.isManager })) }));
  const people = d.members.filter((m) => m.isActive).map((m) => ({ userId: m.userId, name: m.name }));
  return <TeamsTab teams={teams} people={people} canManage={d.perms.teams} uid={d.uid} isOwner={d.baseRole === "owner"} demo={d.demo} />;
}
