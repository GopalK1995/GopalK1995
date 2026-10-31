import { describe, expect, it, vi } from "vitest";
import { safeExcerpt, sendOnce, type Transport } from "../send";

const PUBLIC = ["93.184.216.34"];
const ok: Transport = async () => ({ status: 200, body: "ok" });
const args = (url: string, over: Partial<Parameters<typeof sendOnce>[0]> = {}) => ({ url, body: "{}", headers: { "webhook-id": "x" }, ...over });

describe("send-time SSRF guard", () => {
  it("delivers to a public host and pins the validated address for the connection", async () => {
    const transport = vi.fn(ok);
    const r = await sendOnce(args("https://hooks.example.com/in", { resolver: async () => PUBLIC, transport }));
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(transport.mock.calls[0][0]).toMatchObject({ address: "93.184.216.34", family: 4 });
  });
  it.each([
    ["loopback", "https://127.0.0.1/x"],
    ["private 10/8", "https://10.1.2.3/x"],
    ["private 192.168", "https://192.168.0.5/x"],
    ["cloud metadata", "https://169.254.169.254/latest/meta-data"],
    ["ipv6 loopback", "https://[::1]/x"],
    ["ipv4-mapped ipv6", "https://[::ffff:10.0.0.1]/x"],
    ["localhost", "https://localhost/x"],
    ["plain http", "http://hooks.example.com/x"],
    ["credentials", "https://user:pw@hooks.example.com/x"],
  ])("blocks %s without opening a connection", async (_n, url) => {
    const transport = vi.fn(ok);
    const r = await sendOnce(args(url, { resolver: async () => PUBLIC, transport }));
    expect(r).toMatchObject({ ok: false, kind: "blocked", status: null });
    expect(transport).not.toHaveBeenCalled();
  });
  it("blocks a host whose DNS answer is private, or mixed public and private", async () => {
    const transport = vi.fn(ok);
    expect((await sendOnce(args("https://evil.example.com/x", { resolver: async () => ["10.0.0.7"], transport }))).kind).toBe("blocked");
    expect((await sendOnce(args("https://evil.example.com/x", { resolver: async () => ["93.184.216.34", "169.254.169.254"], transport }))).kind).toBe("blocked");
    expect(transport).not.toHaveBeenCalled();
  });
  it("re-resolves on every attempt: DNS rebinding after create is caught at send time", async () => {
    const answers = [PUBLIC, ["127.0.0.1"]];
    const resolver = vi.fn(async () => answers.shift() ?? ["127.0.0.1"]);
    const transport = vi.fn(ok);
    expect((await sendOnce(args("https://rebind.example.com/x", { resolver, transport }))).ok).toBe(true);
    expect((await sendOnce(args("https://rebind.example.com/x", { resolver, transport }))).kind).toBe("blocked");
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("treats DNS failure as blocked and never follows a redirect", async () => {
    expect((await sendOnce(args("https://nx.example.com/x", { resolver: async () => { throw new Error("ENOTFOUND"); }, transport: ok }))).kind).toBe("blocked");
    const transport = vi.fn(async () => ({ status: 302, body: "moved to http://127.0.0.1/" }));
    const r = await sendOnce(args("https://hooks.example.com/x", { resolver: async () => PUBLIC, transport }));
    expect(r).toMatchObject({ ok: false, kind: "redirect", status: 302 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("maps non-2xx and transport errors to failures", async () => {
    const r500 = await sendOnce(args("https://h.example.com/x", { resolver: async () => PUBLIC, transport: async () => ({ status: 500, body: "boom" }) }));
    expect(r500).toMatchObject({ ok: false, kind: "http", status: 500 });
    const rt = await sendOnce(args("https://h.example.com/x", { resolver: async () => PUBLIC, transport: async () => { throw Object.assign(new Error("t"), { code: "ETIMEDOUT" }); } }));
    expect(rt).toMatchObject({ ok: false, kind: "timeout", status: null });
    const tls = await sendOnce(args("https://h.example.com/x", { resolver: async () => PUBLIC, transport: async () => { throw Object.assign(new Error("t"), { code: "CERT_HAS_EXPIRED" }); } }));
    expect(tls.kind).toBe("tls");
  });
  it("passes the 10 s timeout and a response cap to the transport", async () => {
    const transport = vi.fn(ok);
    await sendOnce(args("https://h.example.com/x", { resolver: async () => PUBLIC, transport }));
    expect(transport.mock.calls[0][0]).toMatchObject({ timeoutMs: 10_000, maxBytes: 65536 });
  });
});

describe("response excerpt", () => {
  it("is cut to 2 KB and scrubbed of emails, secrets, tokens and control characters", () => {
    const raw = "ok ana@example.com whsec_AbCdEf123456 Bearer abcdefghijklmnop call +91 98765 43210 \u0007" + "x".repeat(5000);
    const s = safeExcerpt(raw);
    expect(s.length).toBeLessThanOrEqual(2048);
    expect(s).not.toMatch(/ana@example\.com|whsec_AbCd|abcdefghijklmnop|\u0007|98765/);
    expect(s).toContain("[email]");
    expect(s).toContain("[secret]");
  });
  it("is returned scrubbed on a failed attempt", async () => {
    const r = await sendOnce(args("https://h.example.com/x", { resolver: async () => PUBLIC, transport: async () => ({ status: 400, body: "bad lead ana@example.com" }) }));
    expect(r.excerpt).toBe("bad lead [email]");
  });
});
