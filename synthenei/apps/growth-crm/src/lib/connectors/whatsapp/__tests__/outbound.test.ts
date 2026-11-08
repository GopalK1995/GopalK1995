import { beforeEach, describe, expect, it } from "vitest";
import { CredentialError, TransientError } from "../../core/types";
import { dispatchMessage, dispatchQueued } from "../outbound";
import { makeMockGateway, type MockGateway } from "../mock";
import { META_LANG } from "../templates";
import { CONN, fakeDeps, type TestDeps } from "./fake-store";

let deps: TestDeps, gw: MockGateway;
const OPEN = "2026-01-01T10:00:00Z";    // now in fakeDeps is 2026-01-01T12:00:00Z: 2 h after the last inbound
const CLOSED = "2025-12-30T10:00:00Z";
const grant = (lead = "lead-x") => deps.store.consent.push({ tenantId: "t-1", workspaceId: "w-1", leadId: lead, subjectRef: "x", purpose: "whatsapp", action: "granted", note: "" });
beforeEach(() => { deps = fakeDeps(); gw = makeMockGateway(); });

describe("free text and the 24 h window", () => {
  it("sends inside the window and records the wamid and status", async () => {
    grant();
    const id = deps.store.addOutbound({ body: "Hello", lastInboundAt: OPEN });
    const r = await dispatchMessage(deps, CONN, gw, id);
    expect(r).toEqual({ kind: "sent", wamid: "wamid.MOCK000001" });
    expect(deps.store.msgs.find((m) => m.id === id)).toMatchObject({ status: "sent", externalId: "wamid.MOCK000001" });
    expect(gw.sent[0]).toMatchObject({ kind: "text", body: "Hello", to: "919800000001" });
    expect(deps.store.events.map((e) => e.type)).toEqual(["message.sent"]);
  });
  it("outside the window free text is NOT sent: it waits for a template", async () => {
    grant();
    const id = deps.store.addOutbound({ body: "Hello", lastInboundAt: CLOSED });
    expect(await dispatchMessage(deps, CONN, gw, id)).toEqual({ kind: "blocked", reason: "window_closed" });
    expect(deps.store.msgs.find((m) => m.id === id)!.status).toBe("pending_template");
    expect(gw.sent).toHaveLength(0);
  });
  it("no inbound at all means closed; exactly 24 h is closed", async () => {
    grant();
    const a = deps.store.addOutbound({ lastInboundAt: null }), b = deps.store.addOutbound({ lastInboundAt: "2025-12-31T12:00:00Z" });
    expect((await dispatchMessage(deps, CONN, gw, a)).kind).toBe("blocked");
    expect((await dispatchMessage(deps, CONN, gw, b)).kind).toBe("blocked");
  });
  it("a window-closed refusal from Meta (131047) marks the message pending_template, not lost", async () => {
    grant();
    const id = deps.store.addOutbound({ lastInboundAt: OPEN });
    gw.failNext(131047);
    expect(await dispatchMessage(deps, CONN, gw, id)).toMatchObject({ kind: "failed", code: 131047, failure: "window_closed" });
    expect(deps.store.msgs.find((m) => m.id === id)).toMatchObject({ status: "pending_template", errorCode: "131047" });
  });
});

describe("templates", () => {
  const addTemplate = (over: Partial<{ status: string; body: string }> = {}) => {
    deps.store.tpl["tpl-1"] = { id: "tpl-1", name: "sample_followup", language: "en", status: over.status ?? "approved", body: over.body ?? "Hello {{1}}, thanks.", providerTemplateId: "p1", components: [{ type: "BODY", text: "x" }, { type: META_LANG, language: "en_US" }] };
  };
  it("an approved template goes out as a template (any time, window closed) with the vendor language and recovered parameters", async () => {
    grant(); addTemplate();
    const id = deps.store.addOutbound({ body: "Hello Asha, thanks.", templateId: "tpl-1", lastInboundAt: CLOSED });
    expect((await dispatchMessage(deps, CONN, gw, id)).kind).toBe("sent");
    expect(gw.sent[0]).toMatchObject({ kind: "template", template: "sample_followup", language: "en_US", params: ["Asha"] });
  });
  it("a template that is not approved is never sent", async () => {
    grant(); addTemplate({ status: "submitted" });
    const id = deps.store.addOutbound({ body: "Hello Asha, thanks.", templateId: "tpl-1" });
    expect(await dispatchMessage(deps, CONN, gw, id)).toEqual({ kind: "blocked", reason: "template_not_approved" });
    expect(gw.sent).toHaveLength(0);
  });
  it("a body that does not match its template is blocked rather than sent with guessed parameters", async () => {
    grant(); addTemplate();
    const id = deps.store.addOutbound({ body: "Something different", templateId: "tpl-1" });
    expect(await dispatchMessage(deps, CONN, gw, id)).toEqual({ kind: "blocked", reason: "template_params" });
  });
});

describe("consent and opt-out", () => {
  it("no consent on record: blocked and marked failed, nothing sent", async () => {
    const id = deps.store.addOutbound({ lastInboundAt: OPEN });
    expect(await dispatchMessage(deps, CONN, gw, id)).toEqual({ kind: "blocked", reason: "no_consent" });
    expect(deps.store.msgs.find((m) => m.id === id)).toMatchObject({ status: "failed", errorCode: "no_consent" });
    expect(gw.sent).toHaveLength(0);
  });
  it("a STOP after queueing wins: consent is re-checked at send time", async () => {
    grant();
    const id = deps.store.addOutbound({ lastInboundAt: OPEN });
    deps.store.consent.push({ tenantId: "t-1", workspaceId: "w-1", leadId: "lead-x", subjectRef: "x", purpose: "whatsapp", action: "withdrawn", note: "stop" });
    expect((await dispatchMessage(deps, CONN, gw, id)).kind).toBe("blocked");
    expect(gw.sent).toHaveLength(0);
  });
  it("a failing consent check propagates (fail closed, the job retries)", async () => {
    grant();
    deps.store.canContact = async () => { throw new Error("db down"); };
    const id = deps.store.addOutbound({ lastInboundAt: OPEN });
    await expect(dispatchMessage(deps, CONN, gw, id)).rejects.toThrow("db down");
    expect(deps.store.msgs.find((m) => m.id === id)!.status).toBe("queued");
  });
  it("no lead linked is blocked", async () => {
    const id = deps.store.addOutbound({ leadId: null });
    expect(await dispatchMessage(deps, CONN, gw, id)).toEqual({ kind: "blocked", reason: "no_lead" });
  });
});

describe("guards, rate limit and failures", () => {
  it("is idempotent: an already sent message is skipped, notes and other-workspace rows are never sent", async () => {
    grant();
    const id = deps.store.addOutbound({ lastInboundAt: OPEN });
    await dispatchMessage(deps, CONN, gw, id);
    expect(await dispatchMessage(deps, CONN, gw, id)).toEqual({ kind: "skipped", why: "not_queued" });
    expect(gw.sent).toHaveLength(1);
    const note = deps.store.addOutbound({ isNote: true, lastInboundAt: OPEN });
    expect(await dispatchMessage(deps, CONN, gw, note)).toEqual({ kind: "skipped", why: "internal_note" });
    const foreign = deps.store.addOutbound({ workspaceId: "w-2", tenantId: "t-2", lastInboundAt: OPEN });
    expect(await dispatchMessage(deps, CONN, gw, foreign)).toEqual({ kind: "skipped", why: "other_workspace" });
    expect(await dispatchMessage(deps, CONN, gw, "missing")).toEqual({ kind: "skipped", why: "not_found" });
    const email = deps.store.addOutbound({ channel: "email", lastInboundAt: OPEN });
    expect(await dispatchMessage(deps, CONN, gw, email)).toEqual({ kind: "skipped", why: "not_whatsapp" });
    expect(gw.sent).toHaveLength(1);
  });
  it("the rate limit leaves the message queued for the next run", async () => {
    grant();
    deps = fakeDeps(deps.store, { rate: async () => false });
    const id = deps.store.addOutbound({ lastInboundAt: OPEN });
    expect(await dispatchMessage(deps, CONN, gw, id)).toMatchObject({ kind: "retry", why: "throttled" });
    expect(deps.store.msgs.find((m) => m.id === id)!.status).toBe("queued");
  });
  it("a vendor throttle (130429) or a transient error leaves it queued; a dead token surfaces as a credential error", async () => {
    grant();
    const a = deps.store.addOutbound({ lastInboundAt: OPEN });
    gw.failNext(130429);
    expect(await dispatchMessage(deps, CONN, gw, a)).toMatchObject({ kind: "retry", why: "transient" });
    expect(deps.store.msgs.find((m) => m.id === a)!.status).toBe("queued");
    const slow = { ...gw, sendText: async () => { throw new TransientError("down", 1000); } };
    expect(await dispatchMessage(deps, CONN, slow, a)).toEqual({ kind: "retry", why: "transient", retryAfterMs: 1000 });
    const dead = { ...gw, sendText: async () => { throw new CredentialError("expired"); } };
    await expect(dispatchMessage(deps, CONN, dead, a)).rejects.toBeInstanceOf(CredentialError);
    expect(deps.store.msgs.find((m) => m.id === a)!.status).toBe("queued");
  });
  it("sandbox: the 6th distinct recipient is refused by the (mock) test number, the first five are fine", async () => {
    for (let i = 1; i <= 6; i++) {
      grant(`lead-${i}`);
      deps.store.addOutbound({ leadId: `lead-${i}`, waId: `9198000000${i}0`, lastInboundAt: OPEN });
    }
    const s = await dispatchQueued(deps, CONN, gw);
    expect(s).toMatchObject({ sent: 5, failed: 1 });
    expect(deps.store.msgs.filter((m) => m.status === "failed")).toHaveLength(1);
    expect(deps.store.msgs.find((m) => m.status === "failed")).toMatchObject({ errorCode: "131030", errorDetail: "recipient_not_allowed" });
  });
  it("dispatchQueued stops the batch on a throttle and keeps the rest queued", async () => {
    grant();
    let n = 0;
    deps = fakeDeps(deps.store, { rate: async () => ++n <= 2 });
    for (let i = 0; i < 4; i++) deps.store.addOutbound({ lastInboundAt: OPEN });
    const s = await dispatchQueued(deps, CONN, gw);
    expect(s).toMatchObject({ sent: 2, retry: 1 });
    expect(deps.store.msgs.filter((m) => m.status === "queued")).toHaveLength(2);
  });
});
