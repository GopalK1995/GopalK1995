"use client";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FMT, type Fmt, ChartFrame, Legend, TooltipBox, axisProps, useChartAnim } from "./kit";
import { fmtDate } from "@/lib/format";

export type LineSeries = { key: string; label: string; color: string; dashed?: boolean; area?: boolean; bar?: boolean };
/** Trend line(s) over dates. One y-axis only; series of different units go in separate charts. */
export function LineTrend({ data, series, height = 240, label, yFormat: yKey = "num", xKey = "date", legend = true, endLabel = true }: {
  data: Record<string, number | string>[]; series: LineSeries[]; height?: number; label: string; yFormat?: Fmt; xKey?: string; legend?: boolean; endLabel?: boolean;
}) {
  const anim = useChartAnim();
  const yFormat = FMT[yKey];
  const tickEvery = Math.max(1, Math.ceil(data.length / 6));
  return (
    <div>
      {legend && series.length > 1 && <Legend className="mb-3" items={series.map((s) => ({ label: s.label, color: s.color, shape: s.bar ? "dot" : s.dashed ? "dash" : "line" }))} />}
      <ChartFrame label={label} height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: endLabel ? 36 : 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey={xKey} {...axisProps} interval="preserveStartEnd" minTickGap={40} tickFormatter={(v: string) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? fmtDate(v + "T06:00:00Z") : v)} />
            <YAxis {...axisProps} width={44} tickFormatter={yFormat} allowDecimals={false} />
            <Tooltip cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }} content={({ active, payload, label: l }) => active && payload?.length ? (
              <TooltipBox title={typeof l === "string" && /^\d{4}-/.test(l) ? fmtDate(l + "T06:00:00Z") : l} rows={series.map((s) => ({ name: s.label, color: s.color, dash: true, value: yFormat(Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0)) }))} />
            ) : null} />
            {series.filter((s) => s.area).map((s) => <Area key={s.key + "-a"} dataKey={s.key} type="monotone" fill={s.color} fillOpacity={0.08} stroke="none" {...anim} tooltipType="none" />)}
            {series.filter((s) => s.bar).map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} maxBarSize={6} radius={[2, 2, 0, 0]} {...anim} />)}
            {series.filter((s) => !s.bar).map((s) => (
              <Line key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} dot={false}
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} {...anim}
                label={endLabel ? ((p: { index?: number; x?: number | string; y?: number | string; value?: number | string }) => p.index === data.length - 1 ? <text x={Number(p.x) + 6} y={Number(p.y) + 4} fontSize={11} fontWeight={600} fill="var(--ink-2)" className="num">{yFormat(Number(p.value))}</text> : <g />) as never : undefined} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
