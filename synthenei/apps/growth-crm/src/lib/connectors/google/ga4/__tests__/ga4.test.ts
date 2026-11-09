// GA4: runReport parsing against the published response schema (synthetic values), normalisation, merging, request body, incremental
// resumable stream with window replacement, and the Admin API / Data API client against scripted responses.
import { beforeEach, describe, expect, it } from "vitest";
import { CredentialError } from "../../../core/types";
import type { ConnectionRow } from "../../../core/types";
import { makeGa4Api } from "../api";
import { DIMENSIONS, METRICS } from "../constants";
import { ga4GatewayFor } from "../config";
import { makeMockGa4 } from "../mock";
import { mergeRows, normaliseRow, parseReport, reportRequest, ymdToDay, type Ga4DailyRow, type RunReportResponse } from "../report";
import { ga4Step, type Ga4StreamCtx } from "../sync";
import type { Ga4Deps, Ga4Source, Ga4Store } from "../store";
import type { ConnScope } from "../../shared/mode";

/** Shape per https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport (values are synthetic). */
const REPORT: RunReportResponse & { kind: string } = {
  dimensionHeaders: DIMENSIONS.map((name) => ({ name })),
  metricHeaders: METRICS.map((name) => ({ name, type: "TYPE_INTEGER" })),
  rows: [
    { dimensionValues: ["20261101", "Organic Search", "google / organic", "mobile", "Sample City", "/", "(not set)"].map((value) => ({ value })), metricValues: ["120", "84", "100", "60", "5400", "3"].map((value) => ({ value })) },
    { dimensionValues: ["20261101", "Paid Search", "google / cpc", "desktop", "(not set)", "/offer", "spring-promo"].map((value) => ({ value })), metricValues: ["40", "30", "38", "30", "1800", "6"].map((value) => ({ value })) },
    { dimensionValues: ["20261102", "(not set)", "(direct) / (none)", "mobile", "Sample City", "/", "(not set)"].map((value) => ({ value })), metricValues: ["0", "0", "0", "0", "0", "0"].map((value) => ({ value })) },
  ],
  rowCount: 3, metadata: { currencyCode: "INR", timeZone: "Asia/Kolkata", dataLossFromOtherRow: false, subjectToThresholding: true }, kind: "analyticsData#runReport",
};

describe("parseReport / normaliseRow", () => {
  it("matches columns by header name and reads metadata flags", () => {
    const p = parseReport(REPORT);
    expect(p).toMatchObject({ rowCount: 3, otherRow: false, thresholded: true });
    expect(p.rows[1].dims.sessionCampaignName).toBe("spring-promo");
    expect(p.rows[1].metrics.keyEvents).toBe("6");
    // reordered headers still map correctly
    const flipped = parseReport({ dimensionHeaders: [{ name: "city" }, { name: "date" }], metricHeaders: [{ name: "sessions" }], rows: [{ dimensionValues: [{ value: "X" }, { value: "20261101" }], metricValues: [{ value: "9" }] }] });
    expect(flipped.rows[0]).toEqual({ dims: { city: "X", date: "20261101" }, metrics: { sessions: "9" } });
  });
  it("normalises: (not set) becomes empty, channel falls back to Unassigned, engagement is seconds per session", () => {
    const [a, b, c] = parseReport(REPORT).rows.map(normaliseRow);
    expect(a).toEqual({ ok: true, row: { day: "2026-11-01", channelGroup: "Organic Search", sourceMedium: "google / organic", deviceCategory: "mobile", city: "Sample City", landingPage: "/", campaign: "", sessions: 120, engagedSessions: 84, totalUsers: 100, newUsers: 60, avgEngagementSecs: 45, keyEvents: 3 } });
    expect(b).toMatchObject({ ok: true, row: { city: "", campaign: "spring-promo", keyEvents: 6, avgEngagementSecs: 45 } });
    // no sessions: the average is null (not 0), channel group is Unassigned
    expect(c).toMatchObject({ ok: true, row: { channelGroup: "Unassigned", sessions: 0, avgEngagementSecs: null } });
  });
  it("rejects a bad date or a non-numeric / negative metric instead of writing zeros", () => {
    const good = parseReport(REPORT).rows[0];
    expect(normaliseRow({ ...good, dims: { ...good.dims, date: "2026-11-01" } })).toEqual({ ok: false, reason: "bad_day" });
    expect(normaliseRow({ ...good, dims: { ...good.dims, date: "20261340" } })).toEqual({ ok: false, reason: "bad_day" });
    expect(normaliseRow({ ...good, metrics: { ...good.metrics, sessions: "n/a" } })).toEqual({ ok: false, reason: "bad_metric" });
    expect(normaliseRow({ ...good, metrics: { ...good.metrics, keyEvents: "-1" } })).toEqual({ ok: false, reason: "bad_metric" });
    expect(normaliseRow({ ...good, metrics: { ...good.metrics, newUsers: "" } })).toEqual({ ok: false, reason: "bad_metric" });
    expect(ymdToDay("20260229")).toBeNull();
  });
});

describe("mergeRows", () => {
  const row = (o: Partial<Ga4DailyRow>): Ga4DailyRow => ({ day: "2026-11-01", channelGroup: "Paid Search", sourceMedium: "google / cpc", deviceCategory: "mobile", city: "", landingPage: "/", campaign: "a", sessions: 10, engagedSessions: 6, totalUsers: 9, newUsers: 5, avgEngagementSecs: 30, keyEvents: 2, ...o });
  it("keeps campaigns apart when the table has the column", () => { expect(mergeRows([row({ campaign: "a" }), row({ campaign: "b" })], true)).toHaveLength(2); });
  it("collapses campaigns for the original table key: counts add, engagement is session-weighted", () => {
    const m = mergeRows([row({ campaign: "a", sessions: 10, avgEngagementSecs: 30 }), row({ campaign: "b", sessions: 30, avgEngagementSecs: 50 })], false);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ sessions: 40, keyEvents: 4, campaign: "", avgEngagementSecs: 45 });
  });
});

describe("reportRequest", () => {
  it("asks for the published dimension and metric names with offset paging", () => {
    const b = reportRequest("2026-11-01", "2026-11-03", 20000, 10000);
    expect(b.dimensions.map((d) => d.name)).toEqual(["date", "sessionDefaultChannelGroup", "sessionSourceMedium", "deviceCategory", "city", "landingPage", "sessionCampaignName"]);
    expect(b.metrics.map((m) => m.name)).toEqual(["sessions", "engagedSessions", "totalUsers", "newUsers", "userEngagementDuration", "keyEvents"]);
    expect(b).toMatchObject({ dateRanges: [{ startDate: "2026-11-01", endDate: "2026-11-03" }], limit: "10000", offset: "20000" });
  });
});

class FakeGa4Store implements Ga4Store {
  rows = new Map<string, Ga4DailyRow & { source: string; ws: string }>(); cleared: { since: string; until: string; source: string; ws: string }[] = [];
  async clearWindow(s: ConnScope, since: string, until: string, source: Ga4Source) {
    this.cleared.push({ since, until, source, ws: s.workspaceId });
    for (const [k, r] of this.rows) if (r.ws === s.workspaceId && r.source === source && r.day >= since && r.day <= until) this.rows.delete(k);
  }
  async upsertDaily(rows: Ga4DailyRow[], ctx: ConnScope & { source: Ga4Source }) {
    for (const r of rows) this.rows.set([ctx.workspaceId, r.day, r.channelGroup, r.sourceMedium, r.deviceCategory, r.city, r.landingPage, r.campaign].join("|"), { ...r, source: ctx.source, ws: ctx.workspaceId });
  }
}
const CONN: ConnectionRow = { id: "c-1", tenantId: "t-1", workspaceId: "w-1", connectorId: "ga4", mode: "sandbox", status: "sandbox", settings: {}, credentialSecretId: "s", webhookSecretId: null, tokenExpiresAt: null };
const NOW = new Date("2026-11-09T05:00:00Z");   // 10:30 IST
let store: FakeGa4Store;
const deps = (now = NOW): Ga4Deps => ({ store, log: { info() {}, warn() {}, error() {} }, now: () => now });
const ctx = (over: Partial<Ga4StreamCtx> = {}): Ga4StreamCtx => ({ deps: deps(), conn: CONN, secrets: { property_id: "100000001", access_token: "t" }, gateway: makeMockGa4(), reject: () => {}, ...over });
beforeEach(() => { store = new FakeGa4Store(); });

describe("ga4Step", () => {
  it("does nothing until a property is chosen", async () => {
    expect(await ga4Step(ctx({ secrets: { access_token: "t" } }), undefined)).toMatchObject({ done: true, rowsIn: 0, sample: { skipped: "no_property" } });
  });
  it("backfills the window once, labels Showcase rows mock, and is idempotent on re-run", async () => {
    const r = await ga4Step(ctx(), undefined);
    expect(r).toMatchObject({ done: true, cursor: { through: "2026-11-08" }, rowsRejected: 0, sample: { mode: "mock" } });
    expect(store.cleared[0]).toMatchObject({ since: "2026-08-11", until: "2026-11-08", source: "mock", ws: "w-1" });
    const n = store.rows.size;
    expect(n).toBeGreaterThan(0);
    expect([...store.rows.values()].every((x) => x.source === "mock" && x.ws === "w-1")).toBe(true);
    await ga4Step(ctx(), undefined);
    expect(store.rows.size).toBe(n);   // window replaced, not doubled
  });
  it("incremental: after the backfill only the trailing days are re-read, and nothing when current", async () => {
    const r = await ga4Step(ctx(), { through: "2026-11-06" });
    expect(r.sample).toMatchObject({ days: "2026-11-04..2026-11-08" });
    expect(await ga4Step(ctx(), { through: "2026-11-08" })).toMatchObject({ sample: { skipped: "up_to_date" }, rowsIn: 0 });
  });
  it("a restated day replaces what was loaded (a vanished combination does not linger)", async () => {
    await ga4Step(ctx(), { through: "2026-11-06" });
    const before = [...store.rows.values()].filter((r) => r.day === "2026-11-05").length;
    const fewer = { ...makeMockGa4(), async runReport() { return { ...REPORT, rows: [REPORT.rows![0]], rowCount: 1 }; } } as unknown as Ga4StreamCtx["gateway"];
    // the single row is dated 2026-11-01 (outside the window), so the whole 04..08 window is cleared and re-written with nothing inside it
    await ga4Step(ctx({ gateway: fewer }), { through: "2026-11-06" });
    expect(before).toBeGreaterThan(0);
    expect([...store.rows.values()].filter((r) => r.day === "2026-11-05")).toHaveLength(0);
  });
  it("pages with a resumable offset cursor and clears the window only once", async () => {
    const seen: number[] = [];
    const g = { ...makeMockGa4(), async runReport(i: { offset: number; limit: number }) { seen.push(i.offset); return makeMockGa4().runReport({ propertyId: "1", since: "2026-11-05", until: "2026-11-05", offset: i.offset, limit: i.limit }); } } as unknown as Ga4StreamCtx["gateway"];
    const first = await ga4Step(ctx({ gateway: g }), { through: "2026-11-07" }, 2);
    expect(first.done).toBe(false);
    expect(first.cursor).toMatchObject({ through: "2026-11-07", win: { page: 2 } });
    const second = await ga4Step(ctx({ gateway: g }), first.cursor, 2);
    expect(second).toMatchObject({ done: true, cursor: { through: "2026-11-08" } });
    expect(seen).toEqual([0, 2]);
    expect(store.cleared).toHaveLength(1);
  });
  it("rejected rows are counted with a reason and never written as zeros", async () => {
    const reasons: string[] = [];
    const bad = { ...REPORT, rows: [{ dimensionValues: REPORT.rows![0].dimensionValues, metricValues: REPORT.rows![0].metricValues!.map(() => ({ value: "x" })) }, REPORT.rows![0]], rowCount: 2 };
    const g = { ...makeMockGa4(), async runReport() { return bad; } } as unknown as Ga4StreamCtx["gateway"];
    const r = await ga4Step(ctx({ gateway: g, reject: (x) => reasons.push(x) }), undefined);
    expect(r.rowsRejected).toBe(1);
    expect(reasons).toEqual(["bad_metric"]);
    expect(store.rows.size).toBe(1);
  });
  it("tenant scope: rows are written only under the connection's workspace", async () => {
    await ga4Step(ctx({ conn: { ...CONN, workspaceId: "w-2", tenantId: "t-2" } }), { through: "2026-11-07" });
    expect([...store.rows.values()].every((r) => r.ws === "w-2")).toBe(true);
  });
});

describe("ga4 API client", () => {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  it("lists properties across account summaries and pages, keeping only numeric ids", async () => {
    const urls: string[] = [];
    const pages = [
      json({ accountSummaries: [{ account: "accounts/1", displayName: "Acct", propertySummaries: [{ property: "properties/111", displayName: "Site A" }, { property: "properties/zzz", displayName: "bad" }] }], nextPageToken: "n2" }),
      json({ accountSummaries: [{ account: "accounts/2", displayName: "Acct 2", propertySummaries: [{ property: "properties/222", displayName: "Site B" }] }] }),
    ];
    const f = (async (u: string) => { urls.push(u); return pages.shift()!; }) as unknown as typeof fetch;
    const g = makeGa4Api({ dataBase: "https://data.invalid/v1beta", adminBase: "https://admin.invalid/v1beta", token: "t", fetch: f });
    expect(await g.listProperties()).toEqual([{ id: "111", name: "Site A", account: "Acct" }, { id: "222", name: "Site B", account: "Acct 2" }]);
    expect(urls[0]).toBe("https://admin.invalid/v1beta/accountSummaries?pageSize=200");
    expect(urls[1]).toContain("pageToken=n2");
  });
  it("runReport posts to properties/<id>:runReport on the configured base; a revoked property access needs the owner", async () => {
    const calls: { url: string; body: string }[] = [];
    const f = (async (u: string, i: RequestInit) => { calls.push({ url: u, body: String(i.body) }); return calls.length === 1 ? json(REPORT) : json({ error: { status: "PERMISSION_DENIED" } }, 403); }) as unknown as typeof fetch;
    const g = makeGa4Api({ dataBase: "https://data.invalid/v1beta/", adminBase: "https://admin.invalid", token: "t", fetch: f });
    await g.runReport({ propertyId: "123", since: "2026-11-01", until: "2026-11-02", offset: 0, limit: 10 });
    expect(calls[0].url).toBe("https://data.invalid/v1beta/properties/123:runReport");
    expect(JSON.parse(calls[0].body).dimensions).toHaveLength(7);
    await expect(g.runReport({ propertyId: "123", since: "2026-11-01", until: "2026-11-02", offset: 0, limit: 10 })).rejects.toBeInstanceOf(CredentialError);
    await expect(g.runReport({ propertyId: "../x", since: "2026-11-01", until: "2026-11-02", offset: 0, limit: 10 })).rejects.toThrow();
  });
  it("gatewayFor serves the mock for the sandbox token and refuses it in production", () => {
    expect(ga4GatewayFor({ secrets: { access_token: "google-mock-token" }, env: {} }).kind).toBe("mock");
    expect(() => ga4GatewayFor({ secrets: { access_token: "google-mock-token" }, env: { APP_ENV: "production" } })).toThrow(CredentialError);
    expect(ga4GatewayFor({ secrets: { access_token: "real" }, env: {} }).kind).toBe("api");
  });
});
