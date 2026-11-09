// Google Ads: GAQL, micros -> currency -> INR, search result normalisation (Google's published REST shape, synthetic values), resumable
// paginated stream, the API client (headers, manager clients, developer-token errors), and customer selection with tenant isolation.
import { beforeEach, describe, expect, it } from "vitest";
import type { RuntimeDeps } from "../../../core/ports";
import { CredentialError, type ConnectionRow } from "../../../core/types";
import { makeAdsApi } from "../api";
import { adsGatewayFor, resetMockAds } from "../config";
import { campaignQuery, costInr, fxRatesOf, microsToUnits, normaliseRow, type RawAdsRow } from "../report";
import { listAdsCustomers, selectAdsCustomer } from "../select";
import { adsStep, type AdsStreamCtx } from "../sync";
import type { AdsDeps, AdsStore } from "../store";
import type { AdsDailyRow } from "../report";
import type { ConnScope } from "../../shared/mode";

/** One element of googleAds:search `results`, per the REST docs (camelCase, int64 as strings). */
const ROW = (over: Partial<RawAdsRow> = {}): RawAdsRow => ({ campaign: { id: "9000000001", name: "Camp one" }, segments: { date: "2026-11-01" }, metrics: { costMicros: "1234567890", impressions: "10000", clicks: "150", conversions: "3.6" }, ...over });

describe("microsToUnits", () => {
  it("divides by one million exactly, including int64-sized strings", () => {
    expect(microsToUnits("1234567890")).toBeCloseTo(1234.56789, 6);
    expect(microsToUnits("0")).toBe(0);
    expect(microsToUnits("9007199254740993")).toBeCloseTo(9007199254.740993, 5);
    expect(microsToUnits(2_500_000)).toBe(2.5);
  });
  it("rejects unreadable or negative values instead of guessing", () => {
    for (const v of [undefined, null, "", "12.5", "abc", "-5", -5, NaN, "1".repeat(20)]) expect(microsToUnits(v)).toBeNull();
  });
});

describe("costInr / fx", () => {
  it("INR passes through to paise; another currency needs the tenant's own rate", () => {
    expect(costInr("1234567890", "INR", {})).toBe(1234.57);
    expect(costInr("10000000", "USD", { USD: 83.5 })).toBe(835);
    expect(costInr("10000000", "USD", {})).toBeNull();
    expect(costInr("10000000", undefined, {})).toBeNull();
    expect(costInr("10000000", "inr", {})).toBe(10);
  });
  it("fxRatesOf keeps only positive finite numbers under three-letter codes", () => {
    expect(fxRatesOf({ fx_to_inr: { usd: 83.5, EUR: -1, X: 2, GBP: "5", AED: 0 } })).toEqual({ USD: 83.5 });
    expect(fxRatesOf({})).toEqual({});
  });
});

describe("campaignQuery", () => {
  it("is GAQL over the campaign resource for the window, ordered by date", () => {
    expect(campaignQuery("2026-11-01", "2026-11-08")).toBe("SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '2026-11-01' AND '2026-11-08' ORDER BY segments.date");
  });
  it("refuses anything that is not a plain date (no query injection)", () => {
    expect(() => campaignQuery("2026-11-01' OR 1=1 --", "2026-11-08")).toThrow();
    expect(() => campaignQuery("2026-11-01", "tomorrow")).toThrow();
  });
});

describe("normaliseRow", () => {
  it("maps cost, counts and rounds fractional conversions to a whole count", () => {
    expect(normaliseRow(ROW(), "INR", {})).toEqual({ ok: true, name: "Camp one", row: { externalCampaignId: "9000000001", day: "2026-11-01", spendInr: 1234.57, impressions: 10000, clicks: 150, platformLeads: 4 } });
  });
  it("converts a foreign account with the tenant rate, and rejects it without one", () => {
    expect(normaliseRow(ROW(), "USD", { USD: 80 })).toMatchObject({ ok: true, row: { spendInr: 98765.43 } });
    expect(normaliseRow(ROW(), "USD", {})).toEqual({ ok: false, reason: "currency_unconvertible" });
    expect(normaliseRow(ROW(), undefined, {})).toEqual({ ok: false, reason: "currency_unconvertible" });
  });
  it("rejects a bad day, a missing campaign and an unreadable cost; a campaign with no cost field is a true zero", () => {
    expect(normaliseRow(ROW({ segments: { date: "11/01/2026" } }), "INR", {})).toEqual({ ok: false, reason: "bad_day" });
    expect(normaliseRow(ROW({ campaign: {} }), "INR", {})).toEqual({ ok: false, reason: "no_campaign" });
    expect(normaliseRow(ROW({ metrics: { costMicros: "abc" } }), "INR", {})).toEqual({ ok: false, reason: "bad_cost" });
    expect(normaliseRow(ROW({ metrics: {} }), "INR", {})).toMatchObject({ ok: true, row: { spendInr: 0, impressions: 0, clicks: 0, platformLeads: 0 } });
    expect(normaliseRow(ROW({ campaign: { id: 5 } }), "INR", {})).toMatchObject({ ok: true, name: "Campaign 5" });
  });
});

class FakeAdsStore implements AdsStore {
  n = 0; campaigns: { id: string; ws: string; ext: string; name: string; synthetic: boolean }[] = []; metrics = new Map<string, AdsDailyRow & { source: string; conn: string }>();
  async ensureCampaign(i: { workspaceId: string; externalId: string; name: string; synthetic: boolean }) {
    const f = this.campaigns.find((c) => c.ws === i.workspaceId && c.ext === i.externalId);
    if (f) return f.id;
    const c = { id: `camp-${++this.n}`, ws: i.workspaceId, ext: i.externalId, name: i.name, synthetic: i.synthetic }; this.campaigns.push(c); return c.id;
  }
  async upsertDailyMetrics(rows: AdsDailyRow[], ctx: ConnScope & { source: "api" | "mock" }) { for (const r of rows) this.metrics.set(`${r.campaignId}|${r.day}`, { ...r, source: ctx.source, conn: ctx.connectionId }); }
}
const CONN: ConnectionRow = { id: "c-1", tenantId: "t-1", workspaceId: "w-1", connectorId: "google-ads", mode: "sandbox", status: "sandbox", settings: {}, credentialSecretId: "s", webhookSecretId: null, tokenExpiresAt: null };
const NOW = new Date("2026-11-09T05:00:00Z");   // 10:30 IST
let store: FakeAdsStore;
const deps = (now = NOW): AdsDeps => ({ store, log: { info() {}, warn() {}, error() {} }, now: () => now });
const SECRETS = { customer_id: "1000000001", currency: "INR", access_token: "google-mock-token" };
const ctx = (over: Partial<AdsStreamCtx> = {}): AdsStreamCtx => ({ deps: deps(), conn: CONN, secrets: SECRETS, gateway: adsGatewayFor({ connectionId: "c-1", secrets: SECRETS, env: {} }), reject: () => {}, ...over });
beforeEach(() => { store = new FakeAdsStore(); resetMockAds(); });

describe("adsStep", () => {
  it("waits for a customer to be chosen", async () => {
    expect(await adsStep(ctx({ secrets: { access_token: "t" } }), undefined)).toMatchObject({ done: true, sample: { skipped: "no_customer" } });
  });
  it("loads the 30-day backfill (Showcase = source mock, synthetic campaigns) and is idempotent", async () => {
    const r = await adsStep(ctx(), undefined);
    expect(r).toMatchObject({ done: true, cursor: { through: "2026-11-08" }, rowsRejected: 0 });
    expect(store.metrics.size).toBe(60);   // 30 days x 2 sample campaigns
    expect([...store.metrics.values()].every((m) => m.source === "mock" && m.conn === "c-1")).toBe(true);
    expect(store.campaigns.every((c) => c.synthetic)).toBe(true);
    await adsStep(ctx(), undefined);
    expect(store.metrics.size).toBe(60);
    expect(store.campaigns).toHaveLength(2);
  });
  it("incremental: re-reads the trailing 7 days, nothing when current", async () => {
    expect((await adsStep(ctx(), { through: "2026-11-05" })).sample).toMatchObject({ days: "2026-10-30..2026-11-08" });
    expect(await adsStep(ctx(), { through: "2026-11-08" })).toMatchObject({ sample: { skipped: "up_to_date" } });
  });
  it("paginates by page token and resumes from the cursor", async () => {
    const tokens: (string | undefined)[] = [];
    const gw = { kind: "api", listCustomers: async () => [], async campaignMetrics(i: { pageToken?: string }) { tokens.push(i.pageToken); return i.pageToken ? { results: [ROW({ segments: { date: "2026-11-02" } })] } : { results: [ROW()], nextPageToken: "tok2" }; } } as unknown as AdsStreamCtx["gateway"];
    const first = await adsStep(ctx({ gateway: gw }), { through: "2026-11-07" });
    expect(first).toMatchObject({ done: false, cursor: { through: "2026-11-07", win: { page: "tok2" } } });
    const second = await adsStep(ctx({ gateway: gw }), first.cursor);
    expect(second).toMatchObject({ done: true, cursor: { through: "2026-11-08" } });
    expect(tokens).toEqual([undefined, "tok2"]);
    expect([...store.metrics.values()].every((m) => m.source === "api")).toBe(true);
  });
  it("non-INR account: converts with the tenant's rate, rejects (counted) without it", async () => {
    const gw = { kind: "api", listCustomers: async () => [], campaignMetrics: async () => ({ results: [ROW()] }) } as unknown as AdsStreamCtx["gateway"];
    const reasons: string[] = [];
    const none = await adsStep(ctx({ gateway: gw, secrets: { ...SECRETS, currency: "USD" }, reject: (r) => reasons.push(r) }), { through: "2026-11-07" });
    expect(none.rowsRejected).toBe(1);
    expect(reasons).toEqual(["currency_unconvertible"]);
    expect(store.metrics.size).toBe(0);
    const ok = await adsStep(ctx({ gateway: gw, secrets: { ...SECRETS, currency: "USD" }, conn: { ...CONN, settings: { fx_to_inr: { USD: 80 } } } }), { through: "2026-11-07" });
    expect(ok.rowsRejected).toBe(0);
    expect([...store.metrics.values()][0].spendInr).toBe(98765.43);
  });
  it("passes the manager login id to the gateway and keeps writes inside the connection's workspace", async () => {
    let seen: { loginCustomerId?: string } = {};
    const gw = { kind: "api", listCustomers: async () => [], async campaignMetrics(i: { loginCustomerId?: string }) { seen = i; return { results: [ROW()] }; } } as unknown as AdsStreamCtx["gateway"];
    await adsStep(ctx({ gateway: gw, secrets: { ...SECRETS, login_customer_id: "2000000002" }, conn: { ...CONN, workspaceId: "w-9" } }), { through: "2026-11-07" });
    expect(seen.loginCustomerId).toBe("2000000002");
    expect(store.campaigns.every((c) => c.ws === "w-9")).toBe(true);
  });
});

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
describe("Google Ads API client", () => {
  const base = { base: "https://ads.invalid", version: "v99", token: "tok", developerToken: "dev-token" };
  it("needs the developer token (an env value, not code)", () => { expect(() => makeAdsApi({ ...base, developerToken: "" })).toThrow(CredentialError); });
  it("sends developer-token and bearer, posts GAQL to customers/<id>/googleAds:search and returns the page token", async () => {
    const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
    const f = (async (url: string, init: RequestInit) => { calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) }); return json({ results: [ROW()], nextPageToken: "n" }); }) as unknown as typeof fetch;
    const g = makeAdsApi({ ...base, fetch: f, loginCustomerId: "300-000-0003" });
    const page = await g.campaignMetrics({ customerId: "100-000-0001", since: "2026-11-01", until: "2026-11-02", pageToken: "p1" });
    expect(page.nextPageToken).toBe("n");
    expect(calls[0].url).toBe("https://ads.invalid/v99/customers/1000000001/googleAds:search");
    expect(calls[0].headers).toMatchObject({ "developer-token": "dev-token", authorization: "Bearer tok", "login-customer-id": "3000000003" });
    expect(calls[0].body).toMatchObject({ pageToken: "p1" });
    expect((calls[0].body as { query: string }).query).toContain("FROM campaign");
    await expect(g.campaignMetrics({ customerId: "../etc", since: "2026-11-01", until: "2026-11-02" })).rejects.toThrow();
  });
  it("lists accessible customers; a manager is replaced by its enabled client accounts reached through it", async () => {
    const queue: Response[] = [
      json({ resourceNames: ["customers/1000000001", "customers/2000000002"] }),
      json({ results: [{ customer: { id: "1000000001", descriptiveName: "Direct client", currencyCode: "INR", manager: false, status: "ENABLED" } }] }),
      json({ results: [{ customer: { id: "2000000002", descriptiveName: "Agency", currencyCode: "USD", manager: true, status: "ENABLED" } }] }),
      json({ results: [{ customerClient: { id: "4000000004", descriptiveName: "Managed client", currencyCode: "USD", manager: false, status: "ENABLED" } }, { customerClient: { id: "5000000005", descriptiveName: "Closed", currencyCode: "USD", manager: false, status: "CANCELED" } }, { customerClient: { id: "6000000006", descriptiveName: "Sub-manager", manager: true, status: "ENABLED" } }] }),
    ];
    const heads: Record<string, string>[] = [];
    const f = (async (_u: string, init: RequestInit) => { heads.push(init.headers as Record<string, string>); return queue.shift()!; }) as unknown as typeof fetch;
    const list = await makeAdsApi({ ...base, fetch: f }).listCustomers();
    expect(list).toEqual([
      { id: "1000000001", name: "Direct client", currency: "INR", manager: false },
      { id: "4000000004", name: "Managed client", currency: "USD", manager: false, loginCustomerId: "2000000002" },
    ]);
    expect(heads[3]["login-customer-id"]).toBe("2000000002");
  });
  it("one account the token cannot open does not hide the others; if none open, the credential error surfaces", async () => {
    const denied = { error: { status: "PERMISSION_DENIED", details: [{ errors: [{ errorCode: { authorizationError: "USER_PERMISSION_DENIED" } }] }] } };
    const mixed = [json({ resourceNames: ["customers/1000000001", "customers/1000000002"] }), json(denied, 403), json({ results: [{ customer: { id: "1000000002", descriptiveName: "Ok", currencyCode: "INR" } }] })];
    expect((await makeAdsApi({ ...base, fetch: (async () => mixed.shift()!) as unknown as typeof fetch }).listCustomers()).map((c) => c.id)).toEqual(["1000000002"]);
    const none = [json({ resourceNames: ["customers/1000000001"] }), json(denied, 403)];
    await expect(makeAdsApi({ ...base, fetch: (async () => none.shift()!) as unknown as typeof fetch }).listCustomers()).rejects.toBeInstanceOf(CredentialError);
  });
  it("an unapproved developer token is reported as a gate, not as a revoked grant", async () => {
    const body = { error: { code: 403, status: "PERMISSION_DENIED", details: [{ errors: [{ errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" } }] }] } };
    const g = makeAdsApi({ ...base, fetch: (async () => json(body, 403)) as unknown as typeof fetch });
    await expect(g.campaignMetrics({ customerId: "1000000001", since: "2026-11-01", until: "2026-11-02" })).rejects.toThrow(/developer token/i);
  });
});

describe("customer selection (tenant isolation, Vault, audit)", () => {
  const vault = new Map<string, string>();
  const audits: { action: string; detail?: Record<string, unknown> }[] = [];
  const conns = new Map<string, ConnectionRow>([["c-1", { ...CONN, credentialSecretId: "sec-1" }]]);
  const patches: Record<string, unknown>[] = [];
  const cursors: string[] = [];
  const d = (): RuntimeDeps => ({
    store: { getConnection: async (id: string) => conns.get(id) ?? null, updateConnection: async (_id: string, p: Record<string, unknown>) => { patches.push(p); }, setCursor: async (_c: string, s: string) => { cursors.push(s); } } as unknown as RuntimeDeps["store"],
    vault: { putSecret: async (name: string, v: string) => { const id = `v-${vault.size + 1}`; vault.set(id, v); void name; return id; }, getSecret: async (id: string) => vault.get(id) ?? null, deleteSecret: async (id: string) => { vault.delete(id); } },
    env: { APP_ENV: "demo" }, log: { info() {}, warn() {}, error() {} },
    audit: async (e) => { audits.push(e); },
  });
  beforeEach(() => { vault.clear(); vault.set("sec-1", JSON.stringify({ access_token: "google-mock-token", refresh_token: "r" })); audits.length = 0; patches.length = 0; cursors.length = 0; });
  const actor = { uid: "u", tenantId: "t-1", workspaceId: "w-1" };

  it("stores the chosen account and its currency in the Vault bundle, resets the cursor and audits", async () => {
    const r = await selectAdsCustomer(d(), actor, "c-1", "100-000-0001");
    expect(r).toEqual({ ok: true, value: { name: "Sample ads account", currency: "INR" } });
    const saved = JSON.parse([...vault.values()].at(-1)!);
    expect(saved).toMatchObject({ customer_id: "1000000001", currency: "INR", refresh_token: "r" });
    expect(cursors).toEqual(["daily"]);
    expect(audits[0]).toMatchObject({ action: "google_ads.customer_selected" });
    expect(patches[0]).toMatchObject({ externalAccountId: "1000000001" });
  });
  it("refuses an account the Google user cannot reach, bad input, and another workspace's connection", async () => {
    expect(await selectAdsCustomer(d(), actor, "c-1", "9999999999")).toEqual({ ok: false, code: "not_available" });
    expect(await selectAdsCustomer(d(), actor, "c-1", "abc")).toEqual({ ok: false, code: "invalid_input" });
    expect(await selectAdsCustomer(d(), { ...actor, workspaceId: "w-2" }, "c-1", "1000000001")).toEqual({ ok: false, code: "not_found" });
    expect(await selectAdsCustomer(d(), { ...actor, tenantId: "t-2" }, "c-1", "1000000001")).toEqual({ ok: false, code: "not_found" });
    expect(audits).toHaveLength(0);
  });
  it("lists names and ids only", async () => {
    const r = await listAdsCustomers(d(), actor, "c-1");
    expect(r).toEqual({ ok: true, value: [{ id: "1000000001", name: "Sample ads account", currency: "INR", manager: false }] });
  });
  it("an audit failure is reported (audit or nothing)", async () => {
    const dd = d(); dd.audit = async () => { throw new Error("down"); };
    expect(await selectAdsCustomer(dd, actor, "c-1", "1000000001")).toEqual({ ok: false, code: "audit_failed" });
  });
});
