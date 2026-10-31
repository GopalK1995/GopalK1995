import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictBanner } from "../conflict-banner";
import { PendingChanges } from "../pending-changes";
import { PresenceFacesView } from "../presence-faces";
import { RealtimeProvider } from "../realtime-provider";
import { SyncChipView } from "../sync-status-chip";
import { detectConflict } from "@/lib/realtime/merge";
import { useLiveList, usePresence } from "@/lib/realtime/hooks";
import type { JoinOptions, Joined, RealtimeHub } from "@/lib/realtime/types";
import { tableTopic } from "@/lib/realtime/topics";

afterEach(cleanup);
const WS = "11111111-1111-4111-8111-111111111111";

describe("SyncChipView", () => {
  it("shows live, reconnecting, offline with words, and the sample label in demo", () => {
    const { rerender } = render(<SyncChipView state="live" demo={false} />);
    expect(screen.getByTestId("sync-chip")).toHaveAttribute("data-state", "live");
    expect(screen.getByText("Live")).toBeInTheDocument();
    rerender(<SyncChipView state="reconnecting" demo={false} />);
    expect(screen.getByText("Reconnecting")).toBeInTheDocument();
    rerender(<SyncChipView state="offline" demo={false} />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
    rerender(<SyncChipView state="live" demo />);
    expect(screen.getByText("Sample presence")).toBeInTheDocument();
  });
});

describe("PresenceFacesView", () => {
  it("renders faces with initials, a text alternative and the sample tag", () => {
    render(<PresenceFacesView users={[{ userId: "s1", name: "Sample colleague A", initials: "SA", color: "chart-1", at: 1, sample: true }, { userId: "u2", name: "Meena K", initials: "MK", color: "chart-2", at: 2 }]} />);
    expect(screen.getAllByTestId("presence-face")).toHaveLength(2);
    expect(screen.getByTestId("presence-faces").getAttribute("aria-label")).toContain("sample colleague");
  });
});

describe("PendingChanges", () => {
  it("shows N changes with a refresh action and hides at zero", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<PendingChanges count={3} onRefresh={onRefresh} />);
    expect(screen.getByText("3 changes, refresh")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalled();
    rerender(<PendingChanges count={0} onRefresh={onRefresh} />);
    expect(screen.queryByTestId("pending-changes")).toBeNull();
  });
});

describe("ConflictBanner", () => {
  const base = { id: "l1", version: 3, name: "Acme", note: "a" };
  const c = detectConflict(base, { name: "Acme Ltd", note: "mine" }, { ...base, version: 4, note: "theirs" }, "u2")!;
  it("shows the field-level diff and passes the chosen merge", () => {
    const onMerge = vi.fn(), onDiscard = vi.fn();
    render(<ConflictBanner conflict={c} who="Priya" ago="20 s ago" onMerge={onMerge} onDiscard={onDiscard} />);
    expect(screen.getByText(/Changed by Priya 20 s ago/)).toBeInTheDocument();
    expect(screen.getByTestId("conflict-diff").querySelectorAll("tr[data-field]")).toHaveLength(2);
    fireEvent.click(screen.getAllByLabelText("Keep mine")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Merge and continue" }));
    expect(onMerge).toHaveBeenCalledWith({ note: "mine" });
    fireEvent.click(screen.getByRole("button", { name: "Discard my changes" }));
    expect(onDiscard).toHaveBeenCalled();
  });
});

function fakeHub() {
  const joins: Array<{ topic: string; opts: JoinOptions; left: boolean }> = [];
  const hub: RealtimeHub = {
    demo: false, getState: () => "live", onState: () => () => undefined,
    join: async (topic, opts) => {
      if (!(await opts.authorize())) return null;
      const rec = { topic, opts, left: false };
      joins.push(rec);
      const j: Joined = { topic, leave: () => { rec.left = true; }, send: () => undefined };
      return j;
    },
    dispose: vi.fn(),
  };
  return { hub, joins };
}

describe("hooks over a hub", () => {
  it("usePresence joins only after authorize and leaves on unmount", async () => {
    const { hub, joins } = fakeHub();
    const wrapper = ({ children }: { children: React.ReactNode }) => <RealtimeProvider wsId={WS} me={{ id: "me", name: "Me" }} demo={false} hub={hub}>{children}</RealtimeProvider>;
    const denied = renderHook(() => usePresence(`ws:${WS}:rec:lead:a1`, { authorize: false }), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(joins).toHaveLength(0);
    denied.unmount();
    const ok = renderHook(() => usePresence(`ws:${WS}:rec:lead:a1`, { authorize: true }), { wrapper });
    await waitFor(() => expect(joins).toHaveLength(1));
    act(() => joins[0].opts.onPresence?.([{ userId: "me", name: "Me", initials: "M", color: "chart-1", at: 1 }, { userId: "u2", name: "Meena K", initials: "MK", color: "chart-2", at: 2 }]));
    expect(ok.result.current.map((u) => u.userId)).toEqual(["u2"]);
    ok.unmount();
    expect(joins[0].left).toBe(true);
    expect(hub.dispose).toHaveBeenCalled();
  });

  it("useLiveList refetches by id on broadcast and holds changes while editing", async () => {
    const { hub, joins } = fakeHub();
    const wrapper = ({ children }: { children: React.ReactNode }) => <RealtimeProvider wsId={WS} me={{ id: "me", name: "Me" }} demo={false} hub={hub}>{children}</RealtimeProvider>;
    const loadByIds = vi.fn(async (ids: string[]) => ids.map((id) => ({ id, stage: "won" })));
    const rows = [{ id: "d1", stage: "new" }, { id: "d2", stage: "new" }];
    const { result, rerender } = renderHook((p: { editing: boolean }) => useLiveList({ table: "deals", rows, idOf: (r) => r.id, loadByIds, authorize: true, editing: p.editing, highlightMs: 5 }), { wrapper, initialProps: { editing: false } });
    await waitFor(() => expect(joins).toHaveLength(1));
    expect(joins[0].topic).toBe(tableTopic(WS, "deals"));
    act(() => joins[0].opts.onEvent?.("UPDATE", { id: "d1", op: "UPDATE", version: 2, changed_by: "peer", changed_fields: ["stage_id"], stage: "LEAK" }));
    await waitFor(() => expect(loadByIds).toHaveBeenCalledWith(["d1"]));
    await waitFor(() => expect(result.current.rows[0]).toEqual({ id: "d1", stage: "won" }));
    // mid-edit: held
    rerender({ editing: true });
    act(() => joins[0].opts.onEvent?.("UPDATE", { id: "d2", op: "UPDATE", version: 2, changed_by: "peer", changed_fields: [] }));
    await waitFor(() => expect(result.current.pending).toBe(1));
    expect(loadByIds).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.refresh(); });
    expect(loadByIds).toHaveBeenLastCalledWith(["d2"]);
    expect(result.current.rows[1].stage).toBe("won");
  });
});
