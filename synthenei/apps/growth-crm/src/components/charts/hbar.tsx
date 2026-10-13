"use client";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FMT, type Fmt, ChartFrame, TooltipBox, axisProps, useChartAnim } from "./kit";

export type HBarRow = { label: string; value: number; color?: string; note?: string };
/** Horizontal bar for comparisons. Value at the tip; highlight one bar with the accent, the rest recede. */
export function HBar({ data, label, format: fKey = "num", height, highlight, color = "var(--chart-1)", muted = "var(--seq-2)", labelWidth = 128, valueLabel = "Value" }: {
  data: HBarRow[]; label: string; format?: Fmt; height?: number; highlight?: string | "all"; color?: string; muted?: string; labelWidth?: number; valueLabel?: string;
}) {
  const anim = useChartAnim();
  const format = FMT[fKey];
  const h = height ?? Math.max(120, data.length * 34 + 16);
  return (
    <ChartFrame label={label} height={h}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" {...axisProps} tickFormatter={format} hide />
          <YAxis type="category" dataKey="label" {...axisProps} width={labelWidth} tick={{ fontSize: 12, fill: "var(--ink-2)" }} interval={0} />
          <Tooltip cursor={{ fill: "var(--paper-2)" }} content={({ active, payload }) => active && payload?.length ? (
            <TooltipBox title={String(payload[0].payload.label)} rows={[{ name: valueLabel, value: format(Number(payload[0].value)) }, ...(payload[0].payload.note ? [{ name: "Note", value: payload[0].payload.note }] : [])]} />
          ) : null} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18} {...anim}>
            {data.map((d) => <Cell key={d.label} fill={d.color ?? (highlight === "all" || !highlight || d.label === highlight ? color : muted)} />)}
            <LabelList dataKey="value" position="right" formatter={(v: unknown) => format(Number(v))} style={{ fontSize: 11, fill: "var(--ink-2)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
