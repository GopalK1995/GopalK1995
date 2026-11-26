import { describe, expect, it, vi } from "vitest";
import { handleDeletionCallback, NotConfiguredError, statusUrl, isMissingTable, CODE_RE, newConfirmationCode, type DeletionDeps, type DeletionRow, type DeletionStore } from "../meta-deletion";
import { signRequest } from "../meta-signed-request";

const SECRET = "s3cret";
const good = () => signRequest({ algorithm: "HMAC-SHA256", user_id: "777" }, SECRET);

function memStore(over: Partial<DeletionStore> = {}, conns: string[] = []) {
  const rows: DeletionRow[] = [];
  const store: DeletionStore = {
    async openRequestFor(u) { return rows.find((r) => r.metaUserId === u && r.status !== "completed") ?? null; },
    async insert(i) { const r: DeletionRow = { id: `id${rows.length + 1}`, confirmationCode: i.confirmationCode, metaUserId: i.metaUserId, status: "received", requestedAt: "2026-11-26T00:00:00Z", completedAt: null }; rows.push(r); return r; },
    async setStatus(id, status) { const r = rows.find((x) => x.id === id)!; r.status = status; },
    async byCode(c) { return rows.find((r) => r.confirmationCode === c) ?? null; },
    async connectionsFor() { return conns; },
    ...over,
  };
  return { rows, store };
}
const mk = (over: Partial<DeletionDeps> = {}, conns: string[] = [], storeOver: Partial<DeletionStore> = {}) => {
  const m = memStore(storeOver, conns);
  const disconnect = vi.fn(async (_id: string) => true);
  const log = { info: vi.fn(), error: vi.fn() };
  const deps: DeletionDeps = { secret: SECRET, store: m.store, disconnect, baseUrl: "https://crm.example/", log, newCode: () => "CODE12345678", ...over };
  return { ...m, disconnect, log, deps };
};

describe("handleDeletionCallback", () => {
  it("records a request and returns the status url and code", async () => {
    const t = mk();
    const r = await handleDeletionCallback(good(), t.deps);
    expect(r).toEqual({ status: 200, body: { url: "https://crm.example/legal/data-deletion/status?code=CODE12345678", confirmation_code: "CODE12345678" } });
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ metaUserId: "777", status: "received" });
    expect(t.disconnect).not.toHaveBeenCalled();
  });
  it("returns 400 for a bad signature, wrong secret, or missing field, and writes nothing", async () => {
    const t = mk();
    for (const bad of [signRequest({ algorithm: "HMAC-SHA256", user_id: "1" }, "wrong"), "garbage", undefined, null]) {
      expect(await handleDeletionCallback(bad, t.deps)).toEqual({ status: 400, body: { error: "invalid_signed_request" } });
    }
    expect(t.rows).toHaveLength(0);
  });
  it("returns 503 not configured when the app secret is missing, without crashing", async () => {
    const t = mk({ secret: undefined });
    expect(await handleDeletionCallback(good(), t.deps)).toEqual({ status: 503, body: { error: "not_configured" } });
    expect(t.log.error).toHaveBeenCalled();
  });
  it("returns 503 (logged) when the table does not exist yet", async () => {
    const t = mk({}, [], { async openRequestFor() { throw new NotConfiguredError("meta_deletion_requests"); } });
    expect(await handleDeletionCallback(good(), t.deps)).toEqual({ status: 503, body: { error: "not_configured" } });
    expect(t.log.error).toHaveBeenCalledWith("meta_data_deletion_not_configured", expect.anything());
  });
  it("returns 500 for an unexpected store failure and does not leak the message", async () => {
    const t = mk({}, [], { async insert() { throw new Error("boom password=x"); } });
    const r = await handleDeletionCallback(good(), t.deps);
    expect(r).toEqual({ status: 500, body: { error: "server_error" } });
    expect(JSON.stringify(t.log.error.mock.calls)).not.toContain("password");
  });
  it("is idempotent: a Meta retry returns the same code and does not disconnect twice", async () => {
    const t = mk({}, ["conn-1"]);
    const a = await handleDeletionCallback(good(), t.deps);
    const b = await handleDeletionCallback(good(), t.deps);
    expect(a).toEqual(b);
    expect(t.rows).toHaveLength(1);
    expect(t.disconnect).toHaveBeenCalledTimes(1);
  });
  it("disconnects matching connections and marks the request disconnected, never completed", async () => {
    const t = mk({}, ["c1", "c2"]);
    await handleDeletionCallback(good(), t.deps);
    expect(t.disconnect).toHaveBeenCalledWith("c1");
    expect(t.disconnect).toHaveBeenCalledWith("c2");
    expect(t.rows[0].status).toBe("disconnected");
  });
  it("keeps status received when a disconnect fails, and still answers 200", async () => {
    const t = mk({ disconnect: async () => { throw new Error("vault down"); } }, ["c1"]);
    const r = await handleDeletionCallback(good(), t.deps);
    expect(r.status).toBe(200);
    expect(t.rows[0].status).toBe("received");
  });
});

describe("helpers", () => {
  it("builds the status url without double slashes and encodes the code", () => {
    expect(statusUrl("https://a.example///", "a b")).toBe("https://a.example/legal/data-deletion/status?code=a%20b");
  });
  it("generates url-safe codes that pass the code pattern", () => {
    const c = newConfirmationCode();
    expect(c).toMatch(CODE_RE);
    expect(newConfirmationCode()).not.toBe(c);
  });
  it("recognises missing-table error codes only", () => {
    expect(isMissingTable("42P01")).toBe(true);
    expect(isMissingTable("PGRST205")).toBe(true);
    expect(isMissingTable("23505")).toBe(false);
  });
});
