import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChartWithTable, cell } from "../chart-table";
import { KpiLedger } from "@/components/ui/kpi";

afterEach(cleanup);
const columns = [{ key: "week", header: "Week ending" }, { key: "paid", header: "Paid", format: "num" as const }, { key: "organic", header: "Organic", format: "num" as const }];
const rows = [{ week: "7 Nov", paid: 1200, organic: null }, { week: "14 Nov", paid: null, organic: 340 }, { week: "21 Nov", paid: 0, organic: 0 }];

describe("ChartWithTable", () => {
  it("shows the chart first and swaps to a real table on toggle", () => {
    render(<ChartWithTable caption="Weekly reach" columns={columns} rows={rows}><div data-testid="the-chart" /></ChartWithTable>);
    expect(screen.getByTestId("the-chart")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    const chartBtn = screen.getByRole("button", { name: "Chart" }), tableBtn = screen.getByRole("button", { name: "Table" });
    expect(chartBtn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(tableBtn);
    expect(screen.queryByTestId("the-chart")).toBeNull();
    expect(tableBtn).toHaveAttribute("aria-pressed", "true");
    const table = screen.getByRole("table", { name: "Weekly reach" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Week ending", "Paid", "Organic"]);
    expect(within(table).getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["7 Nov", "14 Nov", "21 Nov"]);
  });
  it("renders a missing value as No data and a real zero as 0", () => {
    render(<ChartWithTable caption="c" columns={columns} rows={rows} defaultView="table"><div /></ChartWithTable>);
    const [, r1, r2, r3] = screen.getAllByRole("row");
    expect(within(r1).getAllByRole("cell").map((c) => c.textContent)).toEqual(["1,200", "No data"]);
    expect(within(r2).getAllByRole("cell").map((c) => c.textContent)).toEqual(["No data", "340"]);
    expect(within(r3).getAllByRole("cell").map((c) => c.textContent)).toEqual(["0", "0"]);
  });
  it("uses the supplied labels (localised) and goes back to the chart", () => {
    render(<ChartWithTable caption="c" columns={columns} rows={rows} labels={{ chart: "Graph", table: "Grid", toggle: "View", noData: "Nil" }} defaultView="table"><div data-testid="x" /></ChartWithTable>);
    expect(screen.getByRole("group", { name: "View" })).toBeInTheDocument();
    expect(screen.getAllByText("Nil")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    expect(screen.getByTestId("x")).toBeInTheDocument();
  });
});

describe("cell", () => {
  it("never turns null, undefined or NaN into 0", () => {
    for (const v of [null, undefined, NaN]) expect(cell(v, "num", "No data")).toBe("No data");
    expect(cell(0, "num", "No data")).toBe("0");
    expect(cell("x", "num", "No data")).toBe("x");
  });
});

describe("KpiLedger", () => {
  it("shows No data for a missing reading and the formatted value otherwise", () => {
    render(<KpiLedger label="Headline readings" tiles={[
      { id: "cost", label: "Cost per demo", value: null, format: "inr" },
      { id: "new", label: "New leads", value: 0, format: "num" },
      { id: "won", label: "Won", value: 250000, format: "inr", delta: 0.12 },
    ]} />);
    const tile = (id: string) => document.querySelector(`[data-tile="${id}"]`) as HTMLElement;
    expect(tile("cost")).toHaveTextContent("No data");
    expect(tile("cost")).not.toHaveTextContent("₹0");
    expect(tile("new")).toHaveTextContent("0");
    expect(tile("won")).toHaveTextContent("₹2,50,000");
    expect(tile("won")).toHaveTextContent("12.0%");
  });
});
