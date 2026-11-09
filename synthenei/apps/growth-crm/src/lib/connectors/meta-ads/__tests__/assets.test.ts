// Page / Instagram / ad account selection: tenant isolation, ownership, secrets, audit (sandbox gateway, no network).
import { beforeEach, describe, expect, it } from "vitest";
import { ACTOR, makeDeps } from "../../core/__tests__/fakes";
import type { ConnectionRow } from "../../core/types";
import { listMetaAssets, selectMetaAssets } from "../assets";
import { resetMockGateways } from "../config";
import { META_MOCK_TOKEN } from "../mock";
import { FakeStore } from "./fake-store";

let h: ReturnType<typeof makeDeps>, meta: FakeStore, conn: ConnectionRow;
const put = async (over: Partial<ConnectionRow> = {}, ws = "w-1") => {
  const id = await h.vault.putSecret("c", JSON.stringify({ access_token: META_MOCK_TOKEN }));
  const c = await h.store.insertConnection({ tenantId: "t-1", workspaceId: ws, connectorId: "meta-ads", label: "Meta", category: "ads", direction: "both", mode: "sandbox", status: "sandbox", connectedBy: "u" });
  const full = { ...c, credentialSecretId: id, status: "sandbox" as const, ...over };
  h.store.conns.set(c.id, full);
  return full;
};
beforeEach(async () => { resetMockGateways(); h = makeDeps({ env: { META_APP_SECRET: "app-secret" } }); meta = new FakeStore(); conn = await put(); });

describe("selectMetaAssets", () => {
  it("stores tokens and ids in the vault, the signing secret as webhook secret, registers ownership and audits", async () => {
    const r = await selectMetaAssets(h.deps, meta, ACTOR, conn.id, { pageId: "sample-page-1", adAccountId: "sample-act-1" });
    expect(r.ok).toBe(true);
    const c = h.store.conns.get(conn.id)!;
    const bundle = JSON.parse(h.vault.secrets.get(c.credentialSecretId!)!);
    expect(bundle).toMatchObject({ page_id: "sample-page-1", ig_user_id: "sample-ig-1", ad_account_id: "sample-act-1", page_token: "sample-page-token" });
    expect(JSON.parse(h.vault.secrets.get(c.webhookSecretId!)!)).toMatchObject({ app_secret: "app-secret" });
    expect(meta.assets).toHaveLength(1);
    expect(h.audits.map((a) => a.action)).toEqual(["meta.assets_selected"]);
    expect(JSON.stringify(h.audits)).not.toContain("sample-page-token");
  });
  it("re-selecting keeps the verify token", async () => {
    const a = await selectMetaAssets(h.deps, meta, ACTOR, conn.id, { pageId: "sample-page-1" });
    const b = await selectMetaAssets(h.deps, meta, ACTOR, conn.id, { pageId: "sample-page-1" });
    expect(a.ok && b.ok && a.value.verifyToken === b.value.verifyToken).toBe(true);
  });
  it("refuses a page the user does not manage and an unavailable ad account", async () => {
    expect(await selectMetaAssets(h.deps, meta, ACTOR, conn.id, { pageId: "not-mine" })).toEqual({ ok: false, code: "page_not_managed" });
    expect(await selectMetaAssets(h.deps, meta, ACTOR, conn.id, { pageId: "sample-page-1", adAccountId: "nope" })).toEqual({ ok: false, code: "ad_account_not_available" });
    expect(meta.assets).toHaveLength(0);
  });
  it("a page already owned by another workspace is refused (page -> workspace is unique)", async () => {
    meta.assets.push({ tenantId: "t-9", workspaceId: "w-9", connectionId: "other", pageId: "sample-page-1" });
    expect(await selectMetaAssets(h.deps, meta, ACTOR, conn.id, { pageId: "sample-page-1" })).toEqual({ ok: false, code: "page_taken" });
    expect(h.audits).toHaveLength(0);
  });
  it("another workspace's connection looks like a missing one; no app secret = not configured", async () => {
    const other = await put({}, "w-2");
    expect(await selectMetaAssets(h.deps, meta, ACTOR, other.id, { pageId: "sample-page-1" })).toEqual({ ok: false, code: "not_found" });
    expect(await listMetaAssets(h.deps, ACTOR, other.id)).toEqual({ ok: false, code: "not_found" });
    expect(await selectMetaAssets({ ...h.deps, env: {} }, meta, ACTOR, conn.id, { pageId: "sample-page-1" })).toEqual({ ok: false, code: "not_configured" });
  });
  it("listing never returns page tokens", async () => {
    const r = await listMetaAssets(h.deps, ACTOR, conn.id);
    expect(JSON.stringify(r)).not.toContain("sample-page-token");
    expect(r.ok && r.value.pages[0].id).toBe("sample-page-1");
  });
});
