import { describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl, exchangeCode, pkcePair, redirectAllowlist, refreshToken, resolveRedirectUri, safeReturnPath, sha256b64u, signCookie, stateMatches, verifyCookie, type OAuthCookie } from "../oauth";
import { CredentialError, TransientError, type OAuthSpec } from "../types";

const SECRET = "test-secret-not-real";
const NOW = 1_800_000_000_000;
const COOKIE: OAuthCookie = { state: "st-abc", verifier: "ver", ws: "w-1", uid: "u-1", connector: "hubspot", conn: null, exp: NOW + 600_000, returnTo: "/integrations/hubspot" };
const SPEC: OAuthSpec = { authorizeUrl: "https://vendor.test/oauth/authorize", tokenUrl: "https://vendor.test/oauth/token", scopes: ["a", "b"], pkce: true, extraAuthParams: { access_type: "offline" }, clientIdEnv: "X_ID", clientSecretEnv: "X_SECRET" };

describe("oauth state + PKCE", () => {
  it("S256 challenge is sha256(verifier) base64url", () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(sha256b64u(verifier));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });
  it("round-trips a signed cookie", () => {
    const t = signCookie(COOKIE, SECRET);
    expect(verifyCookie(t, SECRET, NOW)).toEqual({ ok: true, value: COOKIE });
  });
  it("rejects tampered payload, tampered signature, wrong secret, expiry, garbage", () => {
    const t = signCookie(COOKIE, SECRET);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...COOKIE, ws: "w-2" })).toString("base64url");
    expect(verifyCookie(`${forged}.${sig}`, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyCookie(`${body}.${sig.slice(0, -2)}AA`, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyCookie(t, "other-secret", NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyCookie(t, SECRET, NOW + 601_000)).toEqual({ ok: false, reason: "expired" });
    expect(verifyCookie("nodot", SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyCookie(undefined, SECRET, NOW)).toEqual({ ok: false, reason: "missing" });
  });
  it("state compare is exact", () => {
    expect(stateMatches("abc", "abc")).toBe(true);
    expect(stateMatches("abc", "abd")).toBe(false);
    expect(stateMatches("abc", "abcd")).toBe(false);
    expect(stateMatches("", "")).toBe(false);
  });
});

describe("redirect allowlist", () => {
  const base = { APP_BASE_URL: "https://app.example.test/" };
  it("derives the callback from APP_BASE_URL", () => {
    expect(resolveRedirectUri(base, "hubspot")).toBe("https://app.example.test/api/oauth/hubspot/callback");
  });
  it("rejects a requested URI that is not listed", () => {
    expect(resolveRedirectUri(base, "hubspot", "https://evil.test/api/oauth/hubspot/callback")).toBeNull();
    expect(resolveRedirectUri(base, "hubspot", "https://app.example.test/api/oauth/slack/callback")).toBeNull();
  });
  it("OAUTH_REDIRECT_URIS overrides; http only for localhost", () => {
    const env = { OAUTH_REDIRECT_URIS: "http://localhost:3000/api/oauth/hubspot/callback, http://app.example.test/api/oauth/hubspot/callback" };
    expect(redirectAllowlist(env, "hubspot")).toHaveLength(2);
    expect(resolveRedirectUri(env, "hubspot", "http://localhost:3000/api/oauth/hubspot/callback")).toBe("http://localhost:3000/api/oauth/hubspot/callback");
    expect(resolveRedirectUri(env, "hubspot", "http://app.example.test/api/oauth/hubspot/callback")).toBeNull();
    expect(resolveRedirectUri({}, "hubspot")).toBeNull();
  });
  it("return path stays inside /integrations", () => {
    expect(safeReturnPath("/integrations/hubspot?connected=1", "/integrations")).toBe("/integrations/hubspot?connected=1");
    for (const bad of ["https://evil.test", "//evil.test", "/leads", "/integrations/x://y", "/integrations\\x", null]) expect(safeReturnPath(bad as string | null, "/integrations")).toBe("/integrations");
  });
});

describe("authorize url and token calls", () => {
  it("builds PKCE, scope and extras", () => {
    const u = new URL(buildAuthorizeUrl(SPEC, { clientId: "cid", redirectUri: "https://app.example.test/cb", state: "s1", challenge: "ch" }));
    expect(u.searchParams.get("code_challenge")).toBe("ch");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).toBe("a b");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("state")).toBe("s1");
  });
  const resp = (status: number, body: unknown) => vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("exchanges a code and sends the verifier", async () => {
    const f = resp(200, { access_token: "AT", refresh_token: "RT", expires_in: 3600, scope: "a b" });
    const r = await exchangeCode(SPEC, { code: "c", redirectUri: "https://app.example.test/cb", clientId: "i", clientSecret: "s", verifier: "VER" }, f);
    expect(r).toEqual({ secrets: { access_token: "AT", refresh_token: "RT" }, expiresInSec: 3600, scopes: ["a", "b"] });
    const call = (f as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0];
    expect(call[1].body).toContain("code_verifier=VER");
  });
  it("a dead refresh token is a CredentialError, a 5xx is transient, and the old refresh token is kept when not rotated", async () => {
    await expect(refreshToken(SPEC, { refreshToken: "RT", clientId: "i", clientSecret: "s" }, resp(400, { error: "invalid_grant", error_description: "secret detail" }))).rejects.toBeInstanceOf(CredentialError);
    await expect(refreshToken(SPEC, { refreshToken: "RT", clientId: "i", clientSecret: "s" }, resp(503, {}))).rejects.toBeInstanceOf(TransientError);
    const ok = await refreshToken(SPEC, { refreshToken: "RT-old", clientId: "i", clientSecret: "s" }, resp(200, { access_token: "AT2", expires_in: 60 }));
    expect(ok.secrets).toEqual({ access_token: "AT2", refresh_token: "RT-old" });
  });
});
