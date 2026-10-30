"use client";
// /tasks: list grouped Overdue / Today / This week / Later, and a Mon-Sat week calendar (spec 5).
// Complete, snooze, reschedule, reassign, edit and create go through server actions. The list keeps an optimistic copy
// with per-row versions; a conflict result rolls the row back and shows the conflict banner (nothing was saved).
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { AlarmClock, Check, Pencil, Plus, UserRoundCheck } from "lucide-react";
import { dayKey, fmtDate, fmtTime, fmtWeekday } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DisabledReason } from "@/components/ui/disabled-reason";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/dropdown";
import { Tabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useVocab } from "@/components/shell/providers";
import type { ActionResult } from "@/lib/actions/result";
import { completeTasks, createTask, editTask, reassignTask, rescheduleTask, snoozeTask } from "../actions";
import { field } from "../../leads/_lib/sales";
import { ConflictBanner } from "../../leads/_components/conflict-banner";
import { KIND_ICON, blockedReason, istHm, istIso, snoozeTargets, sub, useTaskPerm, type TaskRow, type TaskStrings } from "./shared";
import { WeekCalendar, type Holiday } from "./week-calendar";

const DAY = 86400e3;
type Group = "overdue" | "today" | "week" | "later";
const GROUPS: Group[] = ["overdue", "today", "week", "later"];
const GROUP_KEY: Record<Group, [string, string]> = { overdue: ["groupOverdue", "emptyOverdue"], today: ["groupToday", "emptyToday"], week: ["groupWeek", "emptyWeek"], later: ["groupLater", "emptyLater"] };

export function TasksApp({ rows: initial, now, team, leads, weekOffset, holidays, defaultTab, emptyHint, t, canAssignOthers, selfId }: {
  rows: TaskRow[]; now: string; team: { id: string; name: string }[]; leads: { id: string; label: string }[];
  weekOffset: number; holidays: Holiday[]; defaultTab: "list" | "calendar"; emptyHint: string; t: TaskStrings;
  canAssignOthers: boolean; selfId: string;
}) {
  const tk = useVocab().tk, KIND_LABEL = tk.kind;
  const [rows, setRows] = useState(initial);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [resched, setResched] = useState<TaskRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, start] = useTransition();
  const { edit, reassign } = useTaskPerm();
  const editReason = blockedReason(edit, t), assignReason = blockedReason(reassign, t, "disabledNeedsAssign");
  const today = dayKey(now);
  const nowMs = new Date(now).getTime();
  const dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7; // Mon 0
  const weekEnd = dayKey(new Date(nowMs + (6 - dow) * DAY).toISOString());
  const groupOf = (r: TaskRow): Group => (r.due < now ? "overdue" : dayKey(r.due) === today ? "today" : dayKey(r.due) <= weekEnd ? "week" : "later");
  const groups = useMemo(() => {
    const g: Record<Group, TaskRow[]> = { overdue: [], today: [], week: [], later: [] };
    [...rows].sort((a, b) => a.due.localeCompare(b.due)).forEach((r) => g[groupOf(r)].push(r));
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, now]);
  const snooze = snoozeTargets(now, t);
  const label = (iso: string) => `${fmtWeekday(iso)} ${fmtDate(iso)}, ${fmtTime(iso)}`;

  /** Runs a write: optimistic change first, rollback on failure, conflict banner on 409, version bump on success. */
  const run = (id: string | null, optimistic: (xs: TaskRow[]) => TaskRow[], call: () => Promise<ActionResult<{ version: number }> | ActionResult>, failSub: string) => {
    const before = rows;
    setConflict(false);
    setRows(optimistic);
    start(async () => {
      const r = await call();
      if (!r.ok) {
        setRows(before);
        if (r.code === "conflict") setConflict(true);
        toast(r.message, r.sub ?? failSub);
        return;
      }
      const v = (r.data as { version?: number } | undefined)?.version;
      if (id && v !== undefined) setRows((xs) => xs.map((x) => (x.id === id ? { ...x, version: v } : x)));
      toast(r.message, r.sub);
    });
  };

  const complete = (ids: string[]) => { setSel(new Set()); run(null, (xs) => xs.filter((x) => !ids.includes(x.id)), () => completeTasks(ids), t.nothingChanged); };
  const move = (id: string, iso: string, kind: "moved" | "snoozed" = "moved") => {
    const r0 = rows.find((x) => x.id === id);
    run(id, (xs) => xs.map((x) => (x.id === id ? { ...x, due: iso } : x)),
      () => (kind === "snoozed" ? snoozeTask : rescheduleTask)(id, iso, label(iso), r0?.version ?? undefined), t.keptOldTime);
  };
  const reassignTo = (id: string, m: { id: string; name: string }) => {
    const r0 = rows.find((x) => x.id === id);
    run(id, (xs) => xs.map((x) => (x.id === id ? { ...x, ownerId: m.id, owner: m.name } : x)), () => reassignTask(id, m.id, r0?.version ?? undefined), t.nothingChanged);
  };

  const rowView = (r: TaskRow, g: Group) => {
    const I = KIND_ICON[r.kind];
    return (
      <li key={r.id} data-testid="task-row" data-task-id={r.id} className={cn("grid grid-cols-[auto_32px_1fr_auto] items-center gap-3 px-4 py-2.5 sm:px-5", sel.has(r.id) && "bg-accent-soft/40")}>
        {edit === "yes"
          ? <input type="checkbox" aria-label={`Select ${r.title}`} checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} className="size-4 accent-[var(--accent)]" />
          : <span className="w-4" aria-hidden />}
        <span className={cn("grid size-8 place-items-center rounded-sm border", g === "overdue" ? "border-danger/30 bg-danger-soft text-danger" : r.kind === "demo" ? "border-navy-900 bg-navy-900 text-navy-ink" : "border-line bg-paper text-ink-2")} title={KIND_LABEL[r.kind]}>
          <I className="size-4" aria-hidden /><span className="sr-only">{KIND_LABEL[r.kind]}</span>
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-ink">{r.title}</span>
            {r.firstResponse && <span title={t.firstResponseHint}><Badge tone="accent">{t.firstResponse}</Badge></span>}
            {r.priority === "high" && r.kind !== "demo" && <Badge tone="warn">{t.high}</Badge>}{r.priority === "low" && <span className="text-[12px] text-ink-3">{t.low}</span>}
          </div>
          <div className="truncate text-[12px] text-ink-3">
            {r.lead ? <Link href={`/leads/${r.lead.id}`} className="hover:text-accent">{r.lead.name}, {r.lead.firm}</Link> : tk.noLead}
            <span className="hidden sm:inline"> · {r.owner}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className={cn("mr-1 text-right text-[12px] num", g === "overdue" ? "font-medium text-danger" : "text-ink-2")}>
            {g === "overdue" ? sub(t.late, { n: Math.max(1, Math.ceil((nowMs - new Date(r.due).getTime()) / DAY)) }) : g === "today" ? fmtTime(r.due) : `${fmtWeekday(r.due)} ${fmtDate(r.due)}`}
            <span className="hidden text-ink-3 sm:block">{g === "overdue" || g === "today" ? fmtDate(r.due) : fmtTime(r.due)}</span>
          </span>
          <DisabledReason reason={editReason}>
            <Button size="icon" variant="ghost" aria-label={`${t.markDone}: ${r.title}`} title={t.markDone} onClick={() => complete([r.id])} className="size-11 sm:size-8"><Check /></Button>
          </DisabledReason>
          {edit === "yes" ? (
            <Menu>
              <MenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`${t.snooze}: ${r.title}`} title={t.snooze} className="size-11 sm:size-8"><AlarmClock /></Button></MenuTrigger>
              <MenuContent>
                <MenuLabel>{t.snooze}</MenuLabel>
                {snooze.map((s) => <MenuItem key={s.key} onSelect={() => move(r.id, s.iso, "snoozed")}>{s.label}</MenuItem>)}
                <MenuItem onSelect={() => { setErr(null); setResched(r); }}>{t.pickDateTime}</MenuItem>
                <MenuItem onSelect={() => { setErr(null); setEditing(r); }}><Pencil />{t.editTask}</MenuItem>
                <MenuLabel>{t.reassign}</MenuLabel>
                {reassign === "yes"
                  ? team.filter((m) => m.id !== r.ownerId).map((m) => <MenuItem key={m.id} onSelect={() => reassignTo(r.id, m)}><UserRoundCheck />{m.name}</MenuItem>)
                  : <MenuItem disabled>{assignReason}</MenuItem>}
              </MenuContent>
            </Menu>
          ) : (
            <DisabledReason reason={editReason}><Button size="icon" variant="ghost" aria-label={`${t.snooze}: ${r.title}`} className="size-11 sm:size-8"><AlarmClock /></Button></DisabledReason>
          )}
        </div>
      </li>
    );
  };

  const list = (
    <div className="space-y-4">
      {GROUPS.map((g) => (
        <Card key={g}>
          <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <h2 className={cn("text-[14px] font-semibold", g === "overdue" && groups.overdue.length ? "text-danger" : "text-ink")}>{t[GROUP_KEY[g][0]]}</h2>
            <span className="text-[12px] text-ink-3 num">{groups[g].length}</span>
          </header>
          {groups[g].length ? <ul className="divide-y divide-line border-t border-line">{groups[g].map((r) => rowView(r, g))}</ul>
            : <p className="border-t border-line px-4 py-4 text-[13px] text-ink-3 sm:px-5">{t[GROUP_KEY[g][1]]}</p>}
        </Card>
      ))}
    </div>
  );

  /** Create and edit share one form; edit sends the row version so a concurrent change is a conflict, not a silent overwrite. */
  const form = (r: TaskRow | null) => {
    const dueD = r ? dayKey(r.due) : dayKey(new Date(nowMs + DAY).toISOString());
    return (
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        const due = istIso(String(f.get("date")), String(f.get("time")));
        const base = { title: String(f.get("title")), kind: String(f.get("kind")), priority: String(f.get("priority")), due };
        if (r) {
          setEditing(null); setErr(null);
          run(r.id, (xs) => xs.map((x) => (x.id === r.id ? { ...x, title: base.title.trim(), kind: base.kind as TaskRow["kind"], priority: base.priority as TaskRow["priority"], due } : x)),
            () => editTask(r.id, { expectedVersion: r.version ?? 1, patch: base }), t.nothingChanged);
          return;
        }
        start(async () => {
          const res = await createTask({ ...base, leadId: String(f.get("lead") ?? ""), assigneeId: String(f.get("assignee") ?? "") || null });
          if (!res.ok) { setErr(res.message); return; }
          toast(res.message, res.sub); setCreating(false); setErr(null);
        });
      }}>
        <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t.title}</span><input name="title" required minLength={3} maxLength={120} defaultValue={r?.title} className={field} placeholder={tk.titlePh} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t.type}</span><select name="kind" className={field} defaultValue={r?.kind ?? "call"}>{(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t.priority}</span><select name="priority" className={field} defaultValue={r?.priority ?? "normal"}><option value="high">{t.high}</option><option value="normal">{t.normal}</option><option value="low">{t.low}</option></select></label>
          <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t.date}</span><input name="date" type="date" required min={r ? undefined : today} defaultValue={dueD} className={field} /></label>
          <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t.timeIst}</span><input name="time" type="time" required defaultValue={r ? istHm(r.due) : "17:30"} className={field} /></label>
        </div>
        {!r && (
          <>
            <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{tk.leadOpt}</span>
              <select name="lead" className={field} defaultValue=""><option value="">{tk.noLead}</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
            {canAssignOthers && (
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t.assignee}</span>
                <select name="assignee" className={field} defaultValue={selfId}>{team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            )}
          </>
        )}
        {err && <p role="alert" className="text-[12px] text-danger">{err}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => (r ? setEditing(null) : setCreating(false))}>{t.cancel}</Button><Button variant="primary" disabled={pending}>{r ? t.saveTask : t.createTask}</Button></div>
      </form>
    );
  };

  return (
    <>
      {conflict && <div className="mb-3"><ConflictBanner title={t.conflictTitle} body={t.conflictBody} reload={t.conflictReload} onReload={() => setConflict(false)} /></div>}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-ink-2 num"><span className={groups.overdue.length ? "font-medium text-danger" : ""}>{groups.overdue.length} {t.groupOverdue.toLowerCase()}</span> · {groups.today.length} {t.groupToday.toLowerCase()} · {groups.week.length} {t.groupWeek.toLowerCase()}</p>
        <div className="flex gap-2">
          {sel.size > 0 && <Button size="sm" disabled={pending} onClick={() => complete([...sel])}><Check />{sub(t.completeN, { n: sel.size })}</Button>}
          <DisabledReason reason={editReason}>
            <Button size="sm" variant="primary" onClick={() => { setErr(null); setCreating(true); }}><Plus />{t.newTask}</Button>
          </DisabledReason>
        </div>
      </div>
      {!rows.length && <p className="mb-4 rounded-md border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-ink-3">{emptyHint}</p>}
      <Tabs defaultValue={defaultTab} tabs={[
        { value: "list", label: t.tabList, content: list },
        { value: "calendar", label: t.tabCalendar, content: <WeekCalendar rows={rows} now={now} weekOffset={weekOffset} holidays={holidays} canEdit={edit === "yes"} onMove={move} onOpen={(r) => { setErr(null); setResched(r); }} t={t} /> },
      ]} />

      <Dialog open={!!resched} onOpenChange={(o) => !o && setResched(null)}>
        {resched && (
          <DialogContent title={t.reschedule} description={`${resched.title} · ${label(resched.due)} IST`}>
            {edit !== "yes" ? <p className="text-[13px] text-ink-2">{label(resched.due)} IST{resched.lead ? ` · ${resched.lead.name}, ${resched.lead.firm}` : ""}. {resched.owner}.</p> : (
              <form className="space-y-3" onSubmit={(e) => {
                e.preventDefault(); const f = new FormData(e.currentTarget);
                const iso = istIso(String(f.get("date")), String(f.get("time")));
                if (iso < now) { setErr(t.passed); return; }
                const id = resched.id; setResched(null); move(id, iso);
              }}>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t.date}</span><input name="date" type="date" required min={today} defaultValue={dayKey(resched.due) < today ? today : dayKey(resched.due)} className={field} /></label>
                  <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t.timeIst}</span><input name="time" type="time" required defaultValue="10:00" className={field} /></label>
                </div>
                {err && <p role="alert" className="text-[12px] text-danger">{err}</p>}
                <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setResched(null)}>{t.cancel}</Button><Button variant="primary" disabled={pending}>{t.reschedule}</Button></div>
              </form>
            )}
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <DialogContent title={t.editTask} description={tk.newDesc}>{form(editing)}</DialogContent>}
      </Dialog>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title={t.newTask} description={tk.newDesc}>{form(null)}</DialogContent>
      </Dialog>
    </>
  );
}
