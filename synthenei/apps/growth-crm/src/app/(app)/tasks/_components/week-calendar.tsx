"use client";
// Week view, 08:00-20:00 IST, Monday to Saturday (spec 5 /tasks). Demos and touches as blocks coloured by type,
// tenant holidays shaded. Drag a block to another day or time (30-minute snap) to reschedule; click or Enter opens
// the reschedule dialog, which is the keyboard and touch alternative. Mobile shows one day at a time.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef, useState, type PointerEvent as RPE } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayKey, fmtDate, fmtTime, fmtWeekday } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KIND_ICON, KIND_LABEL, istIso, type TaskRow } from "./shared";

export type { Holiday } from "@/lib/data/types";
import type { Holiday } from "@/lib/data/types";
const DAY = 86400e3, START = 8, END = 20, HOUR = 48, SNAP = 30;
const istMinutes = (iso: string) => { const d = new Date(new Date(iso).getTime() + 5.5 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const dur = (r: TaskRow) => (r.kind === "demo" ? 45 : 30);
const TONE: Record<TaskRow["kind"], string> = {
  demo: "bg-navy-900 text-navy-ink border-navy-900",
  call: "bg-accent-soft text-accent-strong border-accent/30",
  whatsapp: "bg-success-soft text-success border-success/25",
  email: "bg-surface text-ink-2 border-line-strong",
  follow_up: "bg-paper-2 text-ink-2 border-line-strong",
  proposal: "bg-warn-soft text-warn-ink border-warn/30",
};
const pad = (n: number) => String(n).padStart(2, "0");

/** Side-by-side lanes for overlapping blocks within one day. */
function lanes(rows: TaskRow[]) {
  const sorted = [...rows].sort((a, b) => a.due.localeCompare(b.due));
  const ends: number[] = []; const out = new Map<string, { lane: number; of: number }>();
  for (const r of sorted) {
    const s = istMinutes(r.due); let lane = ends.findIndex((e) => e <= s);
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = s + dur(r); out.set(r.id, { lane, of: 0 });
  }
  for (const v of out.values()) v.of = Math.max(1, ends.length);
  return out;
}

export function WeekCalendar({ rows, now, weekOffset, holidays, canEdit, onMove, onOpen }: {
  rows: TaskRow[]; now: string; weekOffset: number; holidays: Holiday[]; canEdit: boolean;
  onMove: (id: string, iso: string) => void; onOpen: (r: TaskRow) => void;
}) {
  const sp = useSearchParams(), path = usePathname();
  const today = dayKey(now);
  const dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7;
  const monday = new Date(new Date(today + "T12:00:00Z").getTime() + (weekOffset * 7 - dow) * DAY);
  const days = Array.from({ length: 6 }, (_, i) => new Date(monday.getTime() + i * DAY).toISOString().slice(0, 10));
  const [mDay, setMDay] = useState(days.includes(today) ? today : days[0]);
  const [drag, setDrag] = useState<null | { id: string; day: string; min: number }>(null);
  const start = useRef<{ id: string; x: number; y: number; grabMin: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const nowMin = istMinutes(now);
  const href = (w: number) => { const n = new URLSearchParams(sp.toString()); n.set("tab", "calendar"); if (w) n.set("week", String(w)); else n.delete("week"); return `${path}?${n}`; };
  const weekRows = rows.filter((r) => days.includes(dayKey(r.due)));
  const outside = weekRows.filter((r) => { const m = istMinutes(r.due); return m < START * 60 || m >= END * 60; }).length;

  const targetAt = (x: number, y: number, grabMin: number) => {
    const col = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day]");
    if (!col?.dataset.day) return null;
    const r = col.getBoundingClientRect();
    const raw = START * 60 + ((y - r.top) / HOUR) * 60 - grabMin;
    const min = Math.max(START * 60, Math.min(END * 60 - SNAP, Math.round(raw / SNAP) * SNAP));
    return { day: col.dataset.day, min };
  };
  const onDown = (e: RPE<HTMLButtonElement>, r: TaskRow) => {
    if (!canEdit || e.button !== 0 || e.pointerType === "touch") return;
    const rect = e.currentTarget.getBoundingClientRect();
    start.current = { id: r.id, x: e.clientX, y: e.clientY, grabMin: ((e.clientY - rect.top) / HOUR) * 60, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMoveP = (e: RPE<HTMLButtonElement>) => {
    const s = start.current; if (!s) return;
    if (!s.moved && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6) return;
    s.moved = true;
    const t = targetAt(e.clientX, e.clientY, s.grabMin);
    if (t) setDrag({ id: s.id, ...t });
  };
  const onUp = (r: TaskRow) => {
    const s = start.current; const d = drag; start.current = null; setDrag(null);
    if (!s?.moved) return; // plain click falls through to onClick
    justDragged.current = true;
    if (!d) return;
    const iso = istIso(d.day, `${pad(Math.floor(d.min / 60))}:${pad(d.min % 60)}`);
    if (iso !== r.due) {
      if (iso < now) return;
      onMove(r.id, iso);
    }
  };

  const block = (r: TaskRow, pos: { lane: number; of: number } | undefined) => {
    const m = istMinutes(r.due), clamped = Math.max(START * 60, Math.min(END * 60 - SNAP, m));
    const I = KIND_ICON[r.kind];
    const late = r.due < now;
    return (
      <button key={r.id} type="button"
        onPointerDown={(e) => onDown(e, r)} onPointerMove={onMoveP} onPointerUp={() => onUp(r)}
        onClick={() => { if (justDragged.current) { justDragged.current = false; return; } onOpen(r); }}
        aria-label={`${KIND_LABEL[r.kind]}: ${r.title}, ${fmtWeekday(r.due)} ${fmtTime(r.due)}${late ? ", overdue" : ""}. ${canEdit ? "Press Enter to reschedule." : ""}`}
        className={cn("absolute overflow-hidden rounded-[4px] border px-1.5 py-1 text-left text-[11px] leading-4 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          TONE[r.kind], canEdit && "cursor-grab active:cursor-grabbing", late && "ring-1 ring-danger", drag?.id === r.id && "opacity-40")}
        style={{ top: ((clamped - START * 60) / 60) * HOUR + 1, height: Math.max(22, (dur(r) / 60) * HOUR - 2), left: `calc(${((pos?.lane ?? 0) / (pos?.of ?? 1)) * 100}% + 2px)`, width: `calc(${100 / (pos?.of ?? 1)}% - 4px)` }}>
        <span className="flex items-center gap-1 font-medium num"><I className="size-3 shrink-0" aria-hidden />{fmtTime(r.due)}</span>
        <span className="block truncate">{r.lead ? r.lead.firm : r.title}</span>
      </button>
    );
  };

  const column = (d: string, wide = false) => {
    const hol = holidays.find((h) => h.date === d);
    const dayRows = weekRows.filter((r) => dayKey(r.due) === d);
    const pos = lanes(dayRows);
    return (
      <div key={d} data-day={d} className={cn("relative border-l border-line", hol && "bg-[repeating-linear-gradient(135deg,var(--paper-2)_0_6px,transparent_6px_12px)]", d === today && "bg-accent-soft/30", wide && "border-l-0")} style={{ height: (END - START) * HOUR }}>
        {Array.from({ length: END - START }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * HOUR }} aria-hidden />)}
        {hol && <div className="absolute inset-x-1 top-1 z-10 rounded-[4px] bg-surface/90 px-1.5 py-0.5 text-[10px] font-medium text-ink-2">{hol.name}</div>}
        {d === today && nowMin >= START * 60 && nowMin < END * 60 && <div aria-hidden className="absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: ((nowMin - START * 60) / 60) * HOUR }} />}
        {dayRows.map((r) => block(r, pos.get(r.id)))}
        {drag?.day === d && (
          <div aria-hidden className="pointer-events-none absolute inset-x-1 z-20 rounded-[4px] border-2 border-dashed border-accent bg-accent-soft/60 px-1.5 text-[11px] font-medium text-accent-strong num"
            style={{ top: ((drag.min - START * 60) / 60) * HOUR, height: HOUR / 2 }}>{pad(Math.floor(drag.min / 60))}:{pad(drag.min % 60)}</div>
        )}
      </div>
    );
  };
  const gutter = (
    <div className="relative" style={{ height: (END - START) * HOUR }} aria-hidden>
      {Array.from({ length: END - START }, (_, i) => <span key={i} className="absolute right-2 -translate-y-1/2 text-[11px] text-ink-3 num" style={{ top: i * HOUR }}>{i ? `${pad(START + i)}:00` : ""}</span>)}
    </div>
  );
  const dayHead = (d: string) => {
    const hol = holidays.find((h) => h.date === d);
    return <div className={cn("px-2 py-2 text-[12px] font-medium", d === today ? "text-accent" : "text-ink-2")}>{fmtWeekday(d + "T06:00:00Z")} <span className="num">{Number(d.slice(8))}</span>{hol && <span className="sr-only">, holiday: {hol.name}</span>}</div>;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link href={href(weekOffset - 1)} scroll={false} aria-label="Previous week" className="grid size-9 place-items-center rounded-sm border border-line-strong bg-surface text-ink-2 hover:bg-paper-2"><ChevronLeft className="size-4" /></Link>
          <Link href={href(weekOffset + 1)} scroll={false} aria-label="Next week" className="grid size-9 place-items-center rounded-sm border border-line-strong bg-surface text-ink-2 hover:bg-paper-2"><ChevronRight className="size-4" /></Link>
          <span className="ml-2 text-[13px] font-medium text-ink num">{fmtDate(days[0] + "T06:00:00Z")} – {fmtDate(days[5] + "T06:00:00Z")}</span>
          {weekOffset !== 0 && <Link href={href(0)} scroll={false} className="ml-2 text-[12px] font-medium text-accent hover:underline">This week</Link>}
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3" aria-label="Legend">
          {(["demo", "call", "whatsapp", "proposal", "follow_up", "email"] as const).map((k) => (
            <li key={k} className="inline-flex items-center gap-1"><span className={cn("size-2.5 rounded-[2px] border", TONE[k])} aria-hidden />{KIND_LABEL[k]}</li>
          ))}
        </ul>
      </div>

      <div className="hidden rounded-md border border-line bg-surface md:block">
        <div className="grid grid-cols-[56px_repeat(6,minmax(0,1fr))] border-b border-line">{<div />}{days.map(dayHead)}</div>
        <div className="grid grid-cols-[56px_repeat(6,minmax(0,1fr))] pt-2">{gutter}{days.map((d) => column(d))}</div>
      </div>

      <div className="md:hidden">
        <div role="tablist" aria-label="Day" className="mb-3 grid grid-cols-6 gap-1">
          {days.map((d) => (
            <button key={d} type="button" role="tab" aria-selected={mDay === d} onClick={() => setMDay(d)}
              className={cn("flex h-12 flex-col items-center justify-center rounded-sm border text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mDay === d ? "border-navy-900 bg-navy-900 text-navy-ink" : "border-line-strong bg-surface text-ink-2", holidays.some((h) => h.date === d) && mDay !== d && "border-dashed")}>
              <span>{fmtWeekday(d + "T06:00:00Z")}</span><span className="text-[13px] font-semibold num">{Number(d.slice(8))}</span>
            </button>
          ))}
        </div>
        <div className="rounded-md border border-line bg-surface">
          <div className="grid grid-cols-[48px_minmax(0,1fr)] pt-2">{gutter}{column(mDay, true)}</div>
        </div>
      </div>

      <p className="mt-2 text-[12px] text-ink-3">
        {canEdit ? "Drag a block to move it (30-minute steps), or select it to pick a new time. " : ""}
        Hatched days are tenant holidays entered by the Owner.{outside ? ` ${outside} task${outside > 1 ? "s" : ""} fall outside 08:00–20:00 and are pinned to the edge.` : ""}
      </p>
    </div>
  );
}
