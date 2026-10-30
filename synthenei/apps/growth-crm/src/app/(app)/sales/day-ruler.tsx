// My day device: a horizontal day ruler, 08:00 to 20:00 IST. Hours outside business hours are shaded, a holiday shades the
// whole ruler, and each timed task today is a tick on it. The same facts are listed below as text (the ruler is not the only carrier).
import { dayKey, fmtDate, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Holiday } from "@/lib/data/types";

const START = 8, END = 20, BIZ_START = 10, BIZ_END = 18;
const istMin = (iso: string) => { const d = new Date(new Date(iso).getTime() + 5.5 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const pct = (min: number) => `${(Math.max(START * 60, Math.min(END * 60, min)) - START * 60) / ((END - START) * 60) * 100}%`;

export function DayRuler({ now, tasks, holidays, t }: {
  now: string; tasks: { id: string; title: string; dueAt: string }[]; holidays: Holiday[]; t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const today = dayKey(now);
  const hol = holidays.find((h) => h.date === today);
  const next = holidays.filter((h) => h.date > today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const todays = tasks.filter((x) => dayKey(x.dueAt) === today).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const nowMin = istMin(now);
  return (
    <section aria-label={t("rulerTitle")} data-testid="day-ruler" className="rounded-control border border-line bg-surface p-4">
      <h2 className="text-[15px] font-bold tracking-tight text-ink">{t("rulerTitle")}</h2>
      <p className="mb-3 text-[12px] text-ink-3">{t("rulerSub")}</p>
      <div className="relative h-10 overflow-hidden rounded-bar border border-line bg-surface" role="img"
        aria-label={`${t("calBusinessHours")} ${BIZ_START}:00 to ${BIZ_END}:00${hol ? `, ${t("rulerHoliday", { name: hol.name })}` : ""}`}>
        <div className="absolute inset-y-0 left-0 bg-paper-2" style={{ width: pct(BIZ_START * 60) }} />
        <div className="absolute inset-y-0 right-0 bg-paper-2" style={{ width: `calc(100% - ${pct(BIZ_END * 60)})` }} />
        {hol && <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,var(--paper-2)_0_6px,transparent_6px_12px)]" />}
        {Array.from({ length: END - START + 1 }, (_, i) => <div key={i} className="absolute inset-y-0 border-l border-line/70" style={{ left: pct((START + i) * 60) }} />)}
        {nowMin >= START * 60 && nowMin <= END * 60 && <div className="absolute inset-y-0 border-l-2 border-danger" style={{ left: pct(nowMin) }} />}
        {todays.map((x) => <div key={x.id} className="absolute bottom-1 top-1 w-1 rounded-bar bg-navy-900" style={{ left: pct(istMin(x.dueAt)) }} title={`${fmtTime(x.dueAt)} ${x.title}`} />)}
      </div>
      <div className="mt-1 flex justify-between text-[12px] text-ink-3 num" aria-hidden><span>08:00</span><span>{BIZ_START}:00</span><span>{BIZ_END}:00</span><span>20:00</span></div>
      <ul className="mt-3 space-y-1 text-[13px]">
        {hol && <li className={cn("font-medium text-ink")}>{t("rulerHoliday", { name: hol.name })}</li>}
        {todays.map((x) => <li key={x.id} className="flex gap-2"><span className="w-16 shrink-0 text-ink-2 num">{fmtTime(x.dueAt)}</span><span className="truncate text-ink">{x.title}</span></li>)}
        {!todays.length && <li className="text-ink-3">{t("rulerNoTasks")}</li>}
        {next && <li className="text-[12px] text-ink-3">{t("rulerNextHoliday", { name: next.name, date: fmtDate(next.date + "T06:00:00Z") })}</li>}
      </ul>
    </section>
  );
}
