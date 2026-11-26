import { describe, expect, it, vi } from "vitest";
import { throttleHit, throttled } from "../throttle";
import { buildAuthEventArgs, emailTag, recordAuthEvent } from "../audit-events";

type Call = { fn: string; args: Record<string, unknown> };
const client = (reply: (c: Call) => { data?: unknown; error?: { code?: string } | null }, calls: Call[] = []) => ({
  rpc: (fn: string, args: Record<string, unknown>) => { const c = { fn, args }; calls.push(c); const r = reply(c); return Promise.resolve({ data: r.data ?? null, error: r.error ?? null }); },
});
const lim = { perEmail: 2, perIp: 5, windowS: 900 };

describe("throttle: service-role call first, never a client-chosen bucket", () => {
  it("sends kind, dimension and a normalised value to auth_throttle_hit and returns its verdict", async () => {
    const calls: Call[] = [];
    const svc = client(() => ({ data: true }), calls);
    const sb = client(() => { throw new Error("request client must not be used"); });
    expect(await throttleHit(sb, "login", "email", "  Victim@Example.TEST ", 8, 900, { service: () => svc })).toBe(true);
    expect(calls[0]).toEqual({ fn: "auth_throttle_hit", args: { p_kind: "login", p_dim: "email", p_value: "victim@example.test", p_limit: 8, p_window_s: 900 } });
    expect(await throttleHit(sb, "login", "email", "x@y.z", 8, 900, { service: () => client(() => ({ data: false })) })).toBe(false);
  });

  it("falls back to the legacy bucket through the request client while the new function does not exist yet", async () => {
    const calls: Call[] = [];
    const sb = client((c) => (c.fn === "rate_limit_hit" ? { data: false } : {}), calls);
    const svc = client(() => ({ error: { code: "PGRST202" } }));
    const log = vi.fn();
    expect(await throttleHit(sb, "login", "email", "A@b.c", 1, 900, { service: () => svc, log })).toBe(false);
    expect(calls[0].fn).toBe("rate_limit_hit");
    expect(calls[0].args.p_bucket).toBe("login:email:a@b.c");
    expect(log).toHaveBeenCalled();
  });

  it("falls back when the service key is not configured", async () => {
    const sb = client(() => ({ data: true }));
    const log = vi.fn();
    expect(await throttleHit(sb, "reset", "ip", "1.2.3.4", 3, 3600, { service: () => { throw new Error("no service key"); }, log })).toBe(true);
    expect(log).toHaveBeenCalled();
  });

  it("fails open (and says so) when both paths are refused, as after the migration without a service key", async () => {
    const log = vi.fn();
    const sb = client(() => ({ error: { code: "42501" } }));
    expect(await throttleHit(sb, "login", "ip", "1.2.3.4", 3, 900, { service: () => client(() => ({ error: { code: "42501" } })), log })).toBe(true);
    expect(log.mock.calls.some((c) => String(c[0]).includes("failing open"))).toBe(true);
  });

  it("refuses when either the e-mail or the address is over its limit", async () => {
    const svc = client((c) => ({ data: c.args.p_dim === "ip" ? false : true }));
    const sb = client(() => ({}));
    expect(await throttled(sb, "login", "a@b.c", "1.1.1.1", lim, { service: () => svc })).toBe(true);
    expect(await throttled(sb, "login", "a@b.c", "1.1.1.1", lim, { service: () => client(() => ({ data: true })) })).toBe(false);
  });
});

describe("auth audit events", () => {
  it("never carries the e-mail address, only a short hash tag, and uses the server-only function", async () => {
    const calls: Call[] = [];
    await recordAuthEvent({ action: "auth.login.failure", email: "Victim@Example.test", ip: "9.9.9.9", userAgent: "ua" }, { service: () => client(() => ({}), calls) });
    expect(calls[0].fn).toBe("audit_record_server");
    const a = calls[0].args;
    expect(JSON.stringify(a)).not.toContain("example.test");
    expect(a.p_detail).toEqual({ email_tag: emailTag("victim@example.test"), via: "password" });
    expect(a).toMatchObject({ p_action: "auth.login.failure", p_actor: null, p_actor_kind: "system", p_ip: "9.9.9.9", p_workspace: null });
    expect(buildAuthEventArgs({ action: "auth.login.success", uid: "u1", ip: "unknown" })).toMatchObject({ p_actor: "u1", p_actor_kind: "user", p_ip: null });
  });

  it("swallows a missing function or key and logs", async () => {
    const log = vi.fn();
    await recordAuthEvent({ action: "auth.login.success", uid: "u1" }, { service: () => client(() => ({ error: { code: "PGRST202" } })), log });
    await recordAuthEvent({ action: "auth.login.success", uid: "u1" }, { service: () => { throw new Error("no key"); }, log });
    expect(log).toHaveBeenCalledTimes(2);
  });
});
