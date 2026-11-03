import { describe, expect, it } from "vitest";
import { generateSecret, secretKey, signV1, signedHeaders, verifySignature } from "../signing";
import { retryDelaySeconds, RETRY_SCHEDULE_SECONDS, MAX_ATTEMPTS, shouldAutoDisable, graceActive, ROTATION_GRACE_MS } from "../backoff";

// Reference vector from the Standard Webhooks specification repository (test-cases).
const REF = { secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", id: "msg_p5jXN8AQM9LWM0D4loKWxJek", ts: 1614265330, body: '{"test": 2432232314}', sig: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=" };

describe("Standard Webhooks signing", () => {
  it("matches the reference known-answer vector", () => {
    expect(signV1(REF.secret, REF.id, REF.ts, REF.body)).toBe(REF.sig);
  });
  it("decodes the whsec_ base64 key and rejects other formats", () => {
    expect(secretKey(REF.secret).length).toBe(24);
    expect(() => secretKey("plain")).toThrow();
  });
  it("generates secrets in whsec_<base64> form that sign and verify", () => {
    const s = generateSecret();
    expect(s).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
    const h = signedHeaders([s], "evt_1", 1_700_000_000, "{}");
    expect(verifySignature(s, h, "{}", 1_700_000_010)).toBe(true);
  });
  it("sets the contract headers", () => {
    const h = signedHeaders([REF.secret], REF.id, REF.ts, REF.body);
    expect(h).toMatchObject({ "webhook-id": REF.id, "webhook-timestamp": "1614265330", "webhook-signature": REF.sig, "content-type": "application/json", "user-agent": "SynthanCRM-Webhooks/1" });
  });
  it("during rotation grace both signatures are present and either secret verifies", () => {
    const a = generateSecret(), b = generateSecret();
    const h = signedHeaders([a, b], "evt_2", 1_700_000_000, '{"x":1}');
    const parts = h["webhook-signature"].split(" ");
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.startsWith("v1,"))).toBe(true);
    expect(verifySignature(a, h, '{"x":1}', 1_700_000_001)).toBe(true);
    expect(verifySignature(b, h, '{"x":1}', 1_700_000_001)).toBe(true);
    expect(verifySignature(generateSecret(), h, '{"x":1}', 1_700_000_001)).toBe(false);
  });
  it("rejects a tampered body and a stale timestamp", () => {
    const h = signedHeaders([REF.secret], REF.id, 1_700_000_000, "{}");
    expect(verifySignature(REF.secret, h, "{ }", 1_700_000_000)).toBe(false);
    expect(verifySignature(REF.secret, h, "{}", 1_700_000_000 + 301)).toBe(false);
  });
});

describe("retry schedule", () => {
  it("follows 30 s, 2 m, 10 m, 1 h, 6 h, 24 h with jitter within 20 percent, then gives up", () => {
    expect([...RETRY_SCHEDULE_SECONDS]).toEqual([30, 120, 600, 3600, 21600, 86400]);
    expect(MAX_ATTEMPTS).toBe(7);
    for (let n = 1; n <= 6; n++) {
      const base = RETRY_SCHEDULE_SECONDS[n - 1];
      expect(retryDelaySeconds(n, () => 0.5)).toBe(base);
      expect(retryDelaySeconds(n, () => 0)).toBe(Math.round(base * 0.8));
      expect(retryDelaySeconds(n, () => 0.999999)).toBe(Math.round(base * 1.2));
    }
    expect(retryDelaySeconds(7)).toBeNull();
  });
  it("auto-disables only with 20 failures and no success for 5 days", () => {
    const now = Date.parse("2026-11-01T00:00:00Z");
    const created = "2026-10-01T00:00:00Z";
    expect(shouldAutoDisable(19, null, created, now)).toBe(false);
    expect(shouldAutoDisable(20, "2026-10-30T00:00:00Z", created, now)).toBe(false);
    expect(shouldAutoDisable(20, "2026-10-25T00:00:00Z", created, now)).toBe(true);
    expect(shouldAutoDisable(25, null, created, now)).toBe(true);
  });
  it("grace window lasts 24 hours", () => {
    const t = Date.parse("2026-11-01T00:00:00Z");
    expect(graceActive(new Date(t - ROTATION_GRACE_MS + 1000).toISOString(), t)).toBe(true);
    expect(graceActive(new Date(t - ROTATION_GRACE_MS - 1000).toISOString(), t)).toBe(false);
    expect(graceActive(null, t)).toBe(false);
  });
});
