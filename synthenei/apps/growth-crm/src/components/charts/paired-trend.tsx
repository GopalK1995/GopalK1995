"use client";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormatLocale } from "@/lib/use-formatters";
import { useFmt, type Fmt, ChartFrame, Legend, TooltipBox, axisProps, useChartAnim } from "./kit";
import { cell } from "./chart-table";

export interface PairedPoint { week: string; a: number | null; b: number | null }
/** Two series on one axis (paid vs organic reach per week). A week with no reading is a gap in the line and "No data" in the tooltip. */
export function PairedTrend({ data, aLabel, bLabel, noData, label, format = "numCompact", height = 200 }: {
  data: PairedPoint[]; aLabel: string; bLabel: string; noData: string; label: string; format?: Fmt; height?: number;
}) {
  const anim = useChartAnim();
  const f = useFmt(format);
  const loc = useFormatLocale();
  const series = [{ key: "a" as const, name: aLabel, color: "var(--chart-1)", dash: false }, { key: "b" as const, name: bLabel, color: "var(--chart-3)", dash: true }];
  return (
    <div>
      <Legend className="mb-3" items={series.map((s) => ({ label: s.name, color: s.color, shape: s.dash ? "dash" : "line" }))} />
      <ChartFrame label={label} height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="week" {...axisProps} interval="preserveStartEnd" minTickGap={28} />
            <YAxis {...axisProps} width={44} tickFormatter={f} allowDecimals={false} />
            <Tooltip cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as PairedPoint;
              return <TooltipBox title={row.week} rows={series.map((s) => ({ name: s.name, color: s.color, dash: true, value: cell(row[s.key], format, noData, loc) }))} />;
            }} />
            {series.map((s) => (
              <Line key={s.key} dataKey={s.key} name={s.name} type="monotone" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash ? "5 4" : undefined}
                dot={{ r: 2, fill: s.color, stroke: "none" }} connectNulls={false} {...anim} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
