"use client";
// Client halves of the home dashboard: every chart sits in ChartWithTable so the same numbers are available as a real table.
// Strings arrive as props (resolved on the server), numbers arrive as plain data.
import { ChartWithTable, type ChartTableLabels, type TableColumn, type TableRow } from "@/components/charts/chart-table";
import { MonthRuler, type RulerLabels, type RulerPoint } from "@/components/charts/month-ruler";
import { PairedTrend, type PairedPoint } from "@/components/charts/paired-trend";
import { LineTrend } from "@/components/charts/line-trend";
import { Donut } from "@/components/charts/donut";
import { Funnel } from "@/components/charts/funnel";
import { HBar, type HBarRow } from "@/components/charts/hbar";

export function RulerChart({ points, today, aria, caption, dayHeader, labels, tableLabels }: {
  points: RulerPoint[]; today: number; aria: string; caption: string; dayHeader: string; labels: RulerLabels; tableLabels: ChartTableLabels;
}) {
  const cols: TableColumn[] = [
    { key: "day", header: dayHeader }, { key: "actual", header: labels.actual, format: "inrCompact" },
    { key: "forecast", header: labels.forecast, format: "inrCompact" }, { key: "pace", header: labels.pace, format: "inrCompact" },
  ];
  const rows: TableRow[] = points.map((p) => ({ ...p, day: String(p.day) }));
  return (
    <ChartWithTable caption={caption} columns={cols} rows={rows} labels={tableLabels}>
      <MonthRuler data={points} today={today} label={aria} labels={labels} />
    </ChartWithTable>
  );
}

export function PairedChart({ data, aLabel, bLabel, aria, caption, weekHeader, tableLabels }: {
  data: PairedPoint[]; aLabel: string; bLabel: string; aria: string; caption: string; weekHeader: string; tableLabels: ChartTableLabels;
}) {
  const cols: TableColumn[] = [{ key: "week", header: weekHeader }, { key: "a", header: aLabel, format: "num" }, { key: "b", header: bLabel, format: "num" }];
  return (
    <ChartWithTable caption={caption} columns={cols} rows={data.map((d) => ({ ...d }))} labels={tableLabels}>
      <PairedTrend data={data} aLabel={aLabel} bLabel={bLabel} noData={tableLabels.noData} label={aria} />
    </ChartWithTable>
  );
}

export function PerDayChart({ data, aria, caption, labels, dateHeader, tableLabels }: {
  data: { date: string; leads: number; avg: number }[]; aria: string; caption: string; labels: { bar: string; avg: string }; dateHeader: string; tableLabels: ChartTableLabels;
}) {
  const cols: TableColumn[] = [{ key: "date", header: dateHeader }, { key: "leads", header: labels.bar, format: "num" }, { key: "avg", header: labels.avg }];
  return (
    <ChartWithTable caption={caption} columns={cols} rows={data} labels={tableLabels}>
      <LineTrend label={aria} height={220} yFormat="num" data={data}
        series={[{ key: "leads", label: labels.bar, color: "var(--seq-1)", bar: true }, { key: "avg", label: labels.avg, color: "var(--chart-1)" }]} />
    </ChartWithTable>
  );
}

export function MixChart({ data, aria, caption, center, header, countHeader, tableLabels }: {
  data: { key: string; label: string; n: number }[]; aria: string; caption: string; center: { value: string; label: string }; header: string; countHeader: string; tableLabels: ChartTableLabels;
}) {
  return (
    <ChartWithTable caption={caption} columns={[{ key: "label", header }, { key: "n", header: countHeader, format: "num" }]} rows={data} labels={tableLabels}>
      <Donut label={aria} data={data} centerValue={center.value} centerLabel={center.label} />
    </ChartWithTable>
  );
}

export function FunnelChart({ steps, caption, headers, tableLabels }: {
  steps: { key: string; label: string; n: number; step: number; cum: number }[]; caption: string; headers: { step: string; count: string; rate: string }; tableLabels: ChartTableLabels;
}) {
  const rows: TableRow[] = steps.map((s) => ({ label: s.label, n: s.n, rate: Number.isFinite(s.step) ? s.step : null }));
  return (
    <ChartWithTable caption={caption} columns={[{ key: "label", header: headers.step }, { key: "n", header: headers.count, format: "num" }, { key: "rate", header: headers.rate, format: "pct0" }]} rows={rows} labels={tableLabels}>
      <Funnel steps={steps} mutedSteps={0} note={null} lowN={0} />
    </ChartWithTable>
  );
}

export function CostChart({ data, aria, caption, headers, valueLabel, tableLabels }: {
  data: HBarRow[]; aria: string; caption: string; headers: { campaign: string; cost: string }; valueLabel: string; tableLabels: ChartTableLabels;
}) {
  return (
    <ChartWithTable caption={caption} columns={[{ key: "label", header: headers.campaign }, { key: "value", header: headers.cost, format: "inr" }]} rows={data} labels={tableLabels}>
      <HBar label={aria} data={data} format="inr" highlight={data[0]?.label} labelWidth={150} valueLabel={valueLabel} />
    </ChartWithTable>
  );
}
