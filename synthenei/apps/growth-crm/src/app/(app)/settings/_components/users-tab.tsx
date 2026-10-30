"use client";
import { cloneElement, useState, useTransition, type ReactElement } from "react";
import Link from "next/link";
import { MapPin, UserCheck, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/states";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { th, td } from "@/components/ui/misc";
import { useSession, useVocab } from "@/components/shell/providers";
import { ROLES, ROLE_LABEL, can } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/data/types";
import { sa } from "../roles/_lib/strings";
import { changeMemberRole, inviteMember, reactivateMember, setMemberTerritory, suspendMember } from "./actions";

export type MemberRow = {
  userId: string; name: string; email: string; role: Role; otherWs: number; status: "active" | "invited" | "deactivated"; lastSignIn: string;
  /** Real mode: role id (uuid). Absent in the legacy demo caller: the role key is the id. */
  roleId?: string; roleName?: string; custom?: boolean; districts?: string[]; regions?: string[];
};
/** assignable is computed on the server with the same guards the actions run; the client only renders it. */
export type RoleOption = { id: string; name: string; baseRole: Role; custom: boolean; assignable: boolean };
const STATUS = { active: { tone: "success", key: "statusActive" }, invited: { tone: "outline", key: "statusInvited" }, deactivated: { tone: "neutral", key: "statusDeactivated" } } as const;
const MANAGER_SCOPE: Role[] = ["sales_rep", "viewer"];
const selectCls = "h-8 rounded-chip border border-line-strong bg-surface pl-2 pr-7 text-12 text-ink outline-none focus:border-ring disabled:opacity-50";
const inputCls = "h-9 rounded-chip border border-line-strong bg-surface px-2.5 text-13 text-ink outline-none focus:border-ring";
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function Blocked({ reason, children }: { reason: string; children: ReactElement<{ disabled?: boolean }> }) {
  return <Tip content={reason}><span tabIndex={0} className="inline-flex rounded-chip">{cloneElement(children, { disabled: true })}</span></Tip>;
}

export function UsersTab({ rows, wsName, tenantName, roleOptions, activeOwners, canInvite, showRolesLink = true }: {
  rows: MemberRow[]; wsName: string; tenantName: string; roleOptions?: RoleOption[]; activeOwners?: number; canInvite?: boolean; showRolesLink?: boolean;
}) {
  const vl = useVocab().role as Record<Role, string>;
  const { role, support, uid } = useSession();
  const manage = can("manageUsers", { role, support });
  const options: RoleOption[] = roleOptions ?? ROLES.map((r) => ({ id: r, name: vl[r] ?? ROLE_LABEL[r], baseRole: r, custom: false, assignable: role === "owner" || (role === "sales_manager" && MANAGER_SCOPE.includes(r)) }));
  const owners = activeOwners ?? rows.filter((r) => r.role === "owner" && r.status === "active").length;
  const [roles, setRoles] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.userId, r.roleId ?? r.role])));
  const [, start] = useTransition();
  const idOf = (r: MemberRow) => r.roleId ?? r.role;
  const nameOfRole = (r: MemberRow) => r.roleName ?? vl[r.role] ?? ROLE_LABEL[r.role];

  const reason = (r: MemberRow): string | null => {
    if (support) return sa("reasonSupport");
    if (!manage) return sa("reasonNoManage");
    if (r.userId === uid) return sa("reasonSelf");
    if (r.role === "owner" && role !== "owner") return sa("reasonOwnerOnly");
    if (r.role === "owner" && r.status === "active" && owners <= 1) return sa("reasonLastOwner");
    if (role === "sales_manager" && !MANAGER_SCOPE.includes(r.role)) return sa("reasonManager");
    return null;
  };
  const onRole = (r: MemberRow, next: string) => {
    const prev = roles[r.userId];
    setRoles((x) => ({ ...x, [r.userId]: next }));
    start(async () => { const res = await changeMemberRole(r.userId, next); if (!res.ok) setRoles((x) => ({ ...x, [r.userId]: prev })); toast(res.message, res.sub); });
  };
  const roleControl = (r: MemberRow) => {
    const why = reason(r);
    const choices = why ? options.filter((o) => o.id === idOf(r)) : options.filter((o) => o.assignable || o.id === idOf(r));
    const sel = (
      <select aria-label={`${sa("colRole")}: ${r.name}`} value={roles[r.userId]} onChange={(e) => onRole(r, e.target.value)} className={selectCls}>
        {(choices.length ? choices : [{ id: idOf(r), name: nameOfRole(r) } as RoleOption]).map((x) => <option key={x.id} value={x.id}>{x.name}{x.custom ? ` (${sa("customRole")})` : ""}</option>)}
      </select>
    );
    return why ? <Blocked reason={why}>{sel}</Blocked> : sel;
  };
  const actions = (r: MemberRow) => {
    const why = reason(r);
    const sus = r.status === "deactivated"
      ? <Button size="sm" variant="ghost" aria-label={`${sa("reactivate")} ${r.name}`}><UserCheck />{sa("reactivate")}</Button>
      : <Button size="sm" variant="ghost" aria-label={`${sa("suspend")} ${r.name}`}><UserMinus />{sa("suspend")}</Button>;
    const terr = <Button size="sm" variant="ghost" aria-label={`${sa("territory")} ${r.name}`}><MapPin />{sa("territory")}</Button>;
    if (why) return <span className="inline-flex gap-1"><Blocked reason={why}>{terr}</Blocked><Blocked reason={why}>{sus}</Blocked></span>;
    return <span className="inline-flex gap-1"><TerritoryDialog r={r}>{terr}</TerritoryDialog>{r.status === "deactivated" ? <ReactivateButton r={r}>{sus}</ReactivateButton> : <SuspendDialog r={r} wsName={wsName}>{sus}</SuspendDialog>}</span>;
  };
  const statusChip = (r: MemberRow) => <Badge tone={STATUS[r.status].tone}>{sa(STATUS[r.status].key)}</Badge>;
  const inviteBlockedWhy = support ? sa("reasonSupport") : sa("reasonNoManage");
  const mayInvite = canInvite ?? manage;

  return (
    <Card>
      <CardHeader title={sa("membersTitle", { tenant: tenantName, ws: wsName })} sub={sa("membersSub", { n: rows.length })}
        action={
          <span className="flex items-center gap-2">
            {showRolesLink && <Link href="/settings/roles" className="text-12 font-medium text-accent hover:underline">{sa("linkRolesTeams")}</Link>}
            {mayInvite && !support ? <InviteDialog options={options} wsName={wsName} managerOnly={role === "sales_manager"} /> : <Blocked reason={inviteBlockedWhy}><Button variant="primary" size="sm"><UserPlus />{sa("invite")}</Button></Blocked>}
          </span>
        } />
      {rows.length === 0 ? (
        <div className="zone-work"><EmptyState title={sa("emptyMembersTitle")} body={sa("emptyMembersBody")} /></div>
      ) : (
        <>
          <div className="scrollbar-thin hidden overflow-x-auto md:block">
            <table className="w-full border-collapse" style={{ minWidth: 900 }}>
              <caption className="sr-only">{sa("membersTitle", { tenant: tenantName, ws: wsName })}</caption>
              <thead><tr className="border-y border-line bg-paper/60">
                <th scope="col" className={th}>{sa("colName")}</th><th scope="col" className={th}>{sa("colRole")}</th><th scope="col" className={th}>{sa("colTerritory")}</th>
                <th scope="col" className={th}>{sa("colStatus")}</th><th scope="col" className={th}>{sa("colLastSeen")}</th><th scope="col" className={th}><span className="sr-only">{sa("colActions")}</span></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} className="border-b border-line last:border-0">
                    <td className={cn(td, "h-14")}>
                      <div className="flex items-center gap-2.5"><Avatar name={r.name} size={28} /><div className="min-w-0"><div className="font-medium">{r.name}{r.userId === uid && <span className="ml-1.5 text-12 font-normal text-ink-3">{sa("you")}</span>}</div><div className="text-12 text-ink-3">{r.email}</div></div></div>
                    </td>
                    <td className={td}>{roleControl(r)}</td>
                    <td className={cn(td, "text-ink-2")}>{r.districts?.length || r.regions?.length ? [...(r.districts ?? []), ...(r.regions ?? [])].join(", ") : sa("noTerritory")}</td>
                    <td className={td}>{statusChip(r)}</td>
                    <td className={cn(td, "num text-ink-2")}>{r.lastSignIn}</td>
                    <td className={cn(td, "text-right")}>{actions(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line border-t border-line md:hidden">
            {rows.map((r) => (
              <li key={r.userId} className="px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <Avatar name={r.name} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-13 font-medium text-ink">{r.name}</span>{statusChip(r)}</div>
                    <div className="truncate text-12 text-ink-3">{r.email}</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-[42px]">{roleControl(r)}{actions(r)}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function InviteDialog({ options, wsName, managerOnly }: { options: RoleOption[]; wsName: string; managerOnly: boolean }) {
  const choices = options.filter((o) => o.assignable);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [districts, setDistricts] = useState("");
  const [roleId, setRoleId] = useState(choices.find((o) => o.baseRole === "sales_rep" && !o.custom)?.id ?? choices[0]?.id ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <DialogTrigger asChild><Button variant="primary" size="sm"><UserPlus />{sa("invite")}</Button></DialogTrigger>
      <DialogContent title={sa("inviteTitle", { ws: wsName })} description={sa("inviteDesc")}>
        <form className="flex flex-col gap-4" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await inviteMember({ email, roleId, fullName: name || undefined, districts: list(districts) });
            if (r.ok) { setOpen(false); setEmail(""); setName(""); setDistricts(""); toast(r.message, r.sub); } else setErr([r.message, r.sub].filter(Boolean).join(" "));
          });
        }}>
          <label className="flex flex-col gap-1 text-12 font-medium text-ink-2">{sa("fieldEmail")}
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1 text-12 font-medium text-ink-2">{sa("fieldName")}
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} maxLength={80} />
          </label>
          <label className="flex flex-col gap-1 text-12 font-medium text-ink-2">{sa("fieldRole")}
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className={cn(selectCls, "h-9 text-13")}>
              {choices.map((x) => <option key={x.id} value={x.id}>{x.name}{x.custom ? ` (${sa("customRole")})` : ""}</option>)}
            </select>
            {managerOnly && <span className="font-normal text-ink-3">{sa("managerInviteHelp")}</span>}
          </label>
          <label className="flex flex-col gap-1 text-12 font-medium text-ink-2">{sa("fieldDistricts")}
            <input value={districts} onChange={(e) => setDistricts(e.target.value)} className={inputCls} />
            <span className="font-normal text-ink-3">{sa("listHelp")}</span>
          </label>
          {err && <p role="alert" className="state-danger rounded-chip px-3 py-2 text-12">{err}</p>}
          <div className="flex justify-end gap-2"><DialogClose asChild><Button type="button">{sa("cancel")}</Button></DialogClose><Button type="submit" variant="primary" disabled={pending || !choices.length}>{pending ? sa("sending") : sa("sendInvite")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SuspendDialog({ r, wsName, children }: { r: MemberRow; wsName: string; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent title={sa("suspendTitle", { name: r.name, ws: wsName })} description={sa("suspendDesc")}>
        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button>{sa("cancel")}</Button></DialogClose>
          <Button variant="danger" disabled={pending} onClick={() => start(async () => { const x = await suspendMember(r.userId); setOpen(false); toast(x.message, x.sub); })}>{sa("suspend")} {r.name.split(" ")[0]}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReactivateButton({ r, children }: { r: MemberRow; children: ReactElement<{ onClick?: () => void; disabled?: boolean }> }) {
  const [pending, start] = useTransition();
  return cloneElement(children, { disabled: pending, onClick: () => start(async () => { const x = await reactivateMember(r.userId); toast(x.message, x.sub); }) });
}

function TerritoryDialog({ r, children }: { r: MemberRow; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  const [districts, setDistricts] = useState((r.districts ?? []).join(", "));
  const [regions, setRegions] = useState((r.regions ?? []).join(", "));
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent title={sa("territoryTitle", { name: r.name })} description={sa("territoryDesc")}>
        <form className="flex flex-col gap-4" onSubmit={(e) => {
          e.preventDefault();
          start(async () => { const x = await setMemberTerritory(r.userId, list(districts), list(regions)); if (x.ok) { setOpen(false); toast(x.message, x.sub); } else setErr(x.message); });
        }}>
          <label className="flex flex-col gap-1 text-12 font-medium text-ink-2">{sa("fieldDistricts")}
            <input value={districts} onChange={(e) => setDistricts(e.target.value)} className={inputCls} /><span className="font-normal text-ink-3">{sa("listHelp")}</span>
          </label>
          <label className="flex flex-col gap-1 text-12 font-medium text-ink-2">{sa("fieldRegions")}
            <input value={regions} onChange={(e) => setRegions(e.target.value)} className={inputCls} />
          </label>
          {err && <p role="alert" className="state-danger rounded-chip px-3 py-2 text-12">{err}</p>}
          <div className="flex justify-end gap-2"><DialogClose asChild><Button type="button">{sa("cancel")}</Button></DialogClose><Button type="submit" variant="primary" disabled={pending}>{pending ? sa("saving") : sa("save")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
