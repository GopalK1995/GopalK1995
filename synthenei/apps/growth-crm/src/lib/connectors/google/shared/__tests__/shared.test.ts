// Token refresh and revoked-grant detection, API backoff and error classification, incremental window planning, Showcase switch.
import { describe, expect, it } from "vitest";
import { CredentialError, TransientError } from "../../../core/types";
import { googleJson } from "../api";
import { MOCK_TOKEN } from "../constants";
import { addDays, asDailyCursor, isDay, istDay, planWindow, type WindowPolicy } from "../dates";
import { classify, errorFromResponse } from "../errors";
import { shouldMock } from "../mode";
import { bearerOf, refreshGoogleToken } from "../token";

const ENV = { GOOGLE_OAUTH_CLIENT_ID: "client-id", GOOGLE_OAUTH_CLIENT_SECRET: "client-secret" };
const res = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const fetchOf = (...rs: (Response | Error)[]) => { const calls: { url: string; init?: RequestInit }[] = []; const f = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); const r = rs.shift(); if (!r) throw new Error("no more responses"); if (r instanceof Error) throw r; return r; }) as unknown as typeof fetch; return Object.assign(f, { calls }); };

describe("refreshGoogleToken", () => {
  it("posts a refresh_token grant, keeps the stored refresh token and returns the expiry", async () => {
    const f = fetchOf(res(200, { access_token: "new-access", expires_in: 3599, token_type: "Bearer" }));
    const out = await refreshGoogleToken({ secrets: { access_token: "old", refresh_token: "r1" }, env: ENV, fetchImpl: f });
    expect(out).toEqual({ secrets: { access_token: "new-access", refresh_token: "r1" }, expiresInSec: 3599 });
    const body = new URLSearchParams(String(f.calls[0].init?.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("r1");
    expect(body.get("client_id")).toBe("client-id");
  });
  it("a revoked or expired grant (invalid_grant) is a CredentialError, with no vendor text or token in the message", async () => {
    const f = fetchOf(res(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }));
    const err = await refreshGoogleToken({ secrets: { refresh_token: "secret-refresh" }, env: ENV, fetchImpl: f }).catch((e) => e);
    expect(err).toBeInstanceOf(CredentialError);
    expect(err.message).not.toContain("secret-refresh");
    expect(err.message).not.toContain("expired or revoked.");
  });
  it("rotates the refresh token when Google sends a new one", async () => {
    const f = fetchOf(res(200, { access_token: "a", refresh_token: "r2", expires_in: 100 }));
    expect((await refreshGoogleToken({ secrets: { refresh_token: "r1" }, env: ENV, fetchImpl: f })).secrets.refresh_token).toBe("r2");
  });
  it("server errors, throttling and network failures are transient (retry), not a reconnect prompt", async () => {
    for (const r of [res(503, {}), res(429, {}), new Error("offline")]) {
      await expect(refreshGoogleToken({ secrets: { refresh_token: "r" }, env: ENV, fetchImpl: fetchOf(r) })).rejects.toBeInstanceOf(TransientError);
    }
  });
  it("no refresh token or no app configuration needs the owner", async () => {
    await expect(refreshGoogleToken({ secrets: { access_token: "a" }, env: ENV, fetchImpl: fetchOf() })).rejects.toBeInstanceOf(CredentialError);
    await expect(refreshGoogleToken({ secrets: { refresh_token: "r" }, env: {}, fetchImpl: fetchOf() })).rejects.toBeInstanceOf(CredentialError);
    expect(() => bearerOf({})).toThrow(CredentialError);
  });
});

describe("classify / errorFromResponse", () => {
  it("tells quota from permission on a 403 by the reason in the body", () => {
    expect(classify(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } })).toBe("quota");
    expect(classify(403, { error: { status: "PERMISSION_DENIED", message: "x" } })).toBe("permission");
    expect(classify(429, { error: { status: "RESOURCE_EXHAUSTED" } })).toBe("quota");
    expect(classify(401, {})).toBe("auth");
    expect(classify(500, undefined)).toBe("server");
    expect(classify(404, {})).toBe("not_found");
  });
  it("reads the Google Ads error code shape and the developer-token case", () => {
    const ads = { error: { code: 403, status: "PERMISSION_DENIED", details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" } }] }] } };
    expect(classify(403, ads)).toBe("developer_token");
    expect(errorFromResponse(403, ads)).toBeInstanceOf(CredentialError);
    expect(errorFromResponse(403, ads).message).toMatch(/developer token/i);
    expect(classify(429, { error: { details: [{ errors: [{ errorCode: { quotaError: "RESOURCE_EXHAUSTED" } }] }] } })).toBe("quota");
  });
  it("auth/permission need the owner; quota/5xx are transient; a bad request is a plain error", () => {
    expect(errorFromResponse(401, {})).toBeInstanceOf(CredentialError);
    expect(errorFromResponse(403, { error: { status: "PERMISSION_DENIED" } })).toBeInstanceOf(CredentialError);
    expect(errorFromResponse(429, {}, 5000)).toMatchObject({ name: "TransientError", retryAfterMs: 5000 });
    expect(errorFromResponse(400, { error: { message: "secret query text" } }).message).not.toContain("secret");
  });
});

describe("googleJson (backoff)", () => {
  const sleeps: number[] = [];
  const deps = (f: typeof fetch, extra = {}) => ({ fetch: f, sleep: async (ms: number) => { sleeps.push(ms); }, random: () => 0.5, ...extra });
  const req = { method: "GET" as const, url: "https://example.invalid/x", token: "tok" };
  it("sends the bearer token and returns the JSON", async () => {
    const f = fetchOf(res(200, { ok: 1 }));
    expect(await googleJson(req, deps(f))).toEqual({ ok: 1 });
    expect((f.calls[0].init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
  it("retries 429 honouring Retry-After, then succeeds", async () => {
    sleeps.length = 0;
    const f = fetchOf(res(429, { error: { status: "RESOURCE_EXHAUSTED" } }, { "retry-after": "2" }), res(200, { ok: 1 }));
    expect(await googleJson(req, deps(f))).toEqual({ ok: 1 });
    expect(sleeps).toEqual([2000]);
  });
  it("retries a 403 that is really a rate limit, and grows the delay exponentially for 5xx", async () => {
    sleeps.length = 0;
    const f = fetchOf(res(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } }), res(503, {}), res(503, {}), res(200, { ok: 1 }));
    await googleJson(req, deps(f));
    expect(sleeps).toHaveLength(3);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
    expect(sleeps[2]).toBeGreaterThan(sleeps[1]);
  });
  it("gives up with a TransientError after the retry cap, carrying Retry-After", async () => {
    const f = fetchOf(...Array.from({ length: 3 }, () => res(429, {}, { "retry-after": "7" })));
    await expect(googleJson(req, deps(f, { maxRetries: 2 }))).rejects.toMatchObject({ name: "TransientError", retryAfterMs: 7000 });
  });
  it("401 and a real permission 403 are not retried: the owner has to reconnect", async () => {
    const f1 = fetchOf(res(401, {}));
    await expect(googleJson(req, deps(f1))).rejects.toBeInstanceOf(CredentialError);
    expect(f1.calls).toHaveLength(1);
    await expect(googleJson(req, deps(fetchOf(res(403, { error: { status: "PERMISSION_DENIED" } }))))).rejects.toBeInstanceOf(CredentialError);
  });
  it("network errors are retried then surface as transient", async () => {
    await expect(googleJson(req, deps(fetchOf(new Error("x"), new Error("x")), { maxRetries: 1 }))).rejects.toBeInstanceOf(TransientError);
  });
});

describe("planWindow (incremental, IST)", () => {
  const P: WindowPolicy = { afterMinutesIst: 330, lookbackDays: 3, backfillDays: 90 };
  const at = (iso: string) => new Date(iso);
  it("first run backfills N days ending yesterday (IST) once the sync time has passed", () => {
    expect(planWindow(at("2026-11-09T05:00:00Z"), undefined, P)).toEqual({ since: "2026-08-11", until: "2026-11-08" });   // 10:30 IST
  });
  it("before the sync time the newest day is not final: ends the day before yesterday", () => {
    expect(planWindow(at("2026-11-08T23:30:00Z"), undefined, P)?.until).toBe("2026-11-07");   // 05:00 IST on the 9th
    expect(planWindow(at("2026-11-09T00:00:00Z"), undefined, P)?.until).toBe("2026-11-08");   // 05:30 IST on the 9th
  });
  it("later runs re-read the trailing days and return null when current", () => {
    expect(planWindow(at("2026-11-09T05:00:00Z"), "2026-11-06", P)).toEqual({ since: "2026-11-04", until: "2026-11-08" });
    expect(planWindow(at("2026-11-09T05:00:00Z"), "2026-11-08", P)).toBeNull();
    expect(planWindow(at("2026-11-09T05:00:00Z"), "2026-11-20", P)).toBeNull();
  });
  it("IST day rolls over at 18:30 UTC", () => {
    expect(istDay(at("2026-11-08T18:29:00Z"))).toBe("2026-11-08");
    expect(istDay(at("2026-11-08T18:30:00Z"))).toBe("2026-11-09");
  });
  it("day helpers and cursor parsing reject junk", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(isDay("2026-02-30")).toBe(false);
    expect(asDailyCursor({ through: "bad", win: { since: "2026-11-01", until: "x" } })).toEqual({ through: undefined, win: undefined });
    expect(asDailyCursor({ through: "2026-11-01", win: { since: "2026-11-01", until: "2026-11-02", page: 7 } }).win).toEqual({ since: "2026-11-01", until: "2026-11-02", page: 7 });
  });
});

describe("Showcase switch", () => {
  it("the sandbox token (or demo without credentials) selects the mock, never in production", () => {
    expect(shouldMock({ access_token: MOCK_TOKEN }, {})).toBe(true);
    expect(shouldMock({}, { APP_ENV: "demo" })).toBe(true);
    expect(shouldMock({ access_token: "real" }, { APP_ENV: "demo" })).toBe(false);
    expect(() => shouldMock({ access_token: MOCK_TOKEN }, { APP_ENV: "production" })).toThrow(CredentialError);
    expect(shouldMock({ access_token: "real" }, { APP_ENV: "production" })).toBe(false);
  });
});
