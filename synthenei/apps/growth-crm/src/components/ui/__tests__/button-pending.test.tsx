import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../button";
import { PendingButton, SubmitButton } from "../submit-button";

describe("Button", () => {
  it("defaults to type=button so it never submits a surrounding form by accident", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={onSubmit}><Button>Cancel</Button></form>);
    const btn = screen.getByRole("button", { name: "Cancel" });
    expect(btn).toHaveAttribute("type", "button");
    fireEvent.click(btn);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still submits when type=submit is explicit", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={onSubmit}><Button type="submit">Save</Button></form>);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("loading sets aria-busy, disables the button, swaps the label and shows a spinner", () => {
    const { container, rerender } = render(<Button loading loadingLabel="Saving…">Save</Button>);
    const btn = screen.getByRole("button", { name: "Saving…" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector("svg")).not.toBeNull();
    rerender(<Button>Save</Button>);
    const idle = screen.getByRole("button", { name: "Save" });
    expect(idle).toBeEnabled();
    expect(idle).not.toHaveAttribute("aria-busy");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("keeps the normal label while loading when no loadingLabel is given", () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("aria-busy", "true");
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("SubmitButton / PendingButton (server-action forms)", () => {
  it("shows pending feedback while the form action runs, then recovers", async () => {
    const d = deferred();
    const action = vi.fn(async () => { await d.promise; });
    render(<form action={action}><SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton></form>);
    const btn = screen.getByRole("button", { name: "Sign in" });
    expect(btn).toHaveAttribute("type", "submit");
    expect(btn).toBeEnabled();

    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Signing in…" })).toHaveAttribute("aria-busy", "true");
    expect(action).toHaveBeenCalledTimes(1);

    // a second click while pending must not post again
    fireEvent.click(screen.getByRole("button", { name: "Signing in…" }));
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => { d.resolve(); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Sign in" })).not.toHaveAttribute("aria-busy");
  });

  it("respects an externally disabled state (e.g. demo mode) when idle", () => {
    render(<form action={async () => {}}><SubmitButton disabled>Sign in</SubmitButton></form>);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });

  it("PendingButton disables and flags aria-busy during the action", async () => {
    const d = deferred();
    render(<form action={async () => { await d.promise; }}><PendingButton data-persona="owner">Owner</PendingButton></form>);
    const btn = screen.getByRole("button", { name: "Owner" });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveAttribute("aria-busy", "true");
    await act(async () => { d.resolve(); });
    await waitFor(() => expect(btn).toBeEnabled());
  });
});
