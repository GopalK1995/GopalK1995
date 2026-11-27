import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DataGrid, safeCount, type DataGridColumn } from "../data-grid";

type R = { id: string; name: string; score: number | null };
const data: R[] = [
  { id: "a", name: "Charlie", score: 30 },
  { id: "b", name: "alpha", score: 90 },
  { id: "c", name: "Bravo", score: null },
  { id: "d", name: "Delta", score: 10 },
];
const cols: DataGridColumn<R>[] = [
  { id: "name", header: "Name", rowHeader: true, alwaysVisible: true, cell: (r) => r.name, sortValue: (r) => r.name },
  { id: "score", header: "Score", align: "right", cell: (r) => r.score ?? "-", sortValue: (r) => r.score },
];
const names = () => screen.getAllByRole("rowheader").map((e) => e.textContent);

describe("DataGrid structure and a11y", () => {
  it("renders one real table with caption, column headers and a named, focusable scroll region", () => {
    render(<DataGrid rows={data} columns={cols} rowId={(r) => r.id} caption="Leads" />);
    expect(screen.getByRole("table", { name: "Leads" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    const region = screen.getByRole("region", { name: "Leads" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByRole("row")).toHaveLength(5); // header + 4, no duplicate card list
  });
  it("renders each row once in stacked mode and keeps table roles", () => {
    render(<DataGrid rows={data} columns={cols} rowId={(r) => r.id} caption="Leads" responsive="stack" />);
    expect(screen.getAllByRole("row")).toHaveLength(5);
    expect(screen.getAllByText("Charlie")).toHaveLength(1);
    expect(screen.getAllByRole("rowheader")[0]).toHaveAttribute("data-label", "Name");
  });
  it("shows the honest empty slot and no table", () => {
    render(<DataGrid rows={[]} columns={cols} rowId={(r) => r.id} caption="Leads" empty={{ title: "No leads match", body: "Clear the filters." }} />);
    expect(screen.getByText("No leads match")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("shows a loading skeleton and an error state", () => {
    const { rerender } = render(<DataGrid rows={data} columns={cols} rowId={(r) => r.id} caption="Leads" loading />);
    expect(screen.getByRole("status", { name: "Loading rows" })).toHaveAttribute("aria-busy", "true");
    rerender(<DataGrid rows={data} columns={cols} rowId={(r) => r.id} caption="Leads" error={{ source: "leads", message: "Boom" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Boom");
  });
});

describe("DataGrid sorting", () => {
  it("cycles asc, desc, none with aria-sort and puts empty values last", async () => {
    const u = userEvent.setup();
    render(<DataGrid rows={data} columns={cols} rowId={(r) => r.id} caption="Leads" />);
    const th = screen.getByRole("columnheader", { name: /Score/ });
    expect(th).toHaveAttribute("aria-sort", "none");
    await u.click(within(th).getByRole("button"));
    expect(th).toHaveAttribute("aria-sort", "ascending");
    expect(names()).toEqual(["Delta", "Charlie", "alpha", "Bravo"]);
    await u.click(within(th).getByRole("button"));
    expect(th).toHaveAttribute("aria-sort", "descending");
    expect(names()).toEqual(["alpha", "Charlie", "Delta", "Bravo"]);
    await u.click(within(th).getByRole("button"));
    expect(th).toHaveAttribute("aria-sort", "none");
    expect(names()).toEqual(["Charlie", "alpha", "Bravo", "Delta"]);
  });
  it("sorts text case-insensitively", async () => {
    const u = userEvent.setup();
    render(<DataGrid rows={data} columns={cols} rowId={(r) => r.id} caption="Leads" />);
    await u.click(within(screen.getByRole("columnheader", { name: /Name/ })).getByRole("button"));
    expect(names()).toEqual(["alpha", "Bravo", "Charlie", "Delta"]);
  });
  it("in server mode reports the click and does not reorder rows itself", async () => {
    const u = userEvent.setup();
    const onSortChange = vi.fn();
    render(<DataGrid rows={data} columns={cols} rowId={(r) => r.id} caption="Leads" sort={{ id: "score", dir: "asc" }} onSortChange={onSortChange} />);
    expect(screen.getByRole("columnheader", { name: /Score/ })).toHaveAttribute("aria-sort", "ascending");
    await u.click(within(screen.getByRole("columnheader", { name: /Score/ })).getByRole("button"));
    expect(onSortChange).toHaveBeenCalledWith("score", "desc");
    expect(names()).toEqual(["Charlie", "alpha", "Bravo", "Delta"]);
  });
});

describe("DataGrid selection", () => {
  it("selects rows, announces the count and drives select-all tri-state", async () => {
    const u = userEvent.setup();
    render(<DataGrid rows={data} columns={cols} rowId={(r) => r.id} rowLabel={(r) => r.name} caption="Leads" selectable />);
    const all = screen.getByRole("checkbox", { name: "Select all rows on this page" }) as HTMLInputElement;
    await u.click(screen.getByRole("checkbox", { name: "Select alpha" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 of 4 selected");
    expect(all.indeterminate).toBe(true);
    await u.click(all);
    expect(screen.getByRole("status")).toHaveTextContent("4 of 4 selected");
    expect(all.checked).toBe(true);
    await u.click(all);
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.queryAllByRole("row", { selected: true })).toHaveLength(0);
  });
  it("supports controlled selection and bulk actions", async () => {
    const u = userEvent.setup();
    const seen: string[][] = [];
    function Host() {
      const [s, setS] = useState<Set<string>>(new Set(["b"]));
      return <DataGrid rows={data} columns={cols} rowId={(r) => r.id} caption="Leads" rowLabel={(r) => r.name} selectable selected={s} onSelectedChange={setS} bulkActions={(ids) => { seen.push(ids); return <button type="button">Assign {ids.length}</button>; }} />;
    }
    render(<Host />);
    expect(screen.getByRole("button", { name: "Assign 1" })).toBeInTheDocument();
    await u.click(screen.getByRole("checkbox", { name: "Select Charlie" }));
    expect(screen.getByRole("button", { name: "Assign 2" })).toBeInTheDocument();
  });
});

describe("DataGrid pagination", () => {
  const many: R[] = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, name: `Row${i}`, score: i }));
  it("pages on the client with a correct summary and disabled edges", async () => {
    const u = userEvent.setup();
    render(<DataGrid rows={many} columns={cols} rowId={(r) => r.id} caption="Leads" pagination={{ mode: "client", pageSize: 3 }} />);
    expect(names()).toEqual(["Row0", "Row1", "Row2"]);
    expect(screen.getByText("1-3 of 7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Previous/ })).toBeDisabled();
    await u.click(screen.getByRole("button", { name: /Next/ }));
    await u.click(screen.getByRole("button", { name: /Next/ }));
    expect(names()).toEqual(["Row6"]);
    expect(screen.getByText("7-7 of 7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
  });
  it("clamps the page when rows shrink", () => {
    const { rerender } = render(<DataGrid rows={many} columns={cols} rowId={(r) => r.id} caption="Leads" pagination={{ mode: "client", pageSize: 3 }} />);
    rerender(<DataGrid rows={many.slice(0, 2)} columns={cols} rowId={(r) => r.id} caption="Leads" pagination={{ mode: "client", pageSize: 3 }} />);
    expect(screen.getByText("1-2 of 2")).toBeInTheDocument();
  });
  it("server mode calls onPageChange and never prints NaN for bad counts", async () => {
    const u = userEvent.setup();
    const onPageChange = vi.fn();
    const { rerender } = render(<DataGrid rows={many} columns={cols} rowId={(r) => r.id} caption="Leads" pagination={{ mode: "server", page: 2, pageSize: 3, total: 7, onPageChange }} />);
    expect(screen.getByText("4-6 of 7")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: /Next/ }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    rerender(<DataGrid rows={many} columns={cols} rowId={(r) => r.id} caption="Leads" pagination={{ mode: "server", page: NaN, pageSize: 3, total: undefined as unknown as number, onPageChange }} />);
    expect(screen.getByText("0-0 of 0")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
  it("keyset mode shows prev/next as links and no total", () => {
    render(<DataGrid rows={many} columns={cols} rowId={(r) => r.id} caption="Audit" pagination={{ mode: "keyset", hasPrev: true, hasNext: true, prevHref: "/a", nextHref: "/a?cursor=x" }} />);
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute("href", "/a?cursor=x");
    expect(screen.getByText("7 shown")).toBeInTheDocument();
  });
  it("safeCount never yields NaN or negatives", () => {
    expect([safeCount(NaN), safeCount(undefined), safeCount(-3), safeCount(4.9), safeCount(Infinity)]).toEqual([0, 0, 0, 4, 0]);
  });
});

describe("DataGrid column control, row actions and keyboard", () => {
  it("hides and shows columns from the chooser", async () => {
    const u = userEvent.setup();
    render(<DataGrid rows={data} columns={cols} rowId={(r) => r.id} caption="Leads" columnControl />);
    await u.click(screen.getByRole("button", { name: /Columns/ }));
    const box = screen.getByRole("checkbox", { name: "Score" });
    expect(screen.queryByRole("checkbox", { name: "Name" })).toBeNull(); // alwaysVisible
    await u.click(box);
    expect(screen.queryByRole("columnheader", { name: /Score/ })).toBeNull();
  });
  it("opens the row actions menu and runs an action", async () => {
    const u = userEvent.setup();
    const onSelect = vi.fn();
    render(<DataGrid rows={data} columns={cols} rowId={(r) => r.id} rowLabel={(r) => r.name} caption="Leads" rowActions={() => [{ key: "open", label: "Open lead", onSelect }]} />);
    await u.click(screen.getByRole("button", { name: "Actions for alpha" }));
    await u.click(await screen.findByRole("menuitem", { name: "Open lead" }));
    expect(onSelect).toHaveBeenCalledWith(data[1]);
  });
  it("moves focus between rows with arrow keys (roving tabindex) and activates on Enter", async () => {
    const u = userEvent.setup();
    const onRowActivate = vi.fn();
    render(<DataGrid rows={data} columns={cols} rowId={(r) => r.id} caption="Leads" onRowActivate={onRowActivate} />);
    const rows = () => screen.getAllByRole("row").slice(1);
    expect(rows().map((r) => r.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);
    rows()[0].focus();
    await u.keyboard("{ArrowDown}{ArrowDown}");
    expect(rows()[2]).toHaveFocus();
    expect(rows()[2]).toHaveAttribute("tabindex", "0");
    await u.keyboard("{End}");
    expect(rows()[3]).toHaveFocus();
    await u.keyboard("{Home}{Enter}");
    expect(onRowActivate).toHaveBeenCalledWith(data[0]);
  });
});
