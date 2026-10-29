import { DataTableV2, type DataTableV2Column } from "@/components/ui/data-table-v2";

type Row = { id: string; name: string; value: number };
const rows: Row[] = [{ id: "1", name: "Bravo", value: 20 }, { id: "2", name: "Alpha", value: 5 }, { id: "3", name: "Charlie", value: 12 }];
const columns: DataTableV2Column<Row>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "value", header: "Value" },
];
const base = { columns, getRowId: (r: Row) => r.id, caption: "Test rows", numericColumns: ["value"] };

describe("DataTableV2", () => {
  it("renders 36px ledger rows and sorts by header with the keyboard", () => {
    cy.mount(<DataTableV2 {...base} data={rows} />);
    cy.get("tbody tr").first().invoke("outerHeight").should("eq", 36);
    cy.contains("th button", "Name").focus().type("{enter}");
    cy.contains("th", "Name").should("have.attr", "aria-sort", "ascending");
    cy.get("tbody tr").first().should("contain", "Alpha");
  });
  it("numeric cells are right aligned", () => {
    cy.mount(<DataTableV2 {...base} data={rows} />);
    cy.get("tbody td").eq(1).should("have.css", "text-align", "right");
  });
  it("row click is keyboard reachable", () => {
    const onRow = cy.stub().as("row");
    cy.mount(<DataTableV2 {...base} data={rows} onRowClick={onRow} />);
    cy.get("tbody tr").first().focus().type("{enter}");
    cy.get("@row").should("have.been.calledWith", rows[0]);
  });
  it("loading state", () => {
    cy.mount(<DataTableV2 {...base} data={[]} loading />);
    cy.get("[aria-busy=true]").should("exist");
  });
  it("empty state", () => {
    cy.mount(<DataTableV2 {...base} data={[]} empty={{ title: "No rows" }} />);
    cy.contains("No rows");
  });
  it("error state names the source", () => {
    cy.mount(<DataTableV2 {...base} data={rows} error={{ source: "leads", message: "Timed out" }} />);
    cy.get("[role=alert]").should("contain", "leads");
  });
});
