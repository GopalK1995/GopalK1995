import { beforeEach, describe, expect, it, vi } from "vitest";

const env = { demoMode: false, supabaseConfigured: true, serviceRoleKey: "svc", jobsTickSecret: "tick-secret-aaaaaaaaaaaaaaaa", cronSecret: "cron-secret-bbbbbbbbbbbbbbbb" };
const runTick = vi.fn();

vi.mock("@/lib/env", () => ({ loadEnv: () => env }));
vi.mock("@/lib/db/service", () => ({ serviceDb: () => ({}) }));
vi.mock("@/lib/jobs/tick", () => ({ runTick: (...a: unknown[]) => runTick(...a), jobLogger: () => ({ info() {}, warn() {}, error() {} }) }));

const call = async (method: "POST" | "GET", auth?: string) => {
  const { POST, GET } = await import("@/app/api/jobs/tick/route");
  const req = new Request("http://localhost/api/jobs/tick", { method, headers: auth ? { authorization: auth } : {} });
  return (method === "POST" ? POST : GET)(req);
};

beforeEach(() => {
  runTick.mockReset();
  runTick.mockResolvedValue({ processed: 3, failed: 1, dead: 0, deferred: 0, ms: 12, stoppedBy: "empty", scheduled: null });
  Object.assign(env, { demoMode: false, supabaseConfigured: true, serviceRoleKey: "svc" });
});

describe("/api/jobs/tick", () => {
  it("exports the Node runtime and a 300 s maxDuration", async () => {
    const m = await import("@/app/api/jobs/tick/route");
    expect(m.runtime).toBe("nodejs");
    expect(m.maxDuration).toBe(300);
  });
  it("is 404 in demo mode and when Supabase is not configured", async () => {
    env.demoMode = true;
    expect((await call("POST", "Bearer tick-secret-aaaaaaaaaaaaaaaa")).status).toBe(404);
    Object.assign(env, { demoMode: false, supabaseConfigured: false });
    expect((await call("POST", "Bearer tick-secret-aaaaaaaaaaaaaaaa")).status).toBe(404);
    expect(runTick).not.toHaveBeenCalled();
  });
  it("is 401 without or with a wrong secret and does not run", async () => {
    expect((await call("POST")).status).toBe(401);
    expect((await call("POST", "Bearer nope")).status).toBe(401);
    expect(runTick).not.toHaveBeenCalled();
  });
  it("runs and returns counts for the tick secret on POST and the cron secret on GET", async () => {
    const a = await call("POST", "Bearer tick-secret-aaaaaaaaaaaaaaaa");
    expect(a.status).toBe(200);
    expect(await a.json()).toMatchObject({ processed: 3, failed: 1, dead: 0, ms: 12 });
    expect((await call("GET", "Bearer cron-secret-bbbbbbbbbbbbbbbb")).status).toBe(200);
    expect(runTick).toHaveBeenCalledTimes(2);
  });
  it("answers 500 with no detail when the tick throws", async () => {
    runTick.mockRejectedValue(new Error("secret internals"));
    const r = await call("POST", "Bearer tick-secret-aaaaaaaaaaaaaaaa");
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/internals/);
  });
});
