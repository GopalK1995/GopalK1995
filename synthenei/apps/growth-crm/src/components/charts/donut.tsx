"use client";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { FMT, type Fmt, ChartFrame, OTHER, SERIES, TooltipBox, useChartAnim } from "./kit";
import { pct } from "@/lib/format";

/** Share of a whole. Max 5 slices (callers fold the tail into "Other"). Legend doubles as the data table. */
export function Donut({ data, label, centerLabel, centerValue, format: fKey = "num", size = 168 }: {
  data: { key: string; label: string; n: number; color?: string }[]; label: string; centerLabel: string; centerValue: string; format?: Fmt; size?: number;
}) {
  useChartAnim();
  const format = FMT[fKey];
  const rows = data.slice(0, 5);
  const total = rows.reduce((a, r) => a + r.n, 0);
  /** Per-row colour wins (colour follows the entity); otherwise fixed slot order, Other = neutral. */
  const color = (r: { key: string; color?: string }, i: number) => r.color ?? (r.key === "other" ? OTHER : SERIES[i % SERIES.length]);
  return (
    <div className="@container"><div className="flex flex-col items-center gap-4 @[400px]:flex-row @[400px]:items-center">
      <div className="spin-in relative shrink-0" style={{ width: size, height: size }}>
        <ChartFrame label={label} height={size}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={rows} dataKey="n" nameKey="label" innerRadius="66%" outerRadius="100%" paddingAngle={1.5} stroke="var(--surface)" strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={false}>
                {rows.map((r, i) => <Cell key={r.key} fill={color(r, i)} />)}
              </Pie>
              <Tooltip content={({ active, payload }) => active && payload?.length ? (
                <TooltipBox rows={[{ name: String(payload[0].name), value: `${format(Number(payload[0].value))} · ${pct(Number(payload[0].value) / total, 0)}`, color: String(payload[0].payload.fill ?? "") }]} />
              ) : null} />
            </PieChart>
          </ResponsiveContainer>
        </ChartFrame>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div><div className="text-[20px] font-semibold leading-6 num text-ink">{centerValue}</div><div className="text-[11px] text-ink-3">{centerLabel}</div></div>
        </div>
      </div>
      <table className="w-full text-[12px]">
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className="border-b border-line last:border-0">
              <td className="py-1.5 pr-2"><span className="flex items-center gap-2 text-ink-2"><span className="inline-block size-2.5 rounded-[2px]" style={{ background: color(r, i) }} />{r.label}</span></td>
              <td className="py-1.5 text-right font-medium num text-ink">{format(r.n)}</td>
              <td className="w-12 py-1.5 text-right num text-ink-3">{pct(r.n / total, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div></div>
  );
}
