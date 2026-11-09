// Instagram DM inbound, 24 h window rule on outbound, Graph client errors/backoff, token refresh, asset selection.
import { beforeEach, describe, expect, it } from "vitest";
import { CredentialError, TransientError } from "../../core/types";
import * as F from "../__fixtures__/payloads";
import { classifyError, errorFromResponse, MetaApiError } from "../gateway";
import { appSecretProof, makeGraphGateway } from "../graph";
import { handleIgMessage } from "../inbound";
import { makeMockGateway, type MockGateway } from "../mock";
import { dispatchMessage, dispatchQueued } from "../outbound";
import { parseWebhook, type IgMessageEvent } from "../payload";
import { refreshUserToken } from "../token";
import { CONN, fakeDeps } from "./fake-store";

const SECRETS = { access_token: "t", ig_user_id: F.IG };
let deps: ReturnType<typeof fakeDeps>, gw: MockGateway, rejects: string[];
const ev = (o = {}) => parseWebhook(F.igBody(o))[0] as IgMessageEvent;
const inbound = (e = ev(), secrets: Record<string, string> = SECRETS) => handleIgMessage({ deps, conn: CONN, secrets, gateway: gw, reject: (r) => rejects.push(r) }, e);
beforeEach(() => { deps = fakeDeps(); gw = makeMockGateway(); rejects = []; });

describe("inbound", () => {
  it("creates a lead, conversation and message, and emits message.received", async () => {
    expect(await inbound()).toBe("stored");
    expect(deps.store.leads[0]).toMatchObject({ source: "instagram", full_name: "Sample Person", workspace_id: "w-1" });
    expect(deps.store.convs[0]).toMatchObject({ threadId: F.SENDER, lastInboundAt: "2023-11-14T22:13:20.000Z" });
    expect(deps.store.msgs[0]).toMatchObject({ body: "Hello", externalId: "mid.AAA" });
    expect(deps.store.events.map((e) => e.type)).toEqual(["message.received"]);
  });
  it("is idempotent by mid, and a second message reuses the lead and conversation", async () => {
    await inbound();
    expect(await inbound()).toBe("duplicate");
    expect(await inbound(ev({ mid: "mid.BBB", ts: 1700000100000 }))).toBe("stored");
    expect(deps.store.leads).toHaveLength(1);
    expect(deps.store.convs).toHaveLength(1);
    expect(deps.store.msgs).toHaveLength(2);
  });
  it("last_inbound_at never moves backwards", async () => {
    await inbound(ev({ mid: "n", ts: 1700000100000 }));
    await inbound(ev({ mid: "o", ts: 1700000000000 }));
    expect(deps.store.convs[0].lastInboundAt).toBe("2023-11-14T22:15:00.000Z");
  });
  it("refuses an Instagram account this connection did not select", async () => {
    expect(await inbound(ev({ igUser: "999999999" }))).toBe("rejected");
    expect(rejects).toEqual(["ig_account_mismatch"]);
    expect(deps.store.msgs).toHaveLength(0);
  });
  it("a failed profile lookup does not lose the message", async () => {
    gw.igProfile = async () => { throw new Error("x"); };
    expect(await inbound()).toBe("stored");
    expect(deps.store.leads[0].full_name).toBe("Instagram user");
  });
});

describe("outbound and the 24 h window", () => {
  const OPEN = "2026-11-09T01:00:00Z", CLOSED = "2026-11-07T01:00:00Z";   // now is 2026-11-09T05:00Z
  it("sends inside the window", async () => {
    const id = deps.store.addOutbound({ body: "Hi", lastInboundAt: OPEN });
    expect(await dispatchMessage(deps, CONN, gw, id)).toEqual({ kind: "sent", mid: "mock.mid.000001" });
    expect(deps.store.msgs.find((m) => m.id === id)).toMatchObject({ status: "sent", externalId: "mock.mid.000001" });
    expect(deps.store.events.map((e) => e.type)).toEqual(["message.sent"]);
  });
  it("outside the window nothing is sent (no templates on Instagram)", async () => {
    const id = deps.store.addOutbound({ body: "Hi", lastInboundAt: CLOSED });
    expect(await dispatchMessage(deps, CONN, gw, id)).toEqual({ kind: "blocked", reason: "window_closed" });
    expect(deps.store.msgs.find((m) => m.id === id)).toMatchObject({ status: "failed", errorCode: "window_closed" });
    expect(gw.sent).toHaveLength(0);
    expect(await dispatchMessage(deps, CONN, gw, deps.store.addOutbound({ body: "Hi", lastInboundAt: null }))).toEqual({ kind: "blocked", reason: "window_closed" });
  });
  it("blocks empty and over-long text (bytes, not characters)", async () => {
    expect(await dispatchMessage(deps, CONN, gw, deps.store.addOutbound({ body: "  ", lastInboundAt: OPEN }))).toEqual({ kind: "blocked", reason: "empty_text" });
    expect(await dispatchMessage(deps, CONN, gw, deps.store.addOutbound({ body: "ஆ".repeat(400), lastInboundAt: OPEN }))).toEqual({ kind: "blocked", reason: "text_too_long" });
  });
  it("never sends another workspace's or another channel's message", async () => {
    expect(await dispatchMessage(deps, CONN, gw, deps.store.addOutbound({ body: "x", lastInboundAt: OPEN, workspaceId: "w-2" }))).toEqual({ kind: "skipped", why: "other_workspace" });
    expect(await dispatchMessage(deps, CONN, gw, deps.store.addOutbound({ body: "x", lastInboundAt: OPEN, channel: "whatsapp" }))).toEqual({ kind: "skipped", why: "not_instagram" });
  });
  it("a throttle or transient failure keeps the row queued; a dead token propagates; a vendor refusal keeps its code", async () => {
    const id = deps.store.addOutbound({ body: "x", lastInboundAt: OPEN });
    gw.sendIgMessage = async () => { throw new TransientError("busy"); };
    expect((await dispatchMessage(deps, CONN, gw, id)).kind).toBe("retry");
    expect(deps.store.msgs.find((m) => m.id === id)!.status).toBe("queued");
    gw.sendIgMessage = async () => { throw new CredentialError("dead"); };
    await expect(dispatchMessage(deps, CONN, gw, id)).rejects.toBeInstanceOf(CredentialError);
    gw.sendIgMessage = async () => { throw new MetaApiError(551, 0, "x", 400, "recipient_unavailable", false); };
    expect(await dispatchMessage(deps, CONN, gw, id)).toEqual({ kind: "failed", code: 551, failure: "recipient_unavailable" });
    expect(deps.store.msgs.find((m) => m.id === id)).toMatchObject({ status: "failed", errorCode: "551" });
    const d2 = { ...deps, rate: async () => false };
    expect((await dispatchQueued(d2, CONN, makeMockGateway())).retry).toBe(0);
  });
});

describe("Graph client", () => {
  const res = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
  const opts = (f: typeof fetch) => ({ apiBase: "https://graph.test", version: "v1", userToken: "UT", pageToken: "PT", pageId: "1", appSecret: "sec", fetch: f, sleep: async () => {}, random: () => 0.5 });
  it("classifies Meta error codes", () => {
    expect(classifyError(190, 0, 400).failure).toBe("token");
    expect(classifyError(10, 2534022, 400).failure).toBe("window_closed");
    expect(classifyError(17, 0, 400)).toEqual({ failure: "rate_limited", transient: true });
    expect(classifyError(80004, 0, 400).transient).toBe(true);
    expect(classifyError(100, 33, 400).failure).toBe("not_found");
    expect(errorFromResponse(400, { error: { code: 190 } })).toBeInstanceOf(CredentialError);
    expect(errorFromResponse(403, { error: { code: 200 } })).toBeInstanceOf(CredentialError);
  });
  it("retries a rate-limit error reported as HTTP 400, then succeeds; sends bearer token and appsecret_proof", async () => {
    const calls: { url: string; auth: string | null }[] = [];
    let n = 0;
    const f = (async (url: string, init: RequestInit) => { calls.push({ url, auth: new Headers(init.headers).get("authorization") }); return ++n === 1 ? res(400, { error: { code: 4 } }) : res(200, F.graphLead()); }) as unknown as typeof fetch;
    const lead = await makeGraphGateway(opts(f)).getLead(F.LEADGEN);
    expect(lead?.fields.email).toBe("Asha@Example.COM");
    expect(n).toBe(2);
    expect(calls[0].auth).toBe("Bearer PT");
    expect(calls[0].url).toContain(`appsecret_proof=${appSecretProof("PT", "sec")}`);
  });
  it("gives up as TransientError after the retry budget; a deleted lead is null; 190 is a CredentialError", async () => {
    const always = (async () => res(429, {})) as unknown as typeof fetch;
    await expect(makeGraphGateway({ ...opts(always), policy: { maxRetries: 2 } }).getLead("1")).rejects.toBeInstanceOf(TransientError);
    const gone = (async () => res(400, { error: { code: 100, error_subcode: 33 } })) as unknown as typeof fetch;
    expect(await makeGraphGateway(opts(gone)).getLead("1")).toBeNull();
    const dead = (async () => res(400, { error: { code: 190 } })) as unknown as typeof fetch;
    await expect(makeGraphGateway(opts(dead)).insights({ adAccountId: "1", since: "a", until: "b" })).rejects.toBeInstanceOf(CredentialError);
  });
  it("insights requests campaign level, daily increments and the date range, and pages by cursor", async () => {
    let url = "";
    const f = (async (u: string) => { url = u; return res(200, { data: [F.insightRow()], paging: { cursors: { after: "NEXT" }, next: "x" } }); }) as unknown as typeof fetch;
    const p = await makeGraphGateway(opts(f)).insights({ adAccountId: "12", since: "2026-11-01", until: "2026-11-02" });
    expect(p.after).toBe("NEXT");
    expect(url).toContain("/act_12/insights");
    expect(url).toContain("level=campaign");
    expect(url).toContain("time_increment=1");
    expect(decodeURIComponent(url)).toContain('{"since":"2026-11-01","until":"2026-11-02"}');
  });
});

describe("token refresh", () => {
  const env = { META_APP_ID: "a", META_APP_SECRET: "s" };
  it("exchanges the long-lived token and keeps it as the next refresh token", async () => {
    let url = "";
    const f = (async (u: string) => { url = u; return new Response(JSON.stringify({ access_token: "NEW", expires_in: 5184000 }), { status: 200 }); }) as unknown as typeof fetch;
    const r = await refreshUserToken({ connectionId: "c", secrets: { access_token: "OLD", refresh_token: "OLD" }, env, fetchImpl: f });
    expect(r).toEqual({ secrets: { access_token: "NEW", refresh_token: "NEW" }, expiresInSec: 5184000 });
    expect(url).toContain("grant_type=fb_exchange_token");
    expect(url).toContain("fb_exchange_token=OLD");
  });
  it("a dead token is a CredentialError (needs_attention); an outage is transient", async () => {
    const dead = (async () => new Response(JSON.stringify({ error: { code: 190 } }), { status: 400 })) as unknown as typeof fetch;
    await expect(refreshUserToken({ connectionId: "c", secrets: { access_token: "x" }, env, fetchImpl: dead })).rejects.toBeInstanceOf(CredentialError);
    const down = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    await expect(refreshUserToken({ connectionId: "c", secrets: { access_token: "x" }, env, fetchImpl: down })).rejects.toBeInstanceOf(Error);
  });
  it("the sandbox token is refused in production", async () => {
    await expect(refreshUserToken({ connectionId: "c", secrets: { access_token: "meta-mock-token" }, env: { APP_ENV: "production" } })).rejects.toBeInstanceOf(CredentialError);
  });
});
