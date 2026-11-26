// AUD-036: token expiry is recorded and warned about, a failed webhook subscription is visible and retryable, the Graph version is configurable.
import { beforeEach, describe, expect, it } from "vitest";
import { ACTOR, makeDeps } from "../../core/__tests__/fakes";
import { CredentialError, type ConnectionRow } from "../../core/types";
import { retryWebhookSubscription, selectMetaAssets } from "../assets";
import { apiVersionOf, gatewayFor, resetMockGateways, mockFor } from "../config";
import { graphVersionOf, oauthDialogUrl, oauthTokenUrl } from "../constants";
import { daysLeft, effectiveExpiry, expiringSoon, healthFromDebug, readMetaHealth } from "../health";
import { healthStep } from "../insights";
import { META_MOCK_TOKEN, type MockGateway } from "../mock";
import { FakeStore } from "./fake-store";

const NOW = new Date("2026-11-10T00:00:00Z");
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("graph version", () => {
  it("honours META_GRAPH_API_VERSION in the OAuth dialog, the token URL and the API calls, with a safe default", () => {
    expect(oauthDialogUrl("v23.0")).toBe("https://www.facebook.com/v23.0/dialog/oauth");
    expect(oauthTokenUrl("v23.0")).toBe("https://graph.facebook.com/v23.0/oauth/access_token");
    expect(apiVersionOf({ META_GRAPH_API_VERSION: "v22.0" })).toBe("v22.0");
    expect(graphVersionOf(undefined)).toBe("v21.0");
    expect(graphVersionOf("latest/../x")).toBe("v21.0");   // anything that is not vNN.N cannot reach a URL
    expect(oauthDialogUrl("")).toContain("/v21.0/");
  });
});

describe("expiry maths", () => {
  const dbg = (o: Partial<{ expiresAt: number; dataAccessExpiresAt: number }>) => ({ valid: true, expiresAt: 0, dataAccessExpiresAt: 0, scopes: ["ads_read"], ...o });
  it("expires_at 0 = never expires; data access date is kept separately; the earlier one counts", () => {
    const h = healthFromDebug(dbg({ dataAccessExpiresAt: sec("2026-11-14T00:00:00Z") }), NOW);
    expect(h.tokenNeverExpires).toBe(true);
    expect(h.tokenExpiresAt).toBeNull();
    expect(h.dataAccessExpiresAt).toBe("2026-11-14T00:00:00.000Z");
    expect(effectiveExpiry({ tokenExpiresAt: "2026-12-30T00:00:00.000Z", dataAccessExpiresAt: h.dataAccessExpiresAt })).toBe(h.dataAccessExpiresAt);
    expect(daysLeft(h.dataAccessExpiresAt, NOW)).toBe(4);
    expect(expiringSoon(h, NOW)).toBe(true);
    expect(expiringSoon({ tokenExpiresAt: null, dataAccessExpiresAt: null }, NOW)).toBe(false);
  });
  it("reads back what it stored", () => {
    const h = healthFromDebug(dbg({ expiresAt: sec("2027-01-01T00:00:00Z") }), NOW, { subscribed: false, error: "missing_permission", at: NOW.toISOString() });
    expect(readMetaHealth({ meta: JSON.parse(JSON.stringify(h)) })).toMatchObject({ tokenExpiresAt: "2027-01-01T00:00:00.000Z", webhook: { subscribed: false, error: "missing_permission" } });
    expect(readMetaHealth({})).toBeNull();
  });
});

describe("healthStep records expiry and warns", () => {
  const ctx = (g: unknown, store = new FakeStore()) => ({ store, c: { deps: { store, core: store, log: { info() {}, warn() {}, error() {} }, now: () => NOW, rate: async () => true } as never, conn: { id: "c1" } as ConnectionRow, secrets: {}, gateway: g as MockGateway, reject: () => undefined } });
  it("writes token_expires_at and health, and a connection about to lapse is partial with a reconnect reason", async () => {
    const { store, c } = ctx({ kind: "graph", debugToken: async () => ({ valid: true, expiresAt: sec("2026-11-13T00:00:00Z"), dataAccessExpiresAt: 0, scopes: ["ads_read"] }) });
    const r = await healthStep(c, undefined);
    expect(store.healthRecords[0]).toMatchObject({ connectionId: "c1", tokenExpiresAt: "2026-11-13T00:00:00.000Z" });
    expect(r.status).toBe("partial");
    expect(r.reason).toBe("token_expiring_reconnect");
  });
  it("a healthy long-lived token is recorded and not flagged", async () => {
    const { store, c } = ctx({ kind: "graph", debugToken: async () => ({ valid: true, expiresAt: sec("2027-02-01T00:00:00Z"), dataAccessExpiresAt: sec("2027-02-01T00:00:00Z"), scopes: [] }) });
    const r = await healthStep(c, undefined);
    expect(r.status).toBeUndefined();
    expect(store.healthRecords[0]!.health).toMatchObject({ tokenNeverExpires: false });
  });
});

describe("webhook subscription visibility", () => {
  let h: ReturnType<typeof makeDeps>, meta: FakeStore, conn: ConnectionRow;
  beforeEach(async () => {
    resetMockGateways();
    h = makeDeps({ env: { META_APP_SECRET: "s" } }); meta = new FakeStore();
    const id = await h.vault.putSecret("c", JSON.stringify({ access_token: META_MOCK_TOKEN }));
    const c = await h.store.insertConnection({ tenantId: "t-1", workspaceId: "w-1", connectorId: "meta-ads", label: "Meta", category: "ads", direction: "both", mode: "sandbox", status: "sandbox", connectedBy: "u" });
    conn = { ...c, credentialSecretId: id, status: "sandbox" }; h.store.conns.set(c.id, conn);
  });
  it("a failed subscribePage no longer disappears: the outcome is returned and stored in health", async () => {
    mockFor(conn.id).subscribePage = async () => { throw new CredentialError("pages_manage_metadata missing"); };
    const r = await selectMetaAssets(h.deps, meta, ACTOR, conn.id, { pageId: "sample-page-1" });
    expect(r.ok && r.value.webhookSubscribed).toBe(false);
    expect(meta.healthRecords.at(-1)!.health).toMatchObject({ webhook: { subscribed: false, error: "missing_permission" } });
  });
  it("a successful one is recorded as subscribed, and retry flips a failed state", async () => {
    const gw = mockFor(conn.id);
    gw.subscribePage = async () => { throw new CredentialError("x"); };
    await selectMetaAssets(h.deps, meta, ACTOR, conn.id, { pageId: "sample-page-1" });
    gw.subscribePage = async () => undefined;
    const r = await retryWebhookSubscription(h.deps, meta, ACTOR, conn.id);
    expect(r).toEqual({ ok: true, value: { subscribed: true } });
    expect(meta.healthRecords.at(-1)!.health).toMatchObject({ webhook: { subscribed: true, error: null } });
    expect(h.audits.map((a) => a.action)).toContain("meta.webhook_retry");
  });
  it("retry is tenant-isolated", async () => {
    expect(await retryWebhookSubscription(h.deps, meta, { ...ACTOR, workspaceId: "w-other" }, conn.id)).toEqual({ ok: false, code: "not_found" });
    void gatewayFor;
  });
});
