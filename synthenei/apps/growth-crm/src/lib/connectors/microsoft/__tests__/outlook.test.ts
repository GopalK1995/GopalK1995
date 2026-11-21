// Outlook / Microsoft 365: Graph mappers against published shapes (synthetic fixtures), notification parsing and the subscription
// validation handshake, the Graph client against scripted responses, delta streams (resumable, idempotent, known contacts only, tenant
// scoped), subscription create / renew / recreate, token expiry -> needs_attention, the known-contact send path, admin consent, and the
// hard rules (no tenant / brand / URL specifics in the sources).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_CONNECTORS } from "../../all";
import { refreshIfNeeded } from "../../core/lifecycle";
import { FakeStore, makeDeps } from "../../core/__tests__/fakes";
import { CredentialError, TransientError, type ConnectionRow } from "../../core/types";
import { envConfigured, getConnector } from "../../registry";
import { memoryStore, rateLimit } from "@/lib/security/rate-limit";
import { pickSecret, schemeFor, VERIFIERS } from "../../verify";
import { receivePost, type InboundConnection, type NewInbox, type ReceiveDeps, type ReceiveReq } from "../../verify/receive";
import { MAX_BODY, SUB_MINUTES } from "../constants";
import { makeGraphApi, graphJson } from "../api";
import { sendOutlookMail, subscribeOutlook, type MsActionRuntime } from "../actions";
import { graphGatewayFor, mockGraphFor, resetMockGraph, shouldMock } from "../config";
import { buildAdminConsentUrl, parseAdminConsentReturn, tenantSegment } from "../consent";
import { GraphApiError, GraphResyncError } from "../errors";
import type { GraphGateway } from "../gateway";
import { normaliseEvent, normaliseMessage, parseGraphDate, parseNotifications } from "../mappers";
import { makeMockGraph } from "../mock";
import type { CalendarUpsert, KnownContact, MailUpsert, MsDeps, MsStore, Scope } from "../store";
import { calendarStep, mailStep, type MsStreamCtx } from "../sync";
import { asSubCursor, dropSubscriptions, ensureSubscriptions, notificationUrl } from "../subscriptions";
import { refreshMicrosoftToken } from "../token";
import { answerValidation, verifyClientState } from "../validation";
import { handleGraphEvent } from "../webhook";
import { EVENT, MSG, NOTIFICATION } from "./fixtures";

// ---------- fakes ----------
class FakeMs implements MsStore {
  known = new Map<string, KnownContact>();   // `${tenant}|${workspace}|${email}`
  mails = new Map<string, MailUpsert>();
  events = new Map<string, CalendarUpsert>();
  addKnown(t: string, w: string, email: string, k: Partial<KnownContact> = {}) { this.known.set(`${t}|${w}|${email}`, { leadId: "lead-1", contactId: null, ...k }); }
  async matchContacts(s: { tenantId: string; workspaceId: string }, emails: string[]) {
    const out = new Map<string, KnownContact>();
    for (const e of emails) { const k = this.known.get(`${s.tenantId}|${s.workspaceId}|${e}`); if (k) out.set(e, k); }
    return out;
  }
  async upsertMail(m: MailUpsert) { const k = `${m.connectionId}|${m.externalId}`; if (this.mails.has(k)) return "unchanged" as const; this.mails.set(k, m); return "created" as const; }
  async upsertCalendarEvent(r: CalendarUpsert) {
    const k = `${r.connectionId}|${r.externalId}`, cur = this.events.get(k);
    if (cur?.status === "cancelled" && r.status !== "cancelled") return { outcome: "stale" as const };
    this.events.set(k, r); return { outcome: cur ? ("updated" as const) : ("created" as const) };
  }
  async cancelCalendarEvent(s: Scope, id: string) {
    const k = `${s.connectionId}|${id}`, cur = this.events.get(k);
    if (!cur) return "missing" as const;
    if (cur.status === "cancelled") return "unchanged" as const;
    this.events.set(k, { ...cur, status: "cancelled" }); return "cancelled" as const;
  }
}
const NOW = new Date("2026-11-09T05:00:00Z");
const CONN: ConnectionRow = { id: "c-1", tenantId: "t-1", workspaceId: "w-1", connectorId: "outlook", mode: "live", status: "connected", settings: {}, credentialSecretId: "sec-x", webhookSecretId: null, tokenExpiresAt: null };
const log = { info() {}, warn() {}, error() {} };
function setup(clock = NOW) {
  const ms = new FakeMs();
  let t = clock.getTime();
  const deps: MsDeps = { store: ms, log, now: () => new Date(t) };
  const rejects: string[] = [];
  const ctx = (gateway: GraphGateway, conn: ConnectionRow = CONN): MsStreamCtx => ({ deps, conn, gateway, reject: (r) => rejects.push(r) });
  return { ms, deps, ctx, rejects, advance: (ms2: number) => { t += ms2; } };
}
const gw = (over: Partial<GraphGateway> = {}): GraphGateway => ({ ...makeMockGraph(), ...over });
const page = <T>(items: T[], more: { next?: string; delta?: string }) => ({ items, ...more });

// ---------- mappers ----------
describe("normaliseMessage", () => {
  it("maps a message: lower-cased addresses, one-line subject and preview, thread id, time", () => {
    expect(normaliseMessage(MSG({ subject: "Re:\r\n proposal  " }))).toEqual({
      kind: "message",
      row: { externalId: "AAMkAD-msg-1=", threadId: "AAQkAD-conv-1=", subject: "Re: proposal", preview: "Thanks, we would like to go ahead.", from: "asha.k@client.example.invalid", to: ["owner@firm.example.invalid"], cc: [], at: "2026-11-02T09:00:00.000Z" },
    });
  });
  it("keeps only plain SMTP addresses (Exchange X500 paths and empty values become null / are dropped)", () => {
    const r = normaliseMessage(MSG({ from: { emailAddress: { address: "/O=EXCHANGELABS/OU=GROUP/CN=RECIPIENTS/CN=abc" } }, toRecipients: [{ emailAddress: { address: " B@x.example.invalid " } }, { emailAddress: {} }, { emailAddress: { address: "b@x.example.invalid" } }] }));
    expect(r).toMatchObject({ kind: "message", row: { from: null, to: ["b@x.example.invalid"] } });
  });
  it("falls back to the message id for the thread and to sentDateTime for the time", () => {
    expect(normaliseMessage(MSG({ conversationId: undefined, receivedDateTime: undefined }))).toMatchObject({ kind: "message", row: { threadId: "AAMkAD-msg-1=", at: "2026-11-02T08:59:58.000Z" } });
  });
  it("skips drafts, reports Outlook deletions, rejects unreadable ids and dates instead of inventing them", () => {
    expect(normaliseMessage(MSG({ isDraft: true }))).toEqual({ kind: "skip", why: "draft" });
    expect(normaliseMessage({ id: "AAMk-del=", "@removed": { reason: "deleted" } })).toEqual({ kind: "removed", externalId: "AAMk-del=" });
    expect(normaliseMessage(MSG({ id: "has space/slash" }))).toEqual({ kind: "reject", reason: "missing_id" });
    expect(normaliseMessage(MSG({ receivedDateTime: "nope", sentDateTime: undefined }))).toEqual({ kind: "reject", reason: "bad_date" });
  });
});

describe("normaliseEvent", () => {
  it("maps a UTC event with its attendees", () => {
    expect(normaliseEvent(EVENT())).toEqual({ kind: "event", row: { externalId: "AAMkAD-evt-1=", title: "Discovery call", startsAt: "2026-11-10T09:30:00.000Z", endsAt: "2026-11-10T10:00:00.000Z", status: "confirmed", attendees: ["asha.k@client.example.invalid"] } });
  });
  it("cancelled and tentative statuses", () => {
    expect(normaliseEvent(EVENT({ isCancelled: true }))).toMatchObject({ row: { status: "cancelled" } });
    expect(normaliseEvent(EVENT({ showAs: "tentative" }))).toMatchObject({ row: { status: "tentative" } });
    expect(normaliseEvent(EVENT({ responseStatus: { response: "tentativelyAccepted" } }))).toMatchObject({ row: { status: "tentative" } });
  });
  it("deletions, non-UTC zones (the Prefer header was ignored), reversed times and bad ids are handled, not guessed", () => {
    expect(normaliseEvent({ id: "AAMk-gone=", "@removed": { reason: "deleted" } })).toEqual({ kind: "removed", externalId: "AAMk-gone=" });
    expect(normaliseEvent(EVENT({ start: { dateTime: "2026-11-10T15:00:00.0000000", timeZone: "India Standard Time" }, end: { dateTime: "2026-11-10T16:00:00.0000000", timeZone: "India Standard Time" } }))).toEqual({ kind: "reject", reason: "unsupported_timezone" });
    expect(normaliseEvent(EVENT({ end: { dateTime: "2026-11-10T09:00:00.0000000", timeZone: "UTC" } }))).toEqual({ kind: "reject", reason: "end_before_start" });
    expect(normaliseEvent(EVENT({ start: undefined }))).toEqual({ kind: "reject", reason: "bad_date" });
    expect(normaliseEvent(EVENT({ id: undefined }))).toEqual({ kind: "reject", reason: "missing_id" });
  });
  it("parses Graph's seven-digit fraction and rejects non-dates", () => {
    expect(parseGraphDate({ dateTime: "2026-11-10T09:30:00.5000000", timeZone: "UTC" })).toBe("2026-11-10T09:30:00.500Z");
    expect(parseGraphDate({ dateTime: "2026-11-10 09:30", timeZone: "UTC" })).toBeNull();
  });
});

describe("parseNotifications", () => {
  const body = (...v: unknown[]) => JSON.stringify({ value: v });
  it("reads change and lifecycle notifications", () => {
    const r = parseNotifications(body(NOTIFICATION(), NOTIFICATION({ changeType: "deleted", resourceData: { "@odata.type": "#Microsoft.Graph.Event", id: "AAMkAD-evt-1=" } }), { subscriptionId: "7f105c8f-0000-4000-8000-000000000001", clientState: "x", lifecycleEvent: "reauthorizationRequired" }));
    expect(r.dropped).toBe(0);
    expect(r.events).toEqual([
      { kind: "change", subscriptionId: "7f105c8f-0000-4000-8000-000000000001", changeType: "created", type: "message", id: "AAMkAD-msg-1=" },
      { kind: "change", subscriptionId: "7f105c8f-0000-4000-8000-000000000001", changeType: "deleted", type: "event", id: "AAMkAD-evt-1=" },
      { kind: "lifecycle", subscriptionId: "7f105c8f-0000-4000-8000-000000000001", event: "reauthorizationRequired" },
    ]);
  });
  it("drops anything unreadable: odd ids, unknown change types, unknown resources, unknown lifecycle events; bad JSON gives nothing", () => {
    const r = parseNotifications(body(NOTIFICATION({ resourceData: { "@odata.type": "#Microsoft.Graph.Message", id: "../../me" } }), NOTIFICATION({ changeType: "exploded" }), NOTIFICATION({ resourceData: { "@odata.type": "#Microsoft.Graph.Contact", id: "AAMk=" } }), { subscriptionId: "s-1", lifecycleEvent: "weird" }, { subscriptionId: "bad id!" }, null));
    expect(r).toEqual({ events: [], dropped: 6 });
    expect(parseNotifications("not json")).toEqual({ events: [], dropped: 0 });
    expect(parseNotifications("{}")).toEqual({ events: [], dropped: 0 });
  });
});

// ---------- validation handshake and clientState ----------
describe("subscription validation", () => {
  it("echoes Graph's validationToken as text/plain 200 and nothing else", () => {
    const token = "Validation: Testing client application reachability for subscription Request-Id: 8a1c0f4e-0000-4000-8000-000000000003";
    expect(answerValidation(token)).toEqual({ status: 200, text: token, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
  });
  it("is not a handshake without the parameter; a token that could carry markup, control characters or is huge is refused", () => {
    expect(answerValidation(null)).toBeNull();
    expect(answerValidation(undefined)).toBeNull();
    for (const bad of ["", "<script>alert(1)</script>", "a\r\nSet-Cookie: x=1", "x".repeat(2049), "tab\there", "quo\"te"]) expect(answerValidation(bad)?.status, JSON.stringify(bad)).toBe(400);
  });
  const B = (cs: unknown[]) => JSON.stringify({ value: cs.map((clientState) => NOTIFICATION({ clientState })) });
  it("accepts a delivery only when EVERY notification carries this connection's clientState", () => {
    const h = new Headers();
    expect(verifyClientState(B(["state-secret-0123456789"]), h, "state-secret-0123456789")).toBe(true);
    expect(verifyClientState(B(["state-secret-0123456789", "state-secret-0123456789"]), h, "state-secret-0123456789")).toBe(true);
    expect(verifyClientState(B(["state-secret-0123456789", "other"]), h, "state-secret-0123456789")).toBe(false);
    expect(verifyClientState(B(["wrong"]), h, "state-secret-0123456789")).toBe(false);
    expect(verifyClientState(B([undefined]), h, "state-secret-0123456789")).toBe(false);
    expect(verifyClientState(B(["x"]), h, "")).toBe(false);
    expect(verifyClientState("{}", h, "s")).toBe(false);
    expect(verifyClientState(JSON.stringify({ value: [] }), h, "s")).toBe(false);
    expect(verifyClientState("not json", h, "s")).toBe(false);
  });
  it("is registered as the `graph` scheme for the outlook connector and reads the Vault webhook secret", () => {
    expect(schemeFor("outlook")).toBe("graph");
    expect(VERIFIERS.graph).toBe(verifyClientState);
    expect(pickSecret(JSON.stringify({ webhook_secret: "state-secret-0123456789" }))).toBe("state-secret-0123456789");
  });
});

describe("webhook receiver: Graph handshake and delivery", () => {
  const ID = "5f0c1d52-8a7e-4b1c-9d3e-0a1b2c3d4e5f", STATE = "state-secret-0123456789", TOKEN = "Validation: Testing client application reachability for subscription Request-Id: 1";
  function rig() {
    const rows: (NewInbox & { id: number })[] = [], queued: number[] = [], rl = memoryStore();
    const conn: InboundConnection = { id: ID, tenantId: "t-1", workspaceId: "w-1", connectorId: "outlook", status: "connected", webhookSecretId: "ws-1", credentialSecretId: "cr-1" };
    const deps: ReceiveDeps = {
      enabled: true, now: () => 1_700_000_000_000, usable: () => true,
      store: { getConnection: async (id) => (id === ID ? conn : null), insertInbox: async (n) => { const id = rows.length + 1; rows.push({ ...n, id }); return { id, duplicate: false }; }, deleteInbox: async () => {} },
      getSecret: async (id) => (id === "ws-1" ? JSON.stringify({ webhook_secret: STATE }) : null),
      rate: (scope, id, cfg) => Promise.resolve(rateLimit(scope, id, cfg, { store: rl, now: 1_700_000_000_000 })),
      enqueue: async (_c, id) => { queued.push(id); }, log: { warn() {}, error() {} },
    };
    const req = (qs: string, body: string): ReceiveReq => { const url = `https://app.test/api/hooks/outlook/${ID}${qs}`; return { method: "POST", connector: "outlook", connection: ID, url, query: new URL(url).searchParams, headers: new Headers(), contentLength: null, ip: "1.2.3.4", readBody: async () => body }; };
    return { deps, rows, queued, req };
  }
  it("answers the validationToken handshake with the token as text/plain and stores nothing", async () => {
    const { deps, rows, queued, req } = rig();
    const r = await receivePost(deps, req(`?validationToken=${encodeURIComponent(TOKEN)}`, ""));
    expect(r).toMatchObject({ status: 200, text: TOKEN, headers: { "content-type": "text/plain; charset=utf-8" } });
    expect(rows).toHaveLength(0); expect(queued).toHaveLength(0);
  });
  it("accepts a delivery carrying our clientState and queues it; rejects a wrong one (401, stored unverified, never queued)", async () => {
    const { deps, rows, queued, req } = rig();
    expect((await receivePost(deps, req("", JSON.stringify({ value: [NOTIFICATION({ clientState: STATE })] })))).status).toBe(200);
    expect(rows[0]).toMatchObject({ signatureOk: true, connectorId: "outlook", workspaceId: "w-1" });
    expect(queued).toEqual([1]);
    expect((await receivePost(deps, req("", JSON.stringify({ value: [NOTIFICATION({ clientState: "guess" })] })))).status).toBe(401);
    expect(queued).toEqual([1]);
  });
  it("a handshake for an unknown connection is a 404, not an echo", async () => {
    const { deps, req } = rig();
    const r = req(`?validationToken=abc`, ""); r.connection = "00000000-0000-4000-8000-000000000009";
    expect((await receivePost(deps, r)).status).toBe(404);
  });
});

// ---------- Graph client ----------
const ok = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(b === undefined ? null : JSON.stringify(b), { status, headers });
function scripted(...res: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); const r = res.shift(); if (!r) throw new Error("script exhausted"); if (r instanceof Error) throw r; return r; }) as unknown as typeof fetch;
  return { f, calls };
}
const api = (f: typeof fetch) => makeGraphApi({ token: "tok", base: "https://graph.test/v1.0/", fetch: f, sleep: async () => {}, random: () => 0 });

describe("Graph client", () => {
  it("reads the signed-in user with a bearer token, UTC and page-size preferences", async () => {
    const s = scripted(ok({ id: "u1", mail: "owner@firm.example.invalid", displayName: "Owner" }));
    expect(await api(s.f).profile()).toEqual({ id: "u1", mail: "owner@firm.example.invalid", name: "Owner" });
    expect(s.calls[0].url).toBe("https://graph.test/v1.0/me?$select=id,displayName,mail,userPrincipalName");
    const h = s.calls[0].init.headers as Record<string, string>;
    expect(h.authorization).toBe("Bearer tok");
    expect(h.prefer).toContain('outlook.timezone="UTC"');
  });
  it("builds the first delta URLs for mail folders and the calendar window", async () => {
    const s = scripted(ok({ value: [] }), ok({ value: [] }), ok({ value: [] }));
    const g = api(s.f);
    await g.deltaMessages("inbox", null, "2026-10-10T00:00:00.000Z");
    await g.deltaMessages("sent", null, "2026-10-10T00:00:00.000Z");
    await g.deltaEvents(null, { startIso: "2026-10-10T00:00:00.000Z", endIso: "2027-05-08T00:00:00.000Z" });
    expect(s.calls[0].url).toContain("/me/mailFolders/inbox/messages/delta?$select=");
    expect(s.calls[0].url).toContain("$filter=receivedDateTime%20ge%202026-10-10T00%3A00%3A00.000Z");
    expect(s.calls[1].url).toContain("/me/mailFolders/sentitems/messages/delta");
    expect(s.calls[2].url).toContain("/me/calendarView/delta?startDateTime=2026-10-10T00%3A00%3A00.000Z&endDateTime=2027-05-08T00%3A00%3A00.000Z");
  });
  it("returns next and delta links and follows only links under its own base (a foreign link can never receive the token)", async () => {
    const s = scripted(ok({ value: [{ id: "a" }], "@odata.nextLink": "https://graph.test/v1.0/next" }));
    expect(await api(s.f).deltaMessages("inbox", "https://graph.test/v1.0/prev", "x")).toEqual({ items: [{ id: "a" }], next: "https://graph.test/v1.0/next", delta: undefined });
    expect(s.calls[0].url).toBe("https://graph.test/v1.0/prev");
    const s2 = scripted();
    await expect(api(s2.f).deltaMessages("inbox", "https://evil.example.invalid/steal", "x")).rejects.toBeInstanceOf(GraphResyncError);
    await expect(api(s2.f).deltaEvents("https://graph.test.evil.example.invalid/x", { startIso: "a", endIso: "b" })).rejects.toBeInstanceOf(GraphResyncError);
    expect(s2.calls).toHaveLength(0);
  });
  it("retries throttling honouring Retry-After and 5xx with backoff, then gives up as transient", async () => {
    const sleeps: number[] = [];
    const s = scripted(ok({ error: { code: "TooManyRequests" } }, 429, { "retry-after": "2" }), ok({}, 503), ok({ value: [] }));
    const g = makeGraphApi({ token: "t", base: "https://graph.test/v1.0", fetch: s.f, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0 });
    await g.deltaEvents(null, { startIso: "a", endIso: "b" });
    expect(s.calls).toHaveLength(3);
    expect(sleeps[0]).toBe(2000);
    const dead = scripted(...Array.from({ length: 6 }, () => ok({}, 503)));
    await expect(graphJson({ method: "GET", url: "https://graph.test/x", token: "t" }, { fetch: dead.f, sleep: async () => {}, random: () => 0 })).rejects.toBeInstanceOf(TransientError);
    const net = scripted(...Array.from({ length: 6 }, () => new Error("ECONNRESET")));
    await expect(graphJson({ method: "GET", url: "https://graph.test/x", token: "t" }, { fetch: net.f, sleep: async () => {}, random: () => 0 })).rejects.toBeInstanceOf(TransientError);
  });
  it("401 and 403 need the owner (CredentialError); a mailbox-less account says so; 410 asks for a resync; 404 on a single item is null", async () => {
    await expect(api(scripted(ok({ error: { code: "InvalidAuthenticationToken" } }, 401)).f).profile()).rejects.toBeInstanceOf(CredentialError);
    await expect(api(scripted(ok({ error: { code: "ErrorAccessDenied" } }, 403)).f).deltaEvents(null, { startIso: "a", endIso: "b" })).rejects.toBeInstanceOf(CredentialError);
    await expect(api(scripted(ok({ error: { code: "MailboxNotEnabledForRESTAPI" } }, 404)).f).deltaMessages("inbox", null, "x")).rejects.toThrow(/no Exchange Online mailbox/);
    await expect(api(scripted(ok({ error: { code: "SyncStateNotFound" } }, 410)).f).deltaMessages("inbox", null, "x")).rejects.toBeInstanceOf(GraphResyncError);
    expect(await api(scripted(ok({ error: { code: "ErrorItemNotFound" } }, 404)).f).getMessage("AAMk-gone=")).toBeNull();
    const none = scripted();
    expect(await api(none.f).getMessage("../../etc")).toBeNull();
    expect(none.calls).toHaveLength(0);
  });
  it("errors carry the status only, never the vendor text", async () => {
    const e = await api(scripted(ok({ error: { code: "BadThing", message: "secret subject line leaked" } }, 400)).f).profile().catch((x) => x);
    expect(e).toBeInstanceOf(GraphApiError);
    expect(String(e.message)).toBe("Microsoft Graph error (HTTP 400)");
  });
  it("sends plain text (never HTML) and saves to Sent Items; subscriptions are created, renewed and deleted at the right URLs", async () => {
    const s = scripted(ok(undefined, 202), ok({ id: "sub-1", expirationDateTime: "2026-11-12T01:00:00Z" }, 201), ok({ id: "sub-1", expirationDateTime: "2026-11-12T01:00:00Z" }), ok(undefined, 204), ok({ error: { code: "ErrorItemNotFound" } }, 404));
    const g = api(s.f);
    await g.sendMail({ to: ["a@x.example.invalid"], subject: "Hi", body: "<b>bold</b>" });
    expect(JSON.parse(String(s.calls[0].init.body))).toEqual({ message: { subject: "Hi", body: { contentType: "Text", content: "<b>bold</b>" }, toRecipients: [{ emailAddress: { address: "a@x.example.invalid" } }] }, saveToSentItems: true });
    expect(await g.createSubscription({ resource: "me/events", notificationUrl: "https://app.example.invalid/h", expiresAt: "2026-11-12T01:00:00.000Z", clientState: "cs" })).toEqual({ id: "sub-1", expiresAt: "2026-11-12T01:00:00.000Z" });
    expect(JSON.parse(String(s.calls[1].init.body))).toMatchObject({ changeType: "created,updated,deleted", resource: "me/events", clientState: "cs", notificationUrl: "https://app.example.invalid/h", lifecycleNotificationUrl: "https://app.example.invalid/h" });
    await g.renewSubscription("sub-1", "2026-11-13T01:00:00.000Z");
    expect(s.calls[2]).toMatchObject({ url: "https://graph.test/v1.0/subscriptions/sub-1", init: { method: "PATCH" } });
    await g.deleteSubscription("sub-1");
    await g.deleteSubscription("sub-gone");   // already gone: fine
    expect(s.calls[3].init.method).toBe("DELETE");
  });
});

// ---------- streams ----------
describe("mail streams: known contacts only", () => {
  it("stores inbound mail from a known sender, skips unknown senders and drafts, and is idempotent", async () => {
    const { ms, ctx, rejects } = setup();
    ms.addKnown("t-1", "w-1", "asha.k@client.example.invalid", { leadId: "lead-9", contactId: "con-3" });
    const items = [MSG(), MSG({ id: "AAMkAD-msg-2=", from: { emailAddress: { address: "stranger@elsewhere.example.invalid" } } }), MSG({ id: "AAMkAD-msg-3=", isDraft: true }), MSG({ id: "bad id" })];
    const g = gw({ deltaMessages: async () => page(items, { delta: "https://graph.test/d1" }) });
    const r = await mailStep(ctx(g), "inbox", null);
    expect(r).toMatchObject({ done: true, rowsIn: 4, rowsRejected: 1, cursor: { delta: "https://graph.test/d1" }, sample: { stored: 1, skippedUnknown: 2 } });
    expect(rejects).toEqual(["missing_id"]);
    expect([...ms.mails.values()]).toEqual([{ tenantId: "t-1", workspaceId: "w-1", connectionId: "c-1", threadId: "AAQkAD-conv-1=", externalId: "AAMkAD-msg-1=", direction: "inbound", subject: "Re: proposal", preview: "Thanks, we would like to go ahead.", at: "2026-11-02T09:00:00.000Z", leadId: "lead-9", contactId: "con-3" }]);
    await mailStep(ctx(g), "inbox", null);
    expect(ms.mails.size).toBe(1);
  });
  it("sent mail is stored when at least one recipient is known and is marked outbound", async () => {
    const { ms, ctx } = setup();
    ms.addKnown("t-1", "w-1", "asha.k@client.example.invalid");
    const sent = MSG({ id: "AAMkAD-sent-1=", from: { emailAddress: { address: "owner@firm.example.invalid" } }, toRecipients: [{ emailAddress: { address: "nobody@x.example.invalid" } }, { emailAddress: { address: "asha.k@client.example.invalid" } }] });
    const none = MSG({ id: "AAMkAD-sent-2=", from: { emailAddress: { address: "owner@firm.example.invalid" } }, toRecipients: [{ emailAddress: { address: "nobody@x.example.invalid" } }] });
    await mailStep(ctx(gw({ deltaMessages: async () => page([sent, none], { delta: "d" }) })), "sent", null);
    expect([...ms.mails.values()].map((m) => [m.externalId, m.direction])).toEqual([["AAMkAD-sent-1=", "outbound"]]);
  });
  it("tenant isolation: a contact known to another workspace or tenant is unknown here", async () => {
    const { ms, ctx } = setup();
    ms.addKnown("t-1", "w-2", "asha.k@client.example.invalid");
    ms.addKnown("t-2", "w-1", "asha.k@client.example.invalid");
    const r = await mailStep(ctx(gw({ deltaMessages: async () => page([MSG()], { delta: "d" }) })), "inbox", null);
    expect(r.sample).toMatchObject({ stored: 0, skippedUnknown: 1 });
    expect(ms.mails.size).toBe(0);
  });
  it("resumes by next link and goes incremental by delta link; the backfill window start is kept", async () => {
    const { ms, ctx } = setup();
    ms.addKnown("t-1", "w-1", "asha.k@client.example.invalid");
    const links: (string | null)[] = [], sinces: string[] = [];
    let n = 0;
    const g = gw({ deltaMessages: async (_f, link, since) => { links.push(link); sinces.push(since); n++; return n < 7 ? page([MSG({ id: `AAMkAD-p${n}=` })], { next: `https://graph.test/p${n}` }) : page([], { delta: "https://graph.test/final" }); } });
    const first = await mailStep(ctx(g), "inbox", null);
    expect(first).toMatchObject({ done: false, cursor: { next: "https://graph.test/p5" } });
    expect(links).toEqual([null, "https://graph.test/p1", "https://graph.test/p2", "https://graph.test/p3", "https://graph.test/p4"]);
    expect(sinces[0]).toBe("2026-10-10T05:00:00.000Z");   // 30 days before the injected clock
    const second = await mailStep(ctx(g), "inbox", first.cursor);
    expect(second).toMatchObject({ done: true, cursor: { delta: "https://graph.test/final", since: "2026-10-10T05:00:00.000Z" } });
    expect(links[5]).toBe("https://graph.test/p5");
    const third = await mailStep(ctx(g), "inbox", second.cursor);   // incremental
    expect(links[7 - 1 + 1]).toBe("https://graph.test/final");
    expect(third.done).toBe(true);
    expect(ms.mails.size).toBe(6);
  });
  it("an expired delta (410) restarts from scratch without losing the window start", async () => {
    const { ctx } = setup();
    const g = gw({ deltaMessages: async () => { throw new GraphResyncError(); } });
    expect(await mailStep(ctx(g), "inbox", { delta: "https://graph.test/old", since: "2026-10-01T00:00:00.000Z" })).toMatchObject({ done: false, cursor: { since: "2026-10-01T00:00:00.000Z" }, sample: { resync: true } });
  });
  it("a rejected credential is not swallowed (the framework turns it into needs_attention)", async () => {
    const { ctx } = setup();
    await expect(mailStep(ctx(gw({ deltaMessages: async () => { throw new CredentialError("no"); } })), "inbox", null)).rejects.toBeInstanceOf(CredentialError);
  });
});

describe("calendar stream", () => {
  it("syncs events into calendar_events linked to a known lead by attendee, cancels deleted events, never resurrects, rejects non-UTC", async () => {
    const { ms, ctx, rejects } = setup();
    ms.addKnown("t-1", "w-1", "asha.k@client.example.invalid", { leadId: "lead-9" });
    const windows: unknown[] = [];
    const items = [EVENT(), EVENT({ id: "AAMkAD-evt-2=", subject: "Internal", attendees: [] }), EVENT({ id: "AAMkAD-evt-3=", start: { dateTime: "2026-11-10T15:00:00.0000000", timeZone: "Pacific Standard Time" }, end: { dateTime: "2026-11-10T16:00:00.0000000", timeZone: "Pacific Standard Time" } })];
    const g = gw({ deltaEvents: async (_l, w) => { windows.push(w); return page(items, { delta: "https://graph.test/cal-d" }); } });
    const r = await calendarStep(ctx(g), null);
    expect(r).toMatchObject({ done: true, rowsIn: 3, rowsRejected: 1, cursor: { delta: "https://graph.test/cal-d" } });
    expect(rejects).toEqual(["unsupported_timezone"]);
    expect(windows[0]).toEqual({ startIso: "2026-10-10T05:00:00.000Z", endIso: "2027-05-08T05:00:00.000Z" });
    expect(ms.events.get("c-1|AAMkAD-evt-1=")).toMatchObject({ title: "Discovery call", status: "confirmed", leadId: "lead-9", tenantId: "t-1", workspaceId: "w-1" });
    expect(ms.events.get("c-1|AAMkAD-evt-2=")).toMatchObject({ leadId: null });
    // Outlook deletes event 1; a later stale update must not bring it back
    await calendarStep(ctx(gw({ deltaEvents: async () => page([{ id: "AAMkAD-evt-1=", "@removed": { reason: "deleted" } }, { id: "AAMkAD-never=", "@removed": { reason: "deleted" } }], { delta: "d2" }) })), r.cursor);
    expect(ms.events.get("c-1|AAMkAD-evt-1=")?.status).toBe("cancelled");
    expect(ms.events.has("c-1|AAMkAD-never=")).toBe(false);
    const late = await ms.upsertCalendarEvent({ ...ms.events.get("c-1|AAMkAD-evt-1=")!, status: "confirmed" });
    expect(late.outcome).toBe("stale");
  });
  it("renews its delta window after 60 days so the window keeps covering today", async () => {
    const { ctx, advance } = setup();
    const links: (string | null)[] = [];
    const g = gw({ deltaEvents: async (l) => { links.push(l); return page([], { delta: "https://graph.test/cal" }); } });
    const a = await calendarStep(ctx(g), null);
    await calendarStep(ctx(g), a.cursor);
    advance(61 * 86400e3);
    await calendarStep(ctx(g), a.cursor);
    expect(links).toEqual([null, "https://graph.test/cal", null]);
  });
});

// ---------- webhook handling ----------
describe("handleGraphEvent", () => {
  const hook = (ms: FakeMs, g: GraphGateway) => ({ deps: { store: ms, log, now: () => NOW } as MsDeps, conn: CONN, gateway: g, reject: () => {} });
  it("fetches the changed message with our own token and stores it (direction from the mailbox address)", async () => {
    const ms = new FakeMs(); ms.addKnown("t-1", "w-1", "asha.k@client.example.invalid");
    const asked: string[] = [];
    const g = gw({ getMessage: async (id) => { asked.push(id); return MSG(); } });
    await handleGraphEvent(hook(ms, g), { kind: "change", subscriptionId: "s", changeType: "created", type: "message", id: "AAMkAD-msg-1=" });
    expect(asked).toEqual(["AAMkAD-msg-1="]);
    expect([...ms.mails.values()][0]).toMatchObject({ direction: "inbound", externalId: "AAMkAD-msg-1=" });
    const own = MSG({ id: "AAMkAD-out=", from: { emailAddress: { address: "OWNER@firm.example.invalid" } }, toRecipients: [{ emailAddress: { address: "asha.k@client.example.invalid" } }] });
    await handleGraphEvent(hook(ms, gw({ getMessage: async () => own, profile: async () => ({ id: "u", mail: "owner@firm.example.invalid", name: null }) })), { kind: "change", subscriptionId: "s", changeType: "created", type: "message", id: "AAMkAD-out=" });
    expect(ms.mails.get("c-1|AAMkAD-out=")?.direction).toBe("outbound");
  });
  it("ignores deleted mail and vanished items; deleted events cancel the row we hold", async () => {
    const ms = new FakeMs();
    const g = gw({ getMessage: async () => null, getEvent: async () => null });
    await handleGraphEvent(hook(ms, g), { kind: "change", subscriptionId: "s", changeType: "deleted", type: "message", id: "AAMk-m=" });
    await handleGraphEvent(hook(ms, g), { kind: "change", subscriptionId: "s", changeType: "updated", type: "message", id: "AAMk-m=" });
    expect(ms.mails.size).toBe(0);
    await ms.upsertCalendarEvent({ tenantId: "t-1", workspaceId: "w-1", connectionId: "c-1", externalId: "AAMk-e=", startsAt: "2026-11-10T09:00:00.000Z", endsAt: "2026-11-10T10:00:00.000Z", title: "x", status: "confirmed", leadId: null });
    await handleGraphEvent(hook(ms, g), { kind: "change", subscriptionId: "s", changeType: "deleted", type: "event", id: "AAMk-e=" });
    expect(ms.events.get("c-1|AAMk-e=")?.status).toBe("cancelled");
  });
  it("stores a changed event and counts a rejected one", async () => {
    const ms = new FakeMs(); const rej: string[] = [];
    const base = hook(ms, gw({ getEvent: async () => EVENT() }));
    await handleGraphEvent(base, { kind: "change", subscriptionId: "s", changeType: "updated", type: "event", id: "AAMkAD-evt-1=" });
    expect(ms.events.size).toBe(1);
    await handleGraphEvent({ ...hook(ms, gw({ getEvent: async () => EVENT({ id: "AAMkAD-evt-9=", end: { dateTime: "2020-01-01T00:00:00.0000000", timeZone: "UTC" } }) })), reject: (r) => rej.push(r) }, { kind: "change", subscriptionId: "s", changeType: "updated", type: "event", id: "AAMkAD-evt-9=" });
    expect(rej).toEqual(["end_before_start"]);
  });
  it("reauthorizationRequired extends the subscription now; a refused renewal does not fail the delivery", async () => {
    const ms = new FakeMs(); const renewed: [string, string][] = [];
    await handleGraphEvent(hook(ms, gw({ renewSubscription: async (id, at) => { renewed.push([id, at]); return { id, expiresAt: at }; } })), { kind: "lifecycle", subscriptionId: "sub-1", event: "reauthorizationRequired" });
    expect(renewed).toEqual([["sub-1", new Date(NOW.getTime() + SUB_MINUTES * 60_000).toISOString()]]);
    await expect(handleGraphEvent(hook(ms, gw({ renewSubscription: async () => { throw new GraphApiError(404, "not_found", "x"); } })), { kind: "lifecycle", subscriptionId: "sub-1", event: "reauthorizationRequired" })).resolves.toBeUndefined();
    await expect(handleGraphEvent(hook(ms, gw()), { kind: "lifecycle", subscriptionId: "sub-1", event: "subscriptionRemoved" })).resolves.toBeUndefined();
  });
});

// ---------- subscriptions ----------
describe("subscriptions: create, renew, recreate", () => {
  const ENV = { APP_BASE_URL: "https://crm.example.invalid/" };
  function rig() {
    const s = setup(), d = makeDeps();
    d.store.conns.set(CONN.id, { ...CONN });
    const created: { resource: string; notificationUrl: string; expiresAt: string; clientState: string }[] = [], renewed: string[] = [];
    let n = 0;
    const g = gw({
      kind: "api",
      createSubscription: async (r) => { created.push(r); return { id: `sub-${++n}`, expiresAt: r.expiresAt }; },
      renewSubscription: async (id, at) => { renewed.push(id); return { id, expiresAt: at }; },
    });
    const run = (cursor: unknown, over: Partial<{ env: Record<string, string>; gateway: GraphGateway }> = {}) => ensureSubscriptions({ rd: d.deps, deps: s.deps, gateway: over.gateway ?? g, conn: { ...CONN }, env: over.env ?? ENV, cursor });
    return { ...s, d, created, renewed, run, g };
  }
  it("creates one subscription per resource with the capped lifetime and a Vault-held clientState the receiver can verify against", async () => {
    const { run, created, d } = rig();
    const r = await run(null);
    expect(r).toMatchObject({ created: 3, renewed: 0, cursor: { status: "active" } });
    expect(created.map((c) => c.resource)).toEqual(["me/mailFolders('inbox')/messages", "me/mailFolders('sentitems')/messages", "me/events"]);
    for (const c of created) {
      expect(c.notificationUrl).toBe("https://crm.example.invalid/api/hooks/outlook/c-1");
      expect(Date.parse(c.expiresAt) - NOW.getTime()).toBe(SUB_MINUTES * 60_000);
      expect(SUB_MINUTES).toBeLessThanOrEqual(4230);
    }
    const state = created[0].clientState;
    expect(new Set(created.map((c) => c.clientState))).toEqual(new Set([state]));
    expect(state.length).toBeGreaterThanOrEqual(32);
    const conn = (await d.store.getConnection("c-1"))!;
    expect(conn.webhookSecretId).toBeTruthy();
    expect(pickSecret(await d.vault.getSecret(conn.webhookSecretId!))).toBe(state);
    expect(JSON.stringify(r.cursor)).not.toContain(state);   // the secret is not in the cursor
  });
  it("does nothing while every subscription has more than 12 hours left, then renews each (same clientState kept)", async () => {
    const { run, created, renewed, advance } = rig();
    const first = await run(null);
    expect((await run(first.cursor)).created + (await run(first.cursor)).renewed).toBe(0);
    advance((SUB_MINUTES * 60_000) - 11 * 3600_000);   // 11 hours left
    const again = await run(first.cursor);
    expect(again).toMatchObject({ created: 0, renewed: 3 });
    expect(renewed).toEqual(["sub-1", "sub-2", "sub-3"]);
    expect(created).toHaveLength(3);
    for (const e of Object.values(again.cursor.subs)) expect(Date.parse(e.expiresAt)).toBeGreaterThan(NOW.getTime() + 60 * 3600_000);
  });
  it("recreates a subscription Graph dropped (404 on renewal) and records one Graph refuses without failing the rest", async () => {
    const { run, created, advance, g } = rig();
    const first = await run(null);
    advance(SUB_MINUTES * 60_000);
    const dropped = gw({ ...g, renewSubscription: async (id) => { if (id === "sub-2") throw new GraphApiError(404, "not_found", "x"); return { id, expiresAt: new Date(NOW.getTime() + 5 * 86400e3).toISOString() }; } });
    const r = await run(first.cursor, { gateway: dropped });
    expect(r).toMatchObject({ created: 1, renewed: 2, cursor: { status: "active" } });
    expect(created.map((c) => c.resource).slice(3)).toEqual(["me/mailFolders('sentitems')/messages"]);
    const refusing = gw({ createSubscription: async (req) => { if (req.resource === "me/events") throw new GraphApiError(400, "bad_request", "x"); return { id: "ok", expiresAt: req.expiresAt }; } });
    const e = await run(null, { gateway: refusing });
    expect(e.cursor.status).toBe("error");
    expect(e.cursor.error).toBe("calendar:http_400");
    expect(Object.keys(e.cursor.subs)).toEqual(["inbox", "sent"]);
  });
  it("skips (and says so) without a public https base URL; polling is unaffected", async () => {
    const { run, created } = rig();
    for (const env of [{} as Record<string, string>, { APP_BASE_URL: "http://crm.example.invalid" }, { APP_BASE_URL: "https://localhost:3000" }, { APP_BASE_URL: "not a url" }]) expect((await run(null, { env })).cursor.status, JSON.stringify(env)).toBe("no_public_url");
    expect(created).toHaveLength(0);
    expect(notificationUrl({ APP_BASE_URL: "https://crm.example.invalid/?x=1" }, "c-1")).toBeNull();
  });
  it("credential and transient failures are not swallowed", async () => {
    const { run } = rig();
    await expect(run(null, { gateway: gw({ createSubscription: async () => { throw new CredentialError("no"); } }) })).rejects.toBeInstanceOf(CredentialError);
    await expect(run(null, { gateway: gw({ createSubscription: async () => { throw new TransientError("later"); } }) })).rejects.toBeInstanceOf(TransientError);
  });
  it("tolerates a damaged cursor and removes subscriptions on disconnect", async () => {
    expect(asSubCursor("junk")).toEqual({ subs: {}, status: "no_public_url" });
    expect(asSubCursor({ subs: { inbox: { id: 1 }, sent: { id: "a", expiresAt: "x" } }, status: "active" })).toEqual({ subs: { sent: { id: "a", expiresAt: "x" } }, status: "active" });
    const gone: string[] = [];
    expect(await dropSubscriptions(gw({ deleteSubscription: async (id) => { gone.push(id); } }), { subs: { inbox: { id: "a", expiresAt: "x" }, sent: { id: "b", expiresAt: "x" } } })).toBe(2);
    expect(gone).toEqual(["a", "b"]);
  });
  it("subscribeOutlook (the audited action) works on the Showcase gateway and stores the cursor", async () => {
    resetMockGraph();
    const { d } = rig(), s = setup();
    d.store.conns.set("c-1", { ...CONN, tenantId: "t-1", workspaceId: "w-1" });
    d.vault.secrets.set("sec-x", JSON.stringify({ access_token: "microsoft-mock-token" }));
    const rt: MsActionRuntime = { rd: { ...d.deps, env: {} }, deps: s.deps, env: {} };
    const r = await subscribeOutlook(rt, { uid: "u-1", tenantId: "t-1", workspaceId: "w-1" }, "c-1");
    expect(r).toEqual({ ok: true, value: { status: "active", created: 3, renewed: 0 } });
    expect(d.audits.map((a) => a.action)).toEqual(["outlook.subscriptions_ensured"]);
    expect(Object.keys(asSubCursor(await d.store.getCursor("c-1", "subscriptions")).subs)).toHaveLength(3);
    expect(mockGraphFor("c-1").subscriptions.size).toBe(3);
  });
});

// ---------- token ----------
describe("token expiry", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const ENV = { MICROSOFT_OAUTH_CLIENT_ID: "cid", MICROSOFT_OAUTH_CLIENT_SECRET: "csec" };
  const tokenRes = (b: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(b), { status }));
  it("keeps the ROTATED refresh token and reports the lifetime", async () => {
    const f = tokenRes({ access_token: "new-a", refresh_token: "new-r", expires_in: 3599 });
    expect(await refreshMicrosoftToken({ secrets: { access_token: "old", refresh_token: "old-r" }, env: ENV, fetchImpl: f as unknown as typeof fetch })).toEqual({ secrets: { access_token: "new-a", refresh_token: "new-r" }, expiresInSec: 3599 });
    const body = String((f.mock.calls[0] as unknown[])[1] && ((f.mock.calls[0] as unknown[])[1] as RequestInit).body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("scope=https%3A%2F%2Fgraph.microsoft.com%2F.default+offline_access");
  });
  it("a dead grant is a CredentialError (invalid_grant, consent_required, 401); 5xx, 429 and network are transient; missing app config is explicit", async () => {
    const inp = { secrets: { access_token: "a", refresh_token: "r" }, env: ENV };
    await expect(refreshMicrosoftToken({ ...inp, fetchImpl: tokenRes({ error: "invalid_grant", error_description: "AADSTS700082: refresh token expired" }, 400) as unknown as typeof fetch })).rejects.toThrow(/no longer honours/);
    await expect(refreshMicrosoftToken({ ...inp, fetchImpl: tokenRes({ error: "consent_required" }, 400) as unknown as typeof fetch })).rejects.toBeInstanceOf(CredentialError);
    await expect(refreshMicrosoftToken({ ...inp, fetchImpl: tokenRes({}, 401) as unknown as typeof fetch })).rejects.toBeInstanceOf(CredentialError);
    await expect(refreshMicrosoftToken({ ...inp, fetchImpl: tokenRes({}, 503) as unknown as typeof fetch })).rejects.toBeInstanceOf(TransientError);
    await expect(refreshMicrosoftToken({ ...inp, fetchImpl: tokenRes({}, 429) as unknown as typeof fetch })).rejects.toBeInstanceOf(TransientError);
    await expect(refreshMicrosoftToken({ ...inp, fetchImpl: (async () => { throw new Error("down"); }) as unknown as typeof fetch })).rejects.toBeInstanceOf(TransientError);
    await expect(refreshMicrosoftToken({ secrets: { access_token: "a" }, env: ENV })).rejects.toThrow(/no refresh token/);
    await expect(refreshMicrosoftToken({ ...inp, env: {} })).rejects.toThrow(/not configured/);
  });
  it("framework: an expired token whose refresh is refused flips the connection to needs_attention; a good refresh rotates the stored bundle", async () => {
    vi.stubEnv("MICROSOFT_OAUTH_CLIENT_ID", "cid"); vi.stubEnv("MICROSOFT_OAUTH_CLIENT_SECRET", "csec");
    const { deps, store, vault } = makeDeps({ now: () => NOW });
    vault.secrets.set("sec-1", JSON.stringify({ access_token: "old", refresh_token: "r1" }));
    const conn: ConnectionRow = { ...CONN, credentialSecretId: "sec-1", tokenExpiresAt: "2026-11-09T04:00:00Z" };
    store.conns.set(conn.id, { ...conn });
    vi.stubGlobal("fetch", tokenRes({ access_token: "fresh", refresh_token: "r2", expires_in: 3600 }));
    expect(await refreshIfNeeded(deps, conn)).toEqual({ ok: true, refreshed: true });
    const saved = JSON.parse((await vault.getSecret((await store.getConnection(conn.id))!.credentialSecretId!))!);
    expect(saved).toEqual({ access_token: "fresh", refresh_token: "r2" });
    expect((await store.getConnection(conn.id))!.tokenExpiresAt).toBe("2026-11-09T06:00:00.000Z");
    vi.stubGlobal("fetch", tokenRes({ error: "invalid_grant" }, 400));
    const expired = { ...(await store.getConnection(conn.id))!, tokenExpiresAt: "2026-11-09T04:00:00Z" };
    expect(await refreshIfNeeded(deps, expired)).toEqual({ ok: false, reason: "needs_attention" });
    expect((await store.getConnection(conn.id))!.status).toBe("needs_attention");
    expect((await store.getConnection(conn.id))!.lastError).toMatch(/Reconnect|reconnect/);
  });
  it("the Showcase token never leaves the process", async () => {
    expect(await refreshMicrosoftToken({ secrets: { access_token: "microsoft-mock-token" }, env: {}, fetchImpl: (async () => { throw new Error("network!"); }) as unknown as typeof fetch })).toMatchObject({ secrets: { access_token: "microsoft-mock-token" } });
  });
});

// ---------- send: known contacts only ----------
describe("sendOutlookMail", () => {
  const ACTOR = { uid: "u-1", tenantId: "t-1", workspaceId: "w-1" };
  function rig(opts: { consent?: boolean; audit?: "ok" | "fail"; token?: string } = {}) {
    resetMockGraph();
    const s = setup(), d = makeDeps();
    d.store.conns.set("c-1", { ...CONN });
    d.vault.secrets.set("sec-x", JSON.stringify({ access_token: opts.token ?? "microsoft-mock-token" }));
    if (opts.consent !== undefined) d.store.consent.set("lead-1", opts.consent);
    s.ms.addKnown("t-1", "w-1", "asha.k@client.example.invalid", { leadId: "lead-1" });
    s.ms.addKnown("t-1", "w-1", "contact.only@client.example.invalid", { leadId: null, contactId: "con-1" });
    const order: string[] = [];
    const rd = { ...d.deps, env: {}, audit: async (e: { action: string }) => { order.push(`audit:${e.action}`); if (opts.audit === "fail") throw new Error("audit down"); } };
    const rt: MsActionRuntime = { rd, deps: s.deps, env: {} };
    return { rt, d, ms: s.ms, order };
  }
  const input = (over: Record<string, unknown> = {}) => ({ connectionId: "c-1", to: ["Asha.K@client.example.invalid"], subject: "Hello", body: "Plain text body", ...over });

  it("sends to a known lead that can be contacted: audited first, through the Showcase gateway, plain text", async () => {
    const { rt, order, d } = rig({ consent: true });
    expect(await sendOutlookMail(rt, ACTOR, input())).toEqual({ ok: true, value: { recipients: 1 } });
    expect(order).toEqual(["audit:outlook.mail_sent"]);
    expect(mockGraphFor("c-1").sent).toEqual([{ to: ["asha.k@client.example.invalid"], subject: "Hello", body: "Plain text body" }]);
    expect(d.store.canContactCalls).toEqual(["lead-1"]);
  });
  it("refuses any recipient that is not a known contact of THIS workspace, without saying which", async () => {
    const { rt } = rig({ consent: true });
    expect(await sendOutlookMail(rt, ACTOR, input({ to: ["asha.k@client.example.invalid", "stranger@x.example.invalid"] }))).toEqual({ ok: false, code: "unknown_recipient" });
    expect(mockGraphFor("c-1").sent).toHaveLength(0);
    const other = rig({ consent: true }); other.ms.known.clear(); other.ms.addKnown("t-1", "w-2", "asha.k@client.example.invalid");
    expect(await sendOutlookMail(other.rt, ACTOR, input())).toEqual({ ok: false, code: "unknown_recipient" });
  });
  it("a lead without consent blocks the send; a contact with no lead can be written to", async () => {
    const no = rig({ consent: false });
    expect(await sendOutlookMail(no.rt, ACTOR, input())).toEqual({ ok: false, code: "no_consent" });
    expect(no.order).toEqual([]);   // refused before anything is audited as sent
    const contact = rig();
    expect(await sendOutlookMail(contact.rt, ACTOR, input({ to: ["contact.only@client.example.invalid"] }))).toMatchObject({ ok: true });
  });
  it("tenant isolation: another workspace's or tenant's connection looks missing; a disconnected or attention-needed one cannot send", async () => {
    const { rt, d } = rig({ consent: true });
    expect(await sendOutlookMail(rt, { ...ACTOR, workspaceId: "w-2" }, input())).toEqual({ ok: false, code: "not_found" });
    expect(await sendOutlookMail(rt, { ...ACTOR, tenantId: "t-2" }, input())).toEqual({ ok: false, code: "not_found" });
    expect(await sendOutlookMail(rt, ACTOR, input({ connectionId: "nope" }))).toEqual({ ok: false, code: "not_found" });
    (d.store as FakeStore).conns.get("c-1")!.status = "needs_attention";
    expect(await sendOutlookMail(rt, ACTOR, input())).toEqual({ ok: false, code: "not_connected" });
  });
  it("validates input: recipients 1..10 valid addresses, subject one line, body bounded", async () => {
    const { rt } = rig({ consent: true });
    for (const bad of [{ to: [] }, { to: ["not-an-email"] }, { to: Array.from({ length: 11 }, (_, i) => `a${i}@x.example.invalid`) }, { subject: "" }, { subject: "a\r\nBcc: x@y.example.invalid" }, { body: "  " }, { body: "x".repeat(MAX_BODY + 1) }, { to: "asha.k@client.example.invalid" }])
      expect(await sendOutlookMail(rt, ACTOR, input(bad)), JSON.stringify(bad).slice(0, 40)).toEqual({ ok: false, code: "invalid_input" });
  });
  it("audit or nothing: an audit failure stops the send", async () => {
    const { rt } = rig({ consent: true, audit: "fail" });
    expect(await sendOutlookMail(rt, ACTOR, input())).toEqual({ ok: false, code: "audit_failed" });
    expect(mockGraphFor("c-1").sent).toHaveLength(0);
  });
  it("a live send goes to Graph with the connection's token; a refused token is reported, never thrown", async () => {
    const live = rig({ consent: true, token: "real-token" });
    const s = scripted(ok(undefined, 202));
    expect(await sendOutlookMail({ ...live.rt, fetchImpl: s.f, sleep: async () => {} }, ACTOR, input())).toMatchObject({ ok: true });
    expect(s.calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect((s.calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer real-token");
    const refused = scripted(ok({ error: { code: "InvalidAuthenticationToken" } }, 401));
    expect(await sendOutlookMail({ ...live.rt, fetchImpl: refused.f, sleep: async () => {} }, ACTOR, input())).toEqual({ ok: false, code: "token_rejected" });
    const down = scripted(...Array.from({ length: 6 }, () => ok({}, 503)));
    expect(await sendOutlookMail({ ...live.rt, fetchImpl: down.f, sleep: async () => {} }, ACTOR, input())).toEqual({ ok: false, code: "vendor_unavailable" });
  });
});

// ---------- admin consent ----------
describe("admin consent link", () => {
  const ENV = { MICROSOFT_OAUTH_CLIENT_ID: "app-client-id" };
  const base = { redirectUri: "https://crm.example.invalid/api/oauth/outlook/callback", state: "0123456789abcdef0123456789abcdef" };
  it("builds the tenant-wide consent URL for a tenant id, a verified domain, or `organizations`", () => {
    const r = buildAdminConsentUrl(ENV, { ...base, tenantHint: "Firm.Example.invalid" });
    expect(r.ok && r.url).toBe(`https://login.microsoftonline.com/firm.example.invalid/v2.0/adminconsent?client_id=app-client-id&scope=${encodeURIComponent("https://graph.microsoft.com/.default")}&redirect_uri=${encodeURIComponent(base.redirectUri)}&state=${base.state}`);
    expect(buildAdminConsentUrl(ENV, { ...base })).toMatchObject({ ok: true, url: expect.stringContaining("/organizations/v2.0/adminconsent") });
    expect(tenantSegment("00000000-0000-4000-8000-000000000002")).toBe("00000000-0000-4000-8000-000000000002");
  });
  it("refuses an unconfigured app, a path-injecting tenant, a weak state or a non-https redirect", () => {
    expect(buildAdminConsentUrl({}, base)).toEqual({ ok: false, reason: "not_configured" });
    for (const t of ["../evil", "a/b", "x?y=1", "-bad-.com", "localhost"]) expect(buildAdminConsentUrl(ENV, { ...base, tenantHint: t }), t).toEqual({ ok: false, reason: "bad_tenant" });
    expect(buildAdminConsentUrl(ENV, { ...base, state: "short" })).toEqual({ ok: false, reason: "missing_state" });
    expect(buildAdminConsentUrl(ENV, { ...base, redirectUri: "http://crm.example.invalid/cb" })).toEqual({ ok: false, reason: "bad_redirect" });
    expect(buildAdminConsentUrl(ENV, { ...base, redirectUri: "nope" })).toEqual({ ok: false, reason: "bad_redirect" });
  });
  it("checks the return: state, grant flag and tenant id; a denial is reported", () => {
    const t = "00000000-0000-4000-8000-000000000002";
    expect(parseAdminConsentReturn({ admin_consent: "True", tenant: t, state: base.state }, base.state)).toEqual({ ok: true, tenantId: t });
    expect(parseAdminConsentReturn({ admin_consent: "True", tenant: t, state: "other-state-value-0000000000000" }, base.state)).toEqual({ ok: false, reason: "state_mismatch" });
    expect(parseAdminConsentReturn({ error: "access_denied", state: base.state }, base.state)).toEqual({ ok: false, reason: "denied" });
    expect(parseAdminConsentReturn({ admin_consent: "False", tenant: t, state: base.state }, base.state)).toEqual({ ok: false, reason: "malformed" });
    expect(parseAdminConsentReturn({ admin_consent: "True", tenant: "not-a-guid", state: base.state }, base.state)).toEqual({ ok: false, reason: "malformed" });
  });
});

// ---------- gateway selection, registration, hard rules ----------
describe("gateway selection", () => {
  it("the sandbox token or APP_ENV=demo selects the Showcase gateway; production refuses it", () => {
    expect(shouldMock({ access_token: "microsoft-mock-token" }, {})).toBe(true);
    expect(shouldMock({}, { APP_ENV: "demo" })).toBe(true);
    expect(shouldMock({ access_token: "real" }, { APP_ENV: "demo" })).toBe(false);
    expect(() => shouldMock({ access_token: "microsoft-mock-token" }, { APP_ENV: "production" })).toThrow(CredentialError);
    expect(graphGatewayFor({ connectionId: "k", secrets: { access_token: "t" }, env: { MICROSOFT_GRAPH_API_BASE: "https://stub.example.invalid/v1.0/" } }).kind).toBe("api");
    expect(() => graphGatewayFor({ connectionId: "k", secrets: {}, env: {} })).toThrow(CredentialError);
  });
  it("the Showcase gateway serves sample data and never touches the network", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("network!"); });
    const g = makeMockGraph();
    expect((await g.deltaMessages("inbox", null, "x")).items).toHaveLength(1);
    expect((await g.deltaMessages("inbox", "mock-delta", "x")).items).toHaveLength(0);
    expect((await g.deltaEvents(null, { startIso: "a", endIso: "b" })).items).toHaveLength(1);
    await g.sendMail({ to: ["a@x.example.invalid"], subject: "s", body: "b" });
    expect(g.sent).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

describe("registration", () => {
  const def = ALL_CONNECTORS.find((c) => c.id === "outlook")!;
  it("is registered, OAuth with PKCE and the minimal delegated scopes, gated until publisher verification", () => {
    expect(getConnector("outlook")).toBe(def);
    expect(def).toMatchObject({ category: "email", auth: "oauth2", gate: "needs_vendor_approval", capabilities: { inbound: true, outbound: true, webhooks: true }, pushes: [] });
    expect(def.oauth).toMatchObject({ pkce: true, clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID", clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET" });
    expect(def.oauth!.scopes).toEqual(["offline_access", "User.Read", "Mail.Read", "Mail.Send", "Calendars.Read"]);
    expect(def.oauth!.authorizeUrl).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");   // multi-tenant
    expect(def.streams.map((s) => s.key)).toEqual(["inbox", "sent", "calendar", "subscriptions"]);
    expect(def.sandbox).toEqual({ supported: true, howTo: "outlook.sandbox" });
    expect(def.webhook).toBeTruthy();
  });
  it("needs both OAuth env names", () => {
    expect(envConfigured(def, {})).toBe(false);
    expect(envConfigured(def, { MICROSOFT_OAUTH_CLIENT_ID: "a", MICROSOFT_OAUTH_CLIENT_SECRET: "b" })).toBe(true);
  });
  it("webhook.verify parses notifications only", async () => {
    const evts = await def.webhook!.verify({ rawBody: JSON.stringify({ value: [NOTIFICATION()] }), headers: {} }, {});
    expect(evts).toHaveLength(1);
  });
  it("lists the env names in .env.example without values and ships an English showcase string", () => {
    const env = readFileSync(join(__dirname, "../../../../../.env.example"), "utf8");
    for (const n of ["MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET", "MICROSOFT_GRAPH_API_BASE"]) expect(env, n).toMatch(new RegExp(`^${n}=\\s*$`, "m"));
    const en = JSON.parse(readFileSync(join(__dirname, "../../../../../messages/en/integrations.json"), "utf8")) as Record<string, string>;
    expect(en["outlook.sandbox"]).toMatch(/Showcase/);
  });
});

describe("hard rule: no tenant-, brand-, mailbox- or secret-specific values in the Outlook connector code", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === "__tests__" ? [] : files(p)) : p.endsWith(".ts") ? [p] : []; });
  const src = files(join(__dirname, ".."));
  it("scans the production sources", () => {
    expect(src.length).toBeGreaterThan(12);
    for (const f of src) {
      const text = readFileSync(f, "utf8");
      for (const url of text.match(/https?:\/\/[^\s"'`)]+/g) ?? []) expect(url, f).toMatch(/^https:\/\/(graph\.microsoft\.com|login\.microsoftonline\.com|example\.invalid)(\/|$)/);
      expect(text, f).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.|-----BEGIN|client_secret\s*[:=]\s*["'][^"']{8,}|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);   // JWTs, private keys, inline secrets, tenant / app GUIDs
      expect(text, f).not.toMatch(/\bprocess\.env\.(MICROSOFT|GRAPH)/);   // env is read by name through the injected env, never inline
    }
  });
});
