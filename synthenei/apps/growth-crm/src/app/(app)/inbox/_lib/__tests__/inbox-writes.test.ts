import { describe, expect, it } from "vitest";
import { AuthzError } from "@/lib/authz";
import { failResult, runAction } from "@/lib/actions/result";
import { DbError } from "@/lib/db/errors";
import type { ConversationRow, MessageInput } from "@/lib/db/repo/types";
import { createConversationsRepo } from "@/lib/db/repo/conversations";
import { err, mockDb, ok } from "@/lib/db/__tests__/mock";
import { vocabFor } from "@/lib/vertical";
import { tamilDraft } from "../drafts";
import { draftKey } from "../draft-key";
import { buildRealItems } from "../items";
import * as P from "../persist";
import { shapeMessages } from "../reads";
import { noteSchema, sendSchema } from "../schemas";
import { it as itx, itAll } from "../strings";
import { leftHours, purposeFor, toMs, windowState } from "../window";

const WS = "11111111-1111-4111-8111-111111111111";
const UID = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-31T12:00:00Z");
const legal = vocabFor({ id: "t", vertical: "legal" } as never);
const hosp = vocabFor({ id: "t", vertical: "hospitality" } as never);
const t = itx(legal);

const conv = (o: Partial<ConversationRow> = {}): ConversationRow =>
  ({ id: "C1", channel: "whatsapp", leadId: LEAD, assigneeId: UID, status: "open", version: 3, lastInboundAt: "2026-10-31T06:30:00+00:00", ...o }) as unknown as ConversationRow;

interface Rec { inserted: MessageInput[]; touched: Record<string, unknown>[]; updates: { v: number; patch: Record<string, unknown> }[]; consentCalls: string[] }
function fake(o: { consent?: boolean; templates?: Record<string, P.TemplateRow>; updateErr?: DbError[]; fresh?: ConversationRow | null } = {}): { c: P.Ctx; rec: Rec } {
  const rec: Rec = { inserted: [], touched: [], updates: [], consentCalls: [] };
  const errs = [...(o.updateErr ?? [])];
  const repos: P.Repos = {
    conv: {
      async update(_ws, _id, v, patch) { const e = errs.shift(); if (e) throw e; rec.updates.push({ v, patch }); return { ...conv(), version: v + 1 }; },
      async touch(_ws, _id, patch) { rec.touched.push(patch); },
      async get() { return o.fresh === undefined ? conv({ version: 9 }) : o.fresh; },
    },
    msgs: { async create(_ws, input) { rec.inserted.push(input); return { id: "M1", ...input } as never; } },
    templates: { async get(_ws, id) { return o.templates?.[id] ?? null; } },
    consent: { async canContact(_lead, purpose) { rec.consentCalls.push(purpose); return o.consent ?? true; } },
    leads: { async get(_ws, id) { return id === LEAD ? { id } : null; } },
  };
  return { c: { ws: WS, uid: UID, now: NOW, repos }, rec };
}
const APPROVED: P.TemplateRow = { id: "TP1", channel: "whatsapp", name: "demo_invite", body: "Vanakkam {{1}}, thanks from {{2}}", status: "approved" };

describe("24 hour window (IST safe)", () => {
  it("is open one minute before 24 h and closed after, whatever offset the timestamps carry", () => {
    const inboundIst = "2026-10-30T23:45:00+05:30"; // = 2026-10-30T18:15:00Z
    expect(windowState("whatsapp", inboundIst, "2026-10-31T23:44:00+05:30")).toMatchObject({ open: true, applies: true });
    expect(windowState("whatsapp", inboundIst, "2026-10-31T23:45:01+05:30").open).toBe(false);
    expect(windowState("whatsapp", "2026-10-30T18:15:00Z", "2026-10-31T18:14:00Z").open).toBe(true);
    expect(windowState("whatsapp", "2026-10-30T18:15:00Z", "2026-10-31T18:15:01Z").open).toBe(false);
  });
  it("does not shift across the IST day boundary", () => {
    const w = windowState("whatsapp", "2026-10-31T00:10:00+05:30", "2026-10-31T23:30:00+05:30");
    expect(w.open).toBe(true);
    expect(Math.round(w.leftMs! / 60000)).toBe(40);
  });
  it("reads a timestamp without an offset as UTC, not server-local time", () => {
    expect(toMs("2026-10-31T06:30:00")).toBe(Date.parse("2026-10-31T06:30:00Z"));
    expect(toMs("2026-10-31 06:30:00")).toBe(Date.parse("2026-10-31T06:30:00Z"));
    expect(toMs("garbage")).toBeNull();
  });
  it("only WhatsApp has a window; no inbound yet means templates only", () => {
    expect(windowState("email", null, NOW)).toEqual({ open: true, applies: false, leftMs: null });
    expect(windowState("whatsapp", null, NOW).open).toBe(false);
    expect(leftHours(windowState("email", null, NOW))).toBeNull();
    expect(leftHours(windowState("whatsapp", "2026-10-31T00:00:00Z", NOW))).toBe(12);
  });
  it("consent purpose per channel", () => {
    expect([purposeFor("whatsapp"), purposeFor("email"), purposeFor("linkedin")]).toEqual(["whatsapp", "marketing_email", "demo_followup"]);
  });
});

describe("send: consent, window, templates", () => {
  it("free text inside the window is stored as queued, never sent, and says so", async () => {
    const { c, rec } = fake();
    const r = await P.send(c, conv(), { kind: "reply", body: "  Thursday 5.30 works  ", vars: [] }, t);
    expect(r).toMatchObject({ ok: true, message: "Queued: sending needs a connected channel", data: { status: "queued", live: false } });
    expect(rec.inserted[0]).toMatchObject({ conversationId: "C1", direction: "outbound", status: "queued", body: "Thursday 5.30 works", isInternalNote: false, sentBy: UID });
    expect(rec.consentCalls).toEqual(["whatsapp"]);
    expect(rec.touched[0]).toMatchObject({ lastMessageAt: NOW.toISOString() });
    expect(JSON.stringify(r)).not.toMatch(/was delivered|has been sent|sent to/i);
  });
  it("blocks without consent and stores nothing", async () => {
    const { c, rec } = fake({ consent: false });
    const r = await P.send(c, conv(), { kind: "reply", body: "Hello", vars: [] }, t);
    expect(r).toMatchObject({ ok: false, code: "invalid", issues: [{ path: "consent" }] });
    expect(rec.inserted).toHaveLength(0);
  });
  it("outside the window free text is refused, an approved template goes through", async () => {
    const closed = conv({ lastInboundAt: "2026-10-30T06:00:00+00:00" });
    const a = fake({ templates: { TP1: APPROVED } });
    const free = await P.send(a.c, closed, { kind: "reply", body: "Hello", vars: [] }, t);
    expect(free).toMatchObject({ ok: false, issues: [{ path: "window" }] });
    expect(a.rec.inserted).toHaveLength(0);
    const tpl = await P.send(a.c, closed, { kind: "template", body: "client text must be ignored", templateId: "TP1", vars: ["Asha", "Chambers"] }, t);
    expect(tpl.ok).toBe(true);
    expect(a.rec.inserted[0]).toMatchObject({ status: "queued", templateId: "TP1", body: "Vanakkam Asha, thanks from Chambers" });
  });
  it("non-approved, wrong-channel or unknown templates are refused", async () => {
    const tpls = { P: { ...APPROVED, id: "P", status: "pending" }, E: { ...APPROVED, id: "E", channel: "email" }, L: { ...APPROVED, id: "L", status: undefined, approvalStatus: "approved" } };
    for (const id of ["P", "E", "NOPE"]) {
      const { c, rec } = fake({ templates: tpls });
      expect(await P.send(c, conv(), { kind: "template", body: "", templateId: id, vars: [] }, t)).toMatchObject({ ok: false, issues: [{ path: "template" }] });
      expect(rec.inserted).toHaveLength(0);
    }
    const { c } = fake({ templates: tpls });
    expect((await P.send(c, conv(), { kind: "template", body: "", templateId: "L", vars: [] }, t)).ok).toBe(true); // legacy approval_status fallback
  });
  it("needs a linked lead (consent cannot be checked otherwise) and a non-empty body", async () => {
    const { c, rec } = fake();
    expect(await P.send(c, conv({ leadId: null }), { kind: "reply", body: "Hi", vars: [] }, t)).toMatchObject({ ok: false, issues: [{ path: "lead" }] });
    expect(await P.send(c, conv(), { kind: "reply", body: "   ", vars: [] }, t)).toMatchObject({ ok: false, issues: [{ path: "body" }] });
    expect(rec.inserted).toHaveLength(0);
  });
  it("email has no window", async () => {
    const { c, rec } = fake();
    const r = await P.send(c, conv({ channel: "email", lastInboundAt: null }), { kind: "reply", body: "Hi", vars: [] }, t);
    expect(r.ok).toBe(true);
    expect(rec.consentCalls).toEqual(["marketing_email"]);
  });
});

describe("internal notes", () => {
  it("are stored flagged, never as queued (no dispatcher can send them), without a consent check", async () => {
    const { c, rec } = fake({ consent: false });
    const r = await P.addNote(c, conv(), " call back after lunch ", t);
    expect(r.ok).toBe(true);
    expect(rec.inserted[0]).toMatchObject({ isInternalNote: true, status: "simulated", body: "call back after lunch", templateId: null });
    expect(rec.inserted[0].status).not.toBe("queued");
    expect(rec.consentCalls).toHaveLength(0);
  });
  it("never reach a masked payload or the thread of a masked viewer", () => {
    const rows = [
      { id: "m1", conversationId: "C1", direction: "inbound", isInternalNote: false, bodyMasked: "••••••", createdAt: "2026-10-31T01:00:00Z" },
      { id: "m2", conversationId: "C1", direction: "outbound", isInternalNote: true, bodyMasked: null, body: "SECRET NOTE", createdAt: "2026-10-31T02:00:00Z" },
    ];
    const masked = shapeMessages(rows, true);
    expect(masked.map((m) => m.id)).toEqual(["m1"]);
    expect(JSON.stringify(masked)).not.toContain("SECRET");
    expect(shapeMessages(rows, false).map((m) => m.id)).toEqual(["m1", "m2"]);
  });
  it("the item builder shows the note to the team and never to a masked caller", () => {
    const raw = {
      convs: [{ id: "C1", channel: "whatsapp", leadId: "L1", assigneeId: UID, status: "open", version: 2, lastInboundAt: "2026-10-31T06:00:00Z", lastMessageAt: "2026-10-31T07:00:00Z", createdAt: "2026-10-30T00:00:00Z" }],
      msgs: [
        { id: "m1", conversationId: "C1", direction: "inbound", isInternalNote: false, body: "Hello", status: "received", createdAt: "2026-10-31T06:00:00Z" },
        { id: "m2", conversationId: "C1", direction: "outbound", isInternalNote: true, body: "INTERNAL ONLY", status: "simulated", sentBy: UID, createdAt: "2026-10-31T07:00:00Z" },
      ],
      templates: [],
    };
    const lead = { id: "L1", name: "Asha Rao", accountId: "A1", title: "Partner", stage: "new", score: 50, ownerId: UID, consent: { followup: true, marketing: false, whatsapp: true, at: "" }, phone: "+91 90000 00000", email: "a@b.in" };
    const mk = (masked: boolean) => buildRealItems({
      raw: { ...raw, msgs: shapeMessages(raw.msgs, masked) }, leads: [lead as never], accounts: [], deals: [], team: [{ id: UID, name: "Rep One" } as never],
      v: legal, uid: UID, now: NOW.toISOString(), masked, ownOnly: false, maskName: (n) => n.split(" ").map((p) => p[0] + ".").join(" "), replyFor: () => ({ ok: true, reason: "" }),
    });
    const team = mk(false).items[0];
    expect(team.messages.find((m) => m.from === "note")?.body).toBe("INTERNAL ONLY");
    const viewer = mk(true).items[0];
    expect(JSON.stringify(viewer)).not.toContain("INTERNAL ONLY");
    expect(viewer.lead.name).toBe("A. R.");
    expect(viewer.lead.phone).toBe("");
  });
});

describe("scope and channels in the item builder", () => {
  const base = { leadId: null, status: "open", version: 1, createdAt: "2026-10-30T00:00:00Z", lastInboundAt: null };
  it("rep scope keeps only own conversations; unknown channels are counted as hidden (partial state)", () => {
    const raw = { convs: [{ ...base, id: "A", channel: "email", assigneeId: UID }, { ...base, id: "B", channel: "email", assigneeId: "someone-else" }, { ...base, id: "X", channel: "instagram", assigneeId: UID }], msgs: [], templates: [] };
    const r = buildRealItems({ raw, leads: [], accounts: [], deals: [], team: [], v: legal, uid: UID, now: NOW.toISOString(), masked: false, ownOnly: true, maskName: (n) => n, replyFor: () => ({ ok: true, reason: "" }) });
    expect(r.items.map((i) => i.id)).toEqual(["A"]);
    expect(r.hidden).toBe(1);
  });
});

describe("conflict, denied, errors", () => {
  it("a stale version becomes a conflict carrying the current version through runAction", async () => {
    const { db } = mockDb([ok([]), ok({ id: "C1", workspace_id: WS, version: 7 })]);
    const real = createConversationsRepo(() => Promise.resolve(db));
    const base = fake().c.repos;
    const repos: P.Repos = { ...base, conv: { ...base.conv, update: real.update as P.Repos["conv"]["update"] } };
    const r = await runAction(() => P.setStatus({ ws: WS, uid: UID, now: NOW, repos }, conv(), "closed", 3, t));
    expect(r).toMatchObject({ ok: false, code: "conflict", current: { version: 7 } });
  });
  it("mark read retries once on a fresh version and does not raise a conflict", async () => {
    const { c, rec } = fake({ updateErr: [new DbError("conflict", "conflict", { current: { version: 9 } })], fresh: conv({ version: 9 }) });
    const r = await P.markRead(c, conv(), 3, t);
    expect(r.ok).toBe(true);
    expect(rec.updates[0].v).toBe(9);
    expect(rec.updates[0].patch).toHaveProperty("lastReadAt");
  });
  it("assign and link are version guarded; link refuses an unknown lead", async () => {
    const { c, rec } = fake();
    expect(await P.assign(c, conv(), "U2", 3, "Rep Two", t)).toMatchObject({ ok: true, message: "Assigned to Rep Two" });
    expect(rec.updates[0]).toEqual({ v: 3, patch: { assigneeId: "U2" } });
    expect(await P.link(c, conv(), LEAD, 3, "Asha", t)).toMatchObject({ ok: true });
    expect(await P.link(c, conv(), "missing", 3, "x", t)).toMatchObject({ ok: false, code: "not_found" });
  });
  it("denied and db errors map through runAction", async () => {
    const denied = await runAction(async () => { throw new AuthzError({ allow: false, reason: "no_permission", step: 4, permission: "inbox.reply", maskedFields: [] }); });
    expect(denied).toMatchObject({ ok: false, code: "denied" });
    const { db } = mockDb([err("42501")]);
    const repos = createConversationsRepo(() => Promise.resolve(db));
    expect(await runAction(async () => { await repos.update(WS, "C1", 1, { status: "closed" }); return failResult("error", "x"); })).toMatchObject({ code: "denied" });
  });
  it("status check violation (snooze not in the schema yet) maps to invalid", async () => {
    const { db } = mockDb([err("23514")]);
    const repos = createConversationsRepo(() => Promise.resolve(db));
    const r = await runAction(async () => { await repos.update(WS, "C1", 1, { status: "snoozed" }); return failResult("error", "x"); });
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect(t("snoozeUnavailable")).toMatch(/not available yet/);
  });
});

describe("schemas", () => {
  it("limit message length and require a kind", () => {
    expect(sendSchema.safeParse({ convId: "C1", kind: "reply", body: "x".repeat(4001) }).success).toBe(false);
    expect(sendSchema.safeParse({ convId: "C1", kind: "fax", body: "x" }).success).toBe(false);
    expect(sendSchema.safeParse({ convId: "C1", kind: "template", templateId: "T", vars: ["a"] }).success).toBe(true);
    expect(noteSchema.safeParse({ convId: "C1", body: "   " }).success).toBe(false);
  });
});

describe("drafts: no cross-tenant leak", () => {
  it("Tamil sample drafts exist only for a demo session of a legal tenant", () => {
    expect(tamilDraft({ demo: true, legal: true }, "CV-71", "Asha")).toContain("Asha");
    expect(tamilDraft({ demo: false, legal: true }, "CV-71", "Asha")).toBeNull();
    expect(tamilDraft({ demo: true, legal: false }, "CV-71", "Asha")).toBeNull();
    expect(tamilDraft({ demo: true, legal: true }, "C-real-uuid", "Asha")).toBeNull();
  });
  it("saved drafts are keyed by workspace, user and conversation", () => {
    const a = draftKey("ws1", "u1", "C1");
    expect(new Set([a, draftKey("ws2", "u1", "C1"), draftKey("ws1", "u2", "C1"), draftKey("ws1", "u1", "C2")]).size).toBe(4);
  });
});

describe("vocabulary per vertical", () => {
  it("hospitality copy never says lead; neither vertical carries law words in this namespace", () => {
    const h = itAll(hosp), l = itAll(legal);
    for (const k of Object.keys(h)) expect(h[k]).not.toMatch(/\blead(s)?\b/i);
    expect(itx(hosp)("noConsent", { channel: "WhatsApp" })).toMatch(/enquiry/i);
    expect(itx(legal)("noConsent", { channel: "WhatsApp" })).toMatch(/lead/i);
    const law = /\b(advocate|lawyer|court|chambers|firm|case|bar council)s?\b/i;
    for (const k of Object.keys(h)) expect(h[k]).not.toMatch(law);
    for (const k of Object.keys(l)) expect(l[k]).not.toMatch(law);
  });
  it("copy has no em dashes or exclamation marks", () => {
    for (const s of Object.values(itAll(legal))) { expect(s).not.toContain("—"); expect(s).not.toContain("!"); }
  });
});
