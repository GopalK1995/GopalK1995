import { Chip, LiveStatusChip } from "@/components/ui/chip";
import { EmptyState, ErrorState, PartialState } from "@/components/ui/states";
import { Skeleton, SkeletonChart, SkeletonRows } from "@/components/ui/skeleton";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";

describe("Chip and StatusChip", () => {
  it("uses the chip radius and pairs state with icon and word", () => {
    cy.mount(<><Chip tone="danger">Overdue</Chip><LiveStatusChip status="stale" /></>);
    cy.contains("span", "Overdue").should("have.css", "border-top-left-radius", "4px");
    cy.get("[data-status=stale]").should("contain", "Stale").find("svg").should("exist");
  });
  it("renders live, stale and offline", () => {
    cy.mount(<><LiveStatusChip status="live" /><LiveStatusChip status="stale" /><LiveStatusChip status="offline" /></>);
    cy.get("[data-status]").should("have.length", 3);
  });
});

describe("State blocks", () => {
  it("EmptyState shows title, body and action", () => {
    cy.mount(<EmptyState title="No leads yet" body="Import a CSV or connect a form." action={<Button>Import</Button>} />);
    cy.contains("No leads yet");
    cy.contains("button", "Import");
  });
  it("ErrorState names the failing source and is an alert", () => {
    cy.mount(<ErrorState source="WhatsApp inbox" message="Meta returned 401." retry={<Button>Retry</Button>} />);
    cy.get("[role=alert]").should("contain", "WhatsApp inbox").and("contain", "Meta returned 401.");
  });
  it("PartialState reports done of total", () => {
    cy.mount(<PartialState done={3} total={5} items={[{ label: "Gmail", status: "ok" }, { label: "Sheets", status: "failed", detail: "Token expired" }, { label: "Razorpay", status: "pending" }]} />);
    cy.contains("3 of 5 sources synced");
    cy.contains("Token expired");
  });
});

describe("Skeleton and Kbd", () => {
  it("skeletons are hidden blocks or labelled loading regions", () => {
    cy.mount(<><Skeleton variant="row" /><SkeletonRows rows={2} /><SkeletonChart /></>);
    cy.get("[aria-busy=true]").should("have.length", 2);
  });
  it("Kbd renders at 12px", () => {
    cy.mount(<Kbd>K</Kbd>);
    cy.get("kbd").should("have.css", "font-size", "12px");
  });
});
