import { describe, expect, it, vi } from "vitest";
import { createLiveController, patchRows } from "../live";
import { detectConflict, diffFields, mergeDraft, mergedPatch } from "../merge";
import { DemoHub, SAMPLE_COLLEAGUES } from "../demo";
import { recordTopic } from "../topics";

const WS = "11111111-1111-4111-8111-111111111111";

function ctl(over: { editing?: boolean; me?: string } = {}) {
  const timers: Array<() => void> = [];
  let editing = over.editing ?? false;
  const refetch = vi.fn(async () => undefined);
  const onPending = vi.fn();
  const c = createLiveController({
    me: over.me ?? "me", isEditing: () => editing, refetch, onPending,
    setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => undefined,
  });
  return { c, refetch, onPending, run: () => { const f = timers.pop(); f?.(); }, setEditing: (b: boolean) => { editing = b; } };
}

describe("live controller", () => {
  it("an id-only broadcast triggers a refetch of that id; payload fields are never used", async () => {
    const { c, refetch, run } = ctl();
    c.push({ id: "d1", op: "UPDATE", version: 3, changed_by: "peer", changed_fields: ["stage_id"], stage_id: "STOLEN", name: "x" });
    c.push({ id: "d2", op: "INSERT", version: 1, changed_by: "peer", changed_fields: [] });
    c.push({ id: "d1", op: "UPDATE", version: 4, changed_by: "peer", changed_fields: [] });
    run();
    await Promise.resolve();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith(["d1", "d2"], { byOther: new Set(["d1", "d2"]) });
  });

  it("ignores our own saves and malformed payloads", () => {
    const { c, refetch, run } = ctl();
    c.push({ id: "d1", op: "UPDATE", version: 3, changed_by: "me", changed_fields: [] });
    c.push({ nope: true });
    run();
    expect(refetch).not.toHaveBeenCalled();
    expect(c.pendingCount()).toBe(0);
  });

  it("holds changes while the user is mid-edit and shows a count instead", async () => {
    const { c, refetch, onPending, run, setEditing } = ctl({ editing: true });
    c.push({ id: "d1", op: "UPDATE", version: 2, changed_by: "peer", changed_fields: [] });
    c.push({ id: "d2", op: "UPDATE", version: 2, changed_by: "peer", changed_fields: [] });
    run();
    expect(refetch).not.toHaveBeenCalled();
    expect(onPending).toHaveBeenLastCalledWith(2);
    setEditing(false);
    c.editingEnded();
    run();
    await Promise.resolve();
    expect(refetch).toHaveBeenCalledWith(["d1", "d2"], expect.anything());
    expect(onPending).toHaveBeenLastCalledWith(0);
  });

  it("flush (the refresh button) loads pending changes even while editing", async () => {
    const { c, refetch } = ctl({ editing: true });
    c.push({ id: "d1", op: "DELETE", version: null, changed_by: "peer", changed_fields: [] });
    await c.flush();
    expect(refetch).toHaveBeenCalledWith(["d1"], expect.anything());
  });

  it("does nothing after dispose", () => {
    const { c, refetch, run } = ctl();
    c.push({ id: "d1", op: "UPDATE", version: 2, changed_by: "peer", changed_fields: [] });
    c.dispose();
    run();
    expect(refetch).not.toHaveBeenCalled();
  });
});

describe("patchRows", () => {
  const idOf = (r: { id: string; v: number }) => r.id;
  it("replaces in place, appends new, and drops ids the loader no longer returns", () => {
    const rows = [{ id: "a", v: 1 }, { id: "b", v: 1 }, { id: "c", v: 1 }];
    const out = patchRows(rows, [{ id: "a", v: 2 }, { id: "z", v: 1 }], ["a", "b", "z"], idOf);
    expect(out).toEqual([{ id: "a", v: 2 }, { id: "c", v: 1 }, { id: "z", v: 1 }]);
  });
});

describe("conflict diff", () => {
  const base = { id: "l1", version: 3, name: "Acme", stage: "new", note: "a" };
  it("no conflict when versions match or when there is no draft", () => {
    expect(detectConflict(base, { name: "Acme 2" }, { ...base })).toBeNull();
    expect(detectConflict(base, null, { ...base, version: 4, stage: "won" })).toBeNull();
  });
  it("classifies conflicting, their-only and my-only fields", () => {
    const theirs = { ...base, version: 4, stage: "won", note: "theirs" };
    const mine = { name: "Acme Ltd", note: "mine" };
    const c = detectConflict(base, mine, theirs, "u2")!;
    expect(c.theirsVersion).toBe(4);
    expect(Object.fromEntries(c.diffs.map((d) => [d.field, d.kind]))).toEqual({ name: "mine-only", note: "conflict", stage: "theirs-only" });
    const note = c.diffs.find((d) => d.field === "note")!;
    expect([note.theirs, note.mine]).toEqual(["theirs", "mine"]);
  });
  it("is no conflict when only they changed fields you did not touch", () => {
    expect(detectConflict(base, { name: "Acme" }, { ...base, version: 4, stage: "won" })).toBeNull();
  });
  it("is no conflict when both made the same edit", () => {
    expect(diffFields(base, { note: "x" }, { ...base, version: 4, note: "x" })).toEqual([]);
  });
  it("merge keeps theirs by default, mine where chosen, and always keeps my-only edits", () => {
    const c = detectConflict(base, { name: "Acme Ltd", note: "mine" }, { ...base, version: 4, stage: "won", note: "theirs" })!;
    expect(mergeDraft(c)).toMatchObject({ name: "Acme Ltd", note: "theirs", stage: "won" });
    expect(mergeDraft(c, { note: "mine" })).toMatchObject({ note: "mine" });
    expect(mergedPatch(c)).toEqual({ name: "Acme Ltd" });
    expect(mergedPatch(c, { note: "mine" })).toEqual({ name: "Acme Ltd", note: "mine" });
  });
});

describe("demo hub", () => {
  it("opens no socket and no transport, simulates labelled sample presence", async () => {
    const ws = vi.fn();
    vi.stubGlobal("WebSocket", ws);
    const hub = new DemoHub();
    const onPresence = vi.fn();
    const j = await hub.join(recordTopic(WS, "lead", "a1"), { authorize: async () => true, presence: true, onPresence });
    expect(ws).not.toHaveBeenCalled();
    expect(j).not.toBeNull();
    const users = onPresence.mock.calls[0][0];
    expect(users).toHaveLength(SAMPLE_COLLEAGUES.length);
    expect(users.every((u: { sample?: boolean; name: string }) => u.sample === true && /^Sample /.test(u.name))).toBe(true);
    expect(hub.demo).toBe(true);
    j?.leave();
    expect(hub.channelCount()).toBe(0);
    vi.unstubAllGlobals();
  });
  it("still honours the authorize gate", async () => {
    const hub = new DemoHub();
    expect(await hub.join(recordTopic(WS, "lead", "a1"), { authorize: async () => false, presence: true })).toBeNull();
  });
});
