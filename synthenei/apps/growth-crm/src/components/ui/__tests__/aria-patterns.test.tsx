import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Field, Input } from "../form";
import { Segmented } from "../tabs";
import { StageTabs } from "../stage-tabs";
import { rovingTarget } from "../roving";
import { Avatar } from "../avatar";
import { SampleDataDot } from "@/components/shell/sample-data-dot";

describe("Field (A11Y-010, A11Y-021)", () => {
  it("sets aria-required and adds visually hidden required text to the label", () => {
    render(<Field label="Email" required><Input /></Field>);
    const input = screen.getByRole("textbox", { name: /Email/ });
    expect(input).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("(required)")).toHaveClass("sr-only");
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
  });
  it("does not claim required when it is optional", () => {
    render(<Field label="Note"><Input /></Field>);
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-required");
  });
  it("ties the error to the control with aria-invalid and aria-describedby", () => {
    render(<Field label="Email" error="Enter a valid email" help="Work address"><Input /></Field>);
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const err = screen.getByRole("alert");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(err.id);
    expect(err).toHaveTextContent("Enter a valid email");
  });
});

describe("Segmented (A11Y-009)", () => {
  function Harness() {
    const [v, setV] = useState<"a" | "b" | "c">("a");
    return <Segmented label="Mode" value={v} onChange={setV} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }]} />;
  }
  it("is a radiogroup with a single tab stop on the checked radio", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Mode" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
  });
  it("arrow keys move focus and selection with wrap, Home and End jump", () => {
    render(<Harness />);
    const [a, b, c] = screen.getAllByRole("radio");
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(b).toHaveFocus(); expect(b).toHaveAttribute("aria-checked", "true"); expect(b).toHaveAttribute("tabindex", "0"); expect(a).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(b, { key: "End" });
    expect(c).toHaveFocus();
    fireEvent.keyDown(c, { key: "ArrowRight" });
    expect(a).toHaveFocus(); expect(a).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(a, { key: "ArrowLeft" });
    expect(c).toHaveFocus();
  });
});

describe("StageTabs (A11Y-008, UXB-040)", () => {
  const tabs = [{ value: "new", label: "New", count: 2 }, { value: "won", label: "Won", count: 0 }, { value: "lost", label: "Lost", count: 1 }];
  function Harness() {
    const [v, setV] = useState("new");
    return (<><StageTabs label="Stages" tabs={tabs} value={v} onChange={setV} panelId="panel" /><section role="tabpanel" id="panel" aria-labelledby={`stage-tab-${v}`}>body</section></>);
  }
  it("uses roving tabindex and only the selected tab controls the rendered panel", () => {
    render(<Harness />);
    const t = screen.getAllByRole("tab");
    expect(t.map((x) => x.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(t[0]).toHaveAttribute("aria-controls", "panel");
    expect(t[1]).not.toHaveAttribute("aria-controls");
    expect(document.getElementById("panel")).toHaveAttribute("aria-labelledby", "stage-tab-new");
  });
  it("arrow keys, Home and End move focus and activate", () => {
    render(<Harness />);
    const [n, w, l] = screen.getAllByRole("tab");
    n.focus();
    fireEvent.keyDown(n, { key: "ArrowRight" });
    expect(w).toHaveFocus(); expect(w).toHaveAttribute("aria-selected", "true"); expect(w).toHaveAttribute("aria-controls", "panel");
    fireEvent.keyDown(w, { key: "End" });
    expect(l).toHaveFocus();
    fireEvent.keyDown(l, { key: "Home" });
    expect(n).toHaveFocus();
  });
  it("gives the count a text name (not an aria-label on a role-less span)", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "New, 2" })).toBeInTheDocument();
  });
});

describe("rovingTarget", () => {
  it("wraps and handles Home/End; ignores other keys", () => {
    expect(rovingTarget("ArrowRight", 2, 3)).toBe(0);
    expect(rovingTarget("ArrowLeft", 0, 3)).toBe(2);
    expect(rovingTarget("Home", 2, 3)).toBe(0);
    expect(rovingTarget("End", 0, 3)).toBe(2);
    expect(rovingTarget("a", 0, 3)).toBe(-1);
  });
});

describe("SampleDataDot (A11Y-019)", () => {
  it("is a focusable button with an accessible name", () => {
    render(<SampleDataDot label="Sample data: synthetic Lawsome. Nothing is sent." />);
    const b = screen.getByRole("button", { name: /Sample data/ });
    b.focus();
    expect(b).toHaveFocus();
  });
});

describe("Avatar pseudo (A11Y-020)", () => {
  it("draws initials with CSS content so they are not DOM text", () => {
    const { container } = render(<Avatar name="Gopala Krishnan" pseudo />);
    expect(container.textContent).toBe("");
    expect(container.firstElementChild).toHaveAttribute("data-initials");
  });
  it("keeps initials as text by default", () => {
    const { container } = render(<Avatar name="Gopala Krishnan" />);
    expect(container.textContent).not.toBe("");
  });
});
