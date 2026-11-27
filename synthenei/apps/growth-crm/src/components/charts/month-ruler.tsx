"use client";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormatLocale } from "@/lib/use-formatters";
import { useFmt, type Fmt, ChartFrame, Legend, TooltipBox, axisProps, useChartAnim } from "./kit";
import { cell } from "./chart-table";

export interface RulerPoint { day: number; actual: number | null; pace: number | null; forecast: number | null }
export interface RulerLabels { actual: string; pace: string; forecast: string; today: string; noData: string; day: string }

/**
 * The home page's organising device: the month as a ruler (one tick per day). Cumulative won value against the straight-line
 * target pace, plus the forecast (won so far + weighted open pipeline by expected close). Missing values are gaps, never zero.
 * Direct line labels at the right edge; the legend repeats them because slot 2 of the palette is below 3:1.
 */
export function MonthRuler({ data, today, label, labels, format = "inrCompact", height = 232 }: {
  data: RulerPoint[]; today: number; label: string; labels: RulerLabels; format?: Fmt; height?: number;
}) {
  const anim = useChartAnim();
  const f = useFmt(format);
  const loc = useFormatLocale();
  const series = [
    { key: "actual" as const, name: labels.actual, color: "var(--chart-1)", dash: undefined },
    { key: "forecast" as const, name: labels.forecast, color: "var(--chart-2)", dash: "5 4" },
    { key: "pace" as const, name: labels.pace, color: "var(--ink-3)", dash: "2 3" },
  ];
  return (
    <div>
      <Legend className="mb-3" items={series.map((s) => ({ label: s.name, color: s.color, shape: s.dash ? "dash" : "line" }))} />
      <ChartFrame label={label} height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
            <YAxis {...axisProps} width={52} tickFormatter={f} />
            <ReferenceLine x={today} stroke="var(--ink)" strokeWidth={1} label={{ value: labels.today, position: "insideTopLeft", fontSize: 12, fill: "var(--ink-2)" }} />
            <Tooltip cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as RulerPoint;
              return <TooltipBox title={`${labels.day} ${row.day}`} rows={series.map((s) => ({ name: s.name, color: s.color, dash: !!s.dash, value: cell(row[s.key], format, labels.noData, loc) }))} />;
            }} />
            {series.map((s) => (
              <Line key={s.key} dataKey={s.key} name={s.name} type="stepAfter" stroke={s.color} strokeWidth={s.key === "actual" ? 2 : 1.5} strokeDasharray={s.dash}
                dot={false} connectNulls={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} {...anim} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
