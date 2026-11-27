import { describe, expect, it } from "vitest";
import { exportPath, issueExportDelivery, issueStatusToken, previewExport, redeemExport, viewStatus, type AuditEntry, type DsrDeps, type DsrRequest } from "../dsr";
import { slaClock } from "../due";
import { subjectRefOf } from "../subject";
import { checkIssuedToken, issueToken, tokenHash } from "../tokens";
import type { PublicWorkspace } from "../types";
import { fakeTokens } from "./fake-tokens";

const WS: PublicWorkspace = { wsUuid: "20000000-0000-4000-8000-000000000001", wsSlug: "acme-main", tenantUuid: "10000000-0000-4000-8000-000000000001", orgName: "Acme", supportEmail: null, responseDays: 30, dataRegion: "ap-south-1", dpo: null, notice: {} };
const SECRET = "dsr-secret-0123456789";
const EMAIL = "person@example.com";
const T0 = Date.parse("2026-12-01T05:00:00Z");

function setup(over: { req?: Partial<DsrRequest>; auditOk?: boolean; unsupported?: boolean; rateOk?: boolean } = {}) {
  let now = T0;
  const audits: AuditEntry[] = [];
  const built: unknown[] = [];
  const req: DsrRequest = { id: "30000000-0000-4000-8000-000000000001", wsUuid: WS.wsUuid, tenantUuid: WS.tenantUuid, leadId: "40000000-0000-4000-8000-000000000001", subjectRef: subjectRefOf(EMAIL), kind: "access", status: "received", receivedAt: "2026-12-01T05:00:00.000Z", dueAt: "2026-12-31T05:00:00.000Z", completedAt: null, ...over.req };
  const tokens = fakeTokens(() => now, { unsupported: over.unsupported });
  const d: DsrDeps = {
    store: {
      workspaceBySlug: async (s) => (s === WS.wsSlug ? WS : null), workspaceById: async (id) => (id === WS.wsUuid ? WS : null),
      requestById: async (_w, id) => (id === req.id ? req : null),
      buildBundle: async (i) => { built.push(i); return { manifest: { format: "access-bundle/v1" }, data: {} }; },
    },
    tokens, secret: SECRET, now: () => now, rate: async () => over.rateOk ?? true,
    audit: async (e) => { audits.push(e); return over.auditOk ?? true; },
  };
  return { d, req, audits, built, tokens, tick: (ms: number) => { now += ms; } };
}
const tamper = (s: string): string => s.slice(0, -1) + (s.endsWith("A") ? "B" : "A");
const tokenOf = (path: string) => path.split("/export/")[1];

describe("signed tokens", () => {
  it("issued tokens verify, forged and cross-purpose ones do not, and only the hash is stored", () => {
    const t = issueToken("export", SECRET);
    expect(checkIssuedToken(t.token, "export", SECRET)).toBe(true);
    expect(checkIssuedToken(t.token, "status", SECRET)).toBe(false);
    expect(checkIssuedToken(t.token, "export", "other-secret")).toBe(false);
    expect(checkIssuedToken(tamper(t.token), "export", SECRET)).toBe(false);
    expect(checkIssuedToken("p1.e.short.short", "export", SECRET)).toBe(false);
    expect(t.hash).toBe(tokenHash(t.token));
    expect(t.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(t.hash).not.toContain(t.token.slice(5, 15));
  });
  it("two tokens are never equal", () => { expect(issueToken("status", SECRET).token).not.toBe(issueToken("status", SECRET).token); });
});

describe("SLA clock", () => {
  const recv = "2026-12-01T05:00:00.000Z", due = "2026-12-31T05:00:00.000Z";
  it("counts the tenant window and the days left", () => {
    const c = slaClock("received", recv, due, Date.parse("2026-12-11T05:00:00Z"));
    expect(c).toMatchObject({ totalDays: 30, elapsedDays: 10, daysLeft: 20, state: "on_track" });
    expect(c.percent).toBe(33);
  });
  it("turns due_soon at 5 days, overdue after the due moment, closed once finished", () => {
    expect(slaClock("in_progress", recv, due, Date.parse("2026-12-26T05:00:00Z")).state).toBe("due_soon");
    expect(slaClock("received", recv, due, Date.parse("2027-01-02T05:00:00Z"))).toMatchObject({ state: "overdue", percent: 100 });
    expect(slaClock("completed", recv, due, Date.parse("2027-01-02T05:00:00Z")).state).toBe("closed");
  });
  it("honours a shorter response window", () => {
    expect(slaClock("received", recv, "2026-12-08T05:00:00.000Z", Date.parse("2026-12-03T05:00:00Z"))).toMatchObject({ totalDays: 7, daysLeft: 5, state: "due_soon" });
  });
});

describe("status link", () => {
  it("shows the request's own state and clock, and carries nothing personal", async () => {
    const s = setup();
    const token = (await issueStatusToken(s.d, { wsUuid: WS.wsUuid, tenantUuid: WS.tenantUuid, requestId: s.req.id }))!;
    expect(token).toMatch(/^p1\.s\./);
    const v = await viewStatus(s.d, "acme-main", token);
    expect(v).toMatchObject({ status: "ok", kind: "access", state: "received", orgName: "Acme", clock: { daysLeft: 30 } });
    expect(JSON.stringify(v)).not.toContain(EMAIL);
    expect(s.audits.map((a) => a.action)).toEqual(["privacy.status_link_issued"]);
  });
  it("is bounded: the 31st view is refused, and expiry is enforced", async () => {
    const s = setup();
    const token = (await issueStatusToken(s.d, { wsUuid: WS.wsUuid, tenantUuid: WS.tenantUuid, requestId: s.req.id }))!;
    for (let i = 0; i < 30; i++) expect((await viewStatus(s.d, "acme-main", token)).status).toBe("ok");
    expect((await viewStatus(s.d, "acme-main", token)).status).toBe("used");
    const s2 = setup();
    const t2 = (await issueStatusToken(s2.d, { wsUuid: WS.wsUuid, tenantUuid: WS.tenantUuid, requestId: s2.req.id }))!;
    s2.tick(15 * 86_400_000);
    expect((await viewStatus(s2.d, "acme-main", t2)).status).toBe("expired");
  });
  it("refuses a forged token, a token for another workspace slug, and answers 'unavailable' without the secret", async () => {
    const s = setup();
    expect((await viewStatus(s.d, "acme-main", "p1.s.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA")).status).toBe("invalid");
    const token = (await issueStatusToken(s.d, { wsUuid: WS.wsUuid, tenantUuid: WS.tenantUuid, requestId: s.req.id }))!;
    expect((await viewStatus(s.d, "other-slug", token)).status).toBe("invalid");
    expect((await viewStatus({ ...s.d, secret: "" }, "acme-main", token)).status).toBe("unavailable");
  });
  it("cannot be issued before migration 0032 (no ledger): null, not a throw", async () => {
    const s = setup({ unsupported: true });
    expect(await issueStatusToken(s.d, { wsUuid: WS.wsUuid, tenantUuid: WS.tenantUuid, requestId: s.req.id })).toBeNull();
  });
});

describe("authenticated export delivery", () => {
  const issue = async (s: ReturnType<typeof setup>) => {
    const r = await issueExportDelivery(s.d, { wsUuid: WS.wsUuid, requestId: s.req.id, createdBy: "50000000-0000-4000-8000-000000000001" });
    if (r.status !== "ok") throw new Error(`issue ${r.status}`);
    return { ...r, token: decodeURIComponent(tokenOf(r.path)) };
  };

  it("issues a 24 h single-use link and audits it", async () => {
    const s = setup();
    const r = await issue(s);
    expect(r.path).toBe(exportPath("acme-main", r.token));
    expect(Date.parse(r.expiresAt) - T0).toBe(24 * 3_600_000);
    expect(s.audits[0]).toMatchObject({ action: "privacy.export_delivery_issued", requestId: s.req.id, detail: { singleUse: true } });
    expect((await previewExport(s.d, "acme-main", r.token)).status).toBe("ready");
  });
  it("only access requests with a linked record can be delivered, and rejected ones cannot", async () => {
    expect((await issueExportDelivery(setup({ req: { kind: "erasure" } }).d, { wsUuid: WS.wsUuid, requestId: "30000000-0000-4000-8000-000000000001", createdBy: "u" })).status).toBe("not_access");
    expect((await issueExportDelivery(setup({ req: { leadId: null } }).d, { wsUuid: WS.wsUuid, requestId: "30000000-0000-4000-8000-000000000001", createdBy: "u" })).status).toBe("no_lead");
    expect((await issueExportDelivery(setup({ req: { status: "rejected" } }).d, { wsUuid: WS.wsUuid, requestId: "30000000-0000-4000-8000-000000000001", createdBy: "u" })).status).toBe("closed");
    expect((await issueExportDelivery(setup().d, { wsUuid: WS.wsUuid, requestId: "30000000-0000-4000-8000-0000000000ff", createdBy: "u" })).status).toBe("not_found");
    expect((await issueExportDelivery(setup({ unsupported: true }).d, { wsUuid: WS.wsUuid, requestId: "30000000-0000-4000-8000-000000000001", createdBy: "u" })).status).toBe("unavailable");
  });
  it("a new link cancels the older one", async () => {
    const s = setup();
    const a = await issue(s), b = await issue(s);
    expect((await previewExport(s.d, "acme-main", a.token)).status).toBe("invalid");
    expect((await previewExport(s.d, "acme-main", b.token)).status).toBe("ready");
  });
  it("delivers once to the verified address, audits before serving, builds the bundle at download time", async () => {
    const s = setup();
    const { token } = await issue(s);
    const r = await redeemExport(s.d, { slug: "acme-main", token, email: ` ${EMAIL.toUpperCase()} `, ip: "1.1.1.1" });
    expect(r).toMatchObject({ status: "ok", filename: "access-bundle-30000000.json" });
    expect(s.built).toEqual([{ wsUuid: WS.wsUuid, requestId: s.req.id, subjectRef: s.req.subjectRef, leadId: s.req.leadId }]);
    expect(s.audits.at(-1)).toMatchObject({ action: "privacy.export_delivered" });
    expect(JSON.stringify(s.audits)).not.toContain(EMAIL);
    // replay: spent
    expect((await redeemExport(s.d, { slug: "acme-main", token, email: EMAIL, ip: "1.1.1.1" })).status).toBe("used");
    expect(s.built).toHaveLength(1);
    expect((await previewExport(s.d, "acme-main", token)).status).toBe("used");
  });
  it("a wrong address spends nothing, is audited without the address, and the right one still works", async () => {
    const s = setup();
    const { token } = await issue(s);
    const bad = await redeemExport(s.d, { slug: "acme-main", token, email: "someone.else@example.com", ip: "1.1.1.1" });
    expect(bad.status).toBe("wrong_email");
    expect(s.built).toHaveLength(0);
    expect(s.audits.at(-1)).toMatchObject({ action: "privacy.export_denied", detail: { reason: "wrong_email" } });
    expect(JSON.stringify(s.audits)).not.toContain("someone.else");
    expect((await redeemExport(s.d, { slug: "acme-main", token, email: "not an email", ip: "1.1.1.1" })).status).toBe("wrong_email");
    expect((await redeemExport(s.d, { slug: "acme-main", token, email: EMAIL, ip: "1.1.1.1" })).status).toBe("ok");
  });
  it("expires after 24 hours", async () => {
    const s = setup();
    const { token } = await issue(s);
    s.tick(24 * 3_600_000 + 1);
    expect((await redeemExport(s.d, { slug: "acme-main", token, email: EMAIL, ip: "1.1.1.1" })).status).toBe("expired");
    expect((await previewExport(s.d, "acme-main", token)).status).toBe("expired");
    expect(s.built).toHaveLength(0);
  });
  it("refuses to serve when the audit row cannot be written", async () => {
    const s = setup();
    const { token } = await issue(s);
    const failing = { ...s.d, audit: async (e: AuditEntry) => (e.action === "privacy.export_delivered" ? false : true) };
    expect((await redeemExport(failing, { slug: "acme-main", token, email: EMAIL, ip: "1.1.1.1" })).status).toBe("unavailable");
    expect(s.built).toHaveLength(0);
  });
  it("is rate limited, signature-checked, and tied to the workspace", async () => {
    const s = setup();
    const { token } = await issue(s);
    expect((await redeemExport({ ...s.d, rate: async () => false }, { slug: "acme-main", token, email: EMAIL, ip: "1.1.1.1" })).status).toBe("rate_limited");
    expect((await redeemExport(s.d, { slug: "acme-main", token: tamper(token), email: EMAIL, ip: "1.1.1.1" })).status).toBe("invalid");
    expect((await redeemExport(s.d, { slug: "nope", token, email: EMAIL, ip: "1.1.1.1" })).status).toBe("invalid");
    expect((await redeemExport({ ...s.d, secret: "" }, { slug: "acme-main", token, email: EMAIL, ip: "1.1.1.1" })).status).toBe("unavailable");
  });
  it("a status token cannot be used as an export token", async () => {
    const s = setup();
    const st = (await issueStatusToken(s.d, { wsUuid: WS.wsUuid, tenantUuid: WS.tenantUuid, requestId: s.req.id }))!;
    expect((await redeemExport(s.d, { slug: "acme-main", token: st, email: EMAIL, ip: "1.1.1.1" })).status).toBe("invalid");
  });
});
