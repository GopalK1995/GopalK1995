"use client";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartFrame, Legend, TooltipBox, useChartAnim } from "./kit";

/** Campaign reach profile: 5 normalised axes (0–100, best campaign = 100), 2–3 overlays. Dashed outline on
 *  the comparison series so identity never relies on colour alone. */
export function RadarCompare({ data, series, label, height = 300 }: {
  data: Record<string, number | string>[]; series: { key: string; label: string; color: string; dashed?: boolean }[]; label: string; height?: number;
}) {
  const anim = useChartAnim();
  return (
    <div>
      <Legend className="mb-2" items={series.map((s) => ({ label: s.label, color: s.color, shape: s.dashed ? "dash" : "line" }))} />
      <ChartFrame label={label} height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} outerRadius="72%" margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
            <PolarGrid stroke="var(--chart-grid)" />
            <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "var(--ink-2)" }} />
            <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10, fill: "var(--ink-3)" }} tickCount={3} axisLine={false} />
            {series.map((s, i) => (
              <Radar key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined}
                fill={s.color} fillOpacity={i === 0 ? 0.14 : 0.04} dot={{ r: 3, fill: s.color, stroke: "var(--surface)", strokeWidth: 1.5 }} {...anim} />
            ))}
            <Tooltip content={({ active, payload, label: l }) => active && payload?.length ? (
              <TooltipBox title={l} rows={series.map((s) => ({ name: s.label, color: s.color, value: `${payload.find((p) => p.dataKey === s.key)?.value ?? 0} / 100` }))} />
            ) : null} />
          </RadarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
