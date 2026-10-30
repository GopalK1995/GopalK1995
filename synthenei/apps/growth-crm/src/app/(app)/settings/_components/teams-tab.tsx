"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { createTeam, deleteTeam, removeTeamMember, setTeamMember } from "../roles/actions";
import { sa } from "../roles/_lib/strings";

export interface TeamView { id: string; name: string; parentTeamId: string | null; members: { userId: string; name: string; isManager: boolean }[] }
export interface PersonOption { userId: string; name: string }
const selectCls = "h-8 rounded-chip border border-line-strong bg-surface pl-2 pr-7 text-12 text-ink outline-none focus:border-ring disabled:opacity-50";
const inputCls = "h-9 w-full rounded-chip border border-line-strong bg-surface px-2.5 text-13 text-ink outline-none focus:border-ring";

export function TeamsTab({ teams, people, canManage, uid, isOwner, demo }: { teams: TeamView[]; people: PersonOption[]; canManage: boolean; uid: string; isOwner: boolean; demo: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const why = canManage ? null : sa("authz_no_permission");
  const run = (fn: () => Promise<{ ok: boolean; message: string; sub?: string }>) => start(async () => { const r = await fn(); toast(r.message, r.sub); if (r.ok) router.refresh(); });
  const nameOf = (id: string | null) => teams.find((t) => t.id === id)?.name;

  return (
    <Card>
      <CardHeader title={sa("teamsTitle")} sub={sa("teamsSub")} action={<NewTeam teams={teams} disabledReason={why} onDone={() => router.refresh()} />} />
      {teams.length === 0 ? (
        <div className="zone-work"><EmptyState title={sa("emptyTeamsTitle")} body={sa("emptyTeamsBody")} /></div>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {teams.map((t) => {
            const free = people.filter((p) => !t.members.some((m) => m.userId === p.userId));
            return (
              <li key={t.id} className="zone-work">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-15 font-bold tracking-[-0.015em] text-ink">{t.name}</h3>
                    <p className="text-12 text-ink-3">{sa("teamMembers", { n: t.members.length })}{t.parentTeamId ? ` · ${sa("parentTeam")}: ${nameOf(t.parentTeamId) ?? "-"}` : ""}</p>
                  </div>
                  <DeleteTeam team={t} disabledReason={why} onDone={() => router.refresh()} />
                </div>
                <ul className="mt-2 flex flex-col">
                  {t.members.map((m) => {
                    const selfLead = m.userId === uid && !m.isManager && !isOwner;
                    return (
                      <li key={m.userId} className="flex h-10 items-center justify-between gap-2 border-t border-line first:border-0">
                        <span className="flex items-center gap-2 text-13 text-ink">{m.name}<Badge tone={m.isManager ? "accent" : "outline"}>{m.isManager ? sa("manager") : sa("member")}</Badge></span>
                        <span className="inline-flex gap-1">
                          <DisabledReason reason={why ?? (selfLead ? sa("teamManagerSelf") : null)}>
                            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setTeamMember({ teamId: t.id, userId: m.userId, isManager: !m.isManager }))}>{m.isManager ? sa("member") : sa("makeManager")}</Button>
                          </DisabledReason>
                          <DisabledReason reason={why}>
                            <Button size="sm" variant="ghost" disabled={pending} aria-label={`${sa("removeMember")} ${m.name}`} onClick={() => run(() => removeTeamMember({ teamId: t.id, userId: m.userId }))}><UserMinus />{sa("removeMember")}</Button>
                          </DisabledReason>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <AddPerson teamId={t.id} free={free} disabledReason={why} pending={pending} run={run} />
              </li>
            );
          })}
        </ul>
      )}
      {demo && <p className="border-t border-line px-4 py-3 text-12 text-ink-3 sm:px-5">{sa("demoNotice")}</p>}
    </Card>
  );
}

function AddPerson({ teamId, free, disabledReason, pending, run }: { teamId: string; free: PersonOption[]; disabledReason: string | null; pending: boolean; run: (fn: () => Promise<{ ok: boolean; message: string; sub?: string }>) => void }) {
  const [pick, setPick] = useState("");
  return (
    <div className="mt-2 flex items-center gap-2">
      <select aria-label={sa("pickPerson")} value={pick} onChange={(e) => setPick(e.target.value)} className={selectCls} disabled={!!disabledReason || !free.length}>
        <option value="">{sa("pickPerson")}</option>
        {free.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
      </select>
      <DisabledReason reason={disabledReason}>
        <Button size="sm" disabled={pending || !pick} onClick={() => { run(() => setTeamMember({ teamId, userId: pick, isManager: false })); setPick(""); }}><UserPlus />{sa("addMember")}</Button>
      </DisabledReason>
    </div>
  );
}

function NewTeam({ teams, disabledReason, onDone }: { teams: TeamView[]; disabledReason: string | null; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const trigger = <Button variant="primary" size="sm"><Plus />{sa("newTeam")}</Button>;
  if (disabledReason) return <DisabledReason reason={disabledReason}>{trigger}</DisabledReason>;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={sa("newTeam")}>
        <form className="flex flex-col gap-4" onSubmit={(e) => {
          e.preventDefault();
          start(async () => { const r = await createTeam({ name, parentTeamId: parent || null }); if (r.ok) { setOpen(false); setName(""); toast(r.message, r.sub); onDone(); } else setErr(r.message); });
        }}>
          <label className="flex flex-col gap-1 text-12 font-medium text-ink-2">{sa("teamName")}<input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></label>
          <label className="flex flex-col gap-1 text-12 font-medium text-ink-2">{sa("parentTeam")}
            <select value={parent} onChange={(e) => setParent(e.target.value)} className={cn(selectCls, "h-9 text-13")}><option value="">{sa("noParent")}</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </label>
          {err && <p role="alert" className="state-danger rounded-chip px-3 py-2 text-12">{err}</p>}
          <div className="flex justify-end gap-2"><DialogClose asChild><Button type="button">{sa("cancel")}</Button></DialogClose><Button type="submit" variant="primary" disabled={pending}>{pending ? sa("saving") : sa("save")}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTeam({ team, disabledReason, onDone }: { team: TeamView; disabledReason: string | null; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const trigger = <Button size="sm" variant="ghost" aria-label={`${sa("deleteTeamAction")} ${team.name}`}><Trash2 />{sa("deleteTeamAction")}</Button>;
  if (disabledReason) return <DisabledReason reason={disabledReason}>{trigger}</DisabledReason>;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={sa("deleteTeamTitle", { name: team.name })} description={sa("deleteTeamDesc")}>
        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button>{sa("cancel")}</Button></DialogClose>
          <Button variant="danger" disabled={pending} onClick={() => start(async () => { const r = await deleteTeam({ teamId: team.id }); toast(r.message, r.sub); if (r.ok) { setOpen(false); onDone(); } })}>{sa("deleteTeamAction")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
