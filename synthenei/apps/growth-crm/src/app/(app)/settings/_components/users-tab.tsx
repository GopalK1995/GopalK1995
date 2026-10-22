"use client";
import { cloneElement, useState, useTransition, type ReactElement } from "react";
import { UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { th, td } from "@/components/ui/misc";
import { useSession, useVocab } from "@/components/shell/providers";
import { ROLES, ROLE_LABEL, can } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/data/types";
import { changeMemberRole, inviteMember, suspendMember } from "./actions";

export type MemberRow = { userId: string; name: string; email: string; role: Role; otherWs: number; status: "active" | "invited" | "deactivated"; lastSignIn: string };
const STATUS = { active: { tone: "success", label: "Active" }, invited: { tone: "outline", label: "Invited" }, deactivated: { tone: "neutral", label: "Deactivated" } } as const;
const MANAGER_SCOPE: Role[] = ["sales_rep", "viewer"];
const SUPPORT_REASON = "Not available in a support session.";

function Blocked({ reason, children }: { reason: string; children: ReactElement<{ disabled?: boolean }> }) {
  return <Tip content={reason}><span tabIndex={0} className="inline-flex rounded-sm">{cloneElement(children, { disabled: true })}</span></Tip>;
}
const selectCls = "h-8 rounded-sm border border-line-strong bg-surface pl-2 pr-7 text-[12px] text-ink outline-none focus:border-ring disabled:opacity-50";

export function UsersTab({ rows, wsName, tenantName }: { rows: MemberRow[]; wsName: string; tenantName: string }) {
  const vl = useVocab().role as Record<Role, string>;
  const { role, support, uid } = useSession();
  const manage = can("manageUsers", { role, support });
  const assignable = role === "owner" ? ROLES : MANAGER_SCOPE;
  const canTouch = (r: MemberRow) => manage && r.userId !== uid && (role === "owner" || MANAGER_SCOPE.includes(r.role));
  const why = (r: MemberRow) => support ? SUPPORT_REASON : r.userId === uid ? "You cannot change your own role." : !manage ? `Your role (${ROLE_LABEL[role]}) cannot manage users.` : "Sales Managers manage Sales Reps and Viewers only.";
  const [roles, setRoles] = useState<Record<string, Role>>(() => Object.fromEntries(rows.map((r) => [r.userId, r.role])));
  const [, start] = useTransition();

  const onRole = (r: MemberRow, next: Role) => {
    const prev = roles[r.userId];
    setRoles((x) => ({ ...x, [r.userId]: next }));
    start(async () => { const res = await changeMemberRole(r.userId, next); if (!res.ok) setRoles((x) => ({ ...x, [r.userId]: prev })); toast(res.message, res.detail); });
  };
  const roleControl = (r: MemberRow) => {
    const sel = (
      <select aria-label={`Role for ${r.name}`} value={roles[r.userId]} onChange={(e) => onRole(r, e.target.value as Role)} className={selectCls}>
        {(canTouch(r) ? assignable : [r.role]).map((x) => <option key={x} value={x}>{vl[x]}</option>)}
      </select>
    );
    return canTouch(r) ? sel : <Blocked reason={why(r)}>{sel}</Blocked>;
  };
  const suspend = (r: MemberRow) => {
    const btn = <Button size="sm" variant="ghost" aria-label={`Suspend ${r.name}`}><UserMinus />Suspend</Button>;
    if (!canTouch(r)) return <Blocked reason={why(r)}>{btn}</Blocked>;
    return <SuspendDialog r={r} wsName={wsName}>{btn}</SuspendDialog>;
  };

  return (
    <Card>
      <CardHeader title={`Members of ${tenantName} · ${wsName}`}
        sub={`${rows.length} people. Roles apply to this workspace only; someone can hold a different role elsewhere.`}
        action={manage ? <InviteDialog assignable={assignable} wsName={wsName} /> : <Blocked reason={support ? SUPPORT_REASON : `Your role (${ROLE_LABEL[role]}) cannot invite users.`}><Button variant="primary" size="sm"><UserPlus />Invite</Button></Blocked>} />
      <div className="scrollbar-thin hidden overflow-x-auto md:block">
        <table className="w-full border-collapse" style={{ minWidth: 820 }}>
          <caption className="sr-only">Workspace members</caption>
          <thead><tr className="border-y border-line bg-paper/60">
            <th scope="col" className={th}>Name</th><th scope="col" className={th}>Role here</th><th scope="col" className={cn(th, "text-right")}>Other workspaces</th>
            <th scope="col" className={th}>Status</th><th scope="col" className={th}>Last sign-in</th><th scope="col" className={th}><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className="border-b border-line last:border-0">
                <td className={cn(td, "h-14")}>
                  <div className="flex items-center gap-2.5"><Avatar name={r.name} size={28} /><div className="min-w-0"><div className="font-medium">{r.name}{r.userId === uid && <span className="ml-1.5 text-[11px] font-normal text-ink-3">you</span>}</div><div className="text-[12px] text-ink-3">{r.email}</div></div></div>
                </td>
                <td className={td}>{roleControl(r)}</td>
                <td className={cn(td, "text-right num text-ink-2")}>{r.otherWs}</td>
                <td className={td}><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
                <td className={cn(td, "num text-ink-2")}>{r.lastSignIn}</td>
                <td className={cn(td, "text-right")}>{suspend(r)}</td>
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
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-[13px] font-medium text-ink">{r.name}</span><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></div>
                <div className="truncate text-[12px] text-ink-3">{r.email} · {r.otherWs} other workspace{r.otherWs === 1 ? "" : "s"}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 pl-[42px]">{roleControl(r)}{suspend(r)}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function InviteDialog({ assignable, wsName }: { assignable: Role[]; wsName: string }) {
  const vl = useVocab().role as Record<Role, string>;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(assignable.includes("sales_rep") ? "sales_rep" : assignable[0]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <DialogTrigger asChild><Button variant="primary" size="sm"><UserPlus />Invite</Button></DialogTrigger>
      <DialogContent title={`Invite to ${wsName}`} description="An existing user gets the membership at once; a new user gets an email invite valid for 7 days.">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await inviteMember(email, role); if (r.ok) { setOpen(false); setEmail(""); toast(r.message, r.detail); } else setErr(r.message); }); }}>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={useVocab().st.emailPh} className="h-9 rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-ring" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-2">Role in this workspace
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={cn(selectCls, "h-9 text-[13px]")}>
              {assignable.map((x) => <option key={x} value={x}>{vl[x]}</option>)}
            </select>
            {assignable.length < ROLES.length && <span className="font-normal text-ink-3">As Sales Manager you can invite Sales Reps and Viewers.</span>}
          </label>
          {err && <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-[12px] text-danger">{err}</p>}
          <div className="flex justify-end gap-2"><DialogClose asChild><Button type="button">Cancel</Button></DialogClose><Button type="submit" variant="primary" disabled={pending}>Send invite</Button></div>
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
      <DialogContent title={`Suspend ${r.name} in ${wsName}?`} description="Their membership here is deactivated and sessions are revoked. History stays; other workspaces are not affected.">
        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button>Cancel</Button></DialogClose>
          <Button variant="danger" disabled={pending} onClick={() => start(async () => { const x = await suspendMember(r.userId); setOpen(false); toast(x.message, x.detail); })}>Suspend {r.name.split(" ")[0]}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
