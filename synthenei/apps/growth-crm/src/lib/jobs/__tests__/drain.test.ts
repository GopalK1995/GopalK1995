import { beforeEach, describe, expect, it } from "vitest";
import { drain, type DrainOptions } from "../drain";
import { MAX_ATTEMPTS, backoffSeconds } from "../queues";
import { clearHandlers, registerHandler } from "../registry";
import { FakeQueue, FakeRuns, fakeDb, memLogger } from "./fakes";

let q: FakeQueue;
let runs: FakeRuns;
let log: ReturnType<typeof memLogger>;
const run = (o: Partial<DrainOptions> = {}) => drain({ port: q, runs, db: fakeDb, log, queues: ["notify"], now: () => q.t, ...o });
const msg = (extra: Record<string, unknown> = {}, tenant: string | null = "t1") => ({ kind: "k", tenant_id: tenant, payload: { n: 1 }, ...extra });

beforeEach(() => {
  clearHandlers();
  q = new FakeQueue(); runs = new FakeRuns(); log = memLogger();
});

describe("drainer: success path", () => {
  it("runs the handler, archives the message and records a succeeded run", async () => {
    registerHandler("notify", "k", async () => "done");
    q.put("notify", msg());
    const r = await run();
    expect(r).toMatchObject({ processed: 1, failed: 0, dead: 0, stoppedBy: "empty" });
    expect(q.archived).toHaveLength(1);
    expect(q.list("notify")).toHaveLength(0);
    expect(runs.runs[0]).toMatchObject({ queue: "notify", kind: "k", tenantId: "t1", status: "succeeded", attempt: 1 });
  });

  it("gives the handler its payload, tenant and a deadline before the hard limit", async () => {
    let seen: { p: unknown; tenant: string | null; deadline: number } | null = null;
    registerHandler("notify", "k", async (p, ctx) => { seen = { p, tenant: ctx.tenantId, deadline: ctx.deadline }; return "done"; });
    q.put("notify", msg());
    await run();
    expect(seen).toEqual({ p: { n: 1 }, tenant: "t1", deadline: 240_000 });
  });

  it("treats a bare events-queue body as an event.fanout payload", async () => {
    let got: unknown;
    registerHandler("events", "event.fanout", async (p) => { got = p; return "done"; });
    q.put("events", { event_id: 5, type: "lead.created", tenant_id: "t1", workspace_id: "w1", occurred_at: "2026-10-01T00:00:00Z" } as never);
    const r = await run({ queues: ["events"] });
    expect(r.processed).toBe(1);
    expect(got).toMatchObject({ event_id: 5, workspace_id: "w1" });
    expect(runs.runs[0]).toMatchObject({ kind: "event.fanout", workspaceId: "w1" });
  });
});

describe("drainer: retry with backoff", () => {
  it("re-enqueues a failing message with an incremented attempt and exponential delay", async () => {
    registerHandler("notify", "k", async () => { throw new Error("boom"); });
    q.put("notify", msg());
    const r = await run();
    expect(r).toMatchObject({ processed: 0, failed: 1, dead: 0 });
    const [next] = q.list("notify");
    expect(next.message.attempt).toBe(1);
    expect(q.delayOf("notify", next.msg_id)).toBe(backoffSeconds(1));
    expect(runs.runs[0]).toMatchObject({ status: "failed", error: "boom" });

    // not visible before the backoff elapses
    expect((await run()).failed).toBe(0);
    q.t += 6_000;
    await run();
    const [again] = q.list("notify");
    expect(again.message.attempt).toBe(2);
    expect(q.delayOf("notify", again.msg_id)).toBe(backoffSeconds(2));
    expect(runs.runs[1].attempt).toBe(2);
  });

  it("backoff doubles and caps at 15 minutes", () => {
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([5, 10, 20, 40]);
    expect(backoffSeconds(30)).toBe(900);
  });

  it("a handler returning retry counts as a failed attempt", async () => {
    registerHandler("notify", "k", async () => "retry");
    q.put("notify", msg());
    expect((await run()).failed).toBe(1);
  });

  it("a kind with no handler retries, then is dead-lettered, not dropped", async () => {
    q.put("notify", msg({ kind: "nobody" }));
    for (let i = 0; i < MAX_ATTEMPTS; i++) { await run(); q.t += 1_000_000; }
    expect(q.list("notify")).toHaveLength(0);
    expect(q.list("notify_dlq")).toHaveLength(1);
    expect(runs.runs.at(-1)?.error).toMatch(/no handler registered for notify:nobody/);
  });
});

describe("drainer: dead-lettering", () => {
  it("moves the message to <queue>_dlq after the max attempt fails and records status dead", async () => {
    registerHandler("notify", "k", async () => { throw new Error("always"); });
    q.put("notify", msg());
    let last;
    for (let i = 0; i < MAX_ATTEMPTS; i++) { last = await run(); q.t += 1_000_000; }
    expect(last).toMatchObject({ dead: 1, failed: 0 });
    expect(q.list("notify")).toHaveLength(0);
    const [d] = q.list("notify_dlq");
    expect(d.message).toMatchObject({ kind: "k", attempt: MAX_ATTEMPTS, dead_reason: "always" });
    expect(runs.runs).toHaveLength(MAX_ATTEMPTS);
    expect(runs.runs.at(-1)).toMatchObject({ status: "dead", attempt: MAX_ATTEMPTS });
    expect(runs.runs.slice(0, -1).every((r) => r.status === "failed")).toBe(true);
  });

  it("a message already read more than the max times (killed mid-run) is dead-lettered without running", async () => {
    let calls = 0;
    registerHandler("notify", "k", async () => { calls++; return "done"; });
    q.put("notify", msg(), MAX_ATTEMPTS); // next read makes read_ct = max + 1
    const r = await run();
    expect(calls).toBe(0);
    expect(r.dead).toBe(1);
    expect(q.list("notify_dlq")).toHaveLength(1);
  });

  it("scrubs email and phone out of the stored error", async () => {
    registerHandler("notify", "k", async () => { throw new Error("send to asha@example.com +91 98450 12345 failed"); });
    q.put("notify", msg());
    await run();
    expect(runs.runs[0].error).not.toMatch(/asha@|98450/);
  });
});

describe("drainer: time budget", () => {
  it("stops pulling 30 s before the deadline and leaves the rest queued", async () => {
    registerHandler("notify", "k", async () => { q.t += 60_000; return "done"; }); // each message takes 60 s of fake time
    for (let i = 0; i < 100; i++) q.put("notify", msg({}, `t${i}`));
    const r = await run({ budgetMs: 240_000, readBatch: 2, tenantInFlight: 1, globalConcurrency: 1 });
    expect(r.stoppedBy).toBe("budget");
    // rounds at t=0,120,... pull window ends at 210 s: reads at 0 s and 120 s only
    expect(r.processed).toBe(4);
    expect(q.list("notify").length).toBe(96);
  });

  it("does not pull at all when already past the pull window", async () => {
    registerHandler("notify", "k", async () => "done");
    q.put("notify", msg());
    const r = await run({ budgetMs: 10_000 });
    expect(r.stoppedBy).toBe("budget");
    expect(q.readLog).toHaveLength(0);
  });

  it("stops at the maxRounds guard even if queues never empty", async () => {
    registerHandler("notify", "k", async () => "done");
    for (let i = 0; i < 50; i++) q.put("notify", msg());
    const r = await run({ readBatch: 1, maxRounds: 3 });
    expect(r.stoppedBy).toBe("rounds");
    expect(r.processed).toBe(3);
  });
});

describe("drainer: per-tenant cap", () => {
  it("handles at most tenantPerPass per tenant per pass and defers the rest without penalty", async () => {
    const seen: string[] = [];
    registerHandler("notify", "k", async (_p, ctx) => { seen.push(ctx.tenantId ?? "-"); return "done"; });
    for (let i = 0; i < 12; i++) q.put("notify", msg({}, "noisy"));
    for (let i = 0; i < 3; i++) q.put("notify", msg({}, "quiet"));
    const r = await run({ tenantPerPass: 5, maxRounds: 1 });
    expect(seen.filter((t) => t === "noisy")).toHaveLength(5);
    expect(seen.filter((t) => t === "quiet")).toHaveLength(3);
    expect(r.deferred).toBe(7);
    const left = q.list("notify");
    expect(left).toHaveLength(7);
    // deferred copies keep their attempt count: still a first attempt when they come back
    expect(left.every((m) => (m.message.attempt ?? 0) === 0)).toBe(true);
    expect(left.every((m) => q.delayOf("notify", m.msg_id) > 0)).toBe(true);
  });

  it("never runs more than tenantInFlight handlers at once for one tenant", async () => {
    let live = 0, peak = 0;
    registerHandler("notify", "k", async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return "done"; });
    for (let i = 0; i < 10; i++) q.put("notify", msg({}, "one"));
    await run({ tenantInFlight: 2, tenantPerPass: 20 });
    expect(peak).toBe(2);
  });

  it("lets other tenants run in parallel with a busy one", async () => {
    let live = 0, peak = 0;
    registerHandler("notify", "k", async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return "done"; });
    for (const t of ["a", "b", "c", "d"]) for (let i = 0; i < 3; i++) q.put("notify", msg({}, t));
    await run({ tenantInFlight: 2 });
    expect(peak).toBeGreaterThan(2);
    expect(peak).toBeLessThanOrEqual(8);
  });
});

describe("drainer: idempotent redelivery", () => {
  it("the same message delivered twice leaves the same effect (handlers dedupe on the payload key)", async () => {
    const effects = new Set<string>();
    let calls = 0;
    registerHandler<{ dedupe: string }>("notify", "k", async (p) => { calls++; effects.add(p.dedupe); return "done"; });
    q.put("notify", { kind: "k", tenant_id: "t1", payload: { dedupe: "nt:1:r1" } });
    q.put("notify", { kind: "k", tenant_id: "t1", payload: { dedupe: "nt:1:r1" } }); // redelivered duplicate
    const r = await run();
    expect(r.processed).toBe(2);
    expect(calls).toBe(2);
    expect([...effects]).toEqual(["nt:1:r1"]);
  });

  it("a crash between enqueue-retry and delete only duplicates, never loses", async () => {
    registerHandler("notify", "k", async () => "retry");
    q.put("notify", msg());
    const realDelete = q.delete.bind(q);
    q.delete = async () => { throw new Error("connection reset"); };
    const r = await run();
    q.delete = realDelete;
    expect(r.failed).toBe(1);
    expect(q.list("notify").length).toBeGreaterThanOrEqual(1);
  });
});
