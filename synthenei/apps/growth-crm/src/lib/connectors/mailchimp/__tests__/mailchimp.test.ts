// Mailchimp: lead -> member mapping, pull/webhook payloads, consented-only push through the framework runner, unsubscribes and
// cleaned members flowing back into consent_log + the suppression list, and the audience guard on the webhook.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeDeps, silentLog } from "../../core/__tests__/fakes";
import { runPush } from "../../core/sync";
import { registerConnector, resetRegistry } from "../../registry";
import { setEmailRuntimeFactory } from "../../email/connector";
import { FakeStore as EmailStore, deps as emailDeps } from "../../email/__tests__/fake";
import type { ConnectionRow, HttpRequest, SyncContext, VendorHttp } from "../../core/types";
import { audienceOf, mailchimpConnector, pullPage } from "../connector";
import { chunkIds, hookReason, parseMembers, parseWebhook, reasonForStatus, subscriberHash, toMember } from "../mapping";
import { mailchimpApi, resolveBase } from "../api";

const R = (over = {}) => ({ leadId: "l1", email: "Asha@Example.com", fullName: "Asha Mary Kumar", firstName: "Asha", company: null, district: null, ...over });

describe("mapping", () => {
  it("builds the member from a lead: lower-cased address, split name, status_if_new so an existing status is never overwritten", () => {
    expect(toMember(R(), "Spring list")).toEqual({ email_address: "asha@example.com", status_if_new: "subscribed", merge_fields: { FNAME: "Asha", LNAME: "Mary Kumar" }, tags: ["Spring list"] });
    expect(toMember(R({ fullName: "Madonna" }))).toEqual({ email_address: "asha@example.com", status_if_new: "subscribed", merge_fields: { FNAME: "Madonna" } });
    expect(toMember(R({ email: null }))).toBeNull();
    expect(toMember(R({ email: "  " }))).toBeNull();
    expect(JSON.stringify(toMember(R()))).not.toContain('"status":');   // never a forced "subscribed" on an existing member
  });
  it("hashes the member id the way Mailchimp does (md5 of the lower-cased address)", () => {
    expect(subscriberHash("Test@Example.com")).toBe(subscriberHash("test@example.com"));
    expect(subscriberHash("test@example.com")).toMatch(/^[0-9a-f]{32}$/);
  });
  it("maps statuses: unsubscribed -> unsubscribe, cleaned -> hard bounce, everything else nothing", () => {
    expect(reasonForStatus("unsubscribed")).toBe("unsubscribe");
    expect(reasonForStatus("cleaned")).toBe("hard_bounce");
    for (const s of ["subscribed", "pending", "transactional", "archived", ""]) expect(reasonForStatus(s)).toBeNull();
  });
  it("parses a members page and skips rows without an address", () => {
    const r = parseMembers({ total_items: 3, members: [{ email_address: "A@x.test", last_changed: "2026-10-01T00:00:00+00:00" }, { email_address: "" }, null, { email_address: "b@x.test" }] }, "cleaned");
    expect(r.total).toBe(3);
    expect(r.rows).toEqual([{ email: "a@x.test", status: "cleaned", changedAt: "2026-10-01T00:00:00+00:00" }, { email: "b@x.test", status: "cleaned", changedAt: null }]);
    expect(parseMembers(null, "cleaned")).toEqual({ rows: [], total: 0 });
  });
  it("parses form-encoded webhooks; other event types and junk are ignored", () => {
    const body = "type=unsubscribe&fired_at=2026-10-01+10%3A00%3A00&data%5Bid%5D=abc&data%5Blist_id%5D=L1&data%5Bemail%5D=Asha%40Example.com&data%5Breason%5D=manual";
    expect(parseWebhook(body)).toEqual([{ type: "unsubscribe", email: "asha@example.com", listId: "L1", reason: "manual" }]);
    expect(hookReason(parseWebhook(body)[0])).toBe("unsubscribe");
    expect(parseWebhook("type=cleaned&data[email]=b@x.test&data[reason]=hard").map(hookReason)).toEqual(["hard_bounce"]);
    for (const b of ["type=subscribe&data[email]=a@x.test", "type=profile&data[email]=a@x.test", "type=unsubscribe", "", "garbage"]) expect(parseWebhook(b)).toEqual([]);
  });
  it("chunks ids and reads the audience id only when it looks like one", () => {
    expect(chunkIds(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
    expect(audienceOf({ audience_id: "abc123def4" })).toBe("abc123def4");
    for (const v of [undefined, 5, "", "a b", "../x", "ab"]) expect(audienceOf({ audience_id: v })).toBeNull();
  });
});

// ---- connector against scripted Mailchimp ----
interface Script { calls: HttpRequest[]; put: Record<string, unknown>[]; pages: Record<string, unknown[]> }
function setup(settings: Record<string, unknown> = { audience_id: "aud12345" }) {
  const core = makeDeps();
  const script: Script = { calls: [], put: [], pages: { unsubscribed: [], cleaned: [] } };
  const http: VendorHttp = {
    async json<T>(r: HttpRequest): Promise<T> {
      script.calls.push(r);
      if (r.url.includes("/oauth2/metadata")) return { dc: "us9" } as T;
      if (r.method === "PUT") { script.put.push(r.body as Record<string, unknown>); return { id: "mc-id" } as T; }
      const status = /status=(\w+)/.exec(r.url)![1], offset = Number(/offset=(\d+)/.exec(r.url)![1]);
      const page = script.pages[status]?.[Math.floor(offset / 200)] ?? { members: [], total_items: 0 };
      return page as T;
    },
  };
  const em = new EmailStore();
  setEmailRuntimeFactory(async () => ({ deps: emailDeps(em), env: {}, core: core.deps }));
  core.store.availability.mailchimp = { mode: "live", gateStatus: "ready" };
  const vaultId = "sec-mc";
  core.vault.secrets.set(vaultId, JSON.stringify({ access_token: "tok" }));
  const conn: ConnectionRow = { id: "mc1", tenantId: "t1", workspaceId: "w1", connectorId: "mailchimp", mode: "live", status: "connected", settings, credentialSecretId: vaultId, webhookSecretId: null, tokenExpiresAt: null };
  core.store.conns.set(conn.id, conn);
  core.deps.http = () => http;
  const ctx = (over: Partial<SyncContext> = {}): SyncContext => ({ conn, runId: 1, log: silentLog, apiBase: "", http, secrets: async () => ({ access_token: "tok" }), upsert: { record: async () => ({ localId: "x", created: false }) }, ...over });
  return { core, script, em, conn, http, ctx };
}
beforeEach(() => { resetRegistry(); registerConnector(mailchimpConnector); });
afterEach(() => setEmailRuntimeFactory(null));

describe("push (segments -> audience)", () => {
  it("pushes only consented leads, tags with the segment name, never forces a status, and counts the rest as no consent", async () => {
    const t = setup();
    t.em.addLead("l1", "w1", "asha@example.com", "Asha K");
    t.em.addLead("l2", "w1", "no.consent@example.com", "No Consent", {}, false);
    t.core.store.consent.set("l1", true);   // framework consent gate (public.can_contact)
    const out = await runPush(t.core.deps, { connectionId: "mc1", pushKey: "contacts", leadIds: ["l1", "l2"], payload: { tag: "Spring" } });
    expect(out).toMatchObject({ sent: 1, skippedNoConsent: 1, failed: 0 });
    expect(t.script.put).toEqual([{ email_address: "asha@example.com", status_if_new: "subscribed", merge_fields: { FNAME: "Asha", LNAME: "K" }, tags: ["Spring"] }]);
    const put = t.script.calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe(`https://us9.api.mailchimp.com/3.0/lists/aud12345/members/${subscriberHash("asha@example.com")}`);
    expect(put.headers?.authorization).toBe("Bearer tok");
    expect(t.core.store.canContactCalls).toEqual(["l1", "l2"]);
  });
  it("never pushes a suppressed address even if consent says yes", async () => {
    const t = setup();
    t.em.addLead("l1", "w1", "asha@example.com");
    t.core.store.consent.set("l1", true);
    await t.em.addSuppression({ tenantId: "t1", workspaceId: "w1", email: "ASHA@example.com", reason: "hard_bounce", source: "x" });
    const out = await runPush(t.core.deps, { connectionId: "mc1", pushKey: "contacts", leadIds: ["l1"] });
    expect(out).toMatchObject({ sent: 0, failed: 1 });
    expect(t.script.put).toHaveLength(0);
  });
  it("does nothing without a chosen audience and for a lead without an address", async () => {
    const none = setup({});
    none.em.addLead("l1", "w1", "asha@example.com"); none.core.store.consent.set("l1", true);
    expect(await runPush(none.core.deps, { connectionId: "mc1", pushKey: "contacts", leadIds: ["l1"] })).toMatchObject({ sent: 0, failed: 1 });
    const noMail = setup();
    noMail.em.addLead("l1", "w1", null); noMail.core.store.consent.set("l1", true);
    expect(await runPush(noMail.core.deps, { connectionId: "mc1", pushKey: "contacts", leadIds: ["l1"] })).toMatchObject({ sent: 0, failed: 1 });
    expect(noMail.script.put).toHaveLength(0);
  });
  it("resolveBase validates the data centre before it goes into a host name", async () => {
    const bad: VendorHttp = { json: async <T,>() => ({ dc: "evil.test/x" }) as T };
    await expect(resolveBase(bad, "tok", "")).rejects.toMatchObject({ name: "CredentialError" });
    expect(await resolveBase(bad, "tok", "http://stub.invalid/")).toBe("http://stub.invalid");
    const api = mailchimpApi({ json: async <T,>(r: HttpRequest) => ({ url: r.url }) as T }, "https://us1.api.mailchimp.com", "t");
    expect(await api.members("a b", "cleaned", "2026-01-01T00:00:00Z", 0, 200)).toMatchObject({ url: expect.stringContaining("/lists/a%20b/members?status=cleaned&count=200&offset=0&since_last_changed=2026-01-01T00%3A00%3A00Z") });
  });
});

describe("pull (unsubscribes and bounces come back)", () => {
  it("writes consent withdrawals for unsubscribed and suppresses cleaned, then advances the cursor only after a whole pass", async () => {
    const t = setup();
    t.em.addLead("l1", "w1", "asha@example.com"); t.em.addLead("l2", "w1", "bob@example.com");
    t.script.pages.unsubscribed = [{ total_items: 1, members: [{ email_address: "Asha@Example.com", last_changed: "2026-10-01T00:00:00Z" }] }];
    t.script.pages.cleaned = [{ total_items: 1, members: [{ email_address: "bob@example.com" }, { email_address: "stranger@example.net" }] }];
    const now = () => new Date("2026-11-01T00:00:00Z");
    let r = await pullPage(t.ctx(), null, now);
    expect(r.done).toBe(false);                                  // unsubscribed page done, cleaned next
    expect(await t.em.canContact("l1")).toBe(false);
    expect(t.em.consent.at(-1)).toMatchObject({ action: "withdrawn", leadId: "l1" });
    r = await pullPage(t.ctx(), r.cursor, now);
    expect(r).toMatchObject({ done: true, cursor: { since: "2026-11-01T00:00:00.000Z", phase: "unsubscribed", offset: 0, startedAt: null } });
    expect(t.em.suppressed.map((s) => [s.email, s.reason])).toEqual([["asha@example.com", "unsubscribe"], ["bob@example.com", "hard_bounce"], ["stranger@example.net", "hard_bounce"]]);
    expect(await t.em.canContact("l2")).toBe(true);              // a hard bounce is not a consent withdrawal
    // the next pass only asks for changes since the stored cursor
    t.script.calls.length = 0;
    await pullPage(t.ctx(), r.cursor, now);
    expect(decodeURIComponent(t.script.calls.find((c) => c.url.includes("status=unsubscribed"))!.url)).toContain("since_last_changed=2026-11-01T00:00:00.000Z");
  });
  it("is idempotent when Mailchimp returns the same member again", async () => {
    const t = setup();
    t.em.addLead("l1", "w1", "asha@example.com");
    t.script.pages.unsubscribed = [{ total_items: 1, members: [{ email_address: "asha@example.com" }] }];
    await pullPage(t.ctx(), null); await pullPage(t.ctx(), null);
    expect(t.em.consent.filter((c) => c.action === "withdrawn")).toHaveLength(1);
    expect(t.em.suppressed).toHaveLength(1);
  });
  it("skips quietly (no vendor call) when no audience is chosen", async () => {
    const t = setup({});
    const r = await pullPage(t.ctx(), null);
    expect(r).toMatchObject({ done: true, rowsIn: 0 });
    expect(t.script.calls).toHaveLength(0);
  });
});

describe("webhook", () => {
  it("withdraws consent and suppresses on an unsubscribe for the connected audience; ignores another audience", async () => {
    const t = setup();
    t.em.addLead("l1", "w1", "asha@example.com");
    const evts = await mailchimpConnector.webhook!.verify({ rawBody: "type=unsubscribe&data[list_id]=aud12345&data[email]=asha@example.com", headers: {} }, {});
    let rejected = "";
    await mailchimpConnector.webhook!.handle(t.ctx({ reject: (r) => { rejected = r; } }), evts[0]);
    expect(await t.em.canContact("l1")).toBe(false);
    expect(t.em.suppressed[0]).toMatchObject({ reason: "unsubscribe", source: "mailchimp_webhook" });
    const other = await mailchimpConnector.webhook!.verify({ rawBody: "type=unsubscribe&data[list_id]=someone_else&data[email]=bob@example.com", headers: {} }, {});
    await mailchimpConnector.webhook!.handle(t.ctx({ reject: (r) => { rejected = r; } }), other[0]);
    expect(rejected).toBe("other_audience");
    expect(t.em.suppressed).toHaveLength(1);
  });
});
