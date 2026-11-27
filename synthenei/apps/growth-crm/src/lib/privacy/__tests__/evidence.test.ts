import { describe, expect, it, vi } from "vitest";
import { cleanFormId, evidenceColumns, ipHash, noticeSnapshot, uaClass } from "../evidence";
import { insertConsentRows, registerNotice } from "../consent-write";
import { consentRow } from "../consent";
import { expectedFlags, flagMismatches, type LogRow } from "../reconcile";
import { makePrT } from "../strings";
import type { PublicWorkspace } from "../types";
import { fakeDb } from "./fake-db";

vi.mock("server-only", () => ({}));

const WS: PublicWorkspace = { wsUuid: "w", wsSlug: "acme", tenantUuid: "t", orgName: "Acme", supportEmail: "privacy@acme.test", responseDays: 30, dataRegion: "ap-south-1", dpo: null, notice: { noticeVersion: "v3" } };
const t = makePrT("en");

describe("uaClass", () => {
  it("sorts the common agents into five coarse classes and never keeps the string", () => {
    expect(uaClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Mobile/15E148")).toBe("mobile");
    expect(uaClass("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit Chrome Mobile Safari")).toBe("mobile");
    expect(uaClass("Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit Chrome Safari")).toBe("tablet");
    expect(uaClass("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(uaClass("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120")).toBe("desktop");
    expect(uaClass("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe("bot");
    expect(uaClass("curl/8.0")).toBe("bot");
    expect(uaClass("")).toBe("unknown");
    expect(uaClass(null)).toBe("unknown");
  });
});

describe("ipHash", () => {
  it("is a 64-hex HMAC: stable per secret, different per secret, never the address", () => {
    const a = ipHash("203.0.113.9", "s1"), b = ipHash("203.0.113.9", "s1"), c = ipHash("203.0.113.9", "s2");
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain("203");
    expect(ipHash(" 203.0.113.9 ", "s1")).toBe(a);
  });
  it("records absence as absence", () => {
    expect(ipHash("", "s1")).toBeNull();
    expect(ipHash("unknown", "s1")).toBeNull();
    expect(ipHash(null, "s1")).toBeNull();
    expect(ipHash("203.0.113.9", "")).toBeNull();
  });
});

describe("noticeSnapshot", () => {
  it("is stable for the same notice and changes when any wording changes", () => {
    const a = noticeSnapshot(WS, t), b = noticeSnapshot(WS, t);
    expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(a).toEqual(b);
    expect(a.version).toBe("v3");
    expect(a.text).toContain("Version: v3");
    expect(noticeSnapshot({ ...WS, notice: { ...WS.notice, retention: "We keep leads for 6 months." } }, t).sha256).not.toBe(a.sha256);
    expect(noticeSnapshot({ ...WS, orgName: "Other" }, t).sha256).not.toBe(a.sha256);
  });
});

describe("consent rows carry evidence", () => {
  it("a team capture names its form and cites the notice hash, and has no address hash", () => {
    const row = consentRow({ leadId: "l", purpose: "marketing_email", action: "granted", via: "manual", noticeVersion: "v3", evidence: { noticeSha256: "a".repeat(64) }, workspaceId: "w", subjectRef: "h", recordedBy: "u" });
    expect(row).toMatchObject({ notice_sha256: "a".repeat(64), form_id: "crm:manual", ip_hash: null, ua_class: null, notice_version: "v3" });
  });
  it("evidenceColumns drops a malformed form id", () => {
    expect(evidenceColumns({ noticeSha256: null, formId: "bad form!", ipHash: null, uaClass: null }).form_id).toBeNull();
    expect(cleanFormId("lawsome-landing/demo-form@v2")).toBe("lawsome-landing/demo-form@v2");
  });
});

describe("insertConsentRows degrades without migration 0032", () => {
  const rows = [{ workspace_id: "w", subject_ref: "h", purpose: "marketing_email", action: "withdrawn", notice_sha256: "a".repeat(64), form_id: "f", ip_hash: null, ua_class: "mobile" }];
  it("keeps the evidence when the columns exist", async () => {
    const { db, ops } = fakeDb();
    const r = await insertConsentRows(db, rows);
    expect(r).toMatchObject({ error: null, evidence: true });
    expect(ops).toHaveLength(1);
    expect((ops[0].payload as Record<string, unknown>[])[0].form_id).toBe("f");
  });
  it("retries without the evidence columns when they are missing (PGRST204 / 42703)", async () => {
    for (const code of ["PGRST204", "42703"]) {
      let n = 0;
      const { db, ops } = fakeDb({ failOn: () => (n++ === 0 ? { code } : null) });
      const r = await insertConsentRows(db, rows);
      expect(r).toMatchObject({ error: null, evidence: false });
      expect(ops).toHaveLength(2);
      expect(Object.keys((ops[1].payload as Record<string, unknown>[])[0])).toEqual(["workspace_id", "subject_ref", "purpose", "action"]);
    }
  });
  it("retries with the notice hash dropped when the text was never registered (23503), keeping the rest", async () => {
    let n = 0;
    const { db, ops } = fakeDb({ failOn: () => (n++ === 0 ? { code: "23503" } : null) });
    const r = await insertConsentRows(db, rows);
    expect(r.error).toBeNull();
    const second = (ops[1].payload as Record<string, unknown>[])[0];
    expect(second.notice_sha256).toBeNull();
    expect(second.ua_class).toBe("mobile");
  });
  it("does not swallow a real failure", async () => {
    const { db } = fakeDb({ failOn: () => ({ code: "42501" }) });
    expect((await insertConsentRows(db, rows)).error?.code).toBe("42501");
  });
});

describe("registerNotice", () => {
  const snap = { version: "v3", sha256: "b".repeat(64), text: "x" };
  it("is idempotent (23505 is fine) and says unsupported before 0032", async () => {
    expect(await registerNotice(fakeDb().db, "t", snap)).toBe("ok");
    expect(await registerNotice(fakeDb({ failOn: () => ({ code: "23505" }) }).db, "t", snap)).toBe("ok");
    expect(await registerNotice(fakeDb({ failOn: () => ({ code: "PGRST205" }) }).db, "t", snap)).toBe("unsupported");
    expect(await registerNotice(fakeDb({ failOn: () => ({ code: "42501" }) }).db, "t", snap)).toBe("failed");
  });
});

describe("flag reconciliation", () => {
  const rows: LogRow[] = [
    { leadId: "a", purpose: "marketing_email", action: "granted", occurredAt: "2026-01-01T00:00:00Z", id: 1 },
    { leadId: "a", purpose: "marketing_email", action: "withdrawn", occurredAt: "2026-02-01T00:00:00Z", id: 2 },
    { leadId: "a", purpose: "demo_followup", action: "granted", occurredAt: "2026-01-01T00:00:00Z", id: 3 },
    { leadId: "b", purpose: "whatsapp", action: "granted", occurredAt: "2026-03-01T00:00:00Z", id: 4 },
    { leadId: "b", purpose: "whatsapp", action: "erasure_completed", occurredAt: "2026-03-01T00:00:00Z", id: 5 },
    { leadId: "c", purpose: "analytics_cookies", action: "granted", occurredAt: "2026-03-01T00:00:00Z", id: 6 },
  ];
  it("the newest row per purpose wins, ties by id, purposes without a flag are ignored", () => {
    const e = expectedFlags(rows);
    expect(e.get("a")).toEqual({ consent_marketing: false, consent_demo_followup: true });
    expect(e.get("b")).toEqual({ consent_whatsapp: false });
    expect(e.has("c")).toBe(false);
  });
  it("finds the PRIV-015 case: withdrawn in the log, still true on the lead", () => {
    const m = flagMismatches([{ id: "a", flags: { consent_marketing: true, consent_demo_followup: true } }, { id: "b", flags: { consent_whatsapp: false } }, { id: "z", flags: { consent_marketing: true } }], rows);
    expect(m).toEqual([{ leadId: "a", flag: "consent_marketing", stored: true, expected: false }]);
  });
  it("is empty once flags follow the log", () => {
    expect(flagMismatches([{ id: "a", flags: { consent_marketing: false, consent_demo_followup: true } }, { id: "b", flags: { consent_whatsapp: false } }], rows)).toEqual([]);
  });
});
