import { describe, expect, it } from "vitest";
import { CredentialError, TransientError } from "../../core/types";
import { gatewayFor, mockAllowed, resetMockGateways } from "../config";
import { completeEmbeddedSignup } from "../embedded";
import { WhatsAppApiError, classifyError } from "../gateway";
import { makeGraphGateway } from "../graph";
import { whatsappConnector } from "../connector";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
function scripted(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); const r = responses.shift(); if (!r) throw new Error("unscripted"); if (r instanceof Error) throw r; return r; }) as unknown as typeof fetch;
  return { f, calls };
}
const base = { apiBase: "http://stub.local/", version: "v9.0", accessToken: "TOKEN-123", phoneNumberId: "111", wabaId: "222", sleep: async () => {}, random: () => 0.5 };

describe("Graph gateway", () => {
  it("sends text with the documented body and a bearer token against WHATSAPP_API_BASE", async () => {
    const { f, calls } = scripted(json(200, { messages: [{ id: "wamid.X" }] }));
    const r = await makeGraphGateway({ ...base, fetch: f }).sendText({ to: "919800000001", body: "Hi" });
    expect(r).toEqual({ wamid: "wamid.X" });
    expect(calls[0].url).toBe("http://stub.local/v9.0/111/messages");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer TOKEN-123");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ messaging_product: "whatsapp", to: "919800000001", type: "text", text: { body: "Hi" } });
  });
  it("sends a template with body parameters and the vendor language", async () => {
    const { f, calls } = scripted(json(200, { messages: [{ id: "wamid.T" }] }));
    await makeGraphGateway({ ...base, fetch: f }).sendTemplate({ to: "919800000001", name: "sample_followup", language: "en_US", bodyParams: ["Asha"] });
    expect(JSON.parse(String(calls[0].init.body)).template).toEqual({ name: "sample_followup", language: { code: "en_US" }, components: [{ type: "body", parameters: [{ type: "text", text: "Asha" }] }] });
  });
  it("retries 429 and 5xx with Retry-After, then succeeds; gives up as a transient error", async () => {
    const a = scripted(json(429, {}, { "retry-after": "1" }), json(500, {}), json(200, { messages: [{ id: "wamid.R" }] }));
    expect((await makeGraphGateway({ ...base, fetch: a.f }).sendText({ to: "9198000000", body: "x" })).wamid).toBe("wamid.R");
    expect(a.calls).toHaveLength(3);
    const b = scripted(...Array.from({ length: 6 }, () => json(503, {})));
    await expect(makeGraphGateway({ ...base, fetch: b.f, policy: { maxRetries: 2 } }).sendText({ to: "9198000000", body: "x" })).rejects.toBeInstanceOf(TransientError);
  });
  it("keeps the vendor error code; a bad token (401 or code 190) is a CredentialError; messages never carry the body", async () => {
    const e = await makeGraphGateway({ ...base, fetch: scripted(json(400, { error: { code: 131047, message: "to 919800000001 failed" } })).f }).sendText({ to: "919800000001", body: "secret text" }).catch((x) => x);
    expect(e).toBeInstanceOf(WhatsAppApiError);
    expect(e).toMatchObject({ code: 131047, failure: "window_closed", transient: false });
    expect(String(e.message)).not.toMatch(/919800000001|secret text|TOKEN/);
    const t = await makeGraphGateway({ ...base, fetch: scripted(json(400, { error: { code: 190 } })).f }).sendText({ to: "9198000000", body: "x" }).catch((x) => x);
    expect(t).toBeInstanceOf(CredentialError);
    const u = await makeGraphGateway({ ...base, fetch: scripted(json(401, {})).f }).getPhoneNumber().catch((x) => x);
    expect(u).toBeInstanceOf(CredentialError);
  });
  it("classifies the vendor codes the sender cares about", () => {
    expect(classifyError(130429, 400)).toEqual({ failure: "rate_limited", transient: true });
    expect(classifyError(131030, 400).failure).toBe("recipient_not_allowed");
    expect(classifyError(131049, 400).failure).toBe("user_limit");
    expect(classifyError(132001, 400).failure).toBe("template");
    expect(classifyError(0, 502)).toEqual({ failure: "other", transient: true });
  });
  it("lists templates across pages and keeps the vendor language", async () => {
    const { f, calls } = scripted(
      json(200, { data: [{ id: "1", name: "a", language: "en_US", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "x" }] }], paging: { next: "http://stub.local/v9.0/222/message_templates?after=abc" } }),
      json(200, { data: [{ id: "2", name: "b", language: "ta", status: "REJECTED", category: "MARKETING", components: [], rejected_reason: "INVALID_FORMAT" }, { bad: true }] }),
    );
    const out = await makeGraphGateway({ ...base, fetch: f }).listTemplates();
    expect(out.map((t) => [t.id, t.language, t.status])).toEqual([["1", "en_US", "APPROVED"], ["2", "ta", "REJECTED"]]);
    expect(out[1].rejectedReason).toBe("INVALID_FORMAT");
    expect(calls[0].url).toContain("/222/message_templates?fields=");
  });
  it("reads the number info and media metadata, enforcing the size cap on download", async () => {
    const g = makeGraphGateway({ ...base, fetch: scripted(json(200, { display_phone_number: "1555", verified_name: "Acme", quality_rating: "GREEN", messaging_limit_tier: "TIER_1K" }), json(200, { url: "http://cdn/x", mime_type: "image/png", sha256: "h", file_size: 4 })).f });
    expect(await g.getPhoneNumber()).toMatchObject({ displayNumber: "1555", quality: "green", messagingLimitTier: "TIER_1K" });
    expect(await g.getMediaInfo("m1")).toMatchObject({ url: "http://cdn/x", mime: "image/png" });
    const big = makeGraphGateway({ ...base, fetch: (async () => new Response(new Uint8Array(100), { status: 200 })) as unknown as typeof fetch });
    await expect(big.downloadMedia("http://cdn/x", 10)).rejects.toThrow("media_too_large");
  });
});

describe("gateway selection: real calls only with real credentials", () => {
  const real = { waba_id: "222", phone_number_id: "111", access_token: "real-token", app_secret: "s" };
  it("the sandbox token gives the mock gateway (no network) outside production, and is refused in production", () => {
    resetMockGateways();
    const s = { ...real, access_token: "wa-mock-token" };
    expect(gatewayFor({ connectionId: "c", secrets: s, env: { APP_ENV: "staging" } }).kind).toBe("mock");
    expect(() => gatewayFor({ connectionId: "c", secrets: s, env: { APP_ENV: "production" } })).toThrow(CredentialError);
    expect(mockAllowed({ APP_ENV: "production" })).toBe(false);
  });
  it("demo mode without credentials is the mock; real credentials give the Graph gateway; incomplete ones are a credential error", () => {
    expect(gatewayFor({ connectionId: "c", secrets: {}, env: { APP_ENV: "demo" } }).kind).toBe("mock");
    expect(gatewayFor({ connectionId: "c", secrets: real, env: { APP_ENV: "production" } }).kind).toBe("graph");
    expect(() => gatewayFor({ connectionId: "c", secrets: { access_token: "x" }, env: { APP_ENV: "staging" } })).toThrow(CredentialError);
  });
  it("the connector test() verifies the sandbox bundle without network and reports the account", async () => {
    resetMockGateways();
    const r = await whatsappConnector.test!({ conn: { id: "pending" } as never, secrets: { ...real, access_token: "wa-mock-token" }, http: undefined as never, apiBase: "" });
    expect(r).toMatchObject({ accountId: "111", accountLabel: "Sandbox number" });
  });
  it("credential field patterns reject non-numeric ids", () => {
    const pat = Object.fromEntries((whatsappConnector.credentialFields ?? []).map((f) => [f.key, f.pattern]));
    expect(new RegExp(pat.phone_number_id!).test("12345")).toBe(true);
    expect(new RegExp(pat.phone_number_id!).test("12a45")).toBe(false);
    expect(new RegExp(pat.waba_id!).test("123")).toBe(false);
  });
});

describe("embedded signup (server half)", () => {
  const env = { WHATSAPP_APP_ID: "app1", WHATSAPP_APP_SECRET: "appsecret", WHATSAPP_API_BASE: "http://stub.local", WHATSAPP_API_VERSION: "v9.0" };
  it("exchanges the code with the platform app, subscribes the account and returns the credential bundle", async () => {
    const { f, calls } = scripted(json(200, { access_token: "NEWTOKEN" }), json(200, { success: true }));
    const out = await completeEmbeddedSignup({ code: "c0de", wabaId: "22222", phoneNumberId: "11111" }, env, f);
    expect(out).toEqual({ waba_id: "22222", phone_number_id: "11111", access_token: "NEWTOKEN", app_secret: "appsecret" });
    expect(calls[0].url).toContain("http://stub.local/v9.0/oauth/access_token?");
    expect(calls[1]).toMatchObject({ url: "http://stub.local/v9.0/22222/subscribed_apps" });
  });
  it("refuses when unconfigured, with bad ids, or when Meta rejects the code", async () => {
    await expect(completeEmbeddedSignup({ code: "c", wabaId: "22222", phoneNumberId: "11111" }, {}, scripted().f)).rejects.toBeInstanceOf(CredentialError);
    await expect(completeEmbeddedSignup({ code: "c", wabaId: "x", phoneNumberId: "11111" }, env, scripted().f)).rejects.toBeInstanceOf(CredentialError);
    await expect(completeEmbeddedSignup({ code: "c", wabaId: "22222", phoneNumberId: "11111" }, env, scripted(json(400, { error: {} })).f)).rejects.toBeInstanceOf(CredentialError);
  });
});
