import { describe, expect, it } from "vitest";
import { scrub, sentryBeforeSend } from "../scrub";
import { requestIdFrom } from "../request-id";
import { summarize } from "../health";
import { buildCsp, buildSecurityHeaders } from "../../security/headers.mjs";

describe("pii scrubber", () => {
  it("strips emails and phones from nested values and drops user/request secrets", () => {
    const ev = sentryBeforeSend({
      message: "fail for a.b@x.com call +91 98765 43210",
      user: { id: "1" },
      request: { cookies: "c", headers: { a: "b" }, url: "/x" },
      extra: { email: "q@z.io", note: ["ping r@s.in"] },
      tags: { tenant_id: "t1" },
    });
    expect(JSON.stringify(ev)).not.toMatch(/@x\.com|98765|q@z\.io|r@s\.in/);
    expect(ev).not.toHaveProperty("user");
    expect(ev.request).toEqual({ url: "/x" });
    expect(ev.tags).toEqual({ tenant_id: "t1" });
    expect(scrub("order 12345")).toBe("order 12345");
  });
});

describe("request id", () => {
  it("reuses safe inbound ids and mints otherwise", () => {
    expect(requestIdFrom(new Headers({ "x-request-id": "abc-12345678" }))).toBe("abc-12345678");
    expect(requestIdFrom(new Headers({ "x-request-id": "bad id!" }))).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("health summary", () => {
  it("maps db and queue state to status", () => {
    expect(summarize({ status: "ok" }, { status: "skipped" }).status).toBe("ok");
    expect(summarize({ status: "error" }, { status: "ok" }).status).toBe("down");
    expect(summarize({ status: "ok" }, { status: "error" }).status).toBe("degraded");
  });
});

describe("security headers", () => {
  it("ships CSP report-only by default with other headers enforced", () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NODE_ENV: "production" };
    const h = Object.fromEntries(buildSecurityHeaders(env).map((x) => [x.key, x.value]));
    expect(h["Content-Security-Policy-Report-Only"]).toContain("wss://abc.supabase.co");
    expect(h["Content-Security-Policy"]).toBeUndefined();
    expect(h["Strict-Transport-Security"]).toContain("max-age=63072000");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(buildSecurityHeaders({ CSP_ENFORCE: "1" }).some((x) => x.key === "Content-Security-Policy")).toBe(true);
    expect(buildCsp({ nonce: "n1", env })).toContain("'nonce-n1'");
    expect(buildCsp({ env })).toContain("frame-ancestors 'none'");
  });
});
