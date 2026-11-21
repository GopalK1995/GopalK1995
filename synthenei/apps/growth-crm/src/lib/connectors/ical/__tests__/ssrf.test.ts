import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { checkFeedUrl, isPrivateAddress } from "../ssrf";

vi.mock("server-only", () => ({}));

describe("feed URL checks", () => {
  it.each([
    ["https://example.test/cal/abc.ics?s=1", true],
    ["http://example.test/cal.ics", false],
    ["ftp://example.test/cal.ics", false],
    ["file:///etc/passwd", false],
    ["javascript:alert(1)", false],
    ["https://user:pw@example.test/x", false],
    ["https://example.test:8443/x", false],
    ["https://example.test:443/x", true],
    ["https://127.0.0.1/x", false],
    ["https://[::1]/x", false],
    ["https://169.254.169.254/latest/meta-data", false],
    ["https://2130706433/x", false],
    ["https://0x7f000001/x", false],
    ["https://localhost/x", false],
    ["https://printer.local/x", false],
    ["https://db.internal/x", false],
    ["https://intranet/x", false],
    ["https://metadata.localhost/x", false],
    ["not a url", false],
    ["", false],
  ])("%s -> %s", (u, ok) => { expect(checkFeedUrl(u).ok).toBe(ok); });
  it("rejects an over-long URL", () => { expect(checkFeedUrl(`https://example.test/${"a".repeat(2100)}`).ok).toBe(false); });
});

describe("address classification", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "192.0.0.8", "198.18.0.1", "224.0.0.1", "255.255.255.255", "203.0.113.5",
    "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:db8::1", "not-an-ip", "1.2.3", "999.1.1.1",
  ])("%s is private or invalid", (ip) => { expect(isPrivateAddress(ip)).toBe(true); });
  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "100.63.255.255", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2001:4860:4860::8888"])("%s is public", (ip) => { expect(isPrivateAddress(ip)).toBe(false); });
});

describe("guarded lookup (the address actually connected)", () => {
  it("refuses a name that resolves to a private address, even when a public one is mixed in (DNS rebinding)", async () => {
    const { guardedLookup } = await import("../fetcher");
    const run = (addrs: { address: string; family: number }[], all = true) => new Promise<unknown>((res) => guardedLookup((_h, _o, cb) => cb(null, addrs))("x.example.test", { all }, (err, a) => res({ err: err?.message, a })));
    expect(await run([{ address: "127.0.0.1", family: 4 }])).toMatchObject({ err: "blocked_address" });
    expect(await run([{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }])).toMatchObject({ err: "blocked_address" });
    expect(await run([{ address: "8.8.8.8", family: 4 }])).toEqual({ err: undefined, a: [{ address: "8.8.8.8", family: 4 }] });
    expect(await new Promise((res) => guardedLookup((_h, _o, cb) => cb(null, [{ address: "8.8.8.8", family: 4 }]))("x.example.test", {}, (e, a, f) => res({ e, a, f })))).toEqual({ e: null, a: "8.8.8.8", f: 4 });
  });
});

// A fake https.request: scripted responses per URL, no sockets.
type Res = { status: number; headers?: Record<string, string>; chunks?: string[]; hang?: boolean };
function fakeRequest(table: Record<string, Res>) {
  const seen: string[] = [];
  const request = (url: URL, _opts: unknown, cb: (res: EventEmitter & { statusCode: number; headers: Record<string, string>; resume(): void; destroy(): void }) => void) => {
    const req = new EventEmitter() as EventEmitter & { end(): void; destroy(): void };
    req.destroy = () => undefined;
    req.end = () => {
      seen.push(url.toString());
      const r = table[url.toString()];
      if (!r || r.hang) return;
      const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; resume(): void; destroy(): void };
      Object.assign(res, { statusCode: r.status, headers: r.headers ?? {}, resume() {}, destroy() {} });
      cb(res);
      queueMicrotask(() => { for (const c of r.chunks ?? []) res.emit("data", Buffer.from(c)); res.emit("end"); });
    };
    return req;
  };
  return { request: request as never, seen };
}

describe("feed fetcher", () => {
  const mk = async (table: Record<string, Res>, o: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number } = {}) => {
    const { makeFeedFetcher } = await import("../fetcher");
    const f = fakeRequest(table);
    return { fetch: makeFeedFetcher({ request: f.request, lookup: (() => undefined) as never, ...o }), seen: f.seen };
  };
  it("returns status and body", async () => {
    const { fetch } = await mk({ "https://a.example.test/c.ics": { status: 200, chunks: ["BEGIN:VCALENDAR", "\r\nEND:VCALENDAR"] } });
    expect(await fetch("https://a.example.test/c.ics")).toEqual({ status: 200, body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR" });
  });
  it("refuses a bad URL before any request", async () => {
    const { fetch, seen } = await mk({});
    await expect(fetch("http://a.example.test/c.ics")).rejects.toMatchObject({ code: "bad_url" });
    await expect(fetch("https://10.0.0.1/c.ics")).rejects.toMatchObject({ code: "bad_url" });
    expect(seen).toHaveLength(0);
  });
  it("follows https redirects but never to http or a private host, and stops after the limit", async () => {
    const t = {
      "https://a.example.test/1": { status: 302, headers: { location: "https://b.example.test/2" } },
      "https://b.example.test/2": { status: 200, chunks: ["ok"] },
      "https://a.example.test/down": { status: 302, headers: { location: "http://b.example.test/x" } },
      "https://a.example.test/priv": { status: 301, headers: { location: "https://127.0.0.1/x" } },
      "https://a.example.test/loop": { status: 302, headers: { location: "/loop" } },
    };
    const { fetch } = await mk(t, { maxRedirects: 3 });
    expect((await fetch("https://a.example.test/1")).body).toBe("ok");
    await expect(fetch("https://a.example.test/down")).rejects.toMatchObject({ code: "bad_redirect" });
    await expect(fetch("https://a.example.test/priv")).rejects.toMatchObject({ code: "bad_redirect" });
    await expect(fetch("https://a.example.test/loop")).rejects.toMatchObject({ code: "too_many_redirects" });
  });
  it("enforces the size limit on content-length and on the stream", async () => {
    const big = "x".repeat(50);
    const { fetch } = await mk({
      "https://a.example.test/cl": { status: 200, headers: { "content-length": "999999" }, chunks: ["x"] },
      "https://a.example.test/stream": { status: 200, chunks: [big, big, big] },
    }, { maxBytes: 100 });
    await expect(fetch("https://a.example.test/cl")).rejects.toMatchObject({ code: "too_large" });
    await expect(fetch("https://a.example.test/stream")).rejects.toMatchObject({ code: "too_large" });
  });
  it("times out a server that never answers", async () => {
    const { fetch } = await mk({ "https://a.example.test/slow": { status: 200, hang: true } }, { timeoutMs: 30 });
    await expect(fetch("https://a.example.test/slow")).rejects.toMatchObject({ code: "timeout" });
  });
  it("passes a non-200 status through for the caller to judge", async () => {
    const { fetch } = await mk({ "https://a.example.test/gone": { status: 404, chunks: ["nope"] } });
    expect((await fetch("https://a.example.test/gone")).status).toBe(404);
  });
});
