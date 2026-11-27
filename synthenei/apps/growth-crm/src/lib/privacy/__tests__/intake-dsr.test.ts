import { describe, expect, it } from "vitest";
import { confirmRequest, previewConfirm, type IntakeDeps, type IntakeStore } from "../intake";
import type { OpenRequest } from "../alerts";
import type { AuditEntry } from "../dsr";
import { noticeSnapshot } from "../evidence";
import { makePrT } from "../strings";
import { sealIntake } from "../token";
import { checkIssuedToken } from "../tokens";
import type { PublicWorkspace, RequestKind } from "../types";
import { fakeTokens } from "./fake-tokens";

const WS: PublicWorkspace = { wsUuid: "20000000-0000-4000-8000-000000000001", wsSlug: "acme-main", tenantUuid: "10000000-0000-4000-8000-000000000001", orgName: "Acme", supportEmail: null, responseDays: 30, dataRegion: "ap-southeast-1", dpo: null, notice: { noticeVersion: "v7" } };
const SECRET = "test-secret-0123456789";
const T0 = 1_700_000_000_000;

function setup(over: { unsupported?: boolean; open?: boolean; alertThrows?: boolean } = {}) {
  let now = T0;
  const inserts: unknown[] = [], withdrawals: Parameters<IntakeStore["withdraw"]>[0][] = [], alerts: OpenRequest[] = [], audits: AuditEntry[] = [];
  const store: IntakeStore = {
    workspaceBySlug: async (s) => (s === WS.wsSlug ? WS : null),
    workspaceById: async (id) => (id === WS.wsUuid ? WS : null),
    leadsByEmail: async () => [],
    findOpen: async () => (over.open ? { id: "req-old", dueAt: "2026-12-31T00:00:00.000Z" } : null),
    insertRequest: async (r) => { inserts.push(r); return { id: `req-${inserts.length}`, dueAt: "2026-12-31T00:00:00.000Z" }; },
    withdraw: async (i) => { withdrawals.push(i); return { consentRows: i.purposes.length }; },
  };
  const tokens = fakeTokens(() => now, { unsupported: over.unsupported });
  const deps: IntakeDeps = {
    store, secret: SECRET, baseUrl: "https://crm.example", now: () => now, rate: async () => true, send: async () => "sent",
    mailText: () => ({ subject: "s", text: "t" }), tokens,
    alert: async (r) => { if (over.alertThrows) throw new Error("bus down"); alerts.push(r); },
    audit: async (e) => { audits.push(e); return true; },
    noticeSnapshot: (ws) => noticeSnapshot(ws, makePrT("en")),
  };
  const seal = (kind: RequestKind, purposes: string[] = []) => sealIntake({ w: WS.wsUuid, k: kind, e: "person@example.com", d: "", p: purposes }, SECRET, now, 24 * 3_600_000);
  return { deps, tokens, inserts, withdrawals, alerts, audits, seal, tick: (ms: number) => { now += ms; } };
}

describe("verification link is single use (PRIV-054)", () => {
  it("the first confirmation records the request, a replay is refused and audited", async () => {
    const s = setup();
    const token = s.seal("access");
    const first = await confirmRequest(s.deps, token, "1.1.1.1");
    expect(first.status).toBe("created");
    const replay = await confirmRequest(s.deps, token, "1.1.1.1");
    expect(replay.status).toBe("used");
    expect(s.inserts).toHaveLength(1);
    expect(s.audits.map((a) => a.action)).toContain("privacy.token_replayed");
    expect(JSON.stringify(s.audits)).not.toContain("person@example.com");
  });
  it("a replay cannot re-open a request the owner already closed", async () => {
    const s = setup();
    const token = s.seal("erasure");
    await confirmRequest(s.deps, token, "1.1.1.1");
    // owner closes it: findOpen would now find nothing, but the link is spent
    expect((await confirmRequest(s.deps, token, "1.1.1.1")).status).toBe("used");
    expect(s.inserts).toHaveLength(1);
  });
  it("a replayed withdrawal does not write consent rows twice", async () => {
    const s = setup();
    const token = s.seal("withdrawal", ["marketing_email"]);
    await confirmRequest(s.deps, token, "1.1.1.1");
    await confirmRequest(s.deps, token, "1.1.1.1");
    expect(s.withdrawals).toHaveLength(1);
  });
  it("a different link for the same person is a different token and still works", async () => {
    const s = setup();
    expect((await confirmRequest(s.deps, s.seal("access"), "1.1.1.1")).status).toBe("created");
    expect((await confirmRequest(s.deps, s.seal("access"), "1.1.1.1")).status).toBe("created");
  });
  it("the confirmation page can tell a spent link from a fresh one without spending it", async () => {
    const s = setup();
    const token = s.seal("access");
    expect((await previewConfirm(s.deps, token)).status).toBe("ready");
    expect((await previewConfirm(s.deps, token)).status).toBe("ready");
    await confirmRequest(s.deps, token, "1.1.1.1");
    expect((await previewConfirm(s.deps, token)).status).toBe("used");
  });
  it("an expired link is expired, not 'used'", async () => {
    const s = setup();
    const token = s.seal("access");
    s.tick(25 * 3_600_000);
    expect((await confirmRequest(s.deps, token, "1.1.1.1")).status).toBe("expired");
  });
  it("before migration 0032 (ledger unsupported) the old behaviour holds: open requests are de-duplicated, nothing breaks", async () => {
    const s = setup({ unsupported: true });
    const token = s.seal("access");
    expect((await confirmRequest(s.deps, token, "1.1.1.1")).status).toBe("created");
    expect((await previewConfirm(s.deps, token)).status).toBe("ready");
  });
});

describe("the owner is alerted and the request is audited", () => {
  it("a new request alerts once with ids and kind, and audits request_received without the address", async () => {
    const s = setup();
    await confirmRequest(s.deps, s.seal("grievance"), "1.1.1.1");
    expect(s.alerts).toEqual([{ id: "req-1", wsUuid: WS.wsUuid, tenantUuid: WS.tenantUuid, kind: "grievance", status: "received", dueAt: "2026-12-31T00:00:00.000Z" }]);
    expect(s.audits.find((a) => a.action === "privacy.request_received")).toMatchObject({ requestId: "req-1", detail: { kind: "grievance", status: "received" } });
    expect(JSON.stringify(s.audits)).not.toContain("example.com");
  });
  it("a duplicate (open request exists) does not alert again", async () => {
    const s = setup({ open: true });
    const r = await confirmRequest(s.deps, s.seal("access"), "1.1.1.1");
    expect(r.status).toBe("duplicate");
    expect(s.alerts).toHaveLength(0);
  });
  it("a withdrawal is audited but is not an alert (it is already complete)", async () => {
    const s = setup();
    await confirmRequest(s.deps, s.seal("withdrawal", ["marketing_email", "whatsapp"]), "1.1.1.1");
    expect(s.alerts).toHaveLength(0);
    expect(s.audits.find((a) => a.action === "privacy.withdrawal_applied")).toMatchObject({ detail: { purposes: ["marketing_email", "whatsapp"], consentRows: 2 } });
  });
  it("an alert failure never reaches the requester", async () => {
    const s = setup({ alertThrows: true });
    expect((await confirmRequest(s.deps, s.seal("access"), "1.1.1.1")).status).toBe("created");
  });
});

describe("status link for the requester", () => {
  it("a signed status link comes back with the result and is bound to the first request", async () => {
    const s = setup();
    const r = await confirmRequest(s.deps, s.seal("access"), "1.1.1.1");
    expect(r.status === "created" && r.statusToken).toBeTruthy();
    const tok = (r as { statusToken: string }).statusToken;
    expect(checkIssuedToken(tok, "status", SECRET)).toBe(true);
    expect([...s.tokens.rows.values()].filter((x) => x.purpose === "status")).toHaveLength(1);
  });
  it("no ledger, no status link (and no failure)", async () => {
    const s = setup({ unsupported: true });
    const r = await confirmRequest(s.deps, s.seal("access"), "1.1.1.1");
    expect(r.status).toBe("created");
    expect((r as { statusToken?: string }).statusToken).toBeUndefined();
  });
});

describe("withdrawal evidence (PRIV-013)", () => {
  it("passes the notice text hash, the form id, an HMAC of the address and a coarse user-agent class: never the raw values", async () => {
    const s = setup();
    await confirmRequest(s.deps, s.seal("withdrawal", ["marketing_email"]), "203.0.113.9", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148");
    const ev = s.withdrawals[0].evidence!;
    expect(ev.formId).toBe("privacy-request-form");
    expect(ev.uaClass).toBe("mobile");
    expect(ev.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(ev.notice?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(s.withdrawals[0].noticeVersion).toBe("v7");
    expect(JSON.stringify(ev)).not.toContain("203.0.113.9");
    expect(JSON.stringify(ev)).not.toContain("iPhone");
  });
});
