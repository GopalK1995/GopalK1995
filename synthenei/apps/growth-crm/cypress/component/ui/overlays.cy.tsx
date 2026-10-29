import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Command } from "@/components/ui/command";

const items = [{ id: "leads", label: "Go to Leads", shortcut: "G L" }, { id: "inbox", label: "Go to Inbox" }];

function CommandDemo({ onSelect }: { onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  return <Command open={open} onOpenChange={setOpen} items={items} onSelect={onSelect} />;
}

describe("Sheet", () => {
  it("opens, keeps focus inside the dialog and closes on Escape", () => {
    cy.mount(<Sheet><SheetTrigger>Open</SheetTrigger><SheetContent title="Lead">Details</SheetContent></Sheet>);
    cy.contains("button", "Open").click();
    cy.get("[role=dialog]").should("be.visible").and("contain", "Details");
    cy.focused().closest("[role=dialog]").should("exist");
    cy.get("body").type("{esc}");
    cy.get("[role=dialog]").should("not.exist");
  });
});

describe("Command", () => {
  it("filters by typing and runs the selected item with Enter", () => {
    const onSelect = cy.stub().as("sel");
    cy.mount(<CommandDemo onSelect={onSelect} />);
    cy.get("[cmdk-input]").type("inb");
    cy.get("[cmdk-item]").should("have.length", 1).and("contain", "Inbox");
    cy.get("[cmdk-input]").type("{enter}");
    cy.get("@sel").should("have.been.calledWith", "inbox");
  });
  it("shows the empty text", () => {
    cy.mount(<Command open onOpenChange={() => {}} items={items} onSelect={() => {}} />);
    cy.get("[cmdk-input]").type("zzz");
    cy.contains("No results").should("be.visible");
  });
});
