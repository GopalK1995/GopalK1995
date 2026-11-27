// AUD-100: more than one Page / Instagram account per workspace. Append instead of overwrite, per-Page failures, one-Page removal,
// legacy single-page bundles, webhook ownership of every Page. Sandbox gateway with seeded Pages, no network.
import { beforeEach, describe, expect, it } from "vitest";
import { ACTOR, makeDeps } from "../../core/__tests__/fakes";
import type { ConnectionRow } from "../../core/types";
import { connectMetaPages, listMetaAssets, removeMetaPage, retryWebhookSubscription, selectMetaAssets } from "../assets";
import { mockFor, resetMockGateways } from "../config";
import { handleIgMessage } from "../inbound";
import { handleLeadgen } from "../leads";
import { META_MOCK_TOKEN } from "../mock";
import { ownsIgId, ownsPageId, pagesOf, secretsForInstagram, secretsForPage, withPages } from "../pages";
import { FakeStore } from "./fake-store";

const PAGES = [
  { id: "pg-1", name: "Krishna", pageToken: "tok-1", igUserId: "ig-1", igUsername: "kriszseeker" },
  { id: "pg-2", name: "Studio Two", pageToken: "tok-2", igUserId: "ig-2", igUsername: "studio.two" },
  { id: "pg-3", name: "Cafe Three", pageToken: "tok-3" },
];
let h: ReturnType<typeof makeDeps>, meta: FakeStore, conn: ConnectionRow;
const bundleOf = () => JSON.parse(h.vault.secrets.get(h.store.conns.get(conn.id)!.credentialSecretId!)!) as Record<string, string>;
const put = async (secrets: Record<string, string>, ws = "w-1") => {
  const id = await h.vault.putSecret("c", JSON.stringify(secrets));
  const c = await h.store.insertConnection({ tenantId: "t-1", workspaceId: ws, connectorId: "meta-ads", label: "Meta", category: "ads", direction: "both", mode: "sandbox", status: "sandbox", connectedBy: "u" });
  const full = { ...c, credentialSecretId: id, status: "sandbox" as const };
  h.store.conns.set(c.id, full);
  return full;
};
beforeEach(async () => {
  resetMockGateways(); h = makeDeps({ env: { META_APP_SECRET: "app-secret" } }); meta = new FakeStore();
  conn = await put({ access_token: META_MOCK_TOKEN });
  mockFor(conn.id).seedPages(PAGES);
});

describe("pages bundle", () => {
  it("a bundle saved before this change reads as one page; the single-page keys mirror the first page", () => {
    const legacy = { access_token: "u", page_id: "pg-1", page_token: "tok-1", ig_user_id: "ig-1" };
    expect(pagesOf(legacy)).toEqual([{ id: "pg-1", token: "tok-1", igUserId: "ig-1" }]);
    const two = withPages(legacy, [...pagesOf(legacy), { id: "pg-2", token: "tok-2", igUserId: "ig-2", name: "B" }]);
    expect(two).toMatchObject({ page_id: "pg-1", page_token: "tok-1", ig_user_id: "ig-1", access_token: "u" });
    expect(pagesOf(two).map((p) => p.id)).toEqual(["pg-1", "pg-2"]);
    expect(secretsForPage(two, "pg-2")).toMatchObject({ page_id: "pg-2", page_token: "tok-2", ig_user_id: "ig-2" });
    expect(secretsForPage(two, "nope")).toBeNull();
    expect(secretsForInstagram(two, "ig-2")).toMatchObject({ page_id: "pg-2" });
    expect(ownsPageId(two, "pg-2") && ownsIgId(two, "ig-2") && !ownsPageId(two, "pg-9") && !ownsIgId(two, "ig-9")).toBe(true);
  });
  it("removing every page clears the single-page keys; a corrupt list falls back to them", () => {
    expect(withPages({ access_token: "u", page_id: "pg-1", page_token: "t" }, [])).toEqual({ access_token: "u" });
    expect(pagesOf({ pages_json: "{not json", page_id: "pg-1", page_token: "t" }).map((p) => p.id)).toEqual(["pg-1"]);
  });
});

describe("connectMetaPages (append, per-page results)", () => {
  it("adds several Pages at once, each as its own meta_assets registration with its own token in the bundle", async () => {
    const r = await connectMetaPages(h.deps, meta, ACTOR, conn.id, { pageIds: ["pg-1", "pg-2", "pg-3"] });
    expect(r.ok && r.value.results.every((x) => x.ok)).toBe(true);
    expect(meta.assets.map((a) => a.pageId).sort()).toEqual(["pg-1", "pg-2", "pg-3"]);
    expect(meta.assets.find((a) => a.pageId === "pg-2")).toMatchObject({ igUserId: "ig-2", igUsername: "studio.two", append: true });
    const b = bundleOf();
    expect(b).toMatchObject({ page_id: "pg-1", page_token: "tok-1", ig_user_id: "ig-1" });
    expect(pagesOf(b).map((p) => [p.id, p.token, p.igUserId])).toEqual([["pg-1", "tok-1", "ig-1"], ["pg-2", "tok-2", "ig-2"], ["pg-3", "tok-3", undefined]]);
    expect(h.audits.map((a) => a.action)).toEqual(["meta.assets_selected"]);
    expect(JSON.stringify(h.audits)).not.toMatch(/tok-[123]/);
  });
  it("a later selection appends: the first Page stays primary, nothing is released", async () => {
    await selectMetaAssets(h.deps, meta, ACTOR, conn.id, { pageId: "pg-1" });
    const before = bundleOf();
    const r = await connectMetaPages(h.deps, meta, ACTOR, conn.id, { pageIds: ["pg-2"] });
    expect(r.ok && r.value.pages.map((p) => p.id)).toEqual(["pg-1", "pg-2"]);
    expect(meta.assets.map((a) => a.pageId).sort()).toEqual(["pg-1", "pg-2"]);
    expect(bundleOf()).toMatchObject({ page_id: "pg-1", page_token: before.page_token, ig_user_id: "ig-1" });
    expect(h.store.conns.get(conn.id)!.credentialSecretId).toBeTruthy();
    expect(meta.released).toEqual([]);
  });
  it("a Page that fails is reported on its own and the others still connect", async () => {
    meta.assets.push({ tenantId: "t-9", workspaceId: "w-9", connectionId: "other", pageId: "pg-2" });
    const r = await connectMetaPages(h.deps, meta, ACTOR, conn.id, { pageIds: ["pg-1", "pg-2", "ghost", "pg-3"] });
    expect(r.ok && r.value.results.map((x) => [x.pageId, x.ok ? "ok" : x.code])).toEqual([["pg-1", "ok"], ["pg-2", "page_taken"], ["ghost", "page_not_managed"], ["pg-3", "ok"]]);
    expect(pagesOf(bundleOf()).map((p) => p.id)).toEqual(["pg-1", "pg-3"]);
    expect(meta.assets.filter((a) => a.workspaceId === "w-1").map((a) => a.pageId).sort()).toEqual(["pg-1", "pg-3"]);
  });
  it("an Instagram account taken by another workspace refuses only that Page", async () => {
    meta.assets.push({ tenantId: "t-9", workspaceId: "w-9", connectionId: "other", pageId: "elsewhere", igUserId: "ig-2" });
    const r = await connectMetaPages(h.deps, meta, ACTOR, conn.id, { pageIds: ["pg-2", "pg-3"] });
    expect(r.ok && r.value.results.map((x) => (x.ok ? "ok" : x.code))).toEqual(["ig_taken", "ok"]);
  });
  it("when no Page could be added the call fails with that Page's code and stores nothing", async () => {
    const before = h.store.conns.get(conn.id)!.credentialSecretId;
    expect(await connectMetaPages(h.deps, meta, ACTOR, conn.id, { pageIds: ["ghost"] })).toEqual({ ok: false, code: "page_not_managed" });
    expect(await connectMetaPages(h.deps, meta, ACTOR, conn.id, { pageIds: [] })).toEqual({ ok: false, code: "page_not_managed" });
    expect(h.store.conns.get(conn.id)!.credentialSecretId).toBe(before);
    expect(h.audits).toHaveLength(0);
  });
  it("keeps the ad account already linked when a later selection names none", async () => {
    await connectMetaPages(h.deps, meta, ACTOR, conn.id, { pageIds: ["pg-1"], adAccountId: "sample-act-1" });
    await connectMetaPages(h.deps, meta, ACTOR, conn.id, { pageIds: ["pg-2"] });
    expect(bundleOf().ad_account_id).toBe("sample-act-1");
  });
  it("records the webhook state per Page; the connection is subscribed only when every Page is", async () => {
    const g = mockFor(conn.id);
    g.subscribePage = async (id: string) => { if (id === "pg-3") throw new Error("nope"); };
    await connectMetaPages(h.deps, meta, ACTOR, conn.id, { pageIds: ["pg-1", "pg-3"] });
    const w = (meta.healthRecords.at(-1)!.health as { webhook: { subscribed: boolean; error: string | null; pages: { id: string; subscribed: boolean }[] } }).webhook;
    expect(w.subscribed).toBe(false);
    expect(w.error).toBe("meta_unreachable");
    expect(w.pages.map((p) => [p.id, p.subscribed])).toEqual([["pg-1", true], ["pg-3", false]]);
    g.subscribePage = async () => undefined;
    expect(await retryWebhookSubscription(h.deps, meta, ACTOR, conn.id)).toEqual({ ok: true, value: { subscribed: true } });
  });
  it("lists which Pages are already connected and never returns a token", async () => {
    await connectMetaPages(h.deps, meta, ACTOR, conn.id, { pageIds: ["pg-2"] });
    const l = await listMetaAssets(h.deps, ACTOR, conn.id);
    expect(l.ok && l.value.connected).toEqual(["pg-2"]);
    expect(JSON.stringify(l)).not.toContain("tok-");
  });
  it("a connection saved by the single-page flow keeps working: adding a Page keeps its first Page and webhook state", async () => {
    const legacy = await put({ access_token: META_MOCK_TOKEN, page_id: "pg-1", page_token: "tok-1", ig_user_id: "ig-1" });
    mockFor(legacy.id).seedPages(PAGES);
    meta.healthRecords.push({ connectionId: legacy.id, health: { webhook: { subscribed: true, error: null, at: "x" }, checkedAt: "x" } });
    const r = await connectMetaPages(h.deps, meta, ACTOR, legacy.id, { pageIds: ["pg-2"] });
    expect(r.ok && r.value.pages.map((p) => p.id)).toEqual(["pg-1", "pg-2"]);
    const w = (meta.healthRecords.at(-1)!.health as { webhook: { subscribed: boolean; pages: { id: string; subscribed: boolean }[] } }).webhook;
    expect(w.pages.map((p) => [p.id, p.subscribed])).toEqual([["pg-1", true], ["pg-2", true]]);
    expect(w.subscribed).toBe(true);
  });
});

describe("removeMetaPage", () => {
  beforeEach(async () => { await connectMetaPages(h.deps, meta, ACTOR, conn.id, { pageIds: ["pg-1", "pg-2", "pg-3"] }); h.audits.length = 0; });
  it("removes one Page without touching the others", async () => {
    const r = await removeMetaPage(h.deps, meta, ACTOR, conn.id, "pg-2");
    expect(r).toEqual({ ok: true, value: { remaining: 2 } });
    expect(pagesOf(bundleOf()).map((p) => p.id)).toEqual(["pg-1", "pg-3"]);
    expect(meta.released).toEqual([{ connectionId: conn.id, pageId: "pg-2", igUserId: "ig-2" }]);
    expect(meta.assets.map((a) => a.pageId).sort()).toEqual(["pg-1", "pg-3"]);
    expect(h.audits.map((a) => a.action)).toEqual(["meta.page_removed"]);
    expect(h.store.conns.get(conn.id)!.status).toBe("sandbox");
  });
  it("removing the primary promotes the next Page into the single-page keys and the connection label", async () => {
    const patches: Record<string, unknown>[] = [], orig = h.store.updateConnection.bind(h.store);
    h.store.updateConnection = async (id: string, p: Record<string, unknown>) => { patches.push(p); return orig(id, p as never); };
    await removeMetaPage(h.deps, meta, ACTOR, conn.id, "pg-1");
    expect(bundleOf()).toMatchObject({ page_id: "pg-2", page_token: "tok-2", ig_user_id: "ig-2" });
    expect(patches[0]).toMatchObject({ externalAccountId: "pg-2", externalAccountLabel: "Studio Two" });
  });
  it("removing the last Page leaves the connection connected with no Page selected; unknown pages and other workspaces are refused", async () => {
    await removeMetaPage(h.deps, meta, ACTOR, conn.id, "pg-1"); await removeMetaPage(h.deps, meta, ACTOR, conn.id, "pg-2");
    expect(await removeMetaPage(h.deps, meta, ACTOR, conn.id, "pg-3")).toEqual({ ok: true, value: { remaining: 0 } });
    expect(bundleOf()).not.toHaveProperty("page_id");
    expect(bundleOf().access_token).toBeTruthy();
    expect(await removeMetaPage(h.deps, meta, ACTOR, conn.id, "pg-3")).toEqual({ ok: false, code: "not_found" });
    const other = await put({ access_token: META_MOCK_TOKEN }, "w-2");
    expect(await removeMetaPage(h.deps, meta, ACTOR, other.id, "pg-1")).toEqual({ ok: false, code: "not_found" });
  });
});

describe("webhook events for every connected Page", () => {
  const ctxFor = (secrets: Record<string, string>, rejected: string[] = []) => ({
    deps: { store: meta, core: meta, log: { info() {}, warn() {}, error() {} }, now: () => new Date("2026-11-20T00:00:00Z"), rate: async () => true },
    conn: h.store.conns.get(conn.id)!, secrets, gateway: mockFor(conn.id), reject: (r: string) => rejected.push(r),
  });
  it("a leadgen event for the second Page is accepted; an unknown Page is rejected", async () => {
    await connectMetaPages(h.deps, meta, ACTOR, conn.id, { pageIds: ["pg-1", "pg-2"] });
    const rejected: string[] = [];
    const c = ctxFor(bundleOf(), rejected);
    expect(await handleLeadgen(c as never, { kind: "leadgen", pageId: "pg-2", leadgenId: "L1", at: "2026-11-20T00:00:00Z" })).toBe("created");
    expect(await handleLeadgen(c as never, { kind: "leadgen", pageId: "pg-9", leadgenId: "L2", at: "2026-11-20T00:00:00Z" })).toBe("rejected");
    expect(rejected).toContain("page_mismatch");
  });
  it("an Instagram message for the second account is accepted; one for an unknown account is rejected", async () => {
    await connectMetaPages(h.deps, meta, ACTOR, conn.id, { pageIds: ["pg-1", "pg-2"] });
    const c = ctxFor(bundleOf());
    const evt = (ig: string, mid: string) => ({ kind: "ig_message" as const, igUserId: ig, senderId: "s1", mid, at: "2026-11-20T00:00:00Z", text: "hi", attachments: [] });
    expect(await handleIgMessage(c as never, evt("ig-2", "m1"))).toBe("stored");
    expect(await handleIgMessage(c as never, evt("ig-9", "m2"))).toBe("rejected");
  });
});
