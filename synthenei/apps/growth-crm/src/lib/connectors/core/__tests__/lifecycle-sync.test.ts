import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectWithCredentials, completeOAuth, disconnect, refreshIfNeeded, testConnection } from "../lifecycle";
import { runPush, runSync } from "../sync";
import { MOCK_EXPIRED_KEY, MOCK_TOTAL, MOCK_VALID_KEY, mockConnector } from "../mock";
import { loadSecrets } from "../secrets";
import { filterByConsent } from "../consent";
import { makeVendorHttp, parseRetryAfter } from "../http";
import { registerConnector, resetRegistry } from "../../registry";
import { CredentialError, TransientError, type ConnectorDef } from "../types";
import { ACTOR, makeDeps, silentLog } from "./fakes";

beforeEach(() => { resetRegistry(); silentLog.lines.length = 0; });

describe("lifecycle: connect, test, reconnect, disconnect", () => {
  it("connects the mock connector in sandbox, keeps the key only in the vault and audits it", async () => {
    const { deps, store, vault, audits } = makeDeps();
    const r = await connectWithCredentials(deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY });
    expect(r.ok).toBe(true);
    const conn = [...store.conns.values()][0];
    expect(conn.status).toBe("sandbox");
    expect(conn.mode).toBe("sandbox");
    expect(conn.credentialSecretId).toBeTruthy();
    expect(await loadSecrets(vault, conn)).toEqual({ api_key: MOCK_VALID_KEY });
    // the secret is nowhere else: not in the connection row, the audit rows, or the logs
    const everything = JSON.stringify([conn, audits, silentLog.lines, r]);
    expect(everything).not.toContain(MOCK_VALID_KEY);
    expect(audits.map((a) => a.action)).toEqual(["connector.connected"]);
  });
  it("is live only when availability is live and the gate is ready", async () => {
    const { deps, store } = makeDeps();
    store.availability.mock = { mode: "live", gateStatus: "ready" };
    const r = await connectWithCredentials(deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY });
    expect(r.ok && r.value.status).toBe("connected");
    expect(r.ok && r.value.mode).toBe("live");
  });
  it("refuses when unavailable, when env is missing, when the gate is open to nobody", async () => {
    const a = makeDeps(); a.store.availability.mock = { mode: "disabled", gateStatus: "ready" };
    expect(await connectWithCredentials(a.deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY })).toEqual({ ok: false, code: "not_available" });
    const b = makeDeps(); b.store.availability.mock = { mode: "live", gateStatus: "needs_vendor_approval" };
    expect(await connectWithCredentials(b.deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY })).toEqual({ ok: false, code: "needs_vendor_approval" });
    const needsEnv: ConnectorDef = { ...mockConnector, id: "needs-env" as ConnectorDef["id"], requiredEnv: ["NEEDS_ENV_VAR"] };
    registerConnector(needsEnv);
    const c = makeDeps(); c.store.availability["needs-env"] = { mode: "sandbox", gateStatus: "ready" };
    expect(await connectWithCredentials(c.deps, ACTOR, "needs-env", { api_key: "x" })).toEqual({ ok: false, code: "not_configured" });
    expect(await connectWithCredentials(c.deps, ACTOR, "nope", {})).toEqual({ ok: false, code: "unknown_connector" });
    expect(a.store.conns.size + b.store.conns.size + c.store.conns.size).toBe(0);
  });
  it("rejects bad credentials without creating a connection or a vault entry, and never echoes the value", async () => {
    const { deps, store, vault } = makeDeps();
    const r = await connectWithCredentials(deps, ACTOR, "mock", { api_key: "wrong-key-value" });
    expect(r).toEqual({ ok: false, code: "credentials_rejected" });
    expect(store.conns.size).toBe(0);
    expect(vault.secrets.size).toBe(0);
    expect(JSON.stringify(r)).not.toContain("wrong-key-value");
    expect(await connectWithCredentials(deps, ACTOR, "mock", { api_key: "" })).toEqual({ ok: false, code: "invalid_input", field: "api_key" });
  });
  it("a second connect while connected is refused; reconnect after needs_attention replaces the secret", async () => {
    const { deps, store, vault } = makeDeps();
    await connectWithCredentials(deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY });
    expect(await connectWithCredentials(deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY })).toEqual({ ok: false, code: "already_connected" });
    const conn = [...store.conns.values()][0];
    const firstSecret = conn.credentialSecretId;
    conn.status = "needs_attention";
    const r = await connectWithCredentials(deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY });
    expect(r.ok).toBe(true);
    expect(store.conns.size).toBe(1);
    expect(conn.status).toBe("sandbox");
    expect(conn.credentialSecretId).not.toBe(firstSecret);
    expect(vault.secrets.has(firstSecret as string)).toBe(false);
  });
  it("test connection: healthy clears the error, rejected credentials set needs_attention", async () => {
    const { deps, store, vault } = makeDeps();
    await connectWithCredentials(deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY });
    const conn = [...store.conns.values()][0];
    expect(await testConnection(deps, conn.id)).toEqual({ ok: true, value: { healthy: true } });
    vault.secrets.set(conn.credentialSecretId as string, JSON.stringify({ api_key: MOCK_EXPIRED_KEY }));
    expect(await testConnection(deps, conn.id)).toEqual({ ok: true, value: { healthy: false } });
    expect(conn.status).toBe("needs_attention");
    expect(conn.lastError).toMatch(/rejected the credentials/);
  });
  it("disconnect deletes the vault secret, audits first, and keeps the row as history", async () => {
    const { deps, store, vault, audits } = makeDeps();
    await connectWithCredentials(deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY });
    const conn = [...store.conns.values()][0];
    const r = await disconnect(deps, conn.id, "u-1");
    expect(r.ok).toBe(true);
    expect(vault.secrets.size).toBe(0);
    expect(conn.status).toBe("disconnected");
    expect(conn.credentialSecretId).toBeNull();
    expect(audits.map((a) => a.action)).toEqual(["connector.connected", "connector.disconnected"]);
  });
  it("disconnect does nothing when the audit write fails", async () => {
    const { deps, store, vault } = makeDeps();
    await connectWithCredentials(deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY });
    const conn = [...store.conns.values()][0];
    deps.audit = async () => { throw new Error("audit down"); };
    expect(await disconnect(deps, conn.id, "u-1")).toEqual({ ok: false, code: "audit_failed" });
    expect(vault.secrets.size).toBe(1);
    expect(conn.status).toBe("sandbox");
  });
});

describe("token refresh", () => {
  const oauthDef: ConnectorDef = {
    ...mockConnector, id: "oauth-test" as ConnectorDef["id"], auth: "oauth2", credentialFields: undefined,
    oauth: { authorizeUrl: "https://v.test/a", tokenUrl: "https://v.test/t", scopes: ["x"], pkce: true, clientIdEnv: "OT_ID", clientSecretEnv: "OT_SECRET" },
    requiredEnv: [],
  };
  async function connected(refreshFn: ConnectorDef["refresh"]) {
    registerConnector({ ...oauthDef, refresh: refreshFn });
    const t = makeDeps({ now: () => new Date("2026-05-01T10:00:00Z"), env: { OT_ID: "id", OT_SECRET: "secret" } });
    t.store.availability["oauth-test"] = { mode: "sandbox", gateStatus: "ready" };
    const r = await completeOAuth(t.deps, ACTOR, "oauth-test", { secrets: { access_token: "AT-1", refresh_token: "RT-1" }, expiresInSec: 120 });
    expect(r.ok).toBe(true);
    return { ...t, conn: [...t.store.conns.values()][0] };
  }
  it("refreshes a token that is about to expire and stores the new bundle in the vault", async () => {
    const { deps, conn, vault } = await connected(async () => ({ secrets: { access_token: "AT-2" }, expiresInSec: 3600 }));
    const out = await refreshIfNeeded(deps, conn);
    expect(out).toEqual({ ok: true, refreshed: true });
    expect(await loadSecrets(vault, conn)).toEqual({ access_token: "AT-2", refresh_token: "RT-1" });
    expect(conn.tokenExpiresAt).toBe("2026-05-01T11:00:00.000Z");
  });
  it("a token far from expiry is left alone", async () => {
    const fn = vi.fn();
    const { deps, conn } = await connected(fn);
    conn.tokenExpiresAt = "2026-05-02T10:00:00.000Z";
    expect(await refreshIfNeeded(deps, conn)).toEqual({ ok: true, refreshed: false });
    expect(fn).not.toHaveBeenCalled();
  });
  it("a dead refresh token sets needs_attention with a readable reason, and the sync writes a failed run instead of calling the vendor", async () => {
    const { deps, store, conn } = await connected(async () => { throw new CredentialError("The vendor refused the authorisation (reconnect needed)"); });
    const out = await runSync(deps, { connectionId: conn.id, trigger: "poll" });
    expect(conn.status).toBe("needs_attention");
    expect(conn.lastError).toMatch(/reconnect/i);
    expect(out.skipped).toBe("needs_attention");
    expect(store.runs.length).toBeGreaterThan(0);
    expect(store.runs.every((r) => r.status === "failed" && /Reconnect/.test(r.error ?? ""))).toBe(true);
  });
  it("a transient refresh error asks the job to retry and leaves the status alone", async () => {
    const { deps, conn } = await connected(async () => { throw new TransientError("busy"); });
    const out = await runSync(deps, { connectionId: conn.id, trigger: "poll" });
    expect(out.retry).toBe(true);
    expect(conn.status).toBe("sandbox");
  });
});

describe("sync runner", () => {
  async function ready() {
    const t = makeDeps();
    await connectWithCredentials(t.deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY });
    return { ...t, conn: [...t.store.conns.values()][0] };
  }
  it("pages through the stream, writes one partial run with a scrubbed sample, advances the cursor and links records", async () => {
    const { deps, store, conn } = await ready();
    const out = await runSync(deps, { connectionId: conn.id, trigger: "manual", startedBy: "u-1" });
    expect(out.streams).toHaveLength(1);
    expect(out.streams[0]).toMatchObject({ status: "partial", rowsIn: MOCK_TOTAL - 1, rowsRejected: 1 });
    expect(store.cursors.get(`${conn.id}:contacts`)).toBe(MOCK_TOTAL);
    expect(Object.keys(store.tables.leads)).toHaveLength(MOCK_TOTAL - 1);
    expect(store.links).toHaveLength(MOCK_TOTAL - 1);
    const run = store.runs[0];
    expect(run).toMatchObject({ kind: "manual", status: "partial", rowsIn: MOCK_TOTAL - 1, rowsRejected: 1 });
    expect(run.error).toBe("1 row could not be imported");
    expect(JSON.stringify(run.payloadSample)).not.toMatch(/Mock Contact|example\.test|98450/);
    expect(conn.lastSyncAt).toBeTruthy();
    // transforms ran: E.164 phone, lower-cased email
    const first = store.tables.leads["leads-1"];
    expect(first).toMatchObject({ full_name: "Mock Contact 1", phone: "+919845010001", email: "mock1@example.test", tenant_id: "t-1", workspace_id: "w-1" });
  });
  it("is idempotent: re-running from the start creates no duplicates and rewrites nothing", async () => {
    const { deps, store, conn } = await ready();
    await runSync(deps, { connectionId: conn.id, trigger: "poll" });
    store.cursors.clear();   // simulate a redelivered job that lost the cursor
    const before = JSON.stringify(store.tables.leads);
    const out = await runSync(deps, { connectionId: conn.id, trigger: "poll" });
    expect(out.streams[0].rowsIn).toBe(MOCK_TOTAL - 1);
    expect(Object.keys(store.tables.leads)).toHaveLength(MOCK_TOTAL - 1);
    expect(store.links).toHaveLength(MOCK_TOTAL - 1);
    expect(JSON.stringify(store.tables.leads)).toBe(before);
  });
  it("skips a stream that is already running (duplicate job delivery)", async () => {
    const { deps, store, conn } = await ready();
    await store.startRun({ connectionId: conn.id, tenantId: "t-1", workspaceId: "w-1", kind: "poll", stream: "contacts", mode: "sandbox" });
    const out = await runSync(deps, { connectionId: conn.id, trigger: "poll" });
    expect(out.streams[0].status).toBe("skipped");
    expect(store.runs).toHaveLength(1);
  });
  it("dedupes on match keys: an existing lead with the same phone is linked, not duplicated", async () => {
    const { deps, store, conn } = await ready();
    store.tables.leads.existing = { phone: "+919845010001", full_name: "Old Name" };
    await runSync(deps, { connectionId: conn.id, trigger: "poll" });
    expect(Object.keys(store.tables.leads)).toHaveLength(MOCK_TOTAL - 1);
    expect(store.tables.leads.existing.full_name).toBe("Mock Contact 1");
  });
  it("tenant field map overrides the default for the same field", async () => {
    const { deps, store, conn } = await ready();
    store.fieldMap = [{ externalObject: "Contact", externalField: "city", localTable: "leads", localColumn: "district", direction: "in" }];
    await runSync(deps, { connectionId: conn.id, trigger: "poll" });
    expect(store.tables.leads["leads-1"]).toMatchObject({ district: "Bengaluru" });
  });
  it("a credential failure inside a stream flips needs_attention and the run error is human readable, with no secret", async () => {
    const { deps, store, vault, conn } = await ready();
    vault.secrets.set(conn.credentialSecretId as string, JSON.stringify({ api_key: MOCK_EXPIRED_KEY }));
    const out = await runSync(deps, { connectionId: conn.id, trigger: "poll" });
    expect(out.streams[0].status).toBe("failed");
    expect(conn.status).toBe("needs_attention");
    expect(store.runs[0].error).toMatch(/Reconnect it to resume syncing/);
    expect(JSON.stringify([store.runs, silentLog.lines])).not.toContain(MOCK_EXPIRED_KEY);
  });
  it("does nothing for disconnected, unavailable or unknown connections", async () => {
    const { deps, store, conn } = await ready();
    store.availability.mock = { mode: "disabled", gateStatus: "ready" };
    expect((await runSync(deps, { connectionId: conn.id, trigger: "poll" })).skipped).toBe("not_available");
    store.availability.mock = { mode: "sandbox", gateStatus: "ready" };
    conn.status = "disconnected"; conn.credentialSecretId = null;
    expect((await runSync(deps, { connectionId: conn.id, trigger: "poll" })).skipped).toBe("not_connected");
    expect((await runSync(deps, { connectionId: "nope", trigger: "poll" })).skipped).toBe("not_found");
    expect(store.runs).toHaveLength(0);
  });
  it("emits sync events best effort", async () => {
    const { deps, conn } = await ready();
    const emit = vi.fn(async () => { throw new Error("bus down"); });
    deps.emit = emit;
    const out = await runSync(deps, { connectionId: conn.id, trigger: "poll" });
    expect(out.streams[0].status).toBe("partial");
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe("consent enforcement", () => {
  it("filterByConsent skips contacts that fail can_contact and checks each one", async () => {
    const { store } = makeDeps();
    store.consent.set("l-1", true);
    const r = await filterByConsent(store, ["l-1", "l-2", "l-3"], "whatsapp");
    expect(r).toEqual({ allowed: ["l-1"], skipped: ["l-2", "l-3"] });
    expect(store.canContactCalls).toEqual(["l-1", "l-2", "l-3"]);
    const none = await filterByConsent(store, ["l-9"], undefined);
    expect(none.allowed).toEqual(["l-9"]);
  });
  it("a push only reaches consenting leads; the others are counted as rejected with a reason", async () => {
    const t = makeDeps();
    await connectWithCredentials(t.deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY });
    const conn = [...t.store.conns.values()][0];
    t.store.consent.set("l-1", true);
    const out = await runPush(t.deps, { connectionId: conn.id, pushKey: "send_message", leadIds: ["l-1", "l-2"] });
    expect(out).toMatchObject({ sent: 1, skippedNoConsent: 1, failed: 0 });
    const run = t.store.runs[0];
    expect(run).toMatchObject({ kind: "outbound", status: "partial", rowsOut: 1, rowsRejected: 1 });
    expect(JSON.stringify(run.payloadSample)).toContain("no_consent");
  });
  it("a consent check failure sends nothing (fails closed)", async () => {
    const t = makeDeps();
    await connectWithCredentials(t.deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY });
    const conn = [...t.store.conns.values()][0];
    t.store.canContact = async () => { throw new Error("db down"); };
    await expect(runPush(t.deps, { connectionId: conn.id, pushKey: "send_message", leadIds: ["l-1"] })).rejects.toThrow();
    expect(t.store.runs).toHaveLength(0);
  });
  it("an unknown push or a disconnected connection is skipped", async () => {
    const t = makeDeps();
    await connectWithCredentials(t.deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY });
    const conn = [...t.store.conns.values()][0];
    expect((await runPush(t.deps, { connectionId: conn.id, pushKey: "nope", leadIds: ["l-1"] })).skipped).toBe("unknown_push");
    conn.status = "disconnected";
    expect((await runPush(t.deps, { connectionId: conn.id, pushKey: "send_message", leadIds: ["l-1"] })).skipped).toBe("not_connected");
  });
});

describe("vendor http: rate limit and backoff", () => {
  const res = (status: number, headers: Record<string, string> = {}, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers });
  const policy = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 10_000 };
  it("honours Retry-After on 429 and then succeeds", async () => {
    const sleeps: number[] = [];
    const f = vi.fn().mockResolvedValueOnce(res(429, { "retry-after": "2" })).mockResolvedValueOnce(res(200, {}, { ok: 1 }));
    const http = makeVendorHttp(policy, { fetch: f as unknown as typeof fetch, sleep: async (ms) => { sleeps.push(ms); } });
    expect(await http.json({ method: "GET", url: "https://v.test/x" })).toEqual({ ok: 1 });
    expect(sleeps).toEqual([2000]);
  });
  it("backs off with jitter on 5xx and gives up as a transient error after maxRetries", async () => {
    const sleeps: number[] = [];
    const f = vi.fn(async () => res(503));
    const http = makeVendorHttp(policy, { fetch: f as unknown as typeof fetch, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0 });
    await expect(http.json({ method: "GET", url: "https://v.test/x" })).rejects.toBeInstanceOf(TransientError);
    expect(f).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([50, 100, 200]);
  });
  it("401 is a CredentialError; other 4xx fail without retry and without the body", async () => {
    const f401 = vi.fn(async () => res(401, {}, { error: "token abc123 is dead" }));
    await expect(makeVendorHttp(policy, { fetch: f401 as unknown as typeof fetch }).json({ method: "GET", url: "https://v.test/x" })).rejects.toBeInstanceOf(CredentialError);
    const f400 = vi.fn(async () => res(400, {}, { email: "a@b.com" }));
    const err = await makeVendorHttp(policy, { fetch: f400 as unknown as typeof fetch }).json({ method: "GET", url: "https://v.test/x" }).catch((e: Error) => e);
    expect((err as Error).message).toBe("Vendor request failed (HTTP 400)");
    expect(f400).toHaveBeenCalledTimes(1);
  });
  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:05 GMT", Date.parse("Wed, 21 Oct 2026 07:28:00 GMT"))).toBe(5000);
    expect(parseRetryAfter("soon")).toBeUndefined();
  });
});
