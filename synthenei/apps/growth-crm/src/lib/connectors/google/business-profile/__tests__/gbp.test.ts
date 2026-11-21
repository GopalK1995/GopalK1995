// Google Business Profile: mappers against Google's published response shapes (synthetic fixtures), the four-API client against scripted
// responses, resumable idempotent streams, listing selection with tenant isolation, and the reply workflow (human approval required).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ALL_CONNECTORS } from "../../../all";
import type { RuntimeDeps } from "../../../core/ports";
import { CredentialError, TransientError, type ConnectionRow } from "../../../core/types";
import { envConfigured, getConnector } from "../../../registry";
import type { ConnScope } from "../../shared/mode";
import { makeGbpApi } from "../api";
import { gbpGatewayFor, mockGbpFor, resetMockGbp } from "../config";
import { cleanReplyText, templateDrafter } from "../drafter";
import type { GbpGateway } from "../gateway";
import { foldSeries, normaliseReview, rangeParams, type MetricsRow, type RawReview, type RawSeries, type ReviewRow } from "../mappers";
import { decideReply, draftReply, postApprovedReply, submitForApproval, type ReplyDeps } from "../reply";
import { listGbpLocations, selectGbpLocation } from "../select";
import type { GbpDeps, GbpStore, ReplyPatch, ReplyStatus, StoredReview } from "../store";
import { performanceStep, reviewsStep, type GbpStreamCtx } from "../sync";

// ---------- fixtures (Google's REST shapes, invented values) ----------
const REVIEW = (over: Partial<RawReview> = {}): RawReview => ({ name: "accounts/1/locations/2/reviews/abc", reviewId: "abc", starRating: "FIVE", comment: "Great.", createTime: "2026-11-02T09:00:00.123456Z", updateTime: "2026-11-02T09:00:00Z", reviewer: { displayName: "Asha K" }, ...over });
const d = (y: number, m: number, day: number) => ({ year: y, month: m, day });
const SERIES = (metric: string, vals: Record<string, string | undefined>): RawSeries => ({ dailyMetric: metric, timeSeries: { datedValues: Object.entries(vals).map(([k, v]) => ({ date: d(2026, 11, Number(k)), ...(v === undefined ? {} : { value: v }) })) } });

describe("normaliseReview", () => {
  it("maps stars, text, author, time and an existing owner reply", () => {
    expect(normaliseReview(REVIEW({ reviewReply: { comment: " Thanks ", updateTime: "2026-11-03T00:00:00Z" } }))).toEqual({ ok: true, row: { externalId: "abc", rating: 5, text: "Great.", author: "Asha K", reviewedAt: "2026-11-02T09:00:00.123Z", externalReply: "Thanks", externalReplyAt: "2026-11-03T00:00:00.000Z" } });
  });
  it("anonymous reviewers have no name, a rating-only review has no text; the id falls back to the resource name", () => {
    const r = normaliseReview(REVIEW({ reviewId: undefined, comment: undefined, starRating: "ONE", reviewer: { isAnonymous: true, displayName: "A Google User" } }));
    expect(r).toMatchObject({ ok: true, row: { externalId: "abc", rating: 1, text: null, author: null, externalReply: null } });
  });
  it("rejects an unspecified rating or a missing id instead of inventing one", () => {
    expect(normaliseReview(REVIEW({ starRating: "STAR_RATING_UNSPECIFIED" }))).toEqual({ ok: false, reason: "bad_rating" });
    expect(normaliseReview({ starRating: "FIVE" })).toEqual({ ok: false, reason: "missing_id" });
  });
});

describe("foldSeries", () => {
  it("sums desktop + mobile impressions and keeps each count per day", () => {
    const { rows } = foldSeries([
      SERIES("BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", { 1: "10", 2: "20" }), SERIES("BUSINESS_IMPRESSIONS_MOBILE_SEARCH", { 1: "5" }),
      SERIES("BUSINESS_IMPRESSIONS_MOBILE_MAPS", { 1: "7" }), SERIES("CALL_CLICKS", { 1: "3", 2: "4" }), SERIES("WEBSITE_CLICKS", { 1: "2" }), SERIES("BUSINESS_DIRECTION_REQUESTS", { 2: "9" }),
    ], "2026-11-01", "2026-11-02");
    expect(rows).toEqual<MetricsRow[]>([
      { day: "2026-11-01", impressionsSearch: 15, impressionsMaps: 7, callClicks: 3, websiteClicks: 2, directionRequests: null, conversations: null, bookings: null, foodOrders: null },
      { day: "2026-11-02", impressionsSearch: 20, impressionsMaps: null, callClicks: 4, websiteClicks: null, directionRequests: 9, conversations: null, bookings: null, foodOrders: null },
    ]);
  });
  it("a dated entry without a value is Google's zero; a metric with no series at all stays null (never zero)", () => {
    const { rows } = foldSeries([SERIES("CALL_CLICKS", { 1: undefined })], "2026-11-01", "2026-11-01");
    expect(rows[0]).toMatchObject({ callClicks: 0, websiteClicks: null, impressionsSearch: null });
  });
  it("drops days outside the window and rejects unreadable dates and values", () => {
    const bad: RawSeries = { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ date: { year: 2026, month: 13, day: 1 }, value: "1" }, { date: d(2026, 11, 1), value: "-4" }, { date: d(2026, 11, 1), value: "x" }] } };
    expect(foldSeries([bad, SERIES("CALL_CLICKS", { 5: "1" })], "2026-11-01", "2026-11-03")).toEqual({ rows: [], rejected: 3 });
  });
  it("builds the dailyRange parameters from validated dates only", () => {
    expect(rangeParams("2026-11-01", "2026-11-08")).toEqual([["dailyRange.startDate.year", "2026"], ["dailyRange.startDate.month", "11"], ["dailyRange.startDate.day", "1"], ["dailyRange.endDate.year", "2026"], ["dailyRange.endDate.month", "11"], ["dailyRange.endDate.day", "8"]]);
    expect(() => rangeParams("2026-11-01&x=1", "2026-11-08")).toThrow();
  });
});

describe("drafter", () => {
  it("template replies are neutral, rating-aware, first-name only", async () => {
    expect(await templateDrafter.draft({ rating: 5, text: null, author: "Asha K" })).toMatch(/^Thank you for your kind words, Asha\./);
    expect(await templateDrafter.draft({ rating: 2, text: null, author: null })).toMatch(/sorry/);
    expect(await templateDrafter.draft({ rating: 3, text: null, author: "<script>" })).not.toMatch(/script/);
  });
  it("cleanReplyText strips control characters and enforces the limit", () => {
    expect(cleanReplyText("  hi\u0000 there ")).toBe("hi there");
    expect(cleanReplyText("   ")).toBeNull();
    expect(cleanReplyText("x".repeat(4097))).toBeNull();
  });
});

// ---------- API client ----------
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const api = (queue: Response[], calls: { url: string; method: string; body?: unknown; auth?: string }[] = []) => makeGbpApi({
  token: "tok", accountsBase: "https://acc.test/v1", infoBase: "https://info.test/v1", performanceBase: "https://perf.test/v1", reviewsBase: "https://rev.test/v4", sleep: async () => {}, maxRetries: 2,
  fetch: (async (url: string, init: RequestInit) => { calls.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : undefined, auth: (init.headers as Record<string, string>).authorization }); return queue.shift()!; }) as unknown as typeof fetch,
});

describe("API client", () => {
  it("lists locations across accounts and pages, with the read mask and bearer token", async () => {
    const calls: { url: string; method: string; auth?: string }[] = [];
    const g = api([
      json({ accounts: [{ name: "accounts/11" }, { name: "accounts/bad" }] }),
      json({ locations: [{ name: "locations/21", title: "One", storefrontAddress: { addressLines: ["1 Road"], locality: "Town" } }], nextPageToken: "p2" }),
      json({ locations: [{ name: "locations/22", title: "Two" }] }),
    ], calls);
    expect(await g.listLocations()).toEqual([{ account: "11", location: "21", title: "One", address: "1 Road, Town" }, { account: "11", location: "22", title: "Two" }]);
    expect(calls[1]!.url).toContain("https://info.test/v1/accounts/11/locations?readMask=name%2Ctitle%2CstorefrontAddress");
    expect(calls[2]!.url).toContain("pageToken=p2");
    expect(calls.every((c) => c.auth === "Bearer tok")).toBe(true);
  });
  it("lists reviews newest first with a page token", async () => {
    const calls: { url: string; method: string }[] = [];
    const out = await api([json({ reviews: [REVIEW()], nextPageToken: "n" })], calls).listReviews({ account: "accounts/11", location: "21", pageToken: "t" });
    expect(out.nextPageToken).toBe("n");
    expect(calls[0]!.url).toBe("https://rev.test/v4/accounts/11/locations/21/reviews?pageSize=50&orderBy=updateTime+desc&pageToken=t");
  });
  it("requests every daily metric for the range in one call and flattens the series", async () => {
    const calls: { url: string; method: string }[] = [];
    const out = await api([json({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [SERIES("CALL_CLICKS", { 1: "2" })] }] })], calls).dailyMetrics({ location: "21", since: "2026-11-01", until: "2026-11-03" });
    expect(out).toHaveLength(1);
    expect(calls[0]!.url).toContain("locations/21:fetchMultiDailyMetricsTimeSeries?dailyMetrics=BUSINESS_IMPRESSIONS_DESKTOP_SEARCH");
    expect(calls[0]!.url).toContain("dailyRange.endDate.day=3");
  });
  it("replies with PUT and the comment only; refuses bad ids and empty or oversized text", async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    await api([json({})], calls).replyToReview({ account: "11", location: "21", reviewId: "abc", comment: " Thanks " });
    expect(calls[0]).toMatchObject({ method: "PUT", url: "https://rev.test/v4/accounts/11/locations/21/reviews/abc/reply", body: { comment: "Thanks" } });
    const g = api([]);
    await expect(g.replyToReview({ account: "11", location: "21", reviewId: "../x", comment: "hi" })).rejects.toThrow();
    await expect(g.replyToReview({ account: "11", location: "21", reviewId: "abc", comment: "  " })).rejects.toThrow();
    await expect(g.listReviews({ account: "1/../2", location: "21" })).rejects.toThrow();
  });
  it("a refused permission or a revoked token needs the owner; quota backs off then succeeds", async () => {
    await expect(api([json({ error: { status: "PERMISSION_DENIED" } }, 403)]).listLocations()).rejects.toBeInstanceOf(CredentialError);
    await expect(api([json({ error: {} }, 401)]).listLocations()).rejects.toBeInstanceOf(CredentialError);
    const calls: { url: string; method: string }[] = [];
    expect((await api([json({}, 429), json({ accounts: [] })], calls).listLocations())).toEqual([]);
    expect(calls).toHaveLength(2);
    await expect(api([json({}, 503), json({}, 503), json({}, 503)]).listLocations()).rejects.toBeInstanceOf(TransientError);
  });
});

// ---------- fakes ----------
class FakeStore implements GbpStore {
  reviews = new Map<string, StoredReview & { rowKey: string }>();
  daily = new Map<string, MetricsRow & { source: string; location: string }>();
  upsertCalls = 0;
  async upsertReviews(rows: ReviewRow[], ctx: ConnScope) {
    this.upsertCalls++;
    let created = 0, updated = 0;
    for (const r of rows) {
      const key = `${ctx.workspaceId}|${ctx.connectionId}|${r.externalId}`, hit = this.reviews.get(key);
      if (!hit) { this.reviews.set(key, { id: `r-${this.reviews.size + 1}`, rowKey: key, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, connectionId: ctx.connectionId, externalId: r.externalId, rating: r.rating, text: r.text, author: r.author, replyDraft: null, replyStatus: "none", replyApprovedBy: null, replySource: null }); created++; }
      else if (hit.rating !== r.rating || hit.text !== r.text) { hit.rating = r.rating; hit.text = r.text; updated++; }
    }
    return { created, updated };
  }
  async upsertDaily(rows: MetricsRow[], ctx: ConnScope & { locationId: string; source: "api" | "mock" }) { for (const r of rows) this.daily.set(`${ctx.workspaceId}|${ctx.connectionId}|${r.day}`, { ...r, source: ctx.source, location: ctx.locationId }); }
  private find(scope: { tenantId: string; workspaceId: string }, id: string) { return [...this.reviews.values()].find((r) => r.id === id && r.tenantId === scope.tenantId && r.workspaceId === scope.workspaceId) ?? null; }
  async getReview(scope: { tenantId: string; workspaceId: string }, id: string) { const r = this.find(scope, id); return r ? { ...r } : null; }
  async updateReply(scope: { tenantId: string; workspaceId: string }, id: string, expect: ReplyStatus[], p: ReplyPatch) {
    const r = this.find(scope, id);
    if (!r || !expect.includes(r.replyStatus)) return false;
    const next = { ...r, ...(p.replyDraft !== undefined ? { replyDraft: p.replyDraft } : {}), ...(p.replyStatus ? { replyStatus: p.replyStatus } : {}), ...(p.replyApprovedBy !== undefined ? { replyApprovedBy: p.replyApprovedBy } : {}), ...(p.replySource !== undefined ? { replySource: p.replySource } : {}) };
    if ((next.replyStatus === "approved" || next.replyStatus === "posted") && !next.replyApprovedBy) throw new Error("reviews_reply_needs_approver");   // the 0019 constraint
    Object.assign(r, next);
    return true;
  }
  seed(over: Partial<StoredReview> = {}): StoredReview & { rowKey: string } {
    const r = { id: `r-${this.reviews.size + 1}`, rowKey: `k${this.reviews.size}`, tenantId: "t-1", workspaceId: "w-1", connectionId: "c-1", externalId: "ext-1", rating: 2, text: "Slow.", author: "Asha K", replyDraft: null, replyStatus: "none" as ReplyStatus, replyApprovedBy: null, replySource: null, ...over };
    this.reviews.set(r.rowKey, r);
    return r;
  }
}

const CONN: ConnectionRow = { id: "c-1", tenantId: "t-1", workspaceId: "w-1", connectorId: "google-business", mode: "sandbox", status: "sandbox", settings: {}, credentialSecretId: "s", webhookSecretId: null, tokenExpiresAt: null };
const NOW = new Date("2026-11-09T05:00:00Z");   // 10:30 IST
const SECRETS = { gbp_account: "1000000001", gbp_location: "2000000001", access_token: "google-mock-token" };
let store: FakeStore;
const deps = (now = NOW): GbpDeps => ({ store, log: { info() {}, warn() {}, error() {} }, now: () => now });
const ctx = (over: Partial<GbpStreamCtx> = {}): GbpStreamCtx => ({ deps: deps(), conn: CONN, secrets: SECRETS, gateway: gbpGatewayFor({ connectionId: "c-1", secrets: SECRETS, env: {} }), reject: () => {}, ...over });
beforeEach(() => { store = new FakeStore(); resetMockGbp(); });

describe("reviews stream", () => {
  it("waits for a listing", async () => {
    expect(await reviewsStep(ctx({ secrets: { access_token: "t" } }), undefined)).toMatchObject({ done: true, sample: { skipped: "no_listing" } });
  });
  it("loads reviews into the store and a second run does not double them", async () => {
    const a = await reviewsStep(ctx(), undefined);
    expect(a).toMatchObject({ done: true, rowsIn: 3, sample: { created: 3, updated: 0, mode: "mock" } });
    const b = await reviewsStep(ctx(), a.cursor);
    expect(b).toMatchObject({ rowsIn: 3, sample: { created: 0, updated: 0 } });
    expect(store.reviews.size).toBe(3);
  });
  it("a re-sync refreshes the review text but never touches an approved reply", async () => {
    await reviewsStep(ctx(), undefined);
    const r = [...store.reviews.values()][0]!;
    r.replyStatus = "approved"; r.replyApprovedBy = "u-1"; r.replyDraft = "Thanks";
    mockGbpFor("c-1").seedReviews([{ reviewId: r.externalId!, starRating: "ONE", comment: "Edited by customer", createTime: "2026-11-02T09:00:00Z" }]);
    await reviewsStep(ctx(), undefined);
    expect(store.reviews.get(r.rowKey)).toMatchObject({ rating: 1, text: "Edited by customer", replyStatus: "approved", replyApprovedBy: "u-1", replyDraft: "Thanks" });
  });
  it("is resumable by page token and counts unreadable reviews as rejected", async () => {
    const pages: Record<string, { reviews: RawReview[]; nextPageToken?: string }> = {};
    for (let i = 0; i < 7; i++) pages[i === 0 ? "" : `p${i}`] = { reviews: [REVIEW({ reviewId: `r${i}` }), ...(i === 1 ? [REVIEW({ reviewId: "bad", starRating: "NOPE" })] : [])], nextPageToken: i < 6 ? `p${i + 1}` : undefined };
    const gateway = { kind: "api", listReviews: async (i: { pageToken?: string }) => pages[i.pageToken ?? ""]! } as unknown as GbpGateway;
    const rejects: string[] = [];
    const first = await reviewsStep(ctx({ gateway, reject: (r) => rejects.push(r) }), undefined);
    expect(first).toMatchObject({ done: false, cursor: { page: "p5" }, rowsIn: 5, rowsRejected: 1 });
    expect(rejects).toEqual(["bad_rating"]);
    const second = await reviewsStep(ctx({ gateway }), first.cursor);
    expect(second).toMatchObject({ done: true, cursor: {}, rowsIn: 2 });
    expect(store.reviews.size).toBe(7);
  });
});

describe("performance stream", () => {
  it("backfills 90 days ending two days back, then is current, then re-reads the trailing week next day", async () => {
    const a = await performanceStep(ctx(), undefined);
    expect(a).toMatchObject({ done: true, cursor: { through: "2026-11-07" }, sample: { days: "2026-08-10..2026-11-07", mode: "mock" } });
    expect(store.daily.size).toBe(90);
    expect([...store.daily.values()][0]).toMatchObject({ source: "mock", location: "2000000001" });
    expect(await performanceStep(ctx(), a.cursor)).toMatchObject({ rowsIn: 0, sample: { skipped: "up_to_date" } });
    const next = await performanceStep(ctx({ deps: deps(new Date("2026-11-10T05:00:00Z")) }), a.cursor);
    expect(next).toMatchObject({ cursor: { through: "2026-11-08" }, sample: { days: "2026-11-01..2026-11-08" } });
    expect(store.daily.size).toBe(91);   // replaced days, one new day
  });
  it("stores null for metrics Google did not report and rejects unreadable entries", async () => {
    mockGbpFor("c-1").seedSeries([SERIES("CALL_CLICKS", { 1: "4" }), { dailyMetric: "WEBSITE_CLICKS", timeSeries: { datedValues: [{ date: { year: 2026, month: 2, day: 31 }, value: "1" }] } }]);
    const rejects: string[] = [];
    const r = await performanceStep(ctx({ deps: deps(new Date("2026-11-03T05:00:00Z")), reject: (x) => rejects.push(x) }), { through: "2026-10-31" });
    expect(rejects).toEqual(["unreadable_metric"]);
    expect(r.rowsRejected).toBe(1);
    expect(store.daily.get("w-1|c-1|2026-11-01")).toMatchObject({ callClicks: 4, websiteClicks: null, impressionsMaps: null });
  });
});

// ---------- selection + reply workflow ----------
const vault = new Map<string, string>();
const audits: { action: string; detail?: Record<string, unknown> }[] = [];
const patches: Record<string, unknown>[] = [];
const cursors: string[] = [];
let failAudit = false;
const conns = new Map<string, ConnectionRow>();
const rt = (): RuntimeDeps => ({
  store: { getConnection: async (id: string) => conns.get(id) ?? null, updateConnection: async (_id: string, p: Record<string, unknown>) => { patches.push(p); }, setCursor: async (_c: string, s: string) => { cursors.push(s); } } as unknown as RuntimeDeps["store"],
  vault: { putSecret: async (_n: string, v: string) => { const id = `v-${vault.size + 1}`; vault.set(id, v); return id; }, getSecret: async (id: string) => vault.get(id) ?? null, deleteSecret: async (id: string) => { vault.delete(id); } },
  env: { APP_ENV: "demo" }, log: { info() {}, warn() {}, error() {} },
  audit: async (e) => { if (failAudit) throw new Error("audit down"); audits.push(e); },
});
const actor = { uid: "u-1", tenantId: "t-1", workspaceId: "w-1" };
beforeEach(() => {
  vault.clear(); vault.set("sec-1", JSON.stringify({ refresh_token: "r", ...SECRETS }));
  audits.length = 0; patches.length = 0; cursors.length = 0; failAudit = false;
  conns.clear(); conns.set("c-1", { ...CONN, credentialSecretId: "sec-1" });
});

describe("listing selection (tenant isolation, Vault, audit)", () => {
  it("stores the chosen listing in the Vault bundle, resets both cursors and audits", async () => {
    expect(await selectGbpLocation(rt(), actor, "c-1", { account: "accounts/1000000001", location: "locations/2000000001" })).toEqual({ ok: true, value: { title: "Sample listing" } });
    expect(JSON.parse([...vault.values()].at(-1)!)).toMatchObject({ gbp_account: "1000000001", gbp_location: "2000000001", refresh_token: "r" });
    expect(cursors).toEqual(["reviews", "performance"]);
    expect(audits[0]).toMatchObject({ action: "google_business.listing_selected" });
    expect(patches[0]).toMatchObject({ externalAccountId: "2000000001", externalAccountLabel: "Sample listing" });
  });
  it("refuses a listing the Google user does not manage, bad input and another workspace's connection", async () => {
    expect(await selectGbpLocation(rt(), actor, "c-1", { account: "1000000001", location: "999" })).toEqual({ ok: false, code: "not_available" });
    expect(await selectGbpLocation(rt(), actor, "c-1", { account: "x", location: "y" })).toEqual({ ok: false, code: "invalid_input" });
    expect(await selectGbpLocation(rt(), { ...actor, workspaceId: "w-2" }, "c-1", { account: "1000000001", location: "2000000001" })).toEqual({ ok: false, code: "not_found" });
    expect(await selectGbpLocation(rt(), { ...actor, tenantId: "t-2" }, "c-1", { account: "1000000001", location: "2000000001" })).toEqual({ ok: false, code: "not_found" });
    expect(audits).toHaveLength(0);
  });
  it("lists titles and ids only", async () => {
    const r = await listGbpLocations(rt(), actor, "c-1");
    expect(r).toEqual({ ok: true, value: [{ account: "1000000001", location: "2000000001", title: "Sample listing", address: "1 Sample Street, Sample City" }] });
  });
});

describe("reply workflow: a person must approve before anything is posted", () => {
  const dd = (): ReplyDeps => ({ rt: rt(), store });
  const posted = () => mockGbpFor("c-1").replies;

  it("draft (suggested) -> submit -> approve by a named person -> post sends exactly the approved text", async () => {
    const r = store.seed();
    const draft = await draftReply(dd(), actor, r.id, {});
    expect(draft).toMatchObject({ ok: true, value: { source: "template" } });
    expect(await postApprovedReply(dd(), actor, r.id)).toEqual({ ok: false, code: "invalid_state" });   // a draft cannot be posted
    expect(await submitForApproval(dd(), actor, r.id)).toEqual({ ok: true, value: true });
    expect(await postApprovedReply(dd(), actor, r.id)).toEqual({ ok: false, code: "invalid_state" });   // nor can an unapproved one
    expect(posted()).toHaveLength(0);
    expect(await decideReply(dd(), actor, r.id, "approve")).toEqual({ ok: true, value: true });
    expect(store.reviews.get(r.rowKey)).toMatchObject({ replyStatus: "approved", replyApprovedBy: "u-1" });
    expect(await postApprovedReply(dd(), actor, r.id)).toEqual({ ok: true, value: true });
    expect(posted()).toEqual([{ reviewId: "ext-1", comment: (draft as { value: { draft: string } }).value.draft }]);
    expect(store.reviews.get(r.rowKey)!.replyStatus).toBe("posted");
    expect(audits.map((a) => a.action)).toEqual(["google_business.reply_approved", "google_business.reply_posting"]);
  });
  it("a human-written reply is labelled human; an AI drafter is labelled ai and still needs approval", async () => {
    const r = store.seed();
    expect(await draftReply(dd(), actor, r.id, { text: " My words " })).toEqual({ ok: true, value: { draft: "My words", source: "human" } });
    const ai = { source: "ai" as const, draft: async () => "Model words" };
    expect(await draftReply({ ...dd(), drafter: ai }, actor, r.id, {})).toMatchObject({ ok: true, value: { draft: "Model words", source: "ai" } });
    expect(store.reviews.get(r.rowKey)).toMatchObject({ replyStatus: "draft", replySource: "ai", replyApprovedBy: null });
    expect(posted()).toHaveLength(0);
  });
  it("editing after approval sends it back to draft: the approval never covers different text", async () => {
    const r = store.seed({ replyStatus: "approved", replyApprovedBy: "u-2", replyDraft: "Approved text", replySource: "human" });
    expect(await draftReply(dd(), actor, r.id, { text: "Sneaky change" })).toMatchObject({ ok: true });
    expect(store.reviews.get(r.rowKey)).toMatchObject({ replyStatus: "draft", replyApprovedBy: null, replyDraft: "Sneaky change" });
    expect(await postApprovedReply(dd(), actor, r.id)).toEqual({ ok: false, code: "invalid_state" });
    expect(posted()).toHaveLength(0);
  });
  it("a row that is approved without a named approver is never posted", async () => {
    const r = store.seed({ replyStatus: "approved", replyApprovedBy: null, replyDraft: "x" });
    expect(await postApprovedReply(dd(), actor, r.id)).toEqual({ ok: false, code: "invalid_state" });
    expect(posted()).toHaveLength(0);
  });
  it("needs a signed-in person; the approver is the actor, not anything the client sends", async () => {
    const r = store.seed({ replyStatus: "pending_approval", replyDraft: "Thanks" });
    expect(await decideReply(dd(), { ...actor, uid: "" }, r.id, "approve")).toEqual({ ok: false, code: "not_signed_in" });
    expect(await decideReply(dd(), { ...actor, uid: "u-9" }, r.id, "approve")).toEqual({ ok: true, value: true });
    expect(store.reviews.get(r.rowKey)!.replyApprovedBy).toBe("u-9");
  });
  it("another workspace or tenant sees the review as missing", async () => {
    const r = store.seed({ replyStatus: "approved", replyApprovedBy: "u-2", replyDraft: "Thanks" });
    for (const a of [{ ...actor, workspaceId: "w-2" }, { ...actor, tenantId: "t-2" }]) {
      expect(await postApprovedReply(dd(), a, r.id)).toEqual({ ok: false, code: "not_found" });
      expect(await draftReply(dd(), a, r.id, {})).toEqual({ ok: false, code: "not_found" });
    }
    expect(posted()).toHaveLength(0);
  });
  it("audit or nothing: a failed audit stops the approval and the post", async () => {
    const r = store.seed({ replyStatus: "pending_approval", replyDraft: "Thanks" });
    failAudit = true;
    expect(await decideReply(dd(), actor, r.id, "approve")).toEqual({ ok: false, code: "audit_failed" });
    expect(store.reviews.get(r.rowKey)!.replyStatus).toBe("pending_approval");
    const p = store.seed({ replyStatus: "approved", replyApprovedBy: "u-2", replyDraft: "Thanks", externalId: "ext-2" });
    expect(await postApprovedReply(dd(), actor, p.id)).toEqual({ ok: false, code: "audit_failed" });
    expect(posted()).toHaveLength(0);
  });
  it("two clicks cannot both approve (compare-and-set)", async () => {
    const r = store.seed({ replyStatus: "pending_approval", replyDraft: "Thanks" });
    const [a, b] = await Promise.all([decideReply(dd(), actor, r.id, "approve"), decideReply(dd(), { ...actor, uid: "u-3" }, r.id, "approve")]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
  it("send back returns a pending reply to draft", async () => {
    const r = store.seed({ replyStatus: "pending_approval", replyDraft: "Thanks" });
    expect(await decideReply(dd(), actor, r.id, "reject")).toEqual({ ok: true, value: true });
    expect(store.reviews.get(r.rowKey)!.replyStatus).toBe("draft");
    expect(await decideReply(dd(), actor, r.id, "reject")).toEqual({ ok: false, code: "invalid_state" });
  });
  it("a Google refusal marks the reply failed (never silent) and a retry needs a fresh approval; a transient error stays approved", async () => {
    const r = store.seed({ replyStatus: "approved", replyApprovedBy: "u-2", replyDraft: "Thanks" });
    // the Showcase gateway never fails, so drive the real client with a live-looking bundle
    vault.set("sec-1", JSON.stringify({ ...SECRETS, access_token: "live-token" }));
    const live: ReplyDeps = { ...dd(), rt: { ...rt(), env: {} }, sleep: async () => {}, fetchImpl: (async () => json({ error: { status: "PERMISSION_DENIED" } }, 403)) as unknown as typeof fetch };
    expect(await postApprovedReply(live, actor, r.id)).toEqual({ ok: false, code: "token_rejected" });
    expect(store.reviews.get(r.rowKey)!.replyStatus).toBe("failed");
    expect(await postApprovedReply(live, actor, r.id)).toEqual({ ok: false, code: "invalid_state" });
    expect(await decideReply(dd(), actor, r.id, "approve")).toEqual({ ok: true, value: true });
    const transient: ReplyDeps = { ...live, fetchImpl: (async () => json({}, 503)) as unknown as typeof fetch };
    expect(await postApprovedReply(transient, actor, r.id)).toEqual({ ok: false, code: "post_failed" });
    expect(store.reviews.get(r.rowKey)!.replyStatus).toBe("approved");
  });
});

describe("registration and hard rules", () => {
  it("registers google-business: OAuth on the shared Google client, gated on vendor approval, Showcase supported, no automated push", () => {
    expect(ALL_CONNECTORS.map((c) => c.id)).toContain("google-business");
    const def = getConnector("google-business")!;
    expect(def.gate).toBe("needs_vendor_approval");
    expect(def.auth).toBe("oauth2");
    expect(def.oauth).toMatchObject({ scopes: ["https://www.googleapis.com/auth/business.manage"], clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID", clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET", pkce: true, extraAuthParams: { access_type: "offline", prompt: "consent" } });
    expect(def.sandbox.supported).toBe(true);
    expect(def.pushes).toEqual([]);
    expect(def.streams.map((s) => s.key)).toEqual(["reviews", "performance"]);
    expect(envConfigured(def, { GOOGLE_OAUTH_CLIENT_ID: "x", GOOGLE_OAUTH_CLIENT_SECRET: "y" })).toBe(true);
  });
  it("lists the env names in .env.example without values", () => {
    const env = readFileSync(join(__dirname, "../../../../../../.env.example"), "utf8");
    for (const n of ["GBP_ACCOUNTS_API_BASE", "GBP_INFO_API_BASE", "GBP_PERFORMANCE_API_BASE", "GBP_REVIEWS_API_BASE"]) expect(env, n).toMatch(new RegExp(`^${n}=\\s*$`, "m"));
  });
});
