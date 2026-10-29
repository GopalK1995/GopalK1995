import { describe, expect, it } from "vitest";
import { assertPublicHttpsUrl, isBlockedIp } from "../ssrf";

const pub = async () => ["93.184.216.34"];
describe("ssrf guard", () => {
  it.each([
    "http://example.com/x", "ftp://example.com", "not a url", "https://localhost/x", "https://foo.localhost",
    "https://127.0.0.1/", "https://10.1.2.3/", "https://172.16.0.1/", "https://172.31.255.255/", "https://192.168.1.1/",
    "https://169.254.169.254/latest/meta-data", "https://[::1]/", "https://[fe80::1]/", "https://[fd00::1]/", "https://[::ffff:127.0.0.1]/",
    "https://0.0.0.0/", "https://100.64.0.1/", "https://user:pw@example.com/", "https://metadata.google.internal/",
  ])("rejects %s", async (u) => { await expect(assertPublicHttpsUrl(u, pub)).rejects.toThrow(); });
  it("rejects hostnames resolving to private or mixed addresses", async () => {
    await expect(assertPublicHttpsUrl("https://evil.example/", async () => ["10.0.0.5"])).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://evil.example/", async () => ["93.184.216.34", "169.254.169.254"])).rejects.toThrow();
    await expect(assertPublicHttpsUrl("https://evil.example/", async () => { throw new Error("nx"); })).rejects.toThrow();
  });
  it("accepts public https", async () => {
    expect((await assertPublicHttpsUrl("https://example.com/hook", pub)).hostname).toBe("example.com");
    expect((await assertPublicHttpsUrl("https://93.184.216.34/")).hostname).toBe("93.184.216.34");
  });
  it("range edges", () => {
    expect(isBlockedIp("172.15.0.1")).toBe(false);
    expect(isBlockedIp("172.32.0.1")).toBe(false);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });
});
