import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_NOTICE, Toaster, toast, toastResult } from "../toast";

// Exit animations never finish under jsdom, so render motion elements as plain ones.
vi.mock("motion/react", async () => {
  const React = await import("react");
  const strip = ({ initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest }: Record<string, unknown>) => rest;
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    motion: { div: (p: Record<string, unknown>) => React.createElement("div", strip(p)) },
    useReducedMotion: () => false,
  };
});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const fire = (...a: Parameters<typeof toast>) => act(() => { toast(...a); });
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const items = () => screen.queryAllByTestId("toast");

describe("Toast", () => {
  it("has no default demo sub-line; the demo notice only appears when asked", () => {
    render(<Toaster />);
    fire("Saved");
    expect(screen.queryByText(DEMO_NOTICE)).toBeNull();
    fire("Demo save", undefined, { demo: true });
    expect(screen.getByText(DEMO_NOTICE)).toBeTruthy();
  });

  it("renders a sub-line only when given", () => {
    render(<Toaster />);
    fire("Lead moved", "To Qualified");
    expect(screen.getByText("To Qualified")).toBeTruthy();
  });

  it("uses role status for success/info and role alert for errors, in permanent live regions", () => {
    const { container } = render(<Toaster />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    fire("Done", undefined, { variant: "success" });
    fire("Heads up", undefined, { variant: "info" });
    fire("Failed", undefined, { variant: "error" });
    const status = container.querySelector('[role="status"]')!;
    const alert = container.querySelector('[role="alert"]')!;
    expect(status.textContent).toContain("Done");
    expect(status.textContent).toContain("Heads up");
    expect(alert.textContent).toContain("Failed");
    expect(alert.textContent).not.toContain("Done");
  });

  it("toastResult maps ok to success and a failure to error, never a success icon on failure", () => {
    render(<Toaster />);
    act(() => { toastResult({ ok: false, message: "Could not save" }); toastResult({ ok: true, message: "Saved" }); });
    const [a, b] = items();
    expect(items().map((x) => x.getAttribute("data-variant")).sort()).toEqual(["error", "success"]);
    expect(a.textContent ?? b.textContent).toBeTruthy();
    const err = items().find((x) => x.getAttribute("data-variant") === "error")!;
    expect(err.textContent).toContain("Could not save");
    expect(err.querySelector("svg.lucide-circle-check")).toBeNull();
  });

  it("auto-dismisses success after the timeout but never dismisses errors", () => {
    render(<Toaster />);
    fire("ok", undefined, { variant: "success" });
    fire("bad", undefined, { variant: "error" });
    tick(5900);
    expect(items()).toHaveLength(2);
    tick(200);
    expect(items().map((x) => x.getAttribute("data-variant"))).toEqual(["error"]);
    tick(120_000);
    expect(items()).toHaveLength(1);
  });

  it("pauses while hovered and resumes afterwards", () => {
    render(<Toaster />);
    fire("hover me", undefined, { variant: "info" });
    const el = items()[0];
    tick(4000);
    fireEvent.mouseEnter(el);
    tick(60_000);
    expect(items()).toHaveLength(1);
    fireEvent.mouseLeave(el);
    tick(1900);
    expect(items()).toHaveLength(1);
    tick(200);
    expect(items()).toHaveLength(0);
  });

  it("pauses while focus is inside and resumes on blur", () => {
    render(<Toaster />);
    fire("focus me", undefined, { variant: "success", action: { label: "Undo", onClick: () => {} } });
    const btn = screen.getByRole("button", { name: "Undo" });
    act(() => btn.focus());
    tick(60_000);
    expect(items()).toHaveLength(1);
    act(() => btn.blur());
    tick(6100);
    expect(items()).toHaveLength(0);
  });

  it("has a close button that dismisses, and Escape dismisses too", () => {
    render(<Toaster />);
    fire("closable", undefined, { variant: "error" });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(items()).toHaveLength(0);
    fire("esc", undefined, { variant: "error" });
    fireEvent.keyDown(items()[0], { key: "Escape" });
    expect(items()).toHaveLength(0);
  });

  it("runs the optional action once and dismisses", () => {
    const undo = vi.fn();
    render(<Toaster />);
    fire("Lead deleted", undefined, { variant: "success", action: { label: "Undo", onClick: undo } });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(items()).toHaveLength(0);
  });

  it("keeps at most three toasts", () => {
    render(<Toaster />);
    for (let i = 0; i < 5; i++) fire(`n${i}`, undefined, { variant: "error" });
    expect(items()).toHaveLength(3);
  });
});
