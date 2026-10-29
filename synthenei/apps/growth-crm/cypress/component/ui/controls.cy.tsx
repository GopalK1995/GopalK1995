import { useState } from "react";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const opts = [{ value: "a", label: "Alpha" }, { value: "b", label: "Bravo" }, { value: "c", label: "Charlie", disabled: true }];

function SelectDemo() {
  const [v, setV] = useState("a");
  return <><Select aria-label="Pick" value={v} onValueChange={setV} options={opts} /><output>{v}</output></>;
}

describe("Select", () => {
  it("opens with the keyboard and selects", () => {
    cy.mount(<SelectDemo />);
    cy.get("[role=combobox]").focus().type("{enter}{downarrow}{enter}");
    cy.get("output").should("have.text", "b");
  });
  it("disabled with reason", () => {
    cy.mount(<Select aria-label="Pick" options={opts} disabledReason="Pipeline is locked" />);
    cy.get("[role=combobox]").should("have.attr", "aria-disabled", "true");
  });
});

describe("Switch and Checkbox", () => {
  it("toggle with Space and show a focus ring", () => {
    cy.mount(<><Switch aria-label="Sync" /><Checkbox aria-label="Agree" /></>);
    cy.get("[role=switch]").focus().should("have.css", "outline-style", "solid").type(" ").should("have.attr", "aria-checked", "true");
    cy.get("[role=checkbox]").focus().type(" ").should("have.attr", "aria-checked", "true");
  });
  it("disabled with reason is focusable and does not toggle", () => {
    cy.mount(<Switch aria-label="Sync" disabledReason="Admin approval pending" />);
    cy.get("[role=switch]").focus().should("have.attr", "aria-disabled", "true");
    cy.get("[role=switch]").click({ force: true }).should("have.attr", "aria-checked", "false");
  });
});

describe("RadioGroup", () => {
  it("moves with arrow keys", () => {
    cy.mount(<RadioGroup name="r" defaultValue="a" aria-label="Choice" options={opts} />);
    cy.get("[role=radio]").first().focus().type("{downarrow}");
    cy.get("[role=radio][aria-checked=true]").should("have.length", 1);
  });
});

describe("Popover", () => {
  it("opens from the trigger and closes on Escape", () => {
    cy.mount(<Popover><PopoverTrigger>Filters</PopoverTrigger><PopoverContent>Body</PopoverContent></Popover>);
    cy.contains("button", "Filters").click();
    cy.contains("Body").should("be.visible");
    cy.get("body").type("{esc}");
    cy.contains("Body").should("not.exist");
  });
});
