// Gmail: thread matcher fixtures (Gmail API v1 message shape, synthetic), the testing-mode gate, gated start, thread sync through fakes,
// reply sending, tenant isolation, and the hard-rule scan over the Calendar and Gmail sources.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ALL_CONNECTORS } from "../../../all";
import type { RuntimeDeps } from "../../../core/ports";
import type { ConnectionRow, ConnectionSecrets } from "../../../core/types";
import { envConfigured, getConnector } from "../../../registry";
import type { GmailGateway } from "../gateway";
import { gmailGate, gmailScopes } from "../gate";
import { addressesIn, buildQuery, buildReply, matchThread, parseMessage, type ContactRef, type GMessage, type GThread } from "../matcher";
import { sendGmailReply } from "../send";
import { startGmailConnect } from "../start";
import { gmailThreadsStep } from "../sync";
import type { GmailDeps, GmailStore } from "../store";

const enc = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const msg = (o: { id: string; from: string; to: string; cc?: string; at: number; body?: string; html?: string; extra?: Record<string, string>; thread?: string }): GMessage => ({
  id: o.id, threadId: o.thread ?? "th1", internalDate: String(o.at),
  payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: o.from }, { name: "To", value: o.to }, ...(o.cc ? [{ name: "Cc", value: o.cc }] : []), { name: "Subject", value: "Quote" }, { name: "Message-ID", value: `<${o.id}@x>` }, ...Object.entries(o.extra ?? {}).map(([name, value]) => ({ name, value }))],
    parts: [...(o.body !== undefined ? [{ mimeType: "text/plain", body: { data: enc(o.body) } }] : []), ...(o.html ? [{ mimeType: "text/html", body: { data: enc(o.html) } }] : [])] },
});
const SELF = "agent@example.com";
const known = new Map<string, ContactRef>([["buyer@example.org", { type: "lead", id: "lead-1" }]]);

describe("matcher", () => {
  it("parses addresses, decodes bodies (plain first, else stripped html) and sets direction", () => {
    expect(addressesIn('"Buyer, A" <Buyer@Example.org>, other@example.com')).toEqual(["buyer@example.org", "other@example.com"]);
    const a = parseMessage(msg({ id: "m1", from: "Buyer <buyer@example.org>", to: SELF, at: 1_700_000_000_000, body: "Hello" }), SELF)!;
    expect(a).toMatchObject({ direction: "inbound", body: "Hello", from: "buyer@example.org", to: [SELF], sentAt: "2023-11-14T22:13:20.000Z" });
    const b = parseMessage(msg({ id: "m2", from: SELF, to: "buyer@example.org", at: 1_700_000_100_000, html: "<p>Hi&nbsp;there</p><style>x{}</style>" }), SELF)!;
    expect(b).toMatchObject({ direction: "outbound", body: "Hi there" });
    expect(parseMessage({ id: "x", threadId: "t", internalDate: "nan" }, SELF)).toBeNull();
  });
  it("keeps a thread when a known contact is the sender or a direct recipient", () => {
    const m = [parseMessage(msg({ id: "m1", from: SELF, to: "buyer@example.org", at: 1_700_000_000_000, body: "Quote attached" }), SELF)!];
    expect(matchThread(m, known, SELF)).toEqual({ matched: true, contact: { type: "lead", id: "lead-1" }, email: "buyer@example.org" });
  });
  it("drops threads with strangers, Cc-only mentions, and bulk mail", () => {
    const stranger = [parseMessage(msg({ id: "a", from: "someone@example.net", to: SELF, at: 1_700_000_000_000, body: "hi" }), SELF)!];
    expect(matchThread(stranger, known, SELF)).toEqual({ matched: false, reason: "no_known_contact" });
    const cc = [parseMessage(msg({ id: "b", from: "someone@example.net", to: SELF, cc: "buyer@example.org", at: 1_700_000_000_000, body: "fyi" }), SELF)!];
    expect(matchThread(cc, known, SELF)).toEqual({ matched: false, reason: "no_known_contact" });
    const bulk = [parseMessage(msg({ id: "c", from: "buyer@example.org", to: SELF, at: 1_700_000_000_000, body: "news", extra: { "List-Unsubscribe": "<mailto:u@example.org>" } }), SELF)!];
    expect(matchThread(bulk, known, SELF)).toEqual({ matched: false, reason: "bulk" });
    expect(matchThread([], known, SELF)).toEqual({ matched: false, reason: "no_messages" });
  });
  it("builds a Google search for known addresses only, refusing anything that could inject operators", () => {
    expect(buildQuery(["a@example.org", 'x" OR in:anywhere@e.com', "b@example.org"], 1700000000.9)).toBe("after:1700000000 (from:a@example.org OR to:a@example.org OR from:b@example.org OR to:b@example.org)");
  });
  it("builds a threaded reply without header injection", () => {
    const raw = Buffer.from(buildReply({ from: SELF, to: "buyer@example.org\r\nBcc: evil@example.net", subject: "Quote", body: "Thanks", inReplyTo: "<m1@x>", references: "<m0@x>" }), "base64url").toString("utf8");
    expect(raw).not.toMatch(/\r\nBcc:/);
    expect(raw).toContain("In-Reply-To: <m1@x>");
    expect(raw).toContain("References: <m0@x> <m1@x>");
    expect(Buffer.from(raw.split("\r\n\r\n")[1], "base64").toString("utf8")).toBe("Thanks");
  });
});

describe("gate", () => {
  it("is open only in testing mode (or after CASA) AND with the tenant's opt-in", () => {
    expect(gmailGate({ GOOGLE_OAUTH_APP_MODE: "testing" }, true)).toMatchObject({ open: true, mode: "testing" });
    expect(gmailGate({ GOOGLE_OAUTH_APP_MODE: "testing" }, false)).toMatchObject({ open: false, reasons: ["not_opted_in"] });
    expect(gmailGate({}, true)).toMatchObject({ open: false, reasons: ["app_mode_unknown"] });
    expect(gmailGate({ GOOGLE_OAUTH_APP_MODE: "production" }, true)).toMatchObject({ open: false, reasons: ["app_in_production_unverified"] });
    expect(gmailGate({ GOOGLE_OAUTH_APP_MODE: "production", GOOGLE_OAUTH_CASA_COMPLETE: "true" }, true)).toMatchObject({ open: true, mode: "verified" });
  });
  it("requests no scope at all while closed, so a restricted scope is never asked for without an opt-in", () => {
    expect(gmailScopes({ GOOGLE_OAUTH_APP_MODE: "testing" }, false)).toEqual([]);
    expect(gmailScopes({}, true)).toEqual([]);
    expect(gmailScopes({ GOOGLE_OAUTH_APP_MODE: "testing" }, true)).toEqual(["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"]);
  });
  const ids = { uid: "u1", tenantId: "t-1", workspaceId: "w-1" };
  const deps = (env: Record<string, string>, existing: ConnectionRow | null = null): RuntimeDeps => ({
    store: { findConnection: async () => existing, insertConnection: async () => ({ id: "c-9", tenantId: "t-1", workspaceId: "w-1" }) } as never,
    vault: {} as never, env, log: { info() {}, warn() {}, error() {} }, audit: vi.fn(async () => undefined),
  });
  it("starts only with both acknowledgements, audits the opt-in, and never for a foreign connection", async () => {
    const env = { GOOGLE_OAUTH_APP_MODE: "testing" };
    expect(await startGmailConnect(deps(env), ids, null)).toMatchObject({ ok: false, code: "opt_in_required" });
    expect(await startGmailConnect(deps(env), ids, { restrictedScopes: true })).toMatchObject({ ok: false, code: "opt_in_required" });
    expect(await startGmailConnect(deps({}), ids, { restrictedScopes: true, testUserListed: true })).toMatchObject({ ok: false, code: "gate_closed" });
    const d = deps(env);
    expect(await startGmailConnect(d, ids, { restrictedScopes: true, testUserListed: true })).toMatchObject({ ok: true, connectionId: "c-9", scopes: expect.arrayContaining(["https://www.googleapis.com/auth/gmail.readonly"]) });
    expect(d.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "gmail.opt_in" }));
    const foreign = { id: "c-1", tenantId: "t-OTHER", workspaceId: "w-1" } as ConnectionRow;
    expect(await startGmailConnect(deps(env, foreign), ids, { restrictedScopes: true, testUserListed: true })).toMatchObject({ ok: false, code: "gate_closed" });
  });
  it("registers gmail as a restricted-scope connector that is not configured until the platform declares the app mode", () => {
    const def = getConnector("gmail")!;
    expect(def.oauth!.scopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"]);
    const base = { GOOGLE_OAUTH_CLIENT_ID: "x", GOOGLE_OAUTH_CLIENT_SECRET: "y" };
    expect(envConfigured(def, base)).toBe(false);
    expect(envConfigured(def, { ...base, GOOGLE_OAUTH_APP_MODE: "testing" })).toBe(true);
    const cal = getConnector("google-calendar")!;
    expect(cal.oauth!.scopes).toEqual(["https://www.googleapis.com/auth/calendar.events"]);
    expect(ALL_CONNECTORS.map((c) => c.id)).toEqual(expect.arrayContaining(["gmail", "google-calendar"]));
  });
});

// ---- sync and send through fakes ----
const CONN: ConnectionRow = { id: "c-1", tenantId: "t-1", workspaceId: "w-1", connectorId: "gmail", mode: "live", status: "connected", settings: {}, credentialSecretId: "sec-1", webhookSecretId: null, tokenExpiresAt: null };
const OPTED: ConnectionSecrets = { access_token: "a1", refresh_token: "r1", primary_uid: "u1", primary_email: SELF, gmail_opt_in: "2026-11-10" };
const ENV = { GOOGLE_OAUTH_APP_MODE: "testing" };

function fake(threads: Record<string, GThread>, emails: string[] = ["buyer@example.org"]) {
  const scopes: unknown[] = [], saved: { threadId: string; n: number }[] = [], sent: string[] = [], queries: string[] = [];
  const store: GmailStore = {
    async listKnownEmails(s, off, lim) { scopes.push(s); return emails.slice(off, off + lim); },
    async contactsByEmail(s, e) { scopes.push(s); return new Map(e.filter((x) => known.has(x)).map((x) => [x, known.get(x)!])); },
    async saveThread(s, t) { scopes.push(s); saved.push({ threadId: t.threadId, n: t.messages.length }); return { conversationId: "conv-1", added: t.messages.length }; },
    async findThread(s, id) { scopes.push(s); return id === "th1" ? { conversationId: "conv-1", contact: { type: "lead", id: "lead-1" } } : null; },
    async saveSent(s, _c, m) { scopes.push(s); sent.push(m.body); },
  };
  const calls = { list: 0, get: 0 };
  const gw: GmailGateway = {
    kind: "api", async profile() { return { email: SELF }; },
    async listThreadIds(_t, q) { calls.list++; queries.push(q); return Object.keys(threads); },
    async getThread(_t, id) { calls.get++; return threads[id] ?? null; },
    async send(_t, _raw, th) { return { id: `sent-${th}` }; },
  };
  const deps: GmailDeps = { store, log: { info() {}, warn() {}, error() {} }, now: () => new Date("2026-11-10T00:00:00Z") };
  return { deps, gw, scopes, saved, sent, calls, queries };
}
const T = (id: string, from: string, to: string): GThread => ({ id, messages: [msg({ id: `${id}-m1`, thread: id, from, to, at: 1_700_000_000_000, body: "Hello" })] });
const reject = vi.fn();

describe("thread sync", () => {
  it("stays shut while the gate is closed: no list, no fetch, nothing stored", async () => {
    for (const [env, secrets] of [[{}, OPTED], [ENV, { ...OPTED, gmail_opt_in: "" }]] as const) {
      const f = fake({ th1: T("th1", "buyer@example.org", SELF) });
      const r = await gmailThreadsStep({ deps: f.deps, conn: CONN, secrets, env, gateway: f.gw, reject }, undefined);
      expect(r).toMatchObject({ done: true, sample: { skipped: "gate_closed" } });
      expect(f.calls).toEqual({ list: 0, get: 0 });
      expect(f.saved).toEqual([]);
    }
  });
  it("searches known addresses only, keeps matched threads and drops the rest, all inside the connection's scope", async () => {
    const f = fake({ th1: T("th1", "buyer@example.org", SELF), th2: T("th2", "stranger@example.net", SELF) });
    const a = await gmailThreadsStep({ deps: f.deps, conn: CONN, secrets: OPTED, env: ENV, gateway: f.gw, reject }, undefined);
    expect(f.queries[0]).toContain("from:buyer@example.org");
    expect(f.queries[0]).not.toContain("stranger");
    expect(f.saved).toEqual([{ threadId: "th1", n: 1 }]);
    expect(a.sample).toMatchObject({ threads_kept: 1, threads_dropped: 1 });
    expect(a.done).toBe(false);
    expect(f.scopes.every((s) => JSON.stringify(s) === JSON.stringify({ tenantId: "t-1", workspaceId: "w-1", connectionId: "c-1" }))).toBe(true);
    // no more addresses -> next user -> finished with a time floor that overlaps the run start
    const b = await gmailThreadsStep({ deps: f.deps, conn: CONN, secrets: OPTED, env: ENV, gateway: f.gw, reject }, a.cursor);
    const c = await gmailThreadsStep({ deps: f.deps, conn: CONN, secrets: OPTED, env: ENV, gateway: f.gw, reject }, b.cursor);
    expect(b.done).toBe(false);
    expect(c).toMatchObject({ done: true, cursor: { after: Math.floor(new Date("2026-11-10T00:00:00Z").getTime() / 1000) - 3600, gi: 0, offset: 0 } });
  });
});

describe("reply", () => {
  const vault = new Map([["sec-1", JSON.stringify(OPTED)]]);
  const d = (env: Record<string, string>, conn: ConnectionRow | null = CONN): RuntimeDeps => ({ store: { getConnection: async () => conn } as never, vault: { getSecret: async (id: string) => vault.get(id) ?? null } as never, env, log: { info() {}, warn() {}, error() {} }, audit: vi.fn(async () => undefined) });
  const actor = { uid: "u1", tenantId: "t-1", workspaceId: "w-1" };
  const run = (rt: RuntimeDeps, f: ReturnType<typeof fake>, input = { threadId: "th1", body: "Thanks" }, a = actor) => {
    // the real gateway factory would call Google: route through a scripted fetch instead
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/profile")) return new Response(JSON.stringify({ emailAddress: SELF }), { status: 200 });
      if (u.includes("/threads/")) return new Response(JSON.stringify(f.gw === null ? {} : T("th1", "buyer@example.org", SELF)), { status: 200 });
      if (u.includes("/messages/send")) { f.sent.push(String(init?.body)); return new Response(JSON.stringify({ id: "sent-1" }), { status: 200 }); }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    return sendGmailReply(rt, f.deps, a, "c-1", input, fetchImpl);
  };
  it("sends a threaded reply to the known contact from the acting user's mailbox, records it and audits ids only", async () => {
    const f = fake({}), rt = d(ENV);
    const r = await run(rt, f);
    expect(r).toEqual({ ok: true, value: { messageId: "sent-1" } });
    expect(JSON.parse(f.sent[0]).threadId).toBe("th1");
    expect(f.sent).toContain("Thanks");
    expect(rt.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "gmail.reply_sent", detail: { thread: "th1", conversation: "conv-1" } }));
  });
  it("refuses when the gate is closed, the thread is unknown to this workspace, or the connection belongs to another tenant", async () => {
    expect(await run(d({}), fake({}))).toEqual({ ok: false, code: "gate_closed" });
    const f = fake({});
    expect(await run(d(ENV), f, { threadId: "other", body: "x" })).toEqual({ ok: false, code: "thread_not_found" });
    expect(await run(d(ENV), f, undefined, { ...actor, tenantId: "t-OTHER" })).toEqual({ ok: false, code: "not_found" });
    expect(await run(d(ENV), f, { threadId: "th1", body: "  " })).toEqual({ ok: false, code: "empty_body" });
    expect(f.sent).toEqual([]);
  });
});

describe("hard rule: no tenant-, brand-, account-id- or secret-specific values in the Calendar and Gmail sources", () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === "__tests__" ? [] : files(p)) : p.endsWith(".ts") ? [p] : []; });
  it("scans the production sources", () => {
    const src = [...files(join(__dirname, "..")), ...files(join(__dirname, "../../calendar"))];
    expect(src.length).toBeGreaterThan(20);
    for (const f of src) {
      const text = readFileSync(f, "utf8");
      for (const url of text.match(/https?:\/\/[^\s"'`)]+/g) ?? []) expect(url, f).toMatch(/^https:\/\/([a-z0-9]+\.googleapis\.com|accounts\.google\.com)(\/|$)/);
      expect(text, f).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|ya29\.|1\/\/0[0-9A-Za-z_-]{20,}|GOCSPX-|-----BEGIN/);
      expect(text, f).not.toMatch(/\bprocess\.env\.(GOOGLE|GMAIL)/);
      expect(text, f).not.toMatch(/lawsome|kaveri|shola/i);
    }
  });
  it("lists the new env names in .env.example without values", () => {
    const env = readFileSync(join(__dirname, "../../../../../../.env.example"), "utf8");
    for (const n of ["GOOGLE_OAUTH_APP_MODE", "GOOGLE_OAUTH_CASA_COMPLETE", "GOOGLE_CALENDAR_API_BASE", "GMAIL_API_BASE"]) expect(env, n).toMatch(new RegExp(`^${n}=\\s*$`, "m"));
  });
});
