import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Kpi, KpiLedger, NO_PRIOR, deltaView } from "../kpi";
import { TargetBar } from "@/components/charts/target";

describe("deltaView", () => {
  it("no delta supplied gives nothing", () => { expect(deltaView(undefined)).toBeNull(); expect(deltaView(null)).toBeNull(); });
  it("non-finite (zero or missing baseline) gives No prior period and no direction", () => {
    for (const d of [NaN, Infinity, -Infinity]) expect(deltaView(d)).toEqual({ dir: 0, text: NO_PRIOR, word: "" });
  });
  it("real changes carry a direction word", () => {
    expect(deltaView(0.25)).toEqual({ dir: 1, text: "25.0%", word: "up" });
    expect(deltaView(-0.5)).toEqual({ dir: -1, text: "50.0%", word: "down" });
    expect(deltaView(0.001)?.dir).toBe(0);
  });
});

describe("Kpi rendering", () => {
  it("zero baseline renders No prior period, no 100% and no danger colour", () => {
    const html = renderToStaticMarkup(<Kpi label="Leads" value={0} delta={NaN} />);
    expect(html).toContain("No prior period");
    expect(html).not.toMatch(/100\.0%|text-danger|NaN/);
  });
  it("a real drop shows the percentage and an sr-only down", () => {
    const html = renderToStaticMarkup(<Kpi label="Leads" value={5} delta={-0.4} />);
    expect(html).toContain("40.0%"); expect(html).toContain("down");
  });
  it("missing value renders No data", () => { expect(renderToStaticMarkup(<Kpi label="x" value={NaN} />)).toContain("No data"); });
  it("ledger hides the delta on a missing baseline", () => {
    const html = renderToStaticMarkup(<KpiLedger label="k" tiles={[{ id: "a", label: "A", value: 0, format: "num", delta: NaN }]} />);
    expect(html).not.toMatch(/NaN|100\.0%/);
  });
});

describe("TargetBar", () => {
  it("zero target does not print NaN", () => {
    const html = renderToStaticMarkup(<TargetBar value={0} target={0} pace={0.4} label="Won" format="inr" />);
    expect(html).not.toMatch(/NaN/); expect(html).toContain("No target set");
  });
  it("NaN value and infinite target are safe", () => {
    expect(renderToStaticMarkup(<TargetBar value={NaN} target={100} pace={NaN} label="Won" format="num" />)).not.toMatch(/NaN/);
    expect(renderToStaticMarkup(<TargetBar value={5} target={Infinity} pace={0.2} label="Won" format="num" />)).not.toMatch(/NaN/);
  });
  it("normal case still reports attainment", () => {
    expect(renderToStaticMarkup(<TargetBar value={50} target={100} pace={0.4} label="Won" format="num" />)).toContain("50% achieved");
  });
});
