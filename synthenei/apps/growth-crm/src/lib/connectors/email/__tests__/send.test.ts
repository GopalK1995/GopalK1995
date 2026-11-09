// Send pipeline: consent gating on every path, suppression, sender identity, merge fields, unsubscribe headers, idempotency, throttle,
// isolation, queued-message dispatch and template batches. Uses the mock transport: nothing touches the network.
import { describe, expect, it } from "vitest";
import { CredentialError, TransientError } from "../../core/types";
import { dispatchMessage, dispatchQueued, sendEmail, sendTemplateBatch, subjectAndBody } from "../send";
import { EmailApiError, type EmailTransport } from "../transport";
import { verifyUnsubscribe } from "../unsubscribe";
import { CONN, FakeStore, SECRET, deps, mock } from "./fake";

const req = (over = {}) => ({ leadId: "l1", subject: "Hello {{first_name}}", body: "Dear {{first_name}},\n\nNews for {{company|you}}.", merge: true, idempotencyKey: "k1", ...over });
function setup() { const s = new FakeStore(); s.addLead("l1", "w1", "Asha@Example.com", "Asha Kumar", { company: "Acme" }); return { s, d: deps(s), t: mock() }; }

describe("consent gate (every send)", () => {
  it("sends to a consented lead with the unsubscribe headers, tenant sender identity and rendered fields", async () => {
    const { d, t } = setup();
    const r = await sendEmail(d, CONN(), t, req());
    expect(r).toMatchObject({ kind: "sent" });
    const m = t.sent[0];
    expect(m.from).toEqual({ email: "news@brand.test", name: "Brand Team" });
    expect(m.replyTo).toEqual({ email: "help@brand.test" });
    expect(m.to.email).toBe("Asha@Example.com");
    expect(m.subject).toBe("Hello Asha");
    expect(m.text).toContain("Dear Asha,");
    expect(m.text).toContain("Brand Ltd, 1 Test Road");
    expect(m.html).toContain("Unsubscribe");
    const unsub = /^<(https:\/\/app\.test\/api\/email\/unsubscribe\/(.+))>$/.exec(m.headers["List-Unsubscribe"]);
    expect(unsub).toBeTruthy();
    expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const tok = verifyUnsubscribe(unsub![2], SECRET, d.now().getTime());
    expect(tok.ok && tok.value).toMatchObject({ t: "t1", w: "w1", c: "c1", l: "l1" });
    expect(m.text).toContain(`https://app.test/unsubscribe/${unsub![2]}`);
  });
  it("blocks a lead with no consent record, before the provider is ever called", async () => {
    const s = new FakeStore(); s.addLead("l1", "w1", "a@example.com", "A B", {}, false);
    const t = mock();
    expect(await sendEmail(deps(s), CONN(), t, req())).toEqual({ kind: "blocked", reason: "no_consent" });
    expect(t.sent).toHaveLength(0);
  });
  it("blocks after consent is withdrawn (the latest row wins)", async () => {
    const { s, d, t } = setup();
    await s.recordConsent({ tenantId: "t1", workspaceId: "w1", leadId: "l1", subjectRef: "x", action: "withdrawn", note: "stop" });
    expect(await sendEmail(d, CONN(), t, req())).toEqual({ kind: "blocked", reason: "no_consent" });
    expect(t.sent).toHaveLength(0);
  });
  it("fails closed when the consent check itself fails: it throws, nothing is sent", async () => {
    const { s, d, t } = setup();
    s.failConsent = true;
    await expect(sendEmail(d, CONN(), t, req())).rejects.toThrow("db down");
    expect(t.sent).toHaveLength(0);
  });
  it("checks consent before suppression and before anything is rendered or rate-limited", async () => {
    const s = new FakeStore(); s.addLead("l1", "w1", "a@example.com", "A B", {}, false);
    let rateCalls = 0;
    const out = await sendEmail(deps(s, { rate: async () => { rateCalls++; return true; } }), CONN(), mock(), req());
    expect(out).toEqual({ kind: "blocked", reason: "no_consent" });
    expect(rateCalls).toBe(0);
  });
});

describe("other gates", () => {
  it("blocks a suppressed address even with consent (case-insensitive)", async () => {
    const { s, d, t } = setup();
    await s.addSuppression({ tenantId: "t1", workspaceId: "w1", email: "ASHA@example.com", reason: "hard_bounce", source: "test" });
    expect(await sendEmail(d, CONN(), t, req())).toEqual({ kind: "blocked", reason: "suppressed" });
    expect(t.sent).toHaveLength(0);
  });
  it("suppression is per workspace: another workspace's list does not block this one", async () => {
    const { s, d, t } = setup();
    await s.addSuppression({ tenantId: "t2", workspaceId: "w2", email: "asha@example.com", reason: "complaint", source: "test" });
    expect((await sendEmail(d, CONN(), t, req())).kind).toBe("sent");
  });
  it("blocks without a sender identity (nothing is defaulted in code) and for a lead outside the workspace", async () => {
    const { d, t } = setup();
    expect(await sendEmail(d, CONN({ settings: {} }), t, req())).toEqual({ kind: "blocked", reason: "no_sender" });
    expect(await sendEmail(d, CONN({ settings: { from_email: "not an address" } }), t, req())).toEqual({ kind: "blocked", reason: "no_sender" });
    expect(await sendEmail(d, CONN({ workspaceId: "w9" }), t, req())).toEqual({ kind: "blocked", reason: "no_recipient" });
  });
  it("blocks a lead with no address", async () => {
    const s = new FakeStore(); s.addLead("l1", "w1", null);
    expect(await sendEmail(deps(s), CONN(), mock(), req())).toEqual({ kind: "blocked", reason: "no_recipient" });
  });
  it("blocks when a merge field has no value, naming it, instead of sending a blank", async () => {
    const { d, t } = setup();
    expect(await sendEmail(d, CONN(), t, req({ body: "Hi {{district}}" }))).toEqual({ kind: "blocked", reason: "merge_missing", missing: ["district"] });
    expect(t.sent).toHaveLength(0);
  });
  it("never sends mail that cannot be opted out of (no base URL or no signing secret)", async () => {
    const { s, t } = setup();
    expect(await sendEmail(deps(s, { baseUrl: "" }), CONN(), t, req())).toEqual({ kind: "blocked", reason: "no_unsubscribe" });
    expect(await sendEmail(deps(s, { unsubscribeSecret: "" }), CONN(), t, req())).toEqual({ kind: "blocked", reason: "no_unsubscribe" });
    expect(t.sent).toHaveLength(0);
  });
  it("blocks an empty subject and an oversized body", async () => {
    const { d, t } = setup();
    expect(await sendEmail(d, CONN(), t, req({ subject: "  ", merge: false }))).toEqual({ kind: "blocked", reason: "no_subject" });
    expect(await sendEmail(d, CONN(), t, req({ body: "x".repeat(600_000), merge: false }))).toEqual({ kind: "blocked", reason: "too_large" });
  });
  it("escapes merge values in the HTML part", async () => {
    const s = new FakeStore(); s.addLead("l1", "w1", "a@example.com", "<b>Evil</b> Name");
    const t = mock();
    await sendEmail(deps(s), CONN(), t, req({ body: "Hi {{first_name}}" }));
    expect(t.sent[0].html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
    expect(t.sent[0].html).not.toContain("<b>Evil");
  });
});

describe("throttle, idempotency and provider errors", () => {
  it("asks to retry later when throttled, without sending", async () => {
    const { s, t } = setup();
    expect(await sendEmail(deps(s, { rate: async () => false }), CONN(), t, req())).toMatchObject({ kind: "retry", why: "throttled" });
    expect(t.sent).toHaveLength(0);
  });
  it("sending twice with the same idempotency key yields one message", async () => {
    const { d, t } = setup();
    const a = await sendEmail(d, CONN(), t, req()), b = await sendEmail(d, CONN(), t, req());
    expect(a).toEqual(b);
    expect(t.sent).toHaveLength(1);
  });
  it("a provider refusal of the recipient is a hard bounce: failed and suppressed for next time", async () => {
    const { s, d, t } = setup();
    t.failNext("invalid_recipient");
    expect(await sendEmail(d, CONN(), t, req())).toEqual({ kind: "failed", failure: "invalid_recipient" });
    expect(await s.isSuppressed("w1", "asha@example.com")).toBe(true);
    expect(s.suppressed[0]).toMatchObject({ reason: "hard_bounce", source: "provider_refusal" });
    expect(await sendEmail(d, CONN(), t, req({ idempotencyKey: "k2" }))).toEqual({ kind: "blocked", reason: "suppressed" });
  });
  it("other refusals fail without suppressing; bad credentials propagate; transient errors retry", async () => {
    const { s, d } = setup();
    const t = (e: Error): EmailTransport => ({ kind: "mock", ping: async () => {}, send: async () => { throw e; } });
    expect(await sendEmail(d, CONN(), t(new EmailApiError("x", 400, "invalid_request")), req())).toEqual({ kind: "failed", failure: "invalid_request" });
    expect(s.suppressed).toHaveLength(0);
    await expect(sendEmail(d, CONN(), t(new CredentialError("bad")), req())).rejects.toBeInstanceOf(CredentialError);
    expect(await sendEmail(d, CONN(), t(new TransientError("busy", 1000)), req())).toEqual({ kind: "retry", why: "transient", retryAfterMs: 1000 });
  });
});

describe("queued inbox messages", () => {
  it("dispatches a queued message and records the provider id; subject comes from the body prefix when there is no column", async () => {
    const { s, d, t } = setup();
    s.queue({ id: "m1", subject: null, body: "Subject: Your quote\n\nHere it is." });
    const r = await dispatchMessage(d, CONN(), t, "m1");
    expect(r.kind).toBe("sent");
    expect(t.sent[0].subject).toBe("Your quote");
    expect(t.sent[0].text.startsWith("Here it is.")).toBe(true);
    expect(s.msgs[0]).toMatchObject({ status: "sent", providerId: t.sent[0].providerId });
    expect(s.events.map((e) => e.type)).toContain("message.sent");
    expect(await dispatchMessage(d, CONN(), t, "m1")).toEqual({ kind: "skipped", why: "not_queued" });   // a second run does not resend
  });
  it("re-checks consent at send time: a withdrawal after queueing wins and the row is marked failed with the reason", async () => {
    const { s, d, t } = setup();
    s.queue({ id: "m1" });
    await s.recordConsent({ tenantId: "t1", workspaceId: "w1", leadId: "l1", subjectRef: "x", action: "withdrawn", note: "stop" });
    expect(await dispatchMessage(d, CONN(), t, "m1")).toEqual({ kind: "blocked", reason: "no_consent" });
    expect(t.sent).toHaveLength(0);
    expect(s.msgs[0]).toMatchObject({ status: "failed", errorCode: "no_consent" });
  });
  it("never dispatches another workspace's message, a note, or a non-email message", async () => {
    const { s, d, t } = setup();
    s.queue({ id: "other", workspaceId: "w2", tenantId: "t2" });
    s.queue({ id: "note", internal: true });
    s.queue({ id: "wa", channel: "whatsapp" });
    expect(await dispatchMessage(d, CONN(), t, "other")).toEqual({ kind: "skipped", why: "other_workspace" });
    expect(await dispatchMessage(d, CONN(), t, "note")).toEqual({ kind: "skipped", why: "internal_note" });
    expect(await dispatchMessage(d, CONN(), t, "wa")).toEqual({ kind: "skipped", why: "not_email" });
    expect(await dispatchMessage(d, CONN(), t, "missing")).toEqual({ kind: "skipped", why: "not_found" });
    expect(t.sent).toHaveLength(0);
  });
  it("dispatchQueued stops the batch at the first throttle and counts outcomes", async () => {
    const s = new FakeStore(); for (const i of [1, 2, 3]) { s.addLead(`l${i}`, "w1", `p${i}@example.com`); s.queue({ id: `m${i}`, leadId: `l${i}`, email: `p${i}@example.com` }); }
    let calls = 0;
    const out = await dispatchQueued(deps(s, { rate: async () => ++calls <= 1 }), CONN(), mock());
    expect(out).toMatchObject({ sent: 1, retry: 1 });
    expect(s.msgs.filter((m) => m.status === "queued")).toHaveLength(2);
  });
  it("subjectAndBody falls back to the sender name, never a hard-coded brand", () => {
    expect(subjectAndBody({ subject: null, body: "x" }, { settings: { from_name: "Brand Team" } })).toEqual({ subject: "Message from Brand Team", body: "x" });
    expect(subjectAndBody({ subject: null, body: "x" }, { settings: {} }).subject).toBe("Message");
    expect(subjectAndBody({ subject: "Real", body: "Subject: no\n\ny" }, { settings: {} })).toEqual({ subject: "Real", body: "Subject: no\n\ny" });
  });
});

describe("template batches (campaign sends)", () => {
  function batch() {
    const s = new FakeStore();
    for (const [i, c] of [[1, true], [2, false], [3, true], [4, true]] as const) s.addLead(`l${i}`, "w1", `p${i}@example.com`, `Person ${i}`, {}, c);
    s.templates.set("tpl", { id: "tpl", tenantId: "t1", name: "n", subject: "Hi {{first_name}}", body: "Hello {{first_name}}", status: "showcase", channel: "email" });
    return s;
  }
  it("sends only to consented leads, counts the rest by reason, records each sent message", async () => {
    const s = batch(), t = mock();
    s.addSuppression({ tenantId: "t1", workspaceId: "w1", email: "p4@example.com", reason: "complaint", source: "x" });
    const r = await sendTemplateBatch(deps(s), CONN(), t, { templateId: "tpl", leadIds: ["l1", "l2", "l3", "l4"], campaignKey: "camp1" });
    expect(r).toMatchObject({ sent: 2, blocked: { no_consent: 1, suppressed: 1 }, failed: 0, remaining: [] });
    expect(t.sent.map((m) => m.to.email)).toEqual(["p1@example.com", "p3@example.com"]);
    expect(s.msgs.filter((m) => m.status === "sent")).toHaveLength(2);
  });
  it("is idempotent: running the same batch again sends nothing new and records nothing twice", async () => {
    const s = batch(), t = mock(), d = deps(s);
    const a = { templateId: "tpl", leadIds: ["l1", "l3"], campaignKey: "camp1" };
    await sendTemplateBatch(d, CONN(), t, a);
    await sendTemplateBatch(d, CONN(), t, a);
    expect(t.sent).toHaveLength(2);
    expect(s.msgs).toHaveLength(2);
  });
  it("hands back the unsent leads when throttled, and refuses a template of another tenant", async () => {
    const s = batch(), t = mock();
    let n = 0;
    const r = await sendTemplateBatch(deps(s, { rate: async () => ++n <= 1 }), CONN(), t, { templateId: "tpl", leadIds: ["l1", "l3", "l4"], campaignKey: "c" });
    expect(r.sent).toBe(1);
    expect(r.remaining).toEqual(["l3", "l4"]);
    s.templates.set("foreign", { id: "foreign", tenantId: "t2", name: "n", subject: "x", body: "y", status: "approved", channel: "email" });
    expect((await sendTemplateBatch(deps(s), CONN(), mock(), { templateId: "foreign", leadIds: ["l1"], campaignKey: "c" })).blocked).toEqual({ template_unavailable: 1 });
  });
});
