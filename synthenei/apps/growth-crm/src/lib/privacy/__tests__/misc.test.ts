import { describe, expect, it } from "vitest";
import { boardReportDueAt, boardState } from "../breach";
import { BUNDLE_ROW_CAP, buildAccessBundle, stripInternal } from "../bundle";
import { captureConsent, consentRow } from "../consent";
import { canMove, daysLeft, dueState, inboxCompare } from "../due";
import { buildNotice, noticeVersion, regionLabel } from "../notice";
import { makePrT } from "../strings";
import { maskEmail, normaliseEmail, subjectRefOf } from "../subject";
import type { PublicWorkspace } from "../types";
import { fakeDb } from "./fake-db";

const NOW = Date.UTC(2026, 10, 21, 12);
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe("due dates", () => {
  it("states", () => {
    expect(dueState("received", day(10), NOW)).toBe("on_track");
    expect(dueState("received", day(3), NOW)).toBe("due_soon");
    expect(dueState("in_progress", day(-1), NOW)).toBe("overdue");
    expect(dueState("completed", day(-30), NOW)).toBe("closed");
    expect(daysLeft(day(-2), NOW)).toBe(-2);
  });
  it("inbox order: soonest due first, closed last", () => {
    const rows = [
      { id: "c", status: "completed" as const, dueAt: day(-50), receivedAt: day(-80) }, { id: "b", status: "received" as const, dueAt: day(9), receivedAt: day(-20) },
      { id: "a", status: "received" as const, dueAt: day(-3), receivedAt: day(-33) },
    ];
    expect(rows.sort(inboxCompare(NOW)).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("closed requests stay closed", () => {
    expect(canMove("received", "in_progress")).toBe(true);
    expect(canMove("completed", "in_progress")).toBe(false);
    expect(canMove("rejected", "completed")).toBe(false);
  });
});

describe("subject", () => {
  it("hash ignores case and spaces and matches the email unsubscribe recipe", () => {
    expect(subjectRefOf(" A@B.co ")).toBe(subjectRefOf("a@b.co"));
    expect(subjectRefOf("a@b.co")).toMatch(/^[a-f0-9]{64}$/);
    expect(normaliseEmail(" X@Y.IN ")).toBe("x@y.in");
    expect(maskEmail("person@example.com")).toBe("p***@e***.com");
  });
});

const WS = (n: Partial<PublicWorkspace["notice"]> = {}, o: Partial<PublicWorkspace> = {}): PublicWorkspace => ({ wsUuid: "w", wsSlug: "s", tenantUuid: "t", orgName: "Org One", supportEmail: "help@org.example", responseDays: 20, dataRegion: "ap-southeast-1", dpo: null, notice: n, ...o });
describe("notice", () => {
  const t = makePrT("en");
  it("takes every tenant fact from config and rows", () => {
    const n = buildNotice(WS({ noticeVersion: "v3", effectiveDate: "1 Dec 2026", grievance: { name: "A. Officer", email: "dpo@org.example", hours: "5 days" } }), t);
    const all = n.sections.map((s) => s.body.join(" ")).join("\n");
    expect(n.title).toContain("Org One");
    expect(n.version).toBe("v3");
    expect(all).toContain("within 20 days");
    expect(all).toContain("Singapore");
    expect(all).toContain("A. Officer at dpo@org.example");
    expect(all).toContain("5 days");
  });
  it("tenant overrides replace the generic wording and extra sections are appended", () => {
    const n = buildNotice(WS({ intro: "Custom intro.", retention: "Seven years.", purposes: [{ key: "x", label: "Billing", text: "to invoice you" }], extraSections: [{ heading: "Cookies", body: "None." }] }), t);
    expect(n.sections.find((s) => s.id === "who")?.body).toEqual(["Custom intro."]);
    expect(n.sections.find((s) => s.id === "keep")?.body).toEqual(["Seven years."]);
    expect(n.sections.find((s) => s.id === "why")?.body).toEqual(["Billing: to invoice you"]);
    expect(n.sections.at(-1)).toMatchObject({ heading: "Cookies" });
  });
  it("falls back to the tenant support email, then to the form", () => {
    expect(buildNotice(WS(), t).sections.find((s) => s.id === "grievance")?.body[0]).toContain("help@org.example");
    expect(buildNotice(WS({}, { supportEmail: null }), t).sections.find((s) => s.id === "grievance")?.body[0]).toContain("form on this page");
  });
  it("version defaults and unknown regions are shown as given", () => {
    expect(noticeVersion(WS())).toBe("v1");
    expect(regionLabel("xx-nowhere-9")).toBe("xx-nowhere-9");
  });
  it("English wording names no tenant and has no em dashes", async () => {
    const en = (await import("../../../../messages/en/privacy.json")).default as Record<string, string>;
    const text = Object.values(en).join("\n");
    expect(text).not.toMatch(/lawsome|kaveri|shola|synthan/i);
    expect(text).not.toContain("—");
  });
});

describe("breach register", () => {
  const b = (detectedAt: string, boardNotifiedAt: string | null = null) => ({ detectedAt, boardNotifiedAt, status: "open" as const });
  it("Board report is due 72 hours after detection", () => {
    expect(boardReportDueAt("2026-11-18T00:00:00.000Z")).toBe("2026-11-21T00:00:00.000Z");
    expect(boardState(b(day(-1)), NOW)).toBe("pending");
    expect(boardState(b(day(-4)), NOW)).toBe("overdue");
    expect(boardState(b(day(-4), day(-3)), NOW)).toBe("done");
  });
});

describe("access bundle", () => {
  it("drops internal columns and keeps the person's data", () => {
    expect(stripInternal({ id: "1", tenant_id: "t", workspace_id: "w", owner_id: "o", full_name: "A" })).toEqual({ id: "1", full_name: "A" });
  });
  it("builds every section, scoped to the workspace, and flags unreadable ones in the manifest", async () => {
    const f = fakeDb({ tables: { leads: [{ id: "l", full_name: "A", tenant_id: "t", contact_id: "c" }], payments: { error: { code: "42501" } }, conversations: [{ id: "cv1" }], record_links: [{ to_id: "r1" }], records: [{ id: "r1", title: "Stay" }] } });
    const b = await buildAccessBundle(f.db, { workspaceId: "w", requestId: "q", subjectRef: "h".repeat(64), leadId: "l", now: new Date(NOW) });
    expect(b.manifest.format).toBe("access-bundle/v1");
    expect(b.data.lead[0]).not.toHaveProperty("tenant_id");
    const names = b.manifest.sections.map((s) => s.name);
    for (const n of ["lead", "activities", "conversations", "messages", "consent_log", "lead_events", "tasks", "deals", "payments", "calendar_events", "contact", "records", "privacy_requests"]) expect(names).toContain(n);
    expect(b.manifest.sections.find((s) => s.name === "payments")?.error).toContain("unreadable");
    expect(b.manifest.notes.join(" ")).toContain('"payments" could not be read');
    for (const o of f.ops.filter((x) => x.op !== "rpc" && x.table !== "messages" && x.table !== "contacts")) expect(o.filters.some(([k, v]) => k === "eq:workspace_id" && v === "w") || o.table === "leads" || o.table === "records").toBe(true);
    expect(BUNDLE_ROW_CAP).toBeGreaterThan(0);
  });
});

describe("consent capture", () => {
  it("row names the notice version and who recorded it", () => {
    expect(consentRow({ leadId: "l", purpose: "whatsapp", action: "granted", via: "manual", noticeVersion: "v7", workspaceId: "w", subjectRef: "h", recordedBy: "u", note: "phone call" })).toMatchObject({ notice_version: "v7", captured_via: "manual", recorded_by: "u", purpose: "whatsapp", action: "granted" });
  });
  it("appends a consent_log row and updates the lead flag; no delete", async () => {
    const f = fakeDb({ tables: { leads: [{ id: "l", email: "a@b.co" }] } });
    await captureConsent(f.db, "w", "u", { leadId: "l", purpose: "marketing_email", action: "withdrawn", via: "manual", noticeVersion: "v1" });
    expect(f.ops.find((o) => o.table === "consent_log")?.op).toBe("insert");
    expect(f.ops.find((o) => o.table === "leads" && o.op === "update")?.payload).toEqual({ consent_marketing: false });
    expect(f.ops.some((o) => o.op === "delete")).toBe(false);
  });
  it("a purpose without a lead flag only writes the log", async () => {
    const f = fakeDb({ tables: { leads: [{ id: "l", email: null }] } });
    await captureConsent(f.db, "w", "u", { leadId: "l", purpose: "ai_processing", action: "granted", via: "import", noticeVersion: "v1" });
    expect(f.ops.some((o) => o.table === "leads" && o.op === "update")).toBe(false);
  });
});
