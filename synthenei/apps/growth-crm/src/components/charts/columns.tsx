"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FMT, type Fmt, ChartFrame, Legend, TooltipBox, axisProps, useChartAnim } from "./kit";

export type ColSeries = { key: string; label: string; color: string };
/** Vertical columns for time buckets; stacked when more than one series (2px surface gap between segments). */
export function Columns({ data, series, xKey, label, height = 220, format: fKey = "num", totalLabel = true }: {
  data: Record<string, number | string>[]; series: ColSeries[]; xKey: string; label: string; height?: number; format?: Fmt; totalLabel?: boolean;
}) {
  const anim = useChartAnim();
  const format = FMT[fKey];
  const top = series[series.length - 1].key;
  return (
    <div>
      {series.length > 1 && <Legend className="mb-3" items={series.map((s) => ({ label: s.label, color: s.color }))} />}
      <ChartFrame label={label} height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 4, bottom: 0, left: -16 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey={xKey} {...axisProps} interval={0} tick={{ fontSize: 11, fill: "var(--ink-3)" }} />
            <YAxis {...axisProps} width={40} tickFormatter={format} allowDecimals={false} />
            <Tooltip cursor={{ fill: "var(--paper-2)" }} content={({ active, payload, label: l }) => active && payload?.length ? (
              <TooltipBox title={l} rows={[...series].reverse().map((s) => ({ name: s.label, color: s.color, value: format(Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0)) }))} />
            ) : null} />
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} stroke="var(--surface)" strokeWidth={series.length > 1 ? 1 : 0} maxBarSize={24}
                radius={s.key === top ? [4, 4, 0, 0] : [0, 0, 0, 0]} {...anim}
                label={totalLabel && s.key === top ? ((p: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => {
                  const row = data[p.index ?? 0]; const tot = series.reduce((a, x) => a + Number(row[x.key] ?? 0), 0);
                  return tot ? <text x={Number(p.x) + Number(p.width) / 2} y={Number(p.y) - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--ink-2)">{format(tot)}</text> : <g />;
                }) as never : undefined} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
