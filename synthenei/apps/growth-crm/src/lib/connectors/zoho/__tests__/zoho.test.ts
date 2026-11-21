// Zoho CRM connector: OAuth/region, gateway requests and parsing (fixtures), token refresh and expiry, webhook parsing and isolation,
// watch renewal, setup, and the framework runner end to end (token expiry -> needs_attention, vendor 401, a successful import).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl } from "../../core/oauth";
import { refreshIfNeeded } from "../../core/lifecycle";
import { loadSecrets } from "../../core/secrets";
import { runSync } from "../../core/sync";
import { FakeVault, makeDeps, silentLog } from "../../core/__tests__/fakes";
import { registerConnector, resetRegistry } from "../../registry";
import { CredentialError, TransientError, type ConnectionRow, type HttpRequest, type SyncContext, type VendorHttp } from "../../core/types";
import { makeZohoGateway, selectFields, splitName, toPayload, toZohoTs } from "../api";
import { accountsUrlOf, apiBaseOf, regionOf } from "../config";
import { REGIONS } from "../constants";
import { setZohoRuntimeFactory, healthStep, zohoConnector, type ZohoRuntime } from "../connector";
import { ZOHO_DEFAULT_MAP } from "../defaults";
import { RecordRejected } from "../engine/types";
import { saveSyncOptions } from "../engine/options";
import { finishZohoSetup } from "../setup";
import { refreshZohoToken } from "../token";
import { channelIdFor, parseZohoWebhook, type ZohoEvent } from "../webhook";
import * as F from "../__fixtures__/payloads";
import { FakeCrmStore } from "./fakes";

const scripted = (handler: (req: HttpRequest) => unknown) => {
  const calls: HttpRequest[] = [];
  const http: VendorHttp = { async json<T>(req: HttpRequest): Promise<T> { calls.push(req); const r = handler(req); if (r instanceof Error) throw r; return r as T; } };
  return { calls, http };
};
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); setZohoRuntimeFactory(null); });

describe("OAuth and region", () => {
  it("authorises against the India data centre by default, offline access, one comma separated scope string", () => {
    const o = zohoConnector.oauth!;
    expect(o.authorizeUrl).toBe("https://accounts.zoho.in/oauth/v2/auth");
    expect(o.tokenUrl).toBe("https://accounts.zoho.in/oauth/v2/token");
    const u = new URL(buildAuthorizeUrl(o, { clientId: "cid", redirectUri: "https://app.example.test/api/oauth/zoho-crm/callback", state: "s" }));
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("scope")).toContain("ZohoCRM.modules.ALL,ZohoCRM.coql.READ");
    expect(zohoConnector.gate).toBe("needs_client_credentials");
    expect(zohoConnector.requiredEnv).toEqual(["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"]);
  });
  it("the region is a per-connection setting; the env override (stubs) wins over any region", () => {
    expect(regionOf({}, {})).toBe("in");
    expect(accountsUrlOf({}, {})).toBe("https://accounts.zoho.in");
    expect(apiBaseOf({ region: "eu" }, {})).toBe(REGIONS.eu.api);
    expect(accountsUrlOf({ region: "us" }, {})).toBe("https://accounts.zoho.com");
    expect(regionOf({ region: "bogus" }, { ZOHO_DEFAULT_REGION: "au" })).toBe("au");
    expect(apiBaseOf({ region: "eu" }, { ZOHO_API_BASE: "http://localhost:4010/" })).toBe("http://localhost:4010");
    expect(accountsUrlOf({ region: "eu" }, { ZOHO_ACCOUNTS_URL: "http://localhost:4011" })).toBe("http://localhost:4011");
  });
});

describe("gateway", () => {
  const gw = (handler: (r: HttpRequest) => unknown) => { const s = scripted(handler); return { ...s, g: makeZohoGateway({ http: s.http, apiBase: "https://www.zohoapis.in", token: "tok" }) }; };

  it("reads with COQL ordered by Modified_Time, starting from the beginning or from import_since, and expands synthetic and lookup fields", async () => {
    const { g, calls } = gw(() => F.COQL_LEADS);
    const page = await g.list("lead", null, ["Full_Name", "Email", "Account_Name.id"], null);
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://www.zohoapis.in/crm/v6/coql", headers: { authorization: "Zoho-oauthtoken tok" } });
    const q = (calls[0].body as { select_query: string }).select_query;
    expect(q).toBe("select id, Modified_Time, First_Name, Last_Name, Email, Account_Name from Leads where Modified_Time >= '2000-01-01T00:00:00+00:00' order by Modified_Time asc limit 0, 200");
    expect(page.records.map((r) => [r.id, r.fields.Full_Name])).toEqual([["1000000000001", "Asha Rao"], ["1000000000002", "Iyer"]]);
    expect(page.done).toBe(true);
    expect(page.cursor).toEqual({ since: "2026-11-02T10:05:00+05:30", offset: 0 });
    await g.list("lead", null, ["Email"], "2026-06-01T00:00:00.000Z");
    expect((calls[1].body as { select_query: string }).select_query).toContain("Modified_Time >= '2026-06-01T00:00:00+00:00'");
  });
  it("pages with offsets, and restarts the window from the last Modified_Time before COQL's offset cap", async () => {
    const more = { ...F.COQL_LEADS, info: { more_records: true } };
    const a = gw(() => more);
    const p1 = await a.g.list("lead", { since: "2026-11-01T00:00:00+05:30", offset: 0 }, ["Email"], null);
    expect(p1).toMatchObject({ done: false, cursor: { since: "2026-11-01T00:00:00+05:30", offset: 200 } });
    const p2 = await a.g.list("lead", { since: "2026-11-01T00:00:00+05:30", offset: 1800 }, ["Email"], null);
    expect(p2).toMatchObject({ done: false, cursor: { since: "2026-11-02T10:05:00+05:30", offset: 0 } });
    expect((a.calls[1].body as { select_query: string }).select_query).toContain("limit 1800, 200");
  });
  it("an empty result (HTTP 204) is an empty, finished page that keeps the cursor", async () => {
    const { g } = gw(() => undefined);
    expect(await g.list("lead", { since: "2026-11-01T00:00:00+05:30", offset: 0 }, ["Email"], null)).toEqual({ records: [], cursor: { since: "2026-11-01T00:00:00+05:30", offset: 0 }, done: true });
  });
  it("never interpolates an unvalidated timestamp, field name or id into a request", async () => {
    const { g, calls } = gw(() => F.COQL_LEADS);
    await expect(g.list("lead", { since: "x' or id is not null --", offset: 0 }, ["Email"], null)).rejects.toThrow();
    await g.list("lead", null, ["Email", "Bad Field; drop", "Name) from X where (1=1"], null);
    expect((calls[0].body as { select_query: string }).select_query).toBe("select id, Modified_Time, Email from Leads where Modified_Time >= '2000-01-01T00:00:00+00:00' order by Modified_Time asc limit 0, 200");
    await g.getMany("lead", ["1000000000001", "1 or 1=1", "../x"], ["Email"]);
    expect(calls[1].url).toBe("https://www.zohoapis.in/crm/v6/Leads?ids=1000000000001&fields=Modified_Time,Email");
    expect(await g.getMany("lead", ["nope"], ["Email"])).toEqual([]);
  });
  it("reads deals with their lookups as ids", async () => {
    const { g } = gw(() => F.COQL_DEALS);
    const [d] = (await g.list("deal", null, ["Deal_Name", "Account_Name.id", "Contact_Name.id"], null)).records;
    expect(d.fields).toMatchObject({ Account_Name: { id: "3000000000001" }, Contact_Name: { id: "4000000000001" }, Amount: 12000 });
  });
  it("creates and updates; a duplicate carries the existing id; other rejections carry only a code", async () => {
    const ok = gw(() => F.WRITE_OK);
    expect(await ok.g.create("lead", { Full_Name: "Asha Rao", Email: "a@example.com" })).toEqual({ id: "1000000000099", modifiedAt: "2026-11-04T10:00:00+05:30" });
    expect(ok.calls[0]).toMatchObject({ method: "POST", url: "https://www.zohoapis.in/crm/v6/Leads", body: { data: [{ First_Name: "Asha", Last_Name: "Rao", Email: "a@example.com" }] } });
    expect(await ok.g.update("lead", "1000000000001", { City: "Salem" })).toEqual({ modifiedAt: "2026-11-04T10:00:00+05:30" });
    expect(ok.calls[1]).toMatchObject({ method: "PUT", url: "https://www.zohoapis.in/crm/v6/Leads/1000000000001", body: { data: [{ City: "Salem" }] } });
    await expect(gw(() => F.WRITE_DUPLICATE).g.create("lead", { Email: "a@example.com" })).rejects.toMatchObject({ code: "DUPLICATE_DATA", duplicateId: "1000000000001" });
    const bad = await gw(() => F.WRITE_INVALID).g.update("lead", "1", { Email: "x" }).catch((e) => e);
    expect(bad).toBeInstanceOf(RecordRejected);
    expect(bad.message).not.toMatch(/Email|bad value/);
    await expect(gw(() => F.WRITE_OK).g.update("lead", "not-an-id", {})).rejects.toBeInstanceOf(RecordRejected);
  });
  it("vendor 401 is a credential error and a 429 is retried by the shared client (policy lives in core/http)", async () => {
    const { g } = gw(() => new CredentialError("Vendor rejected the credentials (HTTP 401)"));
    await expect(g.list("lead", null, ["Email"], null)).rejects.toBeInstanceOf(CredentialError);
  });
  it("helpers", () => {
    expect(splitName("Asha Rao")).toEqual({ First_Name: "Asha", Last_Name: "Rao" });
    expect(splitName("Ravi Kumar Iyer")).toEqual({ First_Name: "Ravi Kumar", Last_Name: "Iyer" });
    expect(splitName("Madonna")).toEqual({ Last_Name: "Madonna" });
    expect(toPayload("deal", { "Account_Name.id": "3", Stage: "Closed Won" })).toEqual({ Account_Name: { id: "3" }, Stage: "Closed Won" });
    expect(toZohoTs("2026-11-01T10:00:00.000Z")).toBe("2026-11-01T10:00:00+00:00");
    expect(toZohoTs("garbage")).toBe("2000-01-01T00:00:00+00:00");
    expect(selectFields("account", ["Account_Name", "Billing_City"])).toEqual(["id", "Modified_Time", "Account_Name", "Billing_City"]);
  });
});

describe("token refresh", () => {
  const ENV = { ZOHO_CLIENT_ID: "cid", ZOHO_CLIENT_SECRET: "csecret" };
  const res = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("posts to the connection's accounts server and keeps the refresh token and region", async () => {
    let url = "", body = "";
    const f = (async (u: string, init: { body: string }) => { url = u; body = init.body; return new Response(JSON.stringify({ access_token: "new", expires_in: 3600 })); }) as unknown as typeof fetch;
    const r = await refreshZohoToken({ secrets: { refresh_token: "rt", region: "eu" }, env: ENV, fetchImpl: f });
    expect(url).toBe("https://accounts.zoho.eu/oauth/v2/token");
    expect(new URLSearchParams(body).get("grant_type")).toBe("refresh_token");
    expect(r).toEqual({ secrets: { access_token: "new" }, expiresInSec: 3600 });
  });
  it("normalises an expiry given in milliseconds", async () => {
    expect((await refreshZohoToken({ secrets: { refresh_token: "rt" }, env: ENV, fetchImpl: res(200, { access_token: "n", expires_in: 3_600_000 }) })).expiresInSec).toBe(3600);
    expect((await refreshZohoToken({ secrets: { refresh_token: "rt" }, env: ENV, fetchImpl: res(200, { access_token: "n" }) })).expiresInSec).toBe(3600);
  });
  it("a refusal delivered as HTTP 200 with an error body is a dead token (needs attention), a throttle is transient", async () => {
    await expect(refreshZohoToken({ secrets: { refresh_token: "rt" }, env: ENV, fetchImpl: res(200, { error: "invalid_code" }) })).rejects.toBeInstanceOf(CredentialError);
    await expect(refreshZohoToken({ secrets: { refresh_token: "rt" }, env: ENV, fetchImpl: res(400, { error: "Access Denied", error_description: "You have made too many requests continuously. Please try again after some time." }) })).rejects.toBeInstanceOf(TransientError);
    await expect(refreshZohoToken({ secrets: { refresh_token: "rt" }, env: ENV, fetchImpl: res(503, {}) })).rejects.toBeInstanceOf(TransientError);
    await expect(refreshZohoToken({ secrets: {}, env: ENV })).rejects.toBeInstanceOf(CredentialError);
    await expect(refreshZohoToken({ secrets: { refresh_token: "rt" }, env: {} })).rejects.toBeInstanceOf(CredentialError);
  });
});

describe("webhook", () => {
  it("parses notifications and drops unknown modules, bad ids and a wrong body token", () => {
    expect(parseZohoWebhook(F.notification(), "shared-token")).toEqual([{ object: "lead", operation: "update", ids: ["1000000000001"], channelId: "1000001" }]);
    expect(parseZohoWebhook(F.notification({ module: "Vendors" }))).toEqual([]);
    expect(parseZohoWebhook(F.notification({ ids: ["x", "1 or 1"] }))).toEqual([]);
    expect(parseZohoWebhook(F.notification({ token: "wrong" }), "shared-token")).toEqual([]);
    expect(parseZohoWebhook(F.notification({ token: undefined }), "shared-token")).toHaveLength(1);   // the edge verified the header form
    expect(parseZohoWebhook("not json")).toEqual([]);
  });
  it("the channel id is numeric, stable and different per connection", () => {
    expect(channelIdFor("c1")).toMatch(/^\d+$/);
    expect(channelIdFor("c1")).toBe(channelIdFor("c1"));
    expect(channelIdFor("c1")).not.toBe(channelIdFor("c2"));
  });

  const mkRt = (http: VendorHttp, env: Record<string, string> = {}): { rt: ZohoRuntime; crm: FakeCrmStore; conn: ConnectionRow; ctx: (rejects: string[], secrets?: Record<string, string>) => SyncContext; vault: FakeVault } => {
    const crm = new FakeCrmStore(), vault = new FakeVault();
    const conn: ConnectionRow = { id: "conn-1", tenantId: "t-1", workspaceId: "w-1", connectorId: "zoho-crm", mode: "sandbox", status: "sandbox", settings: { sync_objects: ["lead"] }, credentialSecretId: "sec-x", webhookSecretId: null, tokenExpiresAt: null };
    void crm.core.insertConnection({ tenantId: "t-1", workspaceId: "w-1", connectorId: "zoho-crm", label: "Zoho", category: "crm", direction: "both", mode: "sandbox", status: "sandbox", connectedBy: "u" });
    const rt: ZohoRuntime = { store: crm, env, log: { info() {}, warn() {}, error() {} }, now: () => new Date("2026-11-21T00:00:00Z"), vault };
    const live = crm.core.conns.get("conn-1") as ConnectionRow;
    Object.assign(live, conn);
    return { rt, crm, conn: live, vault, ctx: (rejects, secrets = { access_token: "tok" }) => ({ conn: live, secrets: async () => secrets, http, upsert: { async record() { throw new Error("unused"); } }, log: silentLog, runId: 900 + rejects.length, apiBase: "https://www.zohoapis.in", reject: (r) => rejects.push(r) }) };
  };
  const evt = (over: Partial<ZohoEvent> = {}): ZohoEvent => ({ object: "lead", operation: "update", ids: ["1000000000001"], channelId: channelIdFor("conn-1"), ...over });

  it("a delivery fetches the named records with THIS connection's token and imports them", async () => {
    const s = scripted(() => ({ data: F.COQL_LEADS.data.slice(0, 1) }));
    const m = mkRt(s.http);
    setZohoRuntimeFactory(async () => m.rt);
    const rejects: string[] = [];
    await zohoConnector.webhook!.handle(m.ctx(rejects), evt());
    expect(s.calls[0]).toMatchObject({ method: "GET", headers: { authorization: "Zoho-oauthtoken tok" } });
    expect(m.crm.all("leads")).toHaveLength(1);
    expect(m.crm.all("leads")[0]).toMatchObject({ email: "asha@example.com", workspace_id: "w-1" });
  });
  it("another connection's channel and deletes are refused", async () => {
    const s = scripted(() => ({ data: [] }));
    const m = mkRt(s.http);
    setZohoRuntimeFactory(async () => m.rt);
    const rejects: string[] = [];
    await zohoConnector.webhook!.handle(m.ctx(rejects), evt({ channelId: channelIdFor("conn-OTHER") }));
    await zohoConnector.webhook!.handle(m.ctx(rejects), evt({ operation: "delete" }));
    expect(rejects).toEqual(["channel_mismatch", "remote_deleted"]);
    expect(s.calls).toHaveLength(0);
    expect(m.crm.all("leads")).toHaveLength(0);
  });
  it("verify() applies the body-token check only when a secret is known", async () => {
    const out = await zohoConnector.webhook!.verify({ rawBody: F.notification({ token: "bad" }), headers: {} }, { webhook_secret: "shared-token" });
    expect(out).toEqual([]);
    expect(await zohoConnector.webhook!.verify({ rawBody: F.notification(), headers: {} }, {})).toHaveLength(1);
  });

  describe("watch renewal (channels live at most a week)", () => {
    const ENV = { APP_BASE_URL: "https://crm.example.test/" };
    it("registers a channel for this connection, stores the secret in the Vault, and does not re-register while it is fresh", async () => {
      const s = scripted(() => F.WATCH_OK);
      const m = mkRt(s.http, ENV);
      const rejects: string[] = [];
      const r = await healthStep(m.rt, m.ctx(rejects), { access_token: "tok" });
      expect(r.sample).toEqual({ watch: "renewed" });
      const body = s.calls[0].body as { watch: { channel_id: string; events: string[]; channel_expiry: string; token: string; notify_url: string }[] };
      expect(s.calls[0].url).toBe("https://www.zohoapis.in/crm/v6/actions/watch");
      expect(body.watch[0]).toMatchObject({ channel_id: channelIdFor("conn-1"), events: ["Leads.all"], notify_url: "https://crm.example.test/api/hooks/zoho-crm/conn-1" });
      expect(Date.parse(body.watch[0].channel_expiry) - Date.parse("2026-11-21T00:00:00Z")).toBeLessThanOrEqual(7 * 86_400_000);
      const stored = JSON.parse((await m.vault.getSecret(m.conn.webhookSecretId as string)) as string);
      expect(stored.webhook_secret).toBe(body.watch[0].token);
      expect(JSON.stringify([r, silentLog.lines])).not.toContain(body.watch[0].token);
      expect((await healthStep(m.rt, m.ctx(rejects), { access_token: "tok" })).sample).toEqual({ watch: "ok" });
      expect(s.calls).toHaveLength(1);
      // 6 days later it is renewed with the SAME secret
      const later = await healthStep(m.rt, m.ctx(rejects), { access_token: "tok" }, new Date("2026-11-26T20:00:00Z"));
      expect(later.sample).toEqual({ watch: "renewed" });
      expect((s.calls[1].body as { watch: { token: string }[] }).watch[0].token).toBe(body.watch[0].token);
    });
    it("skips without an app base URL, and a refused registration is counted but never fails the sync (polling continues)", async () => {
      const m = mkRt(scripted(() => F.WATCH_OK).http, {});
      expect((await healthStep(m.rt, m.ctx([]), { access_token: "tok" })).sample).toEqual({ watch: "skipped_no_app_base_url" });
      const bad = mkRt(scripted(() => new Error("Vendor request failed (HTTP 400)")).http, ENV);
      const rejects: string[] = [];
      expect((await healthStep(bad.rt, bad.ctx(rejects), { access_token: "tok" })).sample).toEqual({ watch: "failed" });
      expect(rejects).toEqual(["watch_failed"]);
      const dead = mkRt(scripted(() => new CredentialError("Vendor rejected the credentials (HTTP 401)")).http, ENV);
      await expect(healthStep(dead.rt, dead.ctx([]), { access_token: "tok" })).rejects.toBeInstanceOf(CredentialError);
    });
  });
});

describe("setup and options (server-action targets)", () => {
  it("finishZohoSetup stores the region and org id in the Vault and audits; a rejected token or a bad region changes nothing", async () => {
    resetRegistry(); registerConnector(zohoConnector);
    const { deps, store, vault, audits } = makeDeps({ env: {}, http: () => scripted(() => F.ORG).http });
    const conn = await store.insertConnection({ tenantId: "t-1", workspaceId: "w-1", connectorId: "zoho-crm", label: "Zoho", category: "crm", direction: "both", mode: "sandbox", status: "sandbox", connectedBy: "u" });
    conn.credentialSecretId = await vault.putSecret("n", JSON.stringify({ access_token: "tok", refresh_token: "rt" }));
    expect(await finishZohoSetup(deps, { connectionId: conn.id, region: "mars" })).toEqual({ ok: false, code: "invalid_region" });
    const r = await finishZohoSetup(deps, { connectionId: conn.id, region: "eu" });
    expect(r).toEqual({ ok: true, region: "eu", orgLabel: "Example Org" });
    expect(await loadSecrets(vault, conn)).toEqual({ access_token: "tok", refresh_token: "rt", region: "eu", org_id: "9000000000001" });
    expect(audits.map((a) => a.action)).toEqual(["zoho.region_set"]);

    const rejected = makeDeps({ http: () => scripted(() => new CredentialError("Vendor rejected the credentials (HTTP 401)")).http });
    const c2 = await rejected.store.insertConnection({ tenantId: "t-1", workspaceId: "w-1", connectorId: "zoho-crm", label: "Zoho", category: "crm", direction: "both", mode: "sandbox", status: "sandbox", connectedBy: "u" });
    c2.credentialSecretId = await rejected.vault.putSecret("n", JSON.stringify({ access_token: "tok" }));
    expect(await finishZohoSetup(rejected.deps, { connectionId: c2.id, region: "in" })).toEqual({ ok: false, code: "token_rejected" });
    expect(JSON.parse((await rejected.vault.getSecret(c2.credentialSecretId)) as string)).toEqual({ access_token: "tok" });

    const noAudit = makeDeps({ http: () => scripted(() => F.ORG).http, audit: async () => { throw new Error("down"); } });
    const c3 = await noAudit.store.insertConnection({ tenantId: "t-1", workspaceId: "w-1", connectorId: "zoho-crm", label: "Zoho", category: "crm", direction: "both", mode: "sandbox", status: "sandbox", connectedBy: "u" });
    c3.credentialSecretId = await noAudit.vault.putSecret("n", JSON.stringify({ access_token: "tok" }));
    expect(await finishZohoSetup(noAudit.deps, { connectionId: c3.id, region: "in" })).toEqual({ ok: false, code: "audit_failed" });
    expect(JSON.parse((await noAudit.vault.getSecret(c3.credentialSecretId)) as string)).toEqual({ access_token: "tok" });
  });

  it("saveSyncOptions validates, audits before writing, and defaults stay safe", async () => {
    const { deps, store, audits } = makeDeps();
    const crm = new FakeCrmStore();
    const conn = await store.insertConnection({ tenantId: "t-1", workspaceId: "w-1", connectorId: "zoho-crm", label: "Zoho", category: "crm", direction: "both", mode: "sandbox", status: "sandbox", connectedBy: "u" });
    expect(await saveSyncOptions(deps, crm, "zoho-crm", conn.id, { objects: ["bogus"] })).toEqual({ ok: false, code: "invalid_input", field: "objects" });
    expect(await saveSyncOptions(deps, crm, "zoho-crm", conn.id, { importMode: "overwrite" })).toEqual({ ok: false, code: "invalid_input", field: "importMode" });
    expect(await saveSyncOptions(deps, crm, "hubspot", conn.id, { pushNew: true })).toEqual({ ok: false, code: "wrong_connector" });
    expect(crm.settings).toEqual({});
    const r = await saveSyncOptions(deps, crm, "zoho-crm", conn.id, { objects: ["deal", "lead"], pushNew: true, importMode: "merge", importSince: "2026-01-01" });
    expect(r).toMatchObject({ ok: true, options: { objects: ["lead", "deal"], pushNew: true, importMode: "merge", importSince: "2026-01-01T00:00:00.000Z" } });
    expect(crm.settings).toMatchObject({ push_new: true, import_mode: "merge" });
    expect(audits.at(-1)?.action).toBe("crm_sync.options_changed");
    const blocked = makeDeps({ audit: async () => { throw new Error("down"); } });
    const c2 = await blocked.store.insertConnection({ tenantId: "t-1", workspaceId: "w-1", connectorId: "zoho-crm", label: "Zoho", category: "crm", direction: "both", mode: "sandbox", status: "sandbox", connectedBy: "u" });
    const crm2 = new FakeCrmStore();
    expect(await saveSyncOptions(blocked.deps, crm2, "zoho-crm", c2.id, { pushNew: true })).toEqual({ ok: false, code: "audit_failed" });
    expect(crm2.settings).toEqual({});
  });
});

describe("through the framework runner", () => {
  let h: ReturnType<typeof makeDeps>, crm: FakeCrmStore;
  const base = { tenantId: "t-1", workspaceId: "w-1", connectorId: "zoho-crm" as const, mode: "sandbox" as const, status: "sandbox" as const, settings: { sync_objects: ["lead"] }, webhookSecretId: null, tokenExpiresAt: null as string | null };
  async function connect(secrets: Record<string, string>, over: Partial<ConnectionRow> = {}, http?: VendorHttp, extra: Parameters<typeof makeDeps>[0] = {}) {
    resetRegistry(); registerConnector(zohoConnector);
    h = makeDeps({ now: () => new Date("2026-11-21T00:00:00Z"), env: { ZOHO_CLIENT_ID: "cid", ZOHO_CLIENT_SECRET: "cs" }, ...(http ? { http: () => http } : {}), ...extra });
    h.store.availability["zoho-crm"] = { mode: "sandbox", gateStatus: "ready" };
    const secId = await h.vault.putSecret("n", JSON.stringify(secrets));
    h.store.conns.set("conn-9", { id: "conn-9", ...base, credentialSecretId: secId, ...over });
    crm = new FakeCrmStore();
    setZohoRuntimeFactory(async () => ({ store: crm, env: {}, log: silentLog, now: () => new Date("2026-11-21T00:00:00Z"), vault: h.vault }));
  }
  beforeEach(() => { silentLog.lines.length = 0; });

  it("the first run is the initial import: leads arrive through the planner and the run is recorded", async () => {
    const s = scripted(() => F.COQL_LEADS);
    await connect({ access_token: "tok", refresh_token: "rt" }, {}, s.http);
    const out = await runSync(h.deps, { connectionId: "conn-9", stream: "pull", trigger: "manual" });
    expect(out.streams[0]).toMatchObject({ stream: "pull", status: "success", rowsIn: 2 });
    expect(crm.all("leads").map((l) => l.email).sort()).toEqual(["asha@example.com", "iyer@example.com"]);
    expect(s.calls[0].url).toBe("https://www.zohoapis.in/crm/v6/coql");
    expect(h.store.cursors.get("conn-9:pull")).toMatchObject({ i: 0, cur: { lead: { since: "2026-11-02T10:05:00+05:30" } } });
  });

  it("a vendor 401 mid-sync marks the connection needs_attention with a readable message that carries no token", async () => {
    await connect({ access_token: "tok-SECRET", refresh_token: "rt" }, {}, scripted(() => new CredentialError("Vendor rejected the credentials (HTTP 401)")).http);
    const out = await runSync(h.deps, { connectionId: "conn-9", stream: "pull", trigger: "poll" });
    expect(out.streams[0].status).toBe("failed");
    expect(h.store.conns.get("conn-9")).toMatchObject({ status: "needs_attention" });
    expect(h.store.conns.get("conn-9")?.lastError).toMatch(/Reconnect/);
    expect(JSON.stringify([h.store.runs, silentLog.lines])).not.toContain("tok-SECRET");
    // and it does not keep hammering the vendor: the next scheduled run is skipped
    expect((await runSync(h.deps, { connectionId: "conn-9", trigger: "poll" })).skipped).toBe("needs_attention");
  });

  it("an expired access token with a dead refresh token is needs_attention before any vendor call", async () => {
    vi.stubEnv("ZOHO_CLIENT_ID", "cid"); vi.stubEnv("ZOHO_CLIENT_SECRET", "cs");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "invalid_code" }), { status: 200 }));
    const s = scripted(() => F.COQL_LEADS);
    await connect({ access_token: "old", refresh_token: "dead" }, { tokenExpiresAt: "2026-11-20T00:00:00.000Z" }, s.http);
    const out = await runSync(h.deps, { connectionId: "conn-9", trigger: "poll" });
    expect(out.skipped).toBe("needs_attention");
    expect(s.calls).toHaveLength(0);
    expect(h.store.conns.get("conn-9")).toMatchObject({ status: "needs_attention" });
    expect(h.store.runs.every((r) => r.status === "failed" && /expired|renewed|Reconnect/.test(r.error ?? ""))).toBe(true);
  });

  it("a refreshable token is renewed, stored, and the sync proceeds", async () => {
    vi.stubEnv("ZOHO_CLIENT_ID", "cid"); vi.stubEnv("ZOHO_CLIENT_SECRET", "cs");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 })));
    const s = scripted(() => F.COQL_LEADS);
    await connect({ access_token: "old", refresh_token: "rt", region: "in" }, { tokenExpiresAt: "2026-11-20T23:58:00.000Z" }, s.http);
    const conn = h.store.conns.get("conn-9") as ConnectionRow;
    expect(await refreshIfNeeded(h.deps, conn)).toEqual({ ok: true, refreshed: true });
    expect(await loadSecrets(h.vault, h.store.conns.get("conn-9") as ConnectionRow)).toEqual({ access_token: "fresh", refresh_token: "rt", region: "in" });
    expect(h.store.conns.get("conn-9")?.tokenExpiresAt).toBe("2026-11-21T01:00:00.000Z");
  });

  it("a Zoho throttle is retried by the job (transient), not reported as a credential problem", async () => {
    await connect({ access_token: "tok", refresh_token: "rt" }, {}, scripted(() => new TransientError("Vendor kept failing (HTTP 429)", 1000)).http);
    const out = await runSync(h.deps, { connectionId: "conn-9", stream: "pull", trigger: "poll" });
    expect(out.retry).toBe(true);
    expect(h.store.conns.get("conn-9")?.status).toBe("sandbox");
  });
});

describe("defaults", () => {
  it("the default map only targets columns the engine may write, and owners are explicit", () => {
    for (const f of ZOHO_DEFAULT_MAP) { expect(f.conflictOwner).toBe("crm"); expect(["leads", "contacts", "accounts", "deals"]).toContain(f.localTable); expect(f.localColumn).not.toMatch(/tenant|workspace|^id$/); }
  });
});
