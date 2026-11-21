import { describe, expect, it } from "vitest";
import { confirmRequest, previewConfirm, requestVerification, type IntakeDeps, type IntakeStore, type Mail } from "../intake";
import { subjectRefOf } from "../subject";
import { openIntake, sealIntake } from "../token";
import type { PublicWorkspace } from "../types";

const WS: PublicWorkspace = { wsUuid: "20000000-0000-4000-8000-000000000001", wsSlug: "acme-main", tenantUuid: "10000000-0000-4000-8000-000000000001", orgName: "Acme", supportEmail: null, responseDays: 30, dataRegion: "ap-southeast-1", dpo: null, notice: { noticeVersion: "v7" } };
const SECRET = "test-secret-0123456789";

function setup(over: { leads?: string[]; open?: Record<string, { id: string; dueAt: string }>; rateOk?: (k: string) => boolean; mail?: "sent" | "queued" | "failed" } = {}) {
  const inserts: Parameters<IntakeStore["insertRequest"]>[0][] = [];
  const withdrawals: Parameters<IntakeStore["withdraw"]>[0][] = [];
  const mails: Mail[] = [];
  let now = 1_700_000_000_000;
  const store: IntakeStore = {
    workspaceBySlug: async (s) => (s === WS.wsSlug ? WS : null),
    workspaceById: async (id) => (id === WS.wsUuid ? WS : null),
    leadsByEmail: async () => over.leads ?? [],
    findOpen: async (_w, _s, kind, lead) => over.open?.[`${kind}:${lead}`] ?? null,
    insertRequest: async (r) => { inserts.push(r); return { id: `req-${inserts.length}`, dueAt: "2026-12-31T00:00:00.000Z" }; },
    withdraw: async (i) => { withdrawals.push(i); return { consentRows: i.purposes.length * Math.max(1, i.leadIds.length) }; },
  };
  const deps: IntakeDeps = {
    store, secret: SECRET, baseUrl: "https://crm.example", now: () => now,
    rate: async (k) => over.rateOk?.(k) ?? true,
    send: async (m) => { mails.push(m); return over.mail ?? "sent"; },
    mailText: ({ org, kind, link }) => ({ subject: `${org} ${kind}`, text: link }),
  };
  return { deps, inserts, withdrawals, mails, tick: (ms: number) => { now += ms; } };
}
const tokenFrom = (text: string) => decodeURIComponent(text.split("/verify/")[1]);

describe("requestVerification", () => {
  it("mails a sealed link and stores nothing", async () => {
    const s = setup();
    const r = await requestVerification(s.deps, { workspace: "acme-main", kind: "access", email: " Person@Example.com ", ip: "1.1.1.1" });
    expect(r).toEqual({ status: "sent" });
    expect(s.mails).toHaveLength(1);
    expect(s.mails[0].to).toBe("person@example.com");
    expect(s.mails[0].text).toContain("https://crm.example/privacy/acme-main/verify/v1.");
    expect(s.inserts).toHaveLength(0);
  });
  it("the link does not contain the address in clear", async () => {
    const s = setup();
    await requestVerification(s.deps, { workspace: "acme-main", kind: "access", email: "person@example.com", ip: "1.1.1.1" });
    expect(s.mails[0].text).not.toContain("person");
    expect(s.mails[0].text).not.toContain(Buffer.from("person@example.com").toString("base64url"));
  });
  it("answers the same whether or not the address is in the CRM", async () => {
    const known = setup({ leads: ["l1"] }), unknown = setup({ leads: [] });
    const a = await requestVerification(known.deps, { workspace: "acme-main", kind: "erasure", email: "a@b.co", ip: "1.1.1.1" });
    const b = await requestVerification(unknown.deps, { workspace: "acme-main", kind: "erasure", email: "a@b.co", ip: "1.1.1.1" });
    expect(a).toEqual(b);
  });
  it("validates kind, email, details and purposes", async () => {
    const s = setup();
    const base = { workspace: "acme-main", ip: "i", email: "a@b.co", kind: "access" };
    expect(await requestVerification(s.deps, { ...base, kind: "nope" })).toEqual({ status: "invalid", field: "kind" });
    expect(await requestVerification(s.deps, { ...base, email: "not-an-email" })).toEqual({ status: "invalid", field: "email" });
    expect(await requestVerification(s.deps, { ...base, details: "x".repeat(1001) })).toEqual({ status: "invalid", field: "details" });
    expect(await requestVerification(s.deps, { ...base, kind: "correction" })).toEqual({ status: "invalid", field: "details" });
    expect(await requestVerification(s.deps, { ...base, kind: "withdrawal" })).toEqual({ status: "invalid", field: "purposes" });
    expect(await requestVerification(s.deps, { ...base, kind: "withdrawal", purposes: ["bogus"] })).toEqual({ status: "invalid", field: "purposes" });
    expect(s.mails).toHaveLength(0);
  });
  it("rate limits per ip, per address and per workspace, and sends nothing when limited", async () => {
    for (const prefix of ["ip:", "addr:", "ws:"]) {
      const s = setup({ rateOk: (k) => !k.includes(`privacy-req:${prefix}`) });
      const r = await requestVerification(s.deps, { workspace: "acme-main", kind: "access", email: "a@b.co", ip: "9.9.9.9" });
      expect(r.status).toBe("rate_limited");
      expect(s.mails).toHaveLength(0);
    }
  });
  it("unknown workspace and missing secret", async () => {
    const s = setup();
    expect(await requestVerification(s.deps, { workspace: "nope", kind: "access", email: "a@b.co", ip: "i" })).toEqual({ status: "unknown_workspace" });
    expect(await requestVerification({ ...s.deps, secret: "" }, { workspace: "acme-main", kind: "access", email: "a@b.co", ip: "i" })).toEqual({ status: "unavailable" });
  });
  it("reports unavailable when the mail cannot be sent", async () => {
    const s = setup({ mail: "failed" });
    expect(await requestVerification(s.deps, { workspace: "acme-main", kind: "access", email: "a@b.co", ip: "i" })).toEqual({ status: "unavailable" });
  });
});

async function link(s: ReturnType<typeof setup>, kind: string, extra: { details?: string; purposes?: string[] } = {}) {
  await requestVerification(s.deps, { workspace: "acme-main", kind, email: "person@example.com", ip: "1.1.1.1", ...extra });
  return tokenFrom(s.mails[s.mails.length - 1].text);
}

describe("confirmRequest", () => {
  it("creates one request per matching lead, holding only the hash of the address", async () => {
    const s = setup({ leads: ["l1", "l2"] });
    const out = await confirmRequest(s.deps, await link(s, "access"), "1.1.1.1");
    expect(out).toMatchObject({ status: "created", kind: "access", refs: ["req-1", "req-2"] });
    expect(s.inserts.map((i) => i.leadId)).toEqual(["l1", "l2"]);
    for (const i of s.inserts) { expect(i.subjectRef).toBe(subjectRefOf("person@example.com")); expect(JSON.stringify(i)).not.toContain("person@example.com"); expect(i.status).toBe("received"); }
  });
  it("creates one request with no lead when the address matches nobody", async () => {
    const s = setup({ leads: [] });
    await confirmRequest(s.deps, await link(s, "erasure"), "i");
    expect(s.inserts).toHaveLength(1);
    expect(s.inserts[0].leadId).toBeNull();
  });
  it("carries the requester's details into the notes", async () => {
    const s = setup({ leads: ["l1"] });
    await confirmRequest(s.deps, await link(s, "correction", { details: "my phone changed" }), "i");
    expect(s.inserts[0].notes).toBe("Requester note: my phone changed");
  });
  it("a second confirmation does not create a duplicate", async () => {
    const s = setup({ leads: ["l1"], open: { "access:l1": { id: "old", dueAt: "2026-12-01T00:00:00.000Z" } } });
    const out = await confirmRequest(s.deps, await link(s, "access"), "i");
    expect(out).toMatchObject({ status: "duplicate", refs: ["old"] });
    expect(s.inserts).toHaveLength(0);
  });
  it("withdrawal is completed on the spot and writes consent for the chosen purposes only", async () => {
    const s = setup({ leads: ["l1"] });
    const out = await confirmRequest(s.deps, await link(s, "withdrawal", { purposes: ["marketing_email", "whatsapp", "bogus"] }), "i");
    expect(out).toMatchObject({ status: "created", kind: "withdrawal", withdrawn: 2 });
    expect(s.inserts[0].status).toBe("completed");
    expect(s.withdrawals[0]).toMatchObject({ purposes: ["marketing_email", "whatsapp"], leadIds: ["l1"], noticeVersion: "v7", subjectRef: subjectRefOf("person@example.com") });
  });
  it("withdrawal with no matching lead still records the withdrawal", async () => {
    const s = setup({ leads: [] });
    await confirmRequest(s.deps, await link(s, "withdrawal", { purposes: ["marketing_email"] }), "i");
    expect(s.withdrawals[0].leadIds).toEqual([]);
  });
  it("rejects expired, forged and rate-limited confirmations without writing", async () => {
    const s = setup({ leads: ["l1"] });
    const tok = await link(s, "access");
    s.tick(25 * 3_600_000);
    expect(await confirmRequest(s.deps, tok, "i")).toEqual({ status: "expired" });
    expect(await confirmRequest(s.deps, tok.slice(0, -4) + "AAAA", "i")).toEqual({ status: "invalid" });
    expect(await confirmRequest({ ...s.deps, rate: async () => false }, tok, "i")).toEqual({ status: "rate_limited" });
    expect(s.inserts).toHaveLength(0);
  });
  it("previewConfirm never writes and names the organisation", async () => {
    const s = setup({ leads: ["l1"] });
    expect(await previewConfirm(s.deps, await link(s, "erasure"))).toEqual({ status: "ready", kind: "erasure", orgName: "Acme", slug: "acme-main" });
    expect(s.inserts).toHaveLength(0);
  });
});

describe("token", () => {
  it("round trips and rejects a different secret or a tampered body", () => {
    const t = sealIntake({ w: "w", k: "access", e: "a@b.co", d: "", p: [] }, SECRET, 1000, 5000);
    expect(openIntake(t, SECRET, 2000)).toMatchObject({ ok: true, value: { e: "a@b.co", exp: 6000 } });
    expect(openIntake(t, "other-secret", 2000)).toEqual({ ok: false, reason: "bad_signature" });
    const [v, iv, ct, tag] = t.split(".");
    expect(openIntake([v, iv, Buffer.from("x" + Buffer.from(ct, "base64url").toString("utf8")).toString("base64url"), tag].join("."), SECRET, 2000).ok).toBe(false);
    expect(openIntake(t, SECRET, 7000)).toEqual({ ok: false, reason: "expired" });
    expect(openIntake("garbage", SECRET, 0)).toEqual({ ok: false, reason: "malformed" });
    expect(() => sealIntake({ w: "w", k: "access", e: "a@b.co", d: "", p: [] }, "", 0, 1)).toThrow();
  });
});
