// Insights normalisation (cost, currency, counts), window planning, resumable stream, token expiry and health.
import { beforeEach, describe, expect, it } from "vitest";
import { CredentialError } from "../../core/types";
import * as F from "../__fixtures__/payloads";
import { fxRatesOf, healthStep, insightsStep, normaliseInsight, planWindow, spendInr, tokenState, type StreamCtx } from "../insights";
import { makeMockGateway, type MockGateway } from "../mock";
import { CONN, fakeDeps, NOW } from "./fake-store";

describe("normaliseInsight", () => {
  it("rounds spend to paise, counts actions once (lead beats lead_grouped) and maps reactions/comments/shares", () => {
    const n = normaliseInsight(F.insightRow(), {});
    expect(n).toMatchObject({ ok: true, name: "Camp one", row: { externalCampaignId: "888", day: "2026-11-01", spendInr: 1234.57, impressions: 10000, reach: 8000, clicks: 150, platformLeads: 4, reactions: 12, comments: 3, shares: 2 } });
  });
  it("INR passes through; other currencies need the tenant's rate and are rejected without one", () => {
    expect(spendInr("10", "INR", {})).toBe(10);
    expect(spendInr("10", "USD", { USD: 83.5 })).toBe(835);
    expect(spendInr("10", "USD", {})).toBeNull();
    expect(normaliseInsight(F.insightRow({ account_currency: "USD" }), {})).toEqual({ ok: false, reason: "currency_unconvertible" });
    expect(fxRatesOf({ fx_to_inr: { usd: 83.5, EUR: -1, X: 2, GBP: "5" } })).toEqual({ USD: 83.5 });
  });
  it("rejects bad day, missing campaign and bad spend instead of writing zeros", () => {
    expect(normaliseInsight(F.insightRow({ date_start: "yesterday" }), {})).toEqual({ ok: false, reason: "bad_day" });
    expect(normaliseInsight(F.insightRow({ campaign_id: undefined }), {})).toEqual({ ok: false, reason: "no_campaign" });
    expect(normaliseInsight(F.insightRow({ spend: "abc" }), {})).toEqual({ ok: false, reason: "bad_spend" });
    expect(normaliseInsight(F.insightRow({ spend: "-1" }), {})).toEqual({ ok: false, reason: "bad_spend" });
  });
  it("missing optional metrics are zero counts, not rejections", () => {
    expect(normaliseInsight(F.insightRow({ reach: undefined, actions: undefined }), {})).toMatchObject({ ok: true, row: { reach: 0, platformLeads: 0 } });
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
const ctx = (secrets: Record<string, string> = { ad_account_id: "1", access_token: "t" }, g: MockGateway = gw): StreamCtx => ({ deps, conn: CONN, secrets, gateway: g, reject: () => {} });
beforeEach(() => { deps = fakeDeps(); gw = makeMockGateway(); });

describe("insightsStep", () => {
  it("loads the window into campaign_daily_metrics (source mock for the sandbox) and is idempotent", async () => {
    const r = await insightsStep(ctx(), undefined);
    expect(r).toMatchObject({ done: true, cursor: { through: "2026-11-08" }, rowsRejected: 0 });
    expect(deps.store.metrics.size).toBe(30);
    expect([...deps.store.metrics.values()].every((m) => m.source === "mock")).toBe(true);
    await insightsStep(ctx(), undefined);
    expect(deps.store.metrics.size).toBe(30);
    expect(deps.store.campaigns).toHaveLength(1);
  });
  it("paginates with a resumable cursor", async () => {
    let calls = 0;
    const g = { ...gw, insights: async (i: { after?: string }) => { calls++; return i.after ? { rows: [F.insightRow({ date_start: "2026-11-02" })] } : { rows: [F.insightRow()], after: "cur1" }; } } as unknown as MockGateway;
    const first = await insightsStep(ctx(undefined, g), { through: "2026-11-07" });
    expect(first.done).toBe(false);
    const second = await insightsStep(ctx(undefined, g), first.cursor);
    expect(second).toMatchObject({ done: true, cursor: { through: "2026-11-08" } });
    expect(calls).toBe(2);
    expect(deps.store.metrics.size).toBe(2);
  });
  it("counts rejected rows and does nothing without an ad account or when current", async () => {
    gw.seedInsights([F.insightRow(), F.insightRow({ spend: "x", date_start: "2026-11-02" })]);
    expect(await insightsStep(ctx(), { through: "2026-11-07" })).toMatchObject({ rowsIn: 1, rowsRejected: 1 });
    expect((await insightsStep(ctx({ access_token: "t" }), undefined)).sample).toEqual({ skipped: "no_ad_account" });
    expect((await insightsStep(ctx(), { through: "2026-11-08" })).sample).toEqual({ skipped: "up_to_date" });
  });
  it("rate limits and dead tokens propagate to the framework (retry / needs_attention)", async () => {
    const g = { ...gw, insights: async () => { throw new CredentialError("dead"); } } as unknown as MockGateway;
    await expect(insightsStep(ctx(undefined, g), undefined)).rejects.toBeInstanceOf(CredentialError);
  });
});

describe("token expiry and health", () => {
  it("classifies expiry", () => {
    expect(tokenState(null, NOW)).toBe("unknown");
    expect(tokenState("2026-11-08T00:00:00Z", NOW)).toBe("expired");
    expect(tokenState("2026-11-12T00:00:00Z", NOW)).toBe("expiring");
    expect(tokenState("2027-01-01T00:00:00Z", NOW)).toBe("ok");
  });
  it("health reports days left and missing scopes, once per IST day", async () => {
    const g = { ...gw, debugToken: async () => ({ valid: true, expiresAt: Math.floor(NOW.getTime() / 1000) + 3 * 86400, scopes: ["ads_read"] }) } as unknown as MockGateway;
    const r = await healthStep(ctx(undefined, g), undefined);
    expect(r.sample).toMatchObject({ valid: true, days_left: 3 });
    expect((r.sample as { missing_scopes: string[] }).missing_scopes).toContain("leads_retrieval");
    expect((await healthStep(ctx(undefined, g), r.cursor)).sample).toEqual({ skipped: "checked_today" });
  });
  it("an invalid token is a CredentialError, never silent", async () => {
    const g = { ...gw, debugToken: async () => ({ valid: false, expiresAt: 1, scopes: [] }) } as unknown as MockGateway;
    await expect(healthStep(ctx(undefined, g), undefined)).rejects.toBeInstanceOf(CredentialError);
  });
});
