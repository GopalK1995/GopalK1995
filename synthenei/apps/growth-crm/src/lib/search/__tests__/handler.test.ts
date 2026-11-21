import { describe, expect, it, vi } from "vitest";
import { handleSearch, SEARCH_LIMIT } from "../handler";
import { memoryStore, rateLimit } from "@/lib/security/rate-limit";

const req = (qs = "", h: Record<string, string> = {}) => new Request(`http://x.test/api/search${qs}`, { headers: h });
const ok = { hits: [] };

describe("GET /api/search handler", () => {
  it("401 without a session and never runs a search", async () => {
    const run = vi.fn();
    const r = await handleSearch(req("?q=abc"), { uid: async () => null, run });
    expect(r.status).toBe(401); expect(run).not.toHaveBeenCalled();
  });
  it("403 for cross-site requests", async () => {
    const run = vi.fn();
    expect((await handleSearch(req("?q=abc", { "sec-fetch-site": "cross-site" }), { uid: async () => "u", run })).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });
  it("passes only the sanitised query to the search", async () => {
    const run = vi.fn(async () => ok);
    await handleSearch(req(`?q=${encodeURIComponent("a,b)or(x")}`), { uid: async () => "u", run });
    expect(run).toHaveBeenCalledWith("a b or x");
  });
  it("an empty q is the bootstrap call", async () => {
    const run = vi.fn(async () => ok);
    await handleSearch(req(), { uid: async () => "u", run });
    expect(run).toHaveBeenCalledWith("");
  });
  it("one character answers tooShort without searching", async () => {
    const run = vi.fn();
    const r = await handleSearch(req("?q=a"), { uid: async () => "u", run });
    expect(await r.json()).toEqual({ hits: [], tooShort: true }); expect(run).not.toHaveBeenCalled();
  });
  it("429 with Retry-After once the limit is spent", async () => {
    const store = memoryStore();
    const limit = (k: string) => Promise.resolve(rateLimit("search", k, { limit: 2, windowMs: 10_000 }, { store }));
    const d = { uid: async () => "u", run: async () => ok, limit };
    expect((await handleSearch(req("?q=ab"), d)).status).toBe(200);
    expect((await handleSearch(req("?q=ab"), d)).status).toBe(200);
    const r = await handleSearch(req("?q=ab"), d);
    expect(r.status).toBe(429); expect(r.headers.get("retry-after")).toBeTruthy();
  });
  it("the default limit is bounded", () => { expect(SEARCH_LIMIT.limit).toBeLessThanOrEqual(60); });
  it("500 hides the cause and carries the request id", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handleSearch(req("?q=abc"), { uid: async () => "u", run: async () => { throw new Error("relation secret_table does not exist"); } });
    const text = await r.text();
    expect(r.status).toBe(500); expect(text).not.toContain("secret_table"); expect(r.headers.get("x-request-id")).toBeTruthy();
    spy.mockRestore();
  });
  it("never caches", async () => { expect((await handleSearch(req("?q=abc"), { uid: async () => "u", run: async () => ok })).headers.get("cache-control")).toBe("no-store"); });
});
