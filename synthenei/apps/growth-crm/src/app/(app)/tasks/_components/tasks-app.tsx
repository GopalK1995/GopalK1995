"use client";
// /tasks: list grouped Overdue / Today / This week / Later, and a Mon-Sat week calendar (spec 5).
// Complete, snooze, reschedule, reassign and create all go through server actions; this keeps an optimistic copy.
import Link from "next/link";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { AlarmClock, Check, Plus, UserRoundCheck } from "lucide-react";
import { dayKey, fmtDate, fmtTime, fmtWeekday } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/dropdown";
import { Tabs } from "@/components/ui/tabs";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { completeTasks, createTask, reassignTask, rescheduleTask } from "../actions";
import { field } from "../../leads/_lib/sales";
import { KIND_ICON, KIND_LABEL, istIso, snoozeTargets, useTaskPerm, type TaskRow } from "./shared";
import { WeekCalendar, type Holiday } from "./week-calendar";

const DAY = 86400e3;
type Group = "overdue" | "today" | "week" | "later";
const GROUP_LABEL: Record<Group, string> = { overdue: "Overdue", today: "Today", week: "This week", later: "Later" };

function Disabled({ children }: { children: ReactNode }) {
  return <Tip content="Not available in a read-only support session"><span tabIndex={0} className="inline-flex">{children}</span></Tip>;
}

export function TasksApp({ rows: initial, now, team, leads, weekOffset, holidays, defaultTab, emptyHint }: {
  rows: TaskRow[]; now: string; team: { id: string; name: string }[]; leads: { id: string; label: string }[];
  weekOffset: number; holidays: Holiday[]; defaultTab: "list" | "calendar"; emptyHint: string;
}) {
  const [rows, setRows] = useState(initial);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [resched, setResched] = useState<TaskRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { edit, reassign } = useTaskPerm();
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
  const snooze = snoozeTargets(now);
  const label = (iso: string) => `${fmtWeekday(iso)} ${fmtDate(iso)}, ${fmtTime(iso)}`;

  const complete = (ids: string[]) => {
    const before = rows;
    setRows((xs) => xs.filter((x) => !ids.includes(x.id))); setSel(new Set());
    start(async () => { const r = await completeTasks(ids); if (!r.ok) setRows(before); toast(r.message, r.ok ? r.sub : "Nothing was changed."); });
  };
  const move = (id: string, iso: string) => {
    const before = rows;
    setRows((xs) => xs.map((x) => (x.id === id ? { ...x, due: iso } : x)));
    start(async () => { const r = await rescheduleTask(id, iso, label(iso)); if (!r.ok) setRows(before); toast(r.message, r.ok ? r.sub : "The task kept its old time."); });
  };
  const reassignTo = (id: string, m: { id: string; name: string }) => {
    const before = rows;
    setRows((xs) => xs.map((x) => (x.id === id ? { ...x, ownerId: m.id, owner: m.name } : x)));
    start(async () => { const r = await reassignTask(id, m.id); if (!r.ok) setRows(before); toast(r.message, r.sub); });
  };

  const rowView = (r: TaskRow, g: Group) => {
    const I = KIND_ICON[r.kind];
    return (
      <li key={r.id} className={cn("grid grid-cols-[auto_32px_1fr_auto] items-center gap-3 px-4 py-2.5 sm:px-5", sel.has(r.id) && "bg-accent-soft/40")}>
        {edit === "yes"
          ? <input type="checkbox" aria-label={`Select ${r.title}`} checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} className="size-4 accent-[var(--accent)]" />
          : <span className="w-4" aria-hidden />}
        <span className={cn("grid size-8 place-items-center rounded-sm border", g === "overdue" ? "border-danger/30 bg-danger-soft text-danger" : r.kind === "demo" ? "border-navy-900 bg-navy-900 text-navy-ink" : "border-line bg-paper text-ink-2")} title={KIND_LABEL[r.kind]}>
          <I className="size-4" aria-hidden /><span className="sr-only">{KIND_LABEL[r.kind]}</span>
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-ink">{r.title}</span>
            {r.priority === "high" && r.kind !== "demo" && <Badge tone="warn">High</Badge>}{r.priority === "low" && <span className="text-[11px] text-ink-3">Low</span>}
          </div>
          <div className="truncate text-[12px] text-ink-3">
            {r.lead ? <Link href={`/leads/${r.lead.id}`} className="hover:text-accent">{r.lead.name}, {r.lead.firm}</Link> : "No lead"}
            <span className="hidden sm:inline"> · {r.owner}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className={cn("mr-1 text-right text-[12px] num", g === "overdue" ? "font-medium text-danger" : "text-ink-2")}>
            {g === "overdue" ? `${Math.max(1, Math.ceil((nowMs - new Date(r.due).getTime()) / DAY))}d late` : g === "today" ? fmtTime(r.due) : `${fmtWeekday(r.due)} ${fmtDate(r.due)}`}
            <span className="hidden text-ink-3 sm:block">{g === "overdue" || g === "today" ? fmtDate(r.due) : fmtTime(r.due)}</span>
          </span>
          {edit === "yes" && (
            <>
              <Button size="icon" variant="ghost" aria-label={`Mark done: ${r.title}`} title="Mark done" onClick={() => complete([r.id])} className="size-11 sm:size-8"><Check /></Button>
              <Menu>
                <MenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`Snooze or reschedule: ${r.title}`} title="Snooze" className="size-11 sm:size-8"><AlarmClock /></Button></MenuTrigger>
                <MenuContent>
                  <MenuLabel>Snooze</MenuLabel>
                  {snooze.map((s) => <MenuItem key={s.key} onSelect={() => move(r.id, s.iso)}>{s.label}</MenuItem>)}
                  <MenuItem onSelect={() => { setErr(null); setResched(r); }}>Pick date and time…</MenuItem>
                  {reassign && <><MenuLabel>Reassign</MenuLabel>{team.filter((m) => m.id !== r.ownerId).map((m) => <MenuItem key={m.id} onSelect={() => reassignTo(r.id, m)}><UserRoundCheck />{m.name}</MenuItem>)}</>}
                </MenuContent>
              </Menu>
            </>
          )}
          {edit === "support" && <Disabled><Button size="icon" variant="ghost" disabled aria-label="Mark done"><Check /></Button></Disabled>}
        </div>
      </li>
    );
  };

  const list = (
    <div className="space-y-4">
      {(Object.keys(GROUP_LABEL) as Group[]).map((g) => (
        <Card key={g}>
          <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <h2 className={cn("text-[14px] font-semibold", g === "overdue" && groups.overdue.length ? "text-danger" : "text-ink")}>{GROUP_LABEL[g]}</h2>
            <span className="text-[12px] text-ink-3 num">{groups[g].length}</span>
          </header>
          {groups[g].length ? <ul className="divide-y divide-line border-t border-line">{groups[g].map((r) => rowView(r, g))}</ul>
            : <p className="border-t border-line px-4 py-4 text-[13px] text-ink-3 sm:px-5">{g === "overdue" ? "Nothing overdue." : g === "today" ? "Nothing else due today." : g === "week" ? "Nothing more this week." : "Nothing scheduled beyond this week."}</p>}
        </Card>
      ))}
    </div>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-ink-2 num"><span className={groups.overdue.length ? "font-medium text-danger" : ""}>{groups.overdue.length} overdue</span> · {groups.today.length} today · {groups.week.length} later this week</p>
        <div className="flex gap-2">
          {sel.size > 0 && <Button size="sm" disabled={pending} onClick={() => complete([...sel])}><Check />Complete {sel.size}</Button>}
          {edit === "yes" && <Button size="sm" variant="primary" onClick={() => { setErr(null); setCreating(true); }}><Plus />New task</Button>}
          {edit === "support" && <Disabled><Button size="sm" variant="primary" disabled><Plus />New task</Button></Disabled>}
        </div>
      </div>
      {!rows.length && <p className="mb-4 rounded-md border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-ink-3">{emptyHint}</p>}
      <Tabs defaultValue={defaultTab} tabs={[
        { value: "list", label: "List", content: list },
        { value: "calendar", label: "Week calendar", content: <WeekCalendar rows={rows} now={now} weekOffset={weekOffset} holidays={holidays} canEdit={edit === "yes"} onMove={move} onOpen={(r) => { setErr(null); setResched(r); }} /> },
      ]} />

      <Dialog open={!!resched} onOpenChange={(o) => !o && setResched(null)}>
        {resched && (
          <DialogContent title="Reschedule" description={`${resched.title} · now ${label(resched.due)} IST`}>
            {edit !== "yes" ? <p className="text-[13px] text-ink-2">Due {label(resched.due)} IST{resched.lead ? ` · ${resched.lead.name}, ${resched.lead.firm}` : ""}. Owner: {resched.owner}.</p> : (
              <form className="space-y-3" onSubmit={(e) => {
                e.preventDefault(); const f = new FormData(e.currentTarget);
                const iso = istIso(String(f.get("date")), String(f.get("time")));
                if (iso < now) { setErr("That time has already passed."); return; }
                const id = resched.id; setResched(null); move(id, iso);
              }}>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Date</span><input name="date" type="date" required min={today} defaultValue={dayKey(resched.due) < today ? today : dayKey(resched.due)} className={field} /></label>
                  <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Time (IST)</span><input name="time" type="time" required defaultValue="10:00" className={field} /></label>
                </div>
                {err && <p role="alert" className="text-[12px] text-danger">{err}</p>}
                <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setResched(null)}>Cancel</Button><Button variant="primary" disabled={pending}>Reschedule</Button></div>
              </form>
            )}
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New task" description="Times in IST. Tasks with a lead show on that lead's page.">
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault(); const f = new FormData(e.currentTarget);
            const input = { title: String(f.get("title")), kind: String(f.get("kind")), due: istIso(String(f.get("date")), String(f.get("time"))), leadId: String(f.get("lead") ?? ""), priority: String(f.get("priority")) };
            start(async () => {
              const r = await createTask(input);
              if (!r.ok) { setErr(r.message); return; }
              toast(r.message, r.sub); setCreating(false);
            });
          }}>
            <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Title</span><input name="title" required minLength={3} maxLength={120} className={field} placeholder="e.g. Call partner after court: confirm Saturday demo" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Type</span><select name="kind" className={field} defaultValue="call">{(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Priority</span><select name="priority" className={field} defaultValue="normal"><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Date</span><input name="date" type="date" required min={today} defaultValue={dayKey(new Date(nowMs + DAY).toISOString())} className={field} /></label>
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Time (IST)</span><input name="time" type="time" required defaultValue="17:30" className={field} /></label>
            </div>
            <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Lead (optional)</span>
              <select name="lead" className={field} defaultValue=""><option value="">No lead</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
            {err && <p role="alert" className="text-[12px] text-danger">{err}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" disabled={pending}>Create task</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
