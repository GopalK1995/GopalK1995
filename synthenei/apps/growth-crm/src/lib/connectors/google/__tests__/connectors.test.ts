// Registration, hard rules (no tenant/brand/account/price/URL values in code; env names only), and the framework's token refresh path
// with Google's responses: a refreshed token is stored encrypted (Vault), a revoked grant flips the connection to needs_attention.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_CONNECTORS } from "../../all";
import { refreshIfNeeded } from "../../core/lifecycle";
import type { RuntimeDeps } from "../../core/ports";
import { envConfigured, getConnector } from "../../registry";
import type { ConnectionRow } from "../../core/types";

describe("registration", () => {
  it("registers ga4, google-ads and google-sheets with read-only scopes, offline access and the platform OAuth client env names", () => {
    expect(ALL_CONNECTORS.map((c) => c.id)).toEqual(expect.arrayContaining(["ga4", "google-ads", "google-sheets"]));
    for (const id of ["ga4", "google-ads", "google-sheets"]) {
      const def = getConnector(id)!;
      expect(def.auth).toBe("oauth2");
      expect(def.oauth).toMatchObject({ clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID", clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET", pkce: true, extraAuthParams: { access_type: "offline", prompt: "consent" } });
      expect(def.sandbox.supported).toBe(true);
      expect(def.streams.every((s) => s.schedule?.tz === "Asia/Kolkata")).toBe(true);
    }
    expect(getConnector("ga4")!.oauth!.scopes).toEqual(["https://www.googleapis.com/auth/analytics.readonly"]);
    expect(getConnector("google-sheets")!.oauth!.scopes).toEqual(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  });
  it("Google Ads is gated on the developer token env name and unusable without it", () => {
    const def = getConnector("google-ads")!;
    expect(def.gate).toBe("needs_vendor_approval");
    expect(def.requiredEnv).toEqual(["GOOGLE_ADS_DEVELOPER_TOKEN"]);
    const base = { GOOGLE_OAUTH_CLIENT_ID: "x", GOOGLE_OAUTH_CLIENT_SECRET: "y" };
    expect(envConfigured(def, base)).toBe(false);
    expect(envConfigured(def, { ...base, GOOGLE_ADS_DEVELOPER_TOKEN: "z" })).toBe(true);
    expect(envConfigured(getConnector("ga4")!, base)).toBe(true);
  });
  it("lists the env names in .env.example without values", () => {
    const env = readFileSync(join(__dirname, "../../../../../.env.example"), "utf8");
    for (const n of ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_LOGIN_CUSTOMER_ID", "GOOGLE_ADS_API_BASE", "GA4_DATA_API_BASE", "GA4_ADMIN_API_BASE", "GOOGLE_SHEETS_API_BASE"]) expect(env, n).toMatch(new RegExp(`^${n}=\\s*$`, "m"));
  });
});

describe("hard rule: no tenant-, brand-, account-id- or secret-specific values in the Google connector code", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === "__tests__" ? [] : files(p)) : p.endsWith(".ts") ? [p] : []; });
  const src = files(join(__dirname, ".."));
  it("scans the production sources", () => {
    expect(src.length).toBeGreaterThan(20);
    for (const f of src) {
      const text = readFileSync(f, "utf8");
      // only vendor API hosts and well-known Google OAuth endpoints may appear as URLs
      for (const url of text.match(/https?:\/\/[^\s"'`)]+/g) ?? []) expect(url, `${f}`).toMatch(/^https:\/\/([a-z0-9]+\.googleapis\.com|accounts\.google\.com|docs\.google\.com)(\/|$)/);
      expect(text, f).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|ya29\.|1\/\/0[0-9A-Za-z_-]{20,}|GOCSPX-|-----BEGIN/);   // keys, tokens, client secrets, private keys
      expect(text, f).not.toMatch(/\bprocess\.env\.(GOOGLE|GA4)/);   // env is read by name through the injected env, never inline
    }
  });
});

describe("token refresh path (core lifecycle + Google refresh)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const CONN = (id: string): ConnectionRow => ({ id: "c-1", tenantId: "t-1", workspaceId: "w-1", connectorId: id as ConnectionRow["connectorId"], mode: "live", status: "connected", settings: {}, credentialSecretId: "sec-1", webhookSecretId: null, tokenExpiresAt: "2026-11-09T04:00:00Z" });
  function deps() {
    const vault = new Map<string, string>([["sec-1", JSON.stringify({ access_token: "old", refresh_token: "r1" })]]);
    const patches: Record<string, unknown>[] = [];
    const d: RuntimeDeps = {
      store: { updateConnection: async (_id: string, p: Record<string, unknown>) => { patches.push(p); } } as unknown as RuntimeDeps["store"],
      vault: { putSecret: async (_n: string, v: string) => { const id = `v-${vault.size + 1}`; vault.set(id, v); return id; }, getSecret: async (id: string) => vault.get(id) ?? null, deleteSecret: async (id: string) => { vault.delete(id); } },
      env: {}, log: { info() {}, warn() {}, error() {} }, now: () => new Date("2026-11-09T05:00:00Z"),
    };
    return { d, vault, patches };
  }
  it.each(["ga4", "google-ads", "google-sheets"])("%s: an expiring token is refreshed and the new bundle replaces the old in the Vault", async (id) => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid"); vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "csec");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }), { status: 200 })));
    const { d, vault, patches } = deps();
    expect(await refreshIfNeeded(d, CONN(id))).toEqual({ ok: true, refreshed: true });
    expect(JSON.parse([...vault.values()].at(-1)!)).toEqual({ access_token: "fresh", refresh_token: "r1" });
    expect(vault.has("sec-1")).toBe(false);
    expect(patches[0]).toMatchObject({ tokenExpiresAt: "2026-11-09T06:00:00.000Z", lastError: null });
  });
  it.each(["ga4", "google-ads", "google-sheets"])("%s: a revoked grant (invalid_grant) becomes needs_attention with a readable reason, never silent", async (id) => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid"); vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "csec");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), { status: 400 })));
    const { d, patches } = deps();
    expect(await refreshIfNeeded(d, CONN(id))).toEqual({ ok: false, reason: "needs_attention" });
    expect(patches[0]).toMatchObject({ status: "needs_attention" });
    expect(String(patches[0].lastError)).toMatch(/revoked or expired|reconnect/i);
    expect(String(patches[0].lastError)).not.toContain("r1");
  });
  it("a Google outage is transient: the job retries and the connection is not flagged", async () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid"); vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "csec");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const { d, patches } = deps();
    await expect(refreshIfNeeded(d, CONN("ga4"))).rejects.toMatchObject({ name: "TransientError" });
    expect(patches).toHaveLength(0);
  });
});
