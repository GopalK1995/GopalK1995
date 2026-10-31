import { describe, expect, it, vi } from "vitest";
import { backoffDelay } from "../backoff";
import { RealtimeManager } from "../manager";
import { parseChange, parseEditing, presencePayload, sanitizePresence, usersFromState } from "../presence";
import { boardTopic, recordTopic, tableTopic, topicInWorkspace } from "../topics";
import type { ChannelLike, ChannelOptions, ConnectionState, RealtimeTransport } from "../types";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "22222222-2222-4222-8222-222222222222";
const ME = { id: "user-me", name: "Asha Rao" };

class FakeChannel implements ChannelLike {
  handlers: Array<{ type: string; event: string; cb: (m: never) => void }> = [];
  statusCb: ((s: string) => void) | null = null;
  tracked: Record<string, unknown>[] = [];
  sent: Array<{ event: string; payload: Record<string, unknown> }> = [];
  state: Record<string, unknown[]> = {};
  untracked = 0;
  constructor(public topic: string, public opts: ChannelOptions) {}
  on(type: "presence" | "broadcast", filter: { event: string }, cb: (m: never) => void) { this.handlers.push({ type, event: filter.event, cb }); return this; }
  subscribe(cb?: (s: string) => void) { this.statusCb = cb ?? null; return this; }
  track(p: Record<string, unknown>) { this.tracked.push(p); return Promise.resolve(); }
  untrack() { this.untracked++; return Promise.resolve(); }
  presenceState() { return this.state; }
  send(m: { event: string; payload: Record<string, unknown> }) { this.sent.push({ event: m.event, payload: m.payload }); return Promise.resolve(); }
  status(s: string) { this.statusCb?.(s); }
  emit(type: string, msg: unknown) { for (const h of this.handlers) if (h.type === type) (h.cb as (m: unknown) => void)(msg); }
}

function setup(over: Partial<ConstructorParameters<typeof RealtimeManager>[0]> = {}) {
  const channels: FakeChannel[] = [];
  const removed: FakeChannel[] = [];
  const timers: Array<{ fn: () => void; ms: number; h: number; live: boolean }> = [];
  let authChange: (() => void) | null = null;
  const transport: RealtimeTransport = {
    channel: (topic, opts) => { const c = new FakeChannel(topic, opts); channels.push(c); return c; },
    removeChannel: (c) => { removed.push(c as FakeChannel); },
    setAuth: vi.fn(async () => undefined),
    onAuthChange: (cb) => { authChange = cb; return () => { authChange = null; }; },
  };
  let now = 1000;
  const m = new RealtimeManager({
    transport, wsId: WS, me: ME, now: () => now, random: () => 0, baseDelayMs: 1000, maxDelayMs: 8000, offlineAfter: 3,
    setTimer: (fn, ms) => { const t = { fn, ms, h: timers.length + 1, live: true }; timers.push(t); return t.h; },
    clearTimer: (h) => { const t = timers.find((x) => x.h === h); if (t) t.live = false; },
    ...over,
  });
  const states: ConnectionState[] = [];
  m.onState((s) => states.push(s));
  const fire = (i: number) => { const t = timers[i]; t.live = false; t.fn(); };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { m, channels, removed, timers, states, transport, fire, tick, advance: (ms: number) => { now += ms; }, authChange: () => authChange };
}

describe("topics", () => {
  it("builds workspace-prefixed topics and rejects malformed parts", () => {
    expect(recordTopic(WS, "lead", "abc-1")).toBe(`ws:${WS}:rec:lead:abc-1`);
    expect(boardTopic(WS, "p1")).toBe(`ws:${WS}:board:p1`);
    expect(tableTopic(WS, "deals")).toBe(`ws:${WS}:tbl:deals`);
    expect(() => recordTopic("not-a-uuid", "lead", "1")).toThrow();
    expect(() => tableTopic(WS, "a:b")).toThrow();
  });
  it("accepts only topics of the active workspace", () => {
    expect(topicInWorkspace(tableTopic(WS, "deals"), WS)).toBe(true);
    expect(topicInWorkspace(tableTopic(OTHER_WS, "deals"), WS)).toBe(false);
    expect(topicInWorkspace("realtime:system", WS)).toBe(false);
  });
});

describe("backoff", () => {
  it("grows exponentially, is jittered in the top half and capped", () => {
    expect(backoffDelay(0, { random: () => 0 })).toBe(500);
    expect(backoffDelay(0, { random: () => 1 })).toBe(1000);
    expect(backoffDelay(2, { random: () => 1 })).toBe(4000);
    expect(backoffDelay(20, { random: () => 1 })).toBe(30000);
    expect(backoffDelay(20, { random: () => 0, max: 8000 })).toBe(4000);
  });
});

describe("RealtimeManager join", () => {
  it("opens no channel until authorize resolves true", async () => {
    const { m, channels } = setup();
    let release!: (v: boolean) => void;
    const p = m.join(recordTopic(WS, "lead", "a1"), { authorize: () => new Promise<boolean>((r) => { release = r; }), presence: true });
    expect(channels).toHaveLength(0);
    release(true);
    const j = await p;
    expect(j).not.toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(channels).toHaveLength(1);
    expect(channels[0].opts).toEqual({ private: true, presenceKey: ME.id });
  });

  it("never creates a channel when authorization is denied or throws (presence does not leak unreadable records)", async () => {
    const { m, channels } = setup();
    expect(await m.join(recordTopic(WS, "lead", "secret"), { authorize: async () => false, presence: true })).toBeNull();
    expect(await m.join(recordTopic(WS, "lead", "secret2"), { authorize: async () => { throw new Error("x"); }, presence: true })).toBeNull();
    expect(channels).toHaveLength(0);
    expect(m.channelCount()).toBe(0);
  });

  it("refuses another workspace's topic even when authorized", async () => {
    const { m, channels } = setup();
    expect(await m.join(tableTopic(OTHER_WS, "deals"), { authorize: async () => true })).toBeNull();
    expect(channels).toHaveLength(0);
  });

  it("pushes the token before joining", async () => {
    const { m, transport, tick } = setup();
    await m.join(tableTopic(WS, "deals"), { authorize: async () => true });
    await tick();
    expect(transport.setAuth).toHaveBeenCalled();
  });

  it("shares one channel between subscribers of the same topic", async () => {
    const { m, channels, tick } = setup();
    const t = recordTopic(WS, "lead", "a1");
    const a = await m.join(t, { authorize: async () => true, presence: true });
    const b = await m.join(t, { authorize: async () => true, presence: true });
    await tick();
    expect(channels).toHaveLength(1);
    a?.leave();
    expect(m.channelCount()).toBe(1);
    b?.leave();
    expect(m.channelCount()).toBe(0);
  });
});

describe("presence", () => {
  it("tracks only display name, initials, colour token and join time", async () => {
    const { m, channels, tick } = setup();
    await m.join(recordTopic(WS, "lead", "a1"), { authorize: async () => true, presence: true });
    await tick();
    channels[0].status("SUBSCRIBED");
    expect(channels[0].tracked).toHaveLength(1);
    const p = channels[0].tracked[0];
    expect(Object.keys(p).sort()).toEqual(["at", "color", "initials", "name", "userId"]);
    expect(p.name).toBe("Asha Rao");
    expect(p.initials).toBe("AR");
    expect(String(p.color)).toMatch(/^chart-[1-5]$/);
    expect(JSON.stringify(p)).not.toMatch(/@|email|role|phone/);
  });

  it("presencePayload never includes more than the five keys", () => {
    expect(Object.keys(presencePayload({ id: "u", name: "A B" }, 5)).sort()).toEqual(["at", "color", "initials", "name", "userId"]);
  });

  it("drops unknown keys and bad colours from peers, one face per user", () => {
    const u = sanitizePresence({ userId: "u2", name: "Meena K", color: "url(javascript:x)", at: 3, email: "m@x.in", phone: "123" });
    expect(u).toEqual({ userId: "u2", name: "Meena K", initials: "MK", color: expect.stringMatching(/^chart-[1-5]$/), at: 3 });
    expect(Object.keys(u!)).not.toContain("email");
    expect(sanitizePresence({ userId: "bad id!", name: "x" })).toBeNull();
    const users = usersFromState({ k1: [{ userId: "u2", name: "Meena K", color: "chart-2", at: 9 }], k2: [{ userId: "u2", name: "Meena K", color: "chart-2", at: 4 }, { userId: "u3", name: "Ravi", at: 5 }] });
    expect(users.map((x) => [x.userId, x.at])).toEqual([["u2", 4], ["u3", 5]]);
  });

  it("delivers presence sync to subscribers and the editing broadcast to onEvent", async () => {
    const { m, channels, tick } = setup();
    const onPresence = vi.fn(), onEvent = vi.fn();
    await m.join(recordTopic(WS, "lead", "a1"), { authorize: async () => true, presence: true, onPresence, onEvent });
    await tick();
    channels[0].status("SUBSCRIBED");
    channels[0].state = { u2: [{ userId: "u2", name: "Meena K", color: "chart-2", at: 1 }] };
    channels[0].emit("presence", {});
    expect(onPresence).toHaveBeenCalledWith([expect.objectContaining({ userId: "u2", name: "Meena K" })]);
    channels[0].emit("broadcast", { event: "editing", payload: { userId: "u2", field: "stage" } });
    expect(onEvent).toHaveBeenCalledWith("editing", { userId: "u2", field: "stage" });
    expect(parseEditing({ userId: "u2", field: "stage" })).toEqual({ userId: "u2", field: "stage" });
    expect(parseEditing({ userId: "u2", field: "<script>" })).toBeNull();
  });
});

describe("id-only change payload", () => {
  it("keeps the five id-only keys and ignores anything else", () => {
    const p = parseChange({ id: "d1", op: "UPDATE", version: 4, changed_by: "u2", changed_fields: ["stage_id"], row: { name: "secret" }, name: "secret" });
    expect(p).toEqual({ id: "d1", op: "UPDATE", version: 4, changedBy: "u2", changedFields: ["stage_id"] });
    expect(JSON.stringify(p)).not.toContain("secret");
    expect(parseChange({ id: "d1", op: "TRUNCATE" })).toBeNull();
    expect(parseChange("x")).toBeNull();
  });
});

describe("reconnect with backoff", () => {
  it("retries with growing delays, reports reconnecting, then live and resyncs", async () => {
    const { m, channels, timers, states, fire, tick } = setup();
    const onResync = vi.fn();
    await m.join(tableTopic(WS, "deals"), { authorize: async () => true, onResync });
    await tick();
    channels[0].status("SUBSCRIBED");
    expect(m.getState()).toBe("live");
    channels[0].status("CHANNEL_ERROR");
    expect(m.getState()).toBe("reconnecting");
    expect(timers[0].ms).toBe(500); // attempt 0, random 0 -> half of base
    fire(0);
    await tick();
    expect(channels).toHaveLength(2);
    channels[1].status("TIMED_OUT");
    expect(timers[1].ms).toBe(1000); // attempt 1
    fire(1);
    await tick();
    expect(onResync).not.toHaveBeenCalled();
    channels[2].status("SUBSCRIBED");
    expect(m.getState()).toBe("live");
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["reconnecting", "live"]);
  });

  it("removes the failed channel before retrying so none leak", async () => {
    const { m, channels, removed, fire, tick } = setup();
    await m.join(tableTopic(WS, "deals"), { authorize: async () => true });
    await tick();
    channels[0].status("SUBSCRIBED");
    channels[0].status("CLOSED");
    expect(removed).toContain(channels[0]);
    fire(0);
    await tick();
    channels[1].status("SUBSCRIBED");
    expect(m.channelCount()).toBe(1);
  });

  it("goes offline after repeated failures and when the browser is offline, and recovers on online", async () => {
    const { m, channels, states, fire, tick } = setup();
    await m.join(tableTopic(WS, "deals"), { authorize: async () => true });
    await tick();
    channels[0].status("CHANNEL_ERROR"); fire(0); await tick();
    channels[1].status("CHANNEL_ERROR"); fire(1); await tick();
    channels[2].status("CHANNEL_ERROR");
    expect(m.getState()).toBe("offline");
    m.handleOnline(); await tick();
    expect(channels).toHaveLength(4); // immediate retry, backoff reset
    channels[3].status("SUBSCRIBED");
    expect(m.getState()).toBe("live");
    m.handleOffline();
    expect(m.getState()).toBe("offline");
    m.handleOnline();
    expect(m.getState()).toBe("live");
    expect(states[0]).toBe("reconnecting");
  });

  it("refreshes the token on auth change", async () => {
    const { transport, authChange } = setup();
    authChange()?.();
    expect(transport.setAuth).toHaveBeenCalled();
  });
});

describe("visibility", () => {
  it("asks for a resync after a long background, not after a short one", async () => {
    const { m, advance, tick } = setup();
    const onResync = vi.fn();
    await m.join(tableTopic(WS, "deals"), { authorize: async () => true, onResync });
    await tick();
    m.handleHidden(); advance(5000); m.handleVisible();
    expect(onResync).not.toHaveBeenCalled();
    m.handleHidden(); advance(60000); m.handleVisible();
    expect(onResync).toHaveBeenCalledTimes(1);
  });
  it("reconnects immediately on return when a channel was waiting to retry", async () => {
    const { m, channels, tick } = setup();
    await m.join(tableTopic(WS, "deals"), { authorize: async () => true });
    await tick();
    channels[0].status("CHANNEL_ERROR");
    m.handleVisible(); await tick();
    expect(channels).toHaveLength(2);
  });
});

describe("cleanup", () => {
  it("leave removes the channel and untracks; dispose removes everything and stops timers", async () => {
    const { m, channels, removed, timers, tick } = setup();
    const a = await m.join(recordTopic(WS, "lead", "a1"), { authorize: async () => true, presence: true });
    await m.join(boardTopic(WS, "p1"), { authorize: async () => true, presence: true });
    await tick();
    channels[0].status("SUBSCRIBED"); channels[1].status("SUBSCRIBED");
    a?.leave();
    expect(removed).toContain(channels[0]);
    expect(channels[0].untracked).toBe(1);
    channels[1].status("CHANNEL_ERROR");
    m.dispose();
    expect(m.channelCount()).toBe(0);
    expect(removed).toContain(channels[1]);
    expect(timers.every((t) => !t.live)).toBe(true);
    expect(await m.join(tableTopic(WS, "deals"), { authorize: async () => true })).toBeNull();
  });

  it("send broadcasts only when subscribed", async () => {
    const { m, channels, tick } = setup();
    const j = await m.join(recordTopic(WS, "lead", "a1"), { authorize: async () => true, presence: true });
    await tick();
    j?.send("editing", { userId: ME.id, field: "stage" });
    expect(channels[0].sent).toHaveLength(0);
    channels[0].status("SUBSCRIBED");
    j?.send("editing", { userId: ME.id, field: "stage" });
    expect(channels[0].sent).toEqual([{ event: "editing", payload: { userId: ME.id, field: "stage" } }]);
  });
});
