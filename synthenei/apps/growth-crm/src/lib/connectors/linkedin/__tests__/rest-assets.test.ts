// REST gateway (requests, headers, errors, backoff) against a scripted fetch; ad account selection with isolation and audit; connector def.
import { beforeEach, describe, expect, it } from "vitest";
import { ACTOR, makeDeps } from "../../core/__tests__/fakes";
import { CredentialError, TransientError, type ConnectionRow } from "../../core/types";
import { registerAllConnectors } from "../../all";
import { getConnector } from "../../registry";
import * as F from "../__fixtures__/payloads";
import { listLinkedInAccounts, selectLinkedInAccount } from "../assets";
import { gatewayFor, resetMockGateways } from "../config";
import { LINKEDIN_MOCK_TOKEN } from "../mock";
import { makeRestGateway, parseAdAccounts } from "../rest";
import { FakeStore } from "./fake-store";

interface Call { url: string; method: string; headers: Record<string, string>; body?: string }
function scripted(replies: Array<{ status?: number; body?: unknown; headers?: Record<string, string> } | Error>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body as string | undefined });
    const r = replies.shift() ?? { status: 200, body: {} };
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const gwOf = (s: ReturnType<typeof scripted>, over: Record<string, unknown> = {}) => makeRestGateway({ apiBase: "https://stub.invalid/", version: "202511", token: "tok-secret", fetch: s.fetchImpl, sleep: async () => {}, random: () => 0, ...over });

describe("rest gateway", () => {
  it("lead poll: Rest.li query, versioned headers, bearer token, oldest first, next offset", async () => {
    const s = scripted([{ body: { elements: [F.rawLeadResponse({ id: "b", submittedAt: F.T0 + 10 }), F.rawLeadResponse({ id: "a" })], paging: { start: 0, count: 2, total: 5 } } }]);
    const page = await gwOf(s).listLeadResponses({ accountUrn: F.ACCOUNT_URN, sinceMs: F.T0, start: 0, count: 2 });
    expect(page.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(page.nextStart).toBe(2);
    expect(s.calls[0].url).toBe(`https://stub.invalid/rest/leadFormResponses?q=owner&owner=(sponsoredAccount:${encodeURIComponent(F.ACCOUNT_URN)})&leadType=(leadType:SPONSORED)&submittedAfterTimestamp=${F.T0}&start=0&count=2`);
    expect(s.calls[0].headers).toMatchObject({ authorization: "Bearer tok-secret", "linkedin-version": "202511", "x-restli-protocol-version": "2.0.0" });
  });
  it("last page has no next offset", async () => {
    const s = scripted([{ body: { elements: [F.rawLeadResponse()], paging: { start: 0, count: 100, total: 1 } } }]);
    expect((await gwOf(s).listLeadResponses({ accountUrn: F.ACCOUNT_URN, sinceMs: 0, start: 0, count: 100 })).nextStart).toBeUndefined();
  });
  it("analytics: daily campaign pivot for one account, with the date range", async () => {
    const s = scripted([{ body: { elements: [F.rawAnalytics()] } }]);
    const rows = await gwOf(s).analytics({ accountUrn: F.ACCOUNT_URN, since: "2026-11-01", until: "2026-11-08" });
    expect(rows).toHaveLength(1);
    expect(s.calls[0].url).toContain("pivot=CAMPAIGN&timeGranularity=DAILY&dateRange=(start:(year:2026,month:11,day:1),end:(year:2026,month:11,day:8))");
    expect(s.calls[0].url).toContain(`accounts=List(${encodeURIComponent(F.ACCOUNT_URN)})`);
  });
  it("form questions are read once per form and cached; an unreadable form falls back to an empty map", async () => {
    const s = scripted([{ body: F.rawForm }, { status: 500, body: {} }]);
    const g = gwOf(s, { policy: { maxRetries: 0 } });
    expect((await g.formQuestions(F.FORM_URN)).get("13")).toBe("email");
    await g.formQuestions(F.FORM_URN);
    expect(s.calls).toHaveLength(1);
    expect((await g.formQuestions("urn:li:versionedLeadGenForm:(urn:li:leadGenForm:777,1)")).size).toBe(0);
  });
  it("401 and 403 are CredentialErrors (needs_attention); the message carries no token", async () => {
    for (const status of [401, 403]) {
      const err = await gwOf(scripted([{ status }])).listAdAccounts().catch((e) => e);
      expect(err).toBeInstanceOf(CredentialError);
      expect(String(err.message)).not.toContain("tok-secret");
    }
  });
  it("429 and 5xx are retried with backoff, then become TransientError", async () => {
    const ok = scripted([{ status: 429, headers: { "retry-after": "1" } }, { status: 503 }, { body: rawAcc() }]);
    expect(await gwOf(ok).listAdAccounts()).toHaveLength(2);
    expect(ok.calls).toHaveLength(3);
    const dead = scripted(Array.from({ length: 6 }, () => ({ status: 503 })));
    await expect(gwOf(dead, { policy: { maxRetries: 2 } }).listAdAccounts()).rejects.toBeInstanceOf(TransientError);
    await expect(gwOf(scripted([new Error("down"), new Error("down")]), { policy: { maxRetries: 1 } }).listAdAccounts()).rejects.toBeInstanceOf(TransientError);
  });
  it("introspect posts the app credentials as a form and reads expiry and scopes; without app credentials it is unknown, not alarming", async () => {
    const s = scripted([{ body: { active: true, expires_at: 1900000000, scope: "r_ads,r_ads_reporting" } }]);
    const t = await gwOf(s, { clientId: "cid", clientSecret: "csecret" }).introspect();
    expect(t).toEqual({ active: true, expiresAt: 1900000000, scopes: ["r_ads", "r_ads_reporting"] });
    expect(s.calls[0].headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(await gwOf(scripted([])).introspect()).toEqual({ active: true, expiresAt: null, scopes: [] });
  });
});
const rawAcc = () => F.rawAdAccounts;

describe("parseAdAccounts", () => {
  it("keeps live accounts with a numeric id, drops removed ones", () => { expect(parseAdAccounts(F.rawAdAccounts).map((a) => a.id)).toEqual(["100000001", "100000002"]); });
});

describe("gatewayFor", () => {
  beforeEach(() => resetMockGateways());
  it("mock token serves the sandbox, refused in production; no token is a credential error", () => {
    expect(gatewayFor({ connectionId: "c", secrets: { access_token: LINKEDIN_MOCK_TOKEN }, env: {} }).kind).toBe("mock");
    expect(() => gatewayFor({ connectionId: "c", secrets: { access_token: LINKEDIN_MOCK_TOKEN }, env: { APP_ENV: "production" } })).toThrow(CredentialError);
    expect(() => gatewayFor({ connectionId: "c", secrets: {}, env: {} })).toThrow(CredentialError);
    expect(gatewayFor({ connectionId: "c", secrets: { access_token: "real" }, env: {} }).kind).toBe("rest");
  });
});

let h: ReturnType<typeof makeDeps>, li: FakeStore, conn: ConnectionRow;
const put = async (over: Partial<ConnectionRow> = {}, ws = "w-1") => {
  const id = await h.vault.putSecret("c", JSON.stringify({ access_token: LINKEDIN_MOCK_TOKEN }));
  const c = await h.store.insertConnection({ tenantId: "t-1", workspaceId: ws, connectorId: "linkedin", label: "LinkedIn", category: "ads", direction: "in", mode: "sandbox", status: "sandbox", connectedBy: "u" });
  const full = { ...c, credentialSecretId: id, status: "sandbox" as const, ...over };
  h.store.conns.set(c.id, full);
  return full;
};
beforeEach(async () => { resetMockGateways(); h = makeDeps({ env: {} }); li = new FakeStore(); conn = await put(); });

describe("selectLinkedInAccount", () => {
  it("stores the chosen account in the vault, registers ownership and audits (no token in the audit)", async () => {
    const r = await selectLinkedInAccount(h.deps, li, ACTOR, conn.id, "100000001");
    expect(r).toEqual({ ok: true, value: { accountName: "Sample ad account", currency: "INR" } });
    const c = h.store.conns.get(conn.id)!;
    expect(JSON.parse(h.vault.secrets.get(c.credentialSecretId!)!)).toMatchObject({ ad_account_id: "100000001", access_token: LINKEDIN_MOCK_TOKEN });
    expect(li.accounts).toHaveLength(1);
    expect(h.audits.map((a) => a.action)).toEqual(["linkedin.account_selected"]);
    expect(JSON.stringify(h.audits)).not.toContain(LINKEDIN_MOCK_TOKEN);
  });
  it("refuses an account the user cannot access", async () => {
    expect(await selectLinkedInAccount(h.deps, li, ACTOR, conn.id, "999")).toEqual({ ok: false, code: "account_not_available" });
    expect(li.accounts).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
  });
  it("TENANT ISOLATION: an account owned by another workspace is refused", async () => {
    li.accounts.push({ tenantId: "t-9", workspaceId: "w-9", connectionId: "other", accountId: "100000001" });
    expect(await selectLinkedInAccount(h.deps, li, ACTOR, conn.id, "100000001")).toEqual({ ok: false, code: "account_taken" });
    expect(h.audits).toHaveLength(0);
  });
  it("another workspace's connection looks like a missing one", async () => {
    const other = await put({}, "w-2");
    expect(await selectLinkedInAccount(h.deps, li, ACTOR, other.id, "100000001")).toEqual({ ok: false, code: "not_found" });
    expect(await listLinkedInAccounts(h.deps, ACTOR, other.id)).toEqual({ ok: false, code: "not_found" });
    expect(await selectLinkedInAccount(h.deps, li, { ...ACTOR, tenantId: "t-2" }, conn.id, "100000001")).toEqual({ ok: false, code: "not_found" });
  });
  it("a disconnected connection cannot select; a failing audit stops the action", async () => {
    const dead = await put({ status: "disconnected" });
    expect(await selectLinkedInAccount(h.deps, li, ACTOR, dead.id, "100000001")).toEqual({ ok: false, code: "not_connected" });
    const dd = { ...h.deps, audit: async () => { throw new Error("audit down"); } };
    expect(await selectLinkedInAccount(dd, li, ACTOR, conn.id, "100000001")).toEqual({ ok: false, code: "audit_failed" });
  });
  it("lists names, ids and currency", async () => {
    const r = await listLinkedInAccounts(h.deps, ACTOR, conn.id);
    expect(r.ok && r.value[0]).toEqual({ id: "100000001", name: "Sample ad account", currency: "INR" });
  });
});

describe("connector definition", () => {
  it("is registered, OAuth, gated on vendor approval, no hard-coded client values", () => {
    registerAllConnectors();
    const def = getConnector("linkedin")!;
    expect(def).toBeDefined();
    expect(def).toMatchObject({ auth: "oauth2", gate: "needs_vendor_approval", requiredEnv: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"] });
    expect(def.streams.map((x) => x.key)).toEqual(["leads", "analytics", "health"]);
    expect(def.oauth?.scopes).toEqual(["r_ads", "r_ads_reporting", "r_ads_leadgen_automation"]);
  });
});
