import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({
  searchMentionable: vi.fn(async () => ({ ok: true, data: { people: [{ id: "u1", name: "Priya Raman" }, { id: "u2", name: "Arun Kumar" }] } })),
}));
import { MentionComposer } from "../mention-composer";

const s = { composerLabel: "Write a comment", composerPlaceholder: "Comment", mentionHint: "Type @ to mention someone", mentionNobody: "Nobody found" };

function Harness({ onPick = () => {} }: { onPick?: (m: unknown) => void }) {
  const [v, setV] = useState("");
  return <MentionComposer objectType="lead" objectId="l1" s={s} value={v} onChange={setV} onPick={onPick} />;
}
async function typeAt() {
  const box = screen.getByRole("combobox", { name: "Write a comment" });
  fireEvent.change(box, { target: { value: "hi @", selectionStart: 4 } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  return box;
}

describe("MentionComposer combobox (COMP-019)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("is collapsed with no aria-controls until the listbox is rendered", () => {
    render(<Harness />);
    const box = screen.getByRole("combobox");
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(box).toHaveAttribute("aria-haspopup", "listbox");
    expect(box).not.toHaveAttribute("aria-controls");
    expect(box).not.toHaveAttribute("aria-activedescendant");
  });

  it("opens a listbox of options and points aria-activedescendant at the active one", async () => {
    render(<Harness />);
    const box = await typeAt();
    expect(box).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("listbox");
    expect(box).toHaveAttribute("aria-controls", list.id);
    const opts = screen.getAllByRole("option");
    expect(opts).toHaveLength(2);
    expect(box).toHaveAttribute("aria-activedescendant", opts[0].id);
    expect(opts[0]).toHaveAttribute("aria-selected", "true");
    expect(opts[0].querySelector("button")).toBeNull();
  });

  it("ArrowDown/ArrowUp move the active descendant while focus stays in the textarea", async () => {
    render(<Harness />);
    const box = await typeAt();
    const opts = screen.getAllByRole("option");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveAttribute("aria-activedescendant", opts[1].id);
    expect(opts[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveAttribute("aria-activedescendant", opts[0].id);
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box).toHaveAttribute("aria-activedescendant", opts[1].id);
  });

  it("Enter picks the active option and closes the list; Escape closes without picking", async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    let box = await typeAt();
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "u2" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(box).not.toHaveAttribute("aria-activedescendant");
    box = await typeAt();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});
