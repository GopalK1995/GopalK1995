import { describe, expect, it } from "vitest";
import { bearerToken, generateKey, hashKey, maskedKey, parseKey, randomBase62, verifyKey } from "../keys";
import { BOT_JWT_TTL_SEC, mintBotJwt, verifyBotJwt } from "../jwt";

describe("key format and hashing", () => {
  it("generates sk_<env>_<8>_<32> keys and stores only prefix and sha256", () => {
    const g = generateKey("live");
    expect(g.key).toMatch(/^sk_live_[0-9A-Za-z]{8}_[0-9A-Za-z]{32}$/);
    expect(g.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(g.hash).toBe(hashKey(g.key));
    expect(g.hash).not.toContain(g.key.slice(-32));
    expect(generateKey("test").key.startsWith("sk_test_")).toBe(true);
  });
  it("is unique and unbiased enough: 1000 keys, no duplicates", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateKey("live").key));
    expect(seen.size).toBe(1000);
  });
  it("rejection sampling never emits characters outside base62", () => {
    expect(randomBase62(500, (n) => new Uint8Array(n).fill(255).map((_, i) => (i % 2 ? 7 : 251)))).toMatch(/^[0-9A-Za-z]{500}$/);
  });
  it("parses valid keys and rejects malformed ones", () => {
    const g = generateKey("test");
    expect(parseKey(g.key)).toEqual({ env: "test", prefix: g.prefix, secret: g.key.slice(-32) });
    for (const bad of ["", "sk_live_short", `${g.key}x`, g.key.replace("sk_test", "pk_test"), "Bearer " + g.key, g.key.slice(0, -1), null, undefined]) expect(parseKey(bad as never)).toBeNull();
  });
  it("extracts bearer tokens case-insensitively", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
  it("masks everything after the prefix", () => {
    const g = generateKey("live");
    const m = maskedKey("live", g.prefix);
    expect(m).toContain(g.prefix);
    expect(m).not.toContain(g.key.slice(-32));
  });
});

describe("constant-time verification", () => {
  it("accepts the right key and rejects a wrong key, a wrong hash and malformed hashes", () => {
    const a = generateKey("live"), b = generateKey("live");
    expect(verifyKey(a.key, a.hash)).toBe(true);
    expect(verifyKey(a.key, b.hash)).toBe(false);
    expect(verifyKey(b.key, a.hash)).toBe(false);
    for (const bad of ["", "zz", null, undefined, "0".repeat(64), a.hash.slice(1)]) expect(verifyKey(a.key, bad as never)).toBe(false);
  });
});

describe("bot JWT", () => {
  it("mints a 5-minute authenticated token that verifies and expires", () => {
    const now = 1_800_000_000_000;
    const { token, expiresAt } = mintBotJwt({ sub: "bot-1", secret: "s3cret-s3cret-s3cret-s3cret", keyId: "k1", issuer: "https://x.supabase.co/auth/v1", now });
    expect(expiresAt - Math.floor(now / 1000)).toBe(BOT_JWT_TTL_SEC);
    const claims = verifyBotJwt(token, "s3cret-s3cret-s3cret-s3cret", now + 1000);
    expect(claims).toMatchObject({ sub: "bot-1", role: "authenticated", aud: "authenticated", app_metadata: { api_key_id: "k1" } });
    expect(verifyBotJwt(token, "other-secret", now)).toBeNull();
    expect(verifyBotJwt(token, "s3cret-s3cret-s3cret-s3cret", now + (BOT_JWT_TTL_SEC + 1) * 1000)).toBeNull();
    expect(verifyBotJwt(token.slice(0, -2) + "xx", "s3cret-s3cret-s3cret-s3cret", now)).toBeNull();
  });
});
