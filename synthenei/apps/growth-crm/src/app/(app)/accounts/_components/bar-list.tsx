// Plain CSS horizontal bars (server-rendered, so values show on first paint and in screenshots).
// Sorted by value; the top bar uses the accent, the rest recede; value at the tip with tabular numerals.
import { inrCompact, num } from "@/lib/format";

export function BarList({ rows, format, label }: { rows: { label: string; value: number; note?: string }[]; format: "inrCompact" | "num"; label: string }) {
  const f = format === "inrCompact" ? inrCompact : num;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.label} className="grid grid-cols-[96px_minmax(0,1fr)_56px] items-center gap-3 text-[12px] sm:grid-cols-[120px_minmax(0,1fr)_64px]" title={r.note}>
          <span className="truncate text-right text-ink-2">{r.label}</span>
          <span className="h-[18px] rounded-r-[4px] bg-paper-2/60">
            <span className={`block h-full rounded-r-[4px] ${i === 0 ? "bg-accent" : "bg-seq-2"}`} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </span>
          <span className="text-right font-semibold text-ink-2 num">{f(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}
