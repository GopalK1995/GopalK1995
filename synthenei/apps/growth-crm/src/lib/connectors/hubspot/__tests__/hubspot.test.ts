// HubSpot connector: OAuth spec, gateway requests and parsing (fixtures), webhook signature + parsing + portal isolation, setup,
// and the shared engine against HubSpot's shapes (contacts as leads or contacts, deals, search window restarts).
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthorizeUrl } from "../../core/oauth";
import { loadSecrets } from "../../core/secrets";
import { runSync } from "../../core/sync";
import { makeDeps, silentLog } from "../../core/__tests__/fakes";
import { registerConnector, resetRegistry } from "../../registry";
import { CredentialError, type ConnectionRow, type HttpRequest, type SyncContext, type VendorHttp } from "../../core/types";
import { VERIFIERS } from "../../verify";
import { HOOK_METHOD, HOOK_URL, hmac } from "../../verify/util";
import { FakeCrmStore } from "../../zoho/__tests__/fakes";
import { RecordRejected } from "../../zoho/engine/types";
import { optionsOf } from "../../zoho/engine/types";
import { makeHubspotGateway, propsFor, splitName, toProperties } from "../api";
import { hubspotConnector, objectsFor, setHubspotRuntimeFactory } from "../connector";
import { HUBSPOT_DEFAULT_MAP, hubspotDefaultMap } from "../defaults";
import { finishHubspotSetup } from "../setup";
import { parseHubspotWebhook } from "../webhook";
import * as F from "../__fixtures__/payloads";

const scripted = (handler: (req: HttpRequest) => unknown) => {
  const calls: HttpRequest[] = [];
  const http: VendorHttp = { async json<T>(req: HttpRequest): Promise<T> { calls.push(req); const r = handler(req); if (r instanceof Error) throw r; return r as T; } };
  return { calls, http };
};
afterEach(() => setHubspotRuntimeFactory(null));

describe("OAuth", () => {
  it("authorises with the app's scopes, no PKCE, and uses the framework refresh (HubSpot refresh tokens do not rotate)", () => {
    const o = hubspotConnector.oauth!;
    expect(o.authorizeUrl).toBe("https://app.hubspot.com/oauth/authorize");
    expect(o.tokenUrl).toBe("https://api.hubapi.com/oauth/v1/token");
    expect(o.pkce).toBe(false);
    const u = new URL(buildAuthorizeUrl(o, { clientId: "cid", redirectUri: "https://app.example.test/api/oauth/hubspot/callback", state: "s" }));
    expect(u.searchParams.get("scope")).toBe("oauth crm.objects.contacts.read crm.objects.contacts.write crm.objects.companies.read crm.objects.companies.write crm.objects.deals.read crm.objects.deals.write");
    expect(hubspotConnector.refresh).toBeUndefined();
    expect(hubspotConnector.requiredEnv).toEqual(["HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET"]);
    expect(hubspotConnector.apiBaseEnv).toBe("HUBSPOT_API_BASE");
  });
});

describe("gateway", () => {
  const gw = (handler: (r: HttpRequest) => unknown) => { const s = scripted(handler); const slept: number[] = []; let t = 0; return { ...s, slept, g: makeHubspotGateway({ http: s.http, apiBase: "https://api.hubapi.com", token: "tok", sleep: async (ms) => { slept.push(ms); t += ms; }, now: () => t }) }; };

  it("searches sorted by last-modified from the cursor, asks for the mapped properties, and joins first and last name", async () => {
    const { g, calls } = gw(() => F.SEARCH_CONTACTS);
    const page = await g.list("lead", null, ["full_name", "email", "phone"], "2026-11-01T00:00:00.000Z");
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.hubapi.com/crm/v3/objects/contacts/search", headers: { authorization: "Bearer tok" } });
    expect(calls[0].body).toEqual({
      filterGroups: [{ filters: [{ propertyName: "lastmodifieddate", operator: "GTE", value: String(Date.parse("2026-11-01T00:00:00.000Z")) }] }],
      sorts: [{ propertyName: "lastmodifieddate", direction: "ASCENDING" }], properties: ["firstname", "lastname", "email", "phone"], limit: 100,
    });
    expect(page.records.map((r) => [r.id, r.fields.full_name])).toEqual([["501", "Asha Rao"], ["502", "Iyer"]]);
    expect(page).toMatchObject({ done: true, cursor: { since: "2026-11-02T04:35:00.000Z" } });
  });
  it("companies and deals use hs_lastmodifieddate; amounts become numbers", async () => {
    const { g, calls } = gw(() => F.SEARCH_DEALS);
    const [d] = (await g.list("deal", null, ["dealname", "amount"], null)).records;
    expect((calls[0].body as { sorts: { propertyName: string }[] }).sorts[0].propertyName).toBe("hs_lastmodifieddate");
    expect(calls[0].url).toContain("/deals/search");
    expect(d.fields).toMatchObject({ dealname: "Plan, 12 seats", amount: 12000, dealstage: "contractsent" });
  });
  it("pages with `after`; past 9,000 the window restarts from the last timestamp (search stops at 10,000 results)", async () => {
    const more = gw(() => F.SEARCH_MORE);
    expect(await more.g.list("lead", { since: "2026-11-01T00:00:00.000Z" }, ["email"], null)).toMatchObject({ done: false, cursor: { since: "2026-11-01T00:00:00.000Z", after: "200" } });
    await more.g.list("lead", { since: "2026-11-01T00:00:00.000Z", after: "200" }, ["email"], null);
    expect((more.calls[1].body as { after: string }).after).toBe("200");
    const cap = gw(() => F.SEARCH_CAP);
    expect(await cap.g.list("lead", { since: "2026-11-01T00:00:00.000Z", after: "9000" }, ["email"], null)).toMatchObject({ done: false, cursor: { since: "2026-11-02T04:35:00.000Z" } });
  });
  it("paces search calls to stay under 5 requests a second", async () => {
    const { g, slept } = gw(() => ({ results: [] }));
    await g.list("lead", null, ["email"], null);
    await g.list("lead", null, ["email"], null);
    expect(slept).toEqual([220]);
  });
  it("batch-reads by id, ignoring anything that is not a numeric id", async () => {
    const { g, calls } = gw(() => F.SEARCH_CONTACTS);
    await g.getMany("lead", ["501", "x", "1;2"], ["email"]);
    expect(calls[0]).toMatchObject({ url: "https://api.hubapi.com/crm/v3/objects/contacts/batch/read", body: { properties: ["email"], inputs: [{ id: "501" }] } });
    expect(await g.getMany("lead", ["nope"], ["email"])).toEqual([]);
  });
  it("creates and updates; nulls clear a property; 400 and 409 reject only that record, other errors propagate", async () => {
    const ok = gw(() => F.CREATED);
    expect(await ok.g.create("lead", { full_name: "Asha Rao", email: "a@example.com", city: null })).toEqual({ id: "909", modifiedAt: "2026-11-04T04:30:00.000Z" });
    expect(ok.calls[0]).toMatchObject({ method: "POST", url: "https://api.hubapi.com/crm/v3/objects/contacts", body: { properties: { firstname: "Asha", lastname: "Rao", email: "a@example.com", city: "" } } });
    await ok.g.update("deal", "701", { amount: 5000 });
    expect(ok.calls[1]).toMatchObject({ method: "PATCH", url: "https://api.hubapi.com/crm/v3/objects/deals/701", body: { properties: { amount: "5000" } } });
    await expect(gw(() => new Error("Vendor request failed (HTTP 409)")).g.create("lead", { email: "a@example.com" })).rejects.toMatchObject({ code: "DUPLICATE" });
    await expect(gw(() => new Error("Vendor request failed (HTTP 400)")).g.update("lead", "1", { email: "x" })).rejects.toBeInstanceOf(RecordRejected);
    await expect(gw(() => new CredentialError("Vendor rejected the credentials (HTTP 401)")).g.update("lead", "1", { email: "x" })).rejects.toBeInstanceOf(CredentialError);
    await expect(gw(() => new Error("Vendor request failed (HTTP 404)")).g.update("lead", "1", { email: "x" })).rejects.not.toBeInstanceOf(RecordRejected);
  });
  it("helpers", () => {
    expect(splitName("Ravi Kumar Iyer")).toEqual({ firstname: "Ravi Kumar", lastname: "Iyer" });
    expect(propsFor(["full_name", "email", "Bad Name", "x;y"])).toEqual(["firstname", "lastname", "email"]);
    expect(toProperties("account", { full_name: "ignored", name: "Rao & Co" })).toEqual({ name: "Rao & Co" });
  });
});

describe("webhook", () => {
  it("v3 signature: the edge verifier accepts the signed body and rejects a tampered one", () => {
    const secret = "client-secret-value", url = "https://crm.example.test/api/hooks/hubspot/conn", ts = 1_700_000_000_000;
    const body = F.webhookBody();
    const h = (b: string, s = secret) => new Headers({ "x-hubspot-request-timestamp": String(ts), "x-hubspot-signature-v3": hmac(s, `POST${url}${b}${ts}`, "base64"), [HOOK_METHOD]: "POST", [HOOK_URL]: url });
    expect(VERIFIERS.hubspot(body, h(body), secret, { now: ts })).toBe(true);
    expect(VERIFIERS.hubspot(body.replace("Madurai", "X"), h(body), secret, { now: ts })).toBe(false);
    expect(VERIFIERS.hubspot(body, h(body, "other"), secret, { now: ts })).toBe(false);
  });
  it("parses subscription events; deletes and merges are flagged; unknown types and bad ids are dropped", () => {
    const ev = parseHubspotWebhook(F.webhookBody(F.event(), F.event({ subscriptionType: "company.creation", objectId: 9 }), F.event({ subscriptionType: "deal.deletion", objectId: 7 }), F.event({ subscriptionType: "contact.merge" }),
      F.event({ subscriptionType: "ticket.creation" }), F.event({ objectId: "x" }), F.event({ subscriptionType: "contact.privacyDeletion" })));
    expect(ev.map((e) => [e.kind, e.operation, e.objectId])).toEqual([["contacts", "upsert", "501"], ["companies", "upsert", "9"], ["deals", "delete", "7"], ["contacts", "delete", "501"]]);
    expect(parseHubspotWebhook("nope")).toEqual([]);
    expect(parseHubspotWebhook('{"a":1}')).toEqual([]);
  });

  const mk = (settings: Record<string, unknown> = {}, secrets: Record<string, string> = { access_token: "tok", hub_id: "4200001" }) => {
    const crm = new FakeCrmStore();
    const live = { id: "conn-1", tenantId: "t-1", workspaceId: "w-1", connectorId: "hubspot", mode: "sandbox", status: "sandbox", settings, credentialSecretId: "s", webhookSecretId: null, tokenExpiresAt: null } as ConnectionRow;
    const s = scripted((r) => ({ results: F.SEARCH_CONTACTS.results.filter((x) => (r.body as { inputs: { id: string }[] }).inputs.some((i) => i.id === x.id)) }));   // batch/read returns only the ids asked for
    setHubspotRuntimeFactory(async () => ({ store: crm, env: {}, log: silentLog, now: () => new Date("2026-11-21T00:00:00Z") }));
    const rejects: string[] = [];
    const ctx: SyncContext = { conn: live, secrets: async () => secrets, http: s.http, upsert: { async record() { throw new Error("unused"); } }, log: silentLog, runId: 700 + Math.floor(Math.random() * 1e6), apiBase: "https://api.hubapi.com", reject: (r) => rejects.push(r) };
    return { crm, s, ctx, rejects };
  };
  const ev = (over: Record<string, unknown> = {}) => parseHubspotWebhook(F.webhookBody(F.event(over)))[0];

  it("an event for this portal fetches the record with THIS connection's token and imports it as a lead", async () => {
    const m = mk();
    await hubspotConnector.webhook!.handle(m.ctx, ev());
    expect(m.s.calls[0]).toMatchObject({ method: "POST", headers: { authorization: "Bearer tok" } });
    expect(m.crm.all("leads")).toHaveLength(1);
    expect(m.crm.all("leads")[0]).toMatchObject({ email: "asha@example.com", phone: "+919876543210", workspace_id: "w-1", source: "hubspot" });
  });
  it("another portal's event, an unbound connection, and deletes are refused", async () => {
    const other = mk();
    await hubspotConnector.webhook!.handle(other.ctx, ev({ portalId: 999 }));
    expect(other.rejects).toEqual(["portal_mismatch"]);
    const unbound = mk({}, { access_token: "tok" });
    await hubspotConnector.webhook!.handle(unbound.ctx, ev());
    expect(unbound.rejects).toEqual(["portal_unbound"]);
    const del = mk();
    await hubspotConnector.webhook!.handle(del.ctx, ev({ subscriptionType: "contact.deletion" }));
    expect(del.rejects).toEqual(["remote_deleted"]);
    for (const m of [other, unbound, del]) { expect(m.s.calls).toHaveLength(0); expect(m.crm.all("leads")).toHaveLength(0); }
  });
  it("with the contact target set to contacts, the same event lands in contacts", async () => {
    const m = mk({ contact_target: "contact" });
    await hubspotConnector.webhook!.handle(m.ctx, ev());
    expect(m.crm.all("contacts")).toHaveLength(1);
    expect(m.crm.all("leads")).toHaveLength(0);
  });
});

describe("objects and defaults", () => {
  it("people land in one table: leads by default, contacts when the connection says so", () => {
    expect(objectsFor(optionsOf({}))).toEqual(["account", "lead", "deal"]);
    expect(objectsFor(optionsOf({ contact_target: "contact" }))).toEqual(["account", "contact", "deal"]);
    expect(objectsFor(optionsOf({ sync_objects: ["deal"] }))).toEqual(["deal"]);
    expect(objectsFor(optionsOf({ sync_objects: ["contact"], contact_target: "lead" }))).toEqual(["lead"]);
  });
  it("the contacts-as-contacts map is derived from the leads map", () => {
    const m = hubspotDefaultMap("contact");
    expect(m.filter((f) => f.externalObject === "contacts").every((f) => f.localTable === "contacts")).toBe(true);
    expect(HUBSPOT_DEFAULT_MAP.filter((f) => f.externalObject === "contacts").every((f) => f.localTable === "leads")).toBe(true);
    expect(new Set(HUBSPOT_DEFAULT_MAP.map((f) => `${f.externalObject}|${f.externalField}`)).size).toBe(HUBSPOT_DEFAULT_MAP.length);   // one row per external field (framework effectiveMap key)
  });
});

describe("setup", () => {
  it("binds the portal id, stores the webhook signing bundle in the Vault, audits; a rejected token or missing client secret changes nothing", async () => {
    resetRegistry(); registerConnector(hubspotConnector);
    const { deps, store, vault, audits } = makeDeps({ env: { HUBSPOT_CLIENT_SECRET: "client-secret-value" }, http: () => scripted(() => F.TOKEN_INFO).http });
    const conn = await store.insertConnection({ tenantId: "t-1", workspaceId: "w-1", connectorId: "hubspot", label: "HubSpot", category: "crm", direction: "both", mode: "sandbox", status: "sandbox", connectedBy: "u" });
    conn.credentialSecretId = await vault.putSecret("n", JSON.stringify({ access_token: "tok", refresh_token: "rt" }));
    const r = await finishHubspotSetup(deps, { connectionId: conn.id });
    expect(r).toEqual({ ok: true, portalId: "4200001" });
    expect(await loadSecrets(vault, conn)).toEqual({ access_token: "tok", refresh_token: "rt", hub_id: "4200001" });
    expect(JSON.parse((await vault.getSecret(conn.webhookSecretId as string)) as string)).toEqual({ client_secret: "client-secret-value" });
    expect(audits.map((a) => a.action)).toEqual(["hubspot.portal_bound"]);
    expect(JSON.stringify([audits, silentLog.lines])).not.toContain("client-secret-value");

    const noSecret = makeDeps({ env: {}, http: () => scripted(() => F.TOKEN_INFO).http });
    const c2 = await noSecret.store.insertConnection({ tenantId: "t-1", workspaceId: "w-1", connectorId: "hubspot", label: "HubSpot", category: "crm", direction: "both", mode: "sandbox", status: "sandbox", connectedBy: "u" });
    c2.credentialSecretId = await noSecret.vault.putSecret("n", JSON.stringify({ access_token: "tok" }));
    expect(await finishHubspotSetup(noSecret.deps, { connectionId: c2.id })).toEqual({ ok: false, code: "not_configured" });

    const dead = makeDeps({ env: { HUBSPOT_CLIENT_SECRET: "x" }, http: () => scripted(() => new CredentialError("Vendor rejected the credentials (HTTP 401)")).http });
    const c3 = await dead.store.insertConnection({ tenantId: "t-1", workspaceId: "w-1", connectorId: "hubspot", label: "HubSpot", category: "crm", direction: "both", mode: "sandbox", status: "sandbox", connectedBy: "u" });
    c3.credentialSecretId = await dead.vault.putSecret("n", JSON.stringify({ access_token: "tok" }));
    expect(await finishHubspotSetup(dead.deps, { connectionId: c3.id })).toEqual({ ok: false, code: "token_rejected" });
    expect(c3.webhookSecretId).toBeNull();
  });
});

describe("through the framework runner", () => {
  it("an expired HubSpot token that the vendor rejects is needs_attention with a readable message", async () => {
    resetRegistry(); registerConnector(hubspotConnector);
    const h = makeDeps({ http: () => scripted(() => new CredentialError("Vendor rejected the credentials (HTTP 401)")).http });
    h.store.availability.hubspot = { mode: "sandbox", gateStatus: "ready" };
    const secId = await h.vault.putSecret("n", JSON.stringify({ access_token: "tok-SECRET", refresh_token: "rt" }));
    h.store.conns.set("conn-9", { id: "conn-9", tenantId: "t-1", workspaceId: "w-1", connectorId: "hubspot", mode: "sandbox", status: "sandbox", settings: {}, credentialSecretId: secId, webhookSecretId: null, tokenExpiresAt: null });
    const crm = new FakeCrmStore();
    setHubspotRuntimeFactory(async () => ({ store: crm, env: {}, log: silentLog, now: () => new Date() }));
    const out = await runSync(h.deps, { connectionId: "conn-9", stream: "pull", trigger: "poll" });
    expect(out.streams[0].status).toBe("failed");
    expect(h.store.conns.get("conn-9")).toMatchObject({ status: "needs_attention" });
    expect(JSON.stringify([h.store.runs, silentLog.lines])).not.toContain("tok-SECRET");
  });
  it("initial import: companies, contacts and deals arrive in dependency order with HubSpot's stage ids mapped", async () => {
    resetRegistry(); registerConnector(hubspotConnector);
    const bodies: Record<string, unknown> = { companies: { results: [{ id: "301", updatedAt: "2026-11-01T00:00:00.000Z", properties: { name: "Rao & Co", city: "Chennai", website: "raoandco.example.com" } }] }, contacts: F.SEARCH_CONTACTS, deals: F.SEARCH_DEALS };
    const s = scripted((r) => bodies[/objects\/(\w+)\/search/.exec(r.url)?.[1] ?? ""]);
    const h = makeDeps({ http: () => s.http });
    h.store.availability.hubspot = { mode: "sandbox", gateStatus: "ready" };
    const secId = await h.vault.putSecret("n", JSON.stringify({ access_token: "tok" }));
    h.store.conns.set("conn-9", { id: "conn-9", tenantId: "t-1", workspaceId: "w-1", connectorId: "hubspot", mode: "sandbox", status: "sandbox", settings: {}, credentialSecretId: secId, webhookSecretId: null, tokenExpiresAt: null });
    const crm = new FakeCrmStore();
    setHubspotRuntimeFactory(async () => ({ store: crm, env: {}, log: silentLog, now: () => new Date() }));
    const out = await runSync(h.deps, { connectionId: "conn-9", stream: "pull", trigger: "manual" });
    expect(out.streams[0].status).toBe("success");
    expect(s.calls.map((c) => /objects\/(\w+)\//.exec(c.url)?.[1])).toEqual(["companies", "contacts", "deals"]);
    expect(crm.all("accounts")[0]).toMatchObject({ name: "Rao & Co", city: "Chennai" });
    expect(crm.all("leads").map((l) => l.email).sort()).toEqual(["asha@example.com", "iyer@example.com"]);
    expect(crm.all("deals")[0]).toMatchObject({ name: "Plan, 12 seats", stage_id: "st-proposal", value_inr: 12000, expected_close_on: "2026-12-31" });
  });
});
