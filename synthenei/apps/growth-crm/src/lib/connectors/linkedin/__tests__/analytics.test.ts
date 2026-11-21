// Ad analytics: normalisation (cost, currency, counts), window planning, stream, token expiry and health.
import { beforeEach, describe, expect, it } from "vitest";
import { CredentialError } from "../../core/types";
import * as F from "../__fixtures__/payloads";
import { analyticsStep, fxRatesOf, healthStep, normaliseAnalytics, planWindow, spendInr, tokenState, type StreamCtx } from "../analytics";
import { makeMockGateway, type MockGateway } from "../mock";
import { CONN, fakeDeps, NOW } from "./fake-store";

describe("normaliseAnalytics", () => {
  it("rounds spend to paise and reads campaign, day and counts", () => {
    expect(normaliseAnalytics(F.rawAnalytics(), "INR", {})).toEqual({ ok: true, row: { externalCampaignId: "200000001", day: "2026-11-01", spendInr: 1234.57, impressions: 10000, clicks: 150, platformLeads: 4 } });
  });
  it("INR passes through; other currencies need the tenant's rate and are rejected without one", () => {
    expect(spendInr("10", "INR", {})).toBe(10);
    expect(spendInr("10", "USD", { USD: 83.5 })).toBe(835);
    expect(spendInr("10", "USD", {})).toBeNull();
    expect(spendInr("10", "", {})).toBeNull();
    expect(normaliseAnalytics(F.rawAnalytics(), "USD", {})).toEqual({ ok: false, reason: "currency_unconvertible" });
    expect(fxRatesOf({ fx_to_inr: { usd: 83.5, EUR: -1, X: 2, GBP: "5" } })).toEqual({ USD: 83.5 });
  });
  it("rejects bad day, missing campaign and bad spend instead of writing zeros", () => {
    expect(normaliseAnalytics(F.rawAnalytics({ dateRange: { start: { year: 2026, month: 13, day: 40 } } }), "INR", {})).toEqual({ ok: false, reason: "bad_day" });
    expect(normaliseAnalytics(F.rawAnalytics({ dateRange: undefined }), "INR", {})).toEqual({ ok: false, reason: "bad_day" });
    expect(normaliseAnalytics(F.rawAnalytics({ pivotValues: undefined }), "INR", {})).toEqual({ ok: false, reason: "no_campaign" });
    expect(normaliseAnalytics(F.rawAnalytics({ pivotValues: ["urn:li:sponsoredCreative:1"] }), "INR", {})).toEqual({ ok: false, reason: "no_campaign" });
    expect(normaliseAnalytics(F.rawAnalytics({ costInLocalCurrency: "abc" }), "INR", {})).toEqual({ ok: false, reason: "bad_spend" });
    expect(normaliseAnalytics(F.rawAnalytics({ costInLocalCurrency: "-1" }), "INR", {})).toEqual({ ok: false, reason: "bad_spend" });
  });
  it("missing optional metrics are zero counts, not rejections", () => {
    expect(normaliseAnalytics(F.rawAnalytics({ clicks: undefined, oneClickLeads: undefined }), "INR", {})).toMatchObject({ ok: true, row: { clicks: 0, platformLeads: 0 } });
  });
});

describe("planWindow (IST)", () => {
  it("first run backfills 30 days up to yesterday after 06:00 IST", () => { expect(planWindow(NOW, undefined)).toEqual({ since: "2026-10-10", until: "2026-11-08" }); });
  it("before 06:00 IST the newest day is not final yet", () => { expect(planWindow(new Date("2026-11-08T22:00:00Z"), undefined)?.until).toBe("2026-11-07"); });
  it("later runs re-read the trailing 7 days, and nothing when current", () => {
    expect(planWindow(NOW, "2026-11-07")).toEqual({ since: "2026-11-01", until: "2026-11-08" });
    expect(planWindow(NOW, "2026-11-08")).toBeNull();
  });
});

let deps: ReturnType<typeof fakeDeps>, gw: MockGateway;
const ctx = (secrets: Record<string, string> = { ad_account_id: F.ACCOUNT, access_token: "t" }, g: MockGateway = gw, conn = CONN): StreamCtx => ({ deps, conn, secrets, gateway: g, reject: () => {} });
beforeEach(() => { deps = fakeDeps(); gw = makeMockGateway(); });

describe("analyticsStep", () => {
  it("loads the window into campaign_daily_metrics (source mock for the sandbox), names the campaign, and is idempotent", async () => {
    const r = await analyticsStep(ctx(), undefined);
    expect(r).toMatchObject({ done: true, cursor: { through: "2026-11-08" }, rowsRejected: 0 });
    expect(deps.store.metrics.size).toBe(30);
    expect([...deps.store.metrics.values()].every((m) => m.source === "mock")).toBe(true);
    expect(deps.store.campaigns).toHaveLength(1);
    expect(deps.store.campaigns[0]).toMatchObject({ name: "Sample campaign", synthetic: true });
    await analyticsStep(ctx(), undefined);
    expect(deps.store.metrics.size).toBe(30);
  });
  it("a real name replaces the placeholder a lead created first", async () => {
    await deps.store.ensureCampaign({ workspaceId: "w-1", externalId: "200000001", name: "LinkedIn campaign 200000001", placeholder: true, synthetic: false });
    await analyticsStep(ctx(), undefined);
    expect(deps.store.campaigns[0].name).toBe("Sample campaign");
  });
  it("seeded rows: bad ones are rejected and counted, good ones loaded; a non-INR account without a rate loads nothing", async () => {
    gw.seedAnalytics([F.rawAnalytics({ dateRange: { start: { year: 2026, month: 11, day: 2 } } }), F.rawAnalytics({ costInLocalCurrency: "x", dateRange: { start: { year: 2026, month: 11, day: 3 } } })]);
    const r = await analyticsStep(ctx(), undefined);
    expect(r).toMatchObject({ rowsIn: 1, rowsRejected: 1 });
    const usd = { ...gw, accountCurrency: async () => "USD" } as unknown as MockGateway;
    deps = fakeDeps();
    expect(await analyticsStep(ctx(undefined, usd), undefined)).toMatchObject({ rowsIn: 0, rowsRejected: 2 });
    expect(deps.store.metrics.size).toBe(0);
    deps = fakeDeps();
    await analyticsStep(ctx(undefined, usd, { ...CONN, settings: { fx_to_inr: { USD: 80 } } }), undefined);
    expect([...deps.store.metrics.values()][0].spendInr).toBe(98765.36);
  });
  it("without an ad account, or when current, it does nothing", async () => {
    expect(await analyticsStep(ctx({ access_token: "t" }), undefined)).toMatchObject({ rowsIn: 0, sample: { skipped: "no_ad_account" } });
    expect(await analyticsStep(ctx(), { through: "2026-11-08" })).toMatchObject({ rowsIn: 0, sample: { skipped: "up_to_date" } });
  });
  it("a dead token is a CredentialError, never a silent empty sync", async () => {
    const g = { ...gw, analytics: async () => { throw new CredentialError("no"); } } as unknown as MockGateway;
    await expect(analyticsStep(ctx(undefined, g), undefined)).rejects.toBeInstanceOf(CredentialError);
  });
});

describe("token expiry and health", () => {
  it("classifies expiry", () => {
    expect(tokenState(null, NOW)).toBe("unknown");
    expect(tokenState("garbage", NOW)).toBe("unknown");
    expect(tokenState("2026-11-08T00:00:00Z", NOW)).toBe("expired");
    expect(tokenState("2026-11-12T00:00:00Z", NOW)).toBe("expiring");
    expect(tokenState("2027-01-01T00:00:00Z", NOW)).toBe("ok");
  });
  it("an expired stored token throws CredentialError (needs_attention) before any vendor call", async () => {
    let called = false;
    const g = { ...gw, introspect: async () => { called = true; return { active: true, expiresAt: null, scopes: [] }; } } as unknown as MockGateway;
    await expect(healthStep(ctx(undefined, g, { ...CONN, tokenExpiresAt: "2026-11-01T00:00:00Z" }), undefined)).rejects.toBeInstanceOf(CredentialError);
    expect(called).toBe(false);
  });
  it("an inactive token throws CredentialError", async () => {
    const g = { ...gw, introspect: async () => ({ active: false, expiresAt: null, scopes: [] }) } as unknown as MockGateway;
    await expect(healthStep(ctx(undefined, g), undefined)).rejects.toBeInstanceOf(CredentialError);
  });
  it("healthy token reports days left and missing scopes, then skips for the rest of the IST day", async () => {
    const g = { ...gw, introspect: async () => ({ active: true, expiresAt: Math.floor(NOW.getTime() / 1000) + 3 * 86400, scopes: ["r_ads"] }) } as unknown as MockGateway;
    const r = await healthStep(ctx(undefined, g), undefined);
    expect(r.sample).toMatchObject({ valid: true, days_left: 3, state: "expiring", missing_scopes: ["r_ads_reporting", "r_ads_leadgen_automation"] });
    expect(await healthStep(ctx(undefined, g), r.cursor)).toMatchObject({ sample: { skipped: "checked_today" } });
  });
});
