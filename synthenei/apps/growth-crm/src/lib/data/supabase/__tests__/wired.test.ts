import { describe, expect, it } from "vitest";
import { err, has, mockDb, ok } from "@/lib/db/__tests__/mock";
import { DbError } from "@/lib/db/errors";
import { funnelFromView, pipelineSummaryFromView, repScorecardFromView } from "../../metrics";
import * as m from "../mappers";
import { AI_OFF, STILL_NOT_WIRED, createWiredReads } from "../reads";

const WS = "11111111-1111-1111-1111-111111111111";
const reads = (results: Parameters<typeof mockDb>[0], piiRead = false) => {
  const { db, calls } = mockDb(results);
  return { r: createWiredReads(WS, async () => db, { piiRead }), calls };
};

describe("mappers", () => {
  it("maps activity kinds from kind + direction + meeting type", () => {
    expect(m.activityKind({ kind: "whatsapp", direction: "inbound" })).toBe("whatsapp_in");
    expect(m.activityKind({ kind: "whatsapp", direction: "outbound" })).toBe("whatsapp_out");
    expect(m.activityKind({ kind: "meeting", meetingType: "demo", doneAt: "x" })).toBe("demo_done");
    expect(m.activityKind({ kind: "meeting", meetingType: "demo" })).toBe("demo_booked");
    expect(m.activityKind({ kind: "meeting", meetingType: "discovery" })).toBe("note");
  });

  it("team member masks email without pii.read and takes the monthly target", () => {
    const p = { fullName: "Asha K", email: "asha@firm.in" };
    expect(m.teamMember({ userId: "u1", role: "sales_rep" }, p, { wonValueInr: "250000.00" }, false)).toMatchObject({ id: "u1", name: "Asha K", role: "sales_rep", email: "a***@firm.in", monthlyTarget: 250000 });
    expect(m.teamMember({ userId: "u1", role: "owner" }, p, undefined, true)).toMatchObject({ email: "asha@firm.in", monthlyTarget: 0, title: "Owner" });
  });

  it("rolls ga4 rows up by day and landing page", () => {
    const { days, pages } = m.ga4Rollup([
      { day: "2026-10-02", channelGroup: "Direct", deviceCategory: "mobile", landingPage: "/", sessions: 10, engagedSessions: 5, totalUsers: 8, keyEvents: 1, avgEngagementSecs: "20" },
      { day: "2026-10-01", channelGroup: "Email", deviceCategory: "desktop", landingPage: "/", sessions: 30, engagedSessions: 15, totalUsers: 20, keyEvents: 2, avgEngagementSecs: "40" },
      { day: "2026-10-01", channelGroup: "Weird", deviceCategory: "", landingPage: "", sessions: 5, engagedSessions: 0, totalUsers: 4, keyEvents: 0, avgEngagementSecs: null },
    ]);
    expect(days.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(days[0]).toMatchObject({ sessions: 35, users: 24, keyEvents: 2, byChannel: { Email: 30, Direct: 0 }, byDevice: { desktop: 30, mobile: 0 } });
    expect(pages).toEqual([{ path: "/", title: "/", sessions: 40, engagementRate: 0.5, avgSecs: 35, conversions: 3 }]);
  });

  it("conversation: drops internal notes, counts unread inbound after last read", () => {
    const c = m.conversation({ id: "c1", leadId: "l1", channel: "email", lastReadAt: "2026-10-01T10:00:00Z", lastMessageAt: "2026-10-01T12:00:00Z" }, [
      { id: "m1", direction: "inbound", body: "old", createdAt: "2026-10-01T09:00:00Z" },
      { id: "m2", direction: "inbound", body: "new", createdAt: "2026-10-01T11:00:00Z" },
      { id: "m3", direction: "outbound", body: "reply", createdAt: "2026-10-01T12:00:00Z", status: "read", sentBy: "u1" },
      { id: "m4", direction: "outbound", body: "note", createdAt: "2026-10-01T12:30:00Z", isInternalNote: true },
    ]);
    expect(c.messages.map((x) => x.id)).toEqual(["m1", "m2", "m3"]);
    expect(c.unread).toBe(1);
    expect(c.messages[2]).toMatchObject({ from: "us", status: "read", authorId: "u1" });
    expect(c.aiDraft.body).toBe("");
  });

  it("integration: route id, sample feed flag, field map and sync log", () => {
    const i = m.integration(
      { provider: "zoho_crm", label: "Zoho CRM", category: "crm", direction: "both", status: "showcase", settings: { sample_feed: true }, lastSyncAt: null },
      [{ externalObject: "Deals", externalField: "Stage", localTable: "deals", localColumn: "stage_id", transform: "stage_key_map" }],
      [{ startedAt: "2026-10-01T00:00:00Z", status: "running", rowsIn: 3, error: null }],
    );
    expect(i).toMatchObject({ id: "zoho-crm", category: "CRM", trigger: "Two-way sync", sampleFeed: true, lastSyncAt: null, monogram: "ZO" });
    expect(i.fieldMap[0]).toEqual({ source: "Deals.Stage", target: "deals.stage_id", note: "stage_key_map" });
    expect(i.syncLog[0].status).toBe("partial");
  });

  it("consent keeps only modelled purposes and granted/withdrawn", () => {
    expect(m.consentEntry({ id: 1, purpose: "whatsapp", action: "granted", capturedVia: "landing_form", occurredAt: "t", noticeVersion: "v1", leadId: "l" })).toMatchObject({ id: "1", via: "landing_form" });
    expect(m.consentEntry({ id: 2, purpose: "analytics_cookies", action: "granted" })).toBeNull();
    expect(m.consentEntry({ id: 3, purpose: "whatsapp", action: "erasure_requested" })).toBeNull();
  });

  it("audit target and ip masking; sync run duration; holidays", () => {
    expect(m.auditEntry({ id: 9, occurredAt: "t", actorId: null, actorLabel: "service", action: "insert", tableName: "leads", rowId: "r1", ip: "1.2.3.4" }, false)).toEqual({ id: "9", at: "t", actorId: "service", action: "insert", target: "leads:r1", ip: "" });
    expect(m.auditEntry({ id: 9, ip: "1.2.3.4" }, true).ip).toBe("1.2.3.4");
    expect(m.syncRun({ id: 5, integrationId: "i", startedAt: "2026-10-01T00:00:00Z", finishedAt: "2026-10-01T00:00:42Z", status: "success", rowsIn: 4, rowsRejected: 1, error: null })).toMatchObject({ id: "5", durationSecs: 42, status: "success", note: "" });
    expect(m.holidays(["2026-11-08", "2026-10-20"]).map((h) => h.date)).toEqual(["2026-10-20", "2026-11-08"]);
    expect(m.holidays(null)).toEqual([]);
  });
});

describe("view mappers (metrics.ts)", () => {
  it("pipeline summary, scorecard and funnel", () => {
    const p = pipelineSummaryFromView([{ key: "won", label: "Won", position: 2, deals: 1, valueInr: "100", weightedValueInr: "100", stuckDeals: 0, probability: 100 }, { key: "new", label: "New", position: 1, deals: 2, valueInr: "50.5", weightedValueInr: "5", stuckDeals: 1, probability: 10 }]);
    expect(p.stages.map((s) => s.key)).toEqual(["new", "won"]);
    expect(p).toMatchObject({ totalValue: 150.5, weightedValue: 105, openDeals: 3 });
    expect(repScorecardFromView([{ repId: "r", fullName: "A", openLeads: 2, slaPct30d: null, attainmentPct: "55.5" }])[0]).toMatchObject({ repId: "r", slaPct: null, attainmentPct: 55.5 });
    const f = funnelFromView([{ day: "2026-10-01", eventName: "lead", events: 3, people: 2 }, { day: "2025-01-01", eventName: "lead", events: 9, people: 9 }], 90, "2026-10-10T00:00:00Z");
    expect(f).toEqual({ lead: { events: 3, people: 2 } });
  });
});

describe("wired reads (mocked PostgREST)", () => {
  it("lists exactly the entities that still lack a table", () => {
    expect([...STILL_NOT_WIRED]).toEqual(["privacyRequests", "aiSettings"]);
  });

  it("privacy requests are empty and AI settings are the off default (no query issued)", async () => {
    const { r, calls } = reads([]);
    expect(await r.privacyRequests()).toEqual([]);
    expect(await r.aiSettings()).toEqual(AI_OFF);
    expect(calls).toHaveLength(0);
  });

  it("team joins memberships, profiles and targets, all scoped to the workspace", async () => {
    const { r, calls } = reads([
      ok([{ user_id: "u1", role: "sales_rep" }, { user_id: "u2", role: "owner" }]),
      ok([{ id: "u1", full_name: "Asha", email: "asha@x.in" }]),
      ok([{ rep_id: "u1", won_value_inr: 1000 }]),
    ]);
    const team = await r.team();
    expect(team).toEqual([
      { id: "u1", name: "Asha", role: "sales_rep", title: "Sales rep", email: "a***@x.in", monthlyTarget: 1000 },
      { id: "u2", name: "Unnamed member", role: "owner", title: "Owner", email: "", monthlyTarget: 0 },
    ]);
    expect(calls[0].table).toBe("memberships");
    expect(has(calls[0], "eq", "workspace_id", WS)).toBe(true);
    expect(has(calls[1], "in", "id", ["u1", "u2"])).toBe(true);
    expect(has(calls[2], "eq", "workspace_id", WS)).toBe(true);
  });

  it("empty team skips the follow-up queries", async () => {
    const { r, calls } = reads([ok([])]);
    expect(await r.team()).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("activities use the repo, optionally filtered by lead", async () => {
    const { r, calls } = reads([ok([{ id: "a1", kind: "call", lead_id: "l1", created_at: "2026-10-01T00:00:00Z", subject: "Intro call" }])]);
    const xs = await r.activities("l1");
    expect(xs).toEqual([{ id: "a1", leadId: "l1", kind: "call", at: "2026-10-01T00:00:00Z", title: "Intro call", detail: undefined, byId: undefined }]);
    expect(calls[0].table).toBe("activities");
    expect(has(calls[0], "eq", "lead_id", "l1")).toBe(true);
  });

  it("conversations fetch all messages in one query and group them", async () => {
    const { r, calls } = reads([
      ok([{ id: "c1", lead_id: "l1", channel: "whatsapp", last_message_at: "2026-10-01T10:00:00Z", version: 1 }]),
      ok([{ id: "m1", conversation_id: "c1", direction: "inbound", body: "hi", created_at: "2026-10-01T10:00:00Z" }]),
    ]);
    const cs = await r.conversations();
    expect(cs).toHaveLength(1);
    expect(cs[0].messages).toHaveLength(1);
    expect(cs[0].unread).toBe(1);
    expect(has(calls[1], "in", "conversation_id", ["c1"])).toBe(true);
  });

  it("integrations combine repo rows, field maps and recent sync runs", async () => {
    const { r } = reads([
      ok([{ id: "i1", provider: "whatsapp", label: "WhatsApp", category: "messaging", direction: "both", status: "connected", settings: {}, last_sync_at: "2026-10-01T00:00:00Z" }]),
      ok([]),
      ok([{ id: 1, integration_id: "i1", started_at: "2026-10-01T00:00:00Z", status: "success", rows_in: 2 }]),
    ]);
    const xs = await r.integrations();
    expect(xs[0]).toMatchObject({ id: "whatsapp", status: "connected", lastSyncAt: "2026-10-01T00:00:00Z" });
    expect(xs[0].syncLog).toHaveLength(1);
  });

  it("empty integrations return [] without extra queries", async () => {
    const { r, calls } = reads([ok([])]);
    expect(await r.integrations()).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("holidays come from workspaces.holidays", async () => {
    const { r, calls } = reads([ok({ holidays: ["2026-11-08"] })]);
    expect(await r.holidays()).toEqual([{ date: "2026-11-08", name: "Holiday" }]);
    expect(calls[0].table).toBe("workspaces");
    expect(has(calls[0], "eq", "id", WS)).toBe(true);
  });

  it("audit goes through the audit repo and masks ip", async () => {
    const { r } = reads([ok([{ id: 1, occurred_at: "t", actor_label: "user", action: "update", table_name: "deals", row_id: "d1", ip: "9.9.9.9" }])]);
    const [a] = await r.audit();
    expect(a).toMatchObject({ target: "deals:d1", ip: "" });
  });

  it("a denied read throws a DbError instead of returning rows", async () => {
    const { r } = reads([err("42501", "permission denied")]);
    await expect(r.consent()).rejects.toBeInstanceOf(DbError);
  });

  it("view reads are workspace scoped", async () => {
    const { r, calls } = reads([ok([{ key: "new" }])]);
    expect(await r.views.pipelineSummary()).toEqual([{ key: "new" }]);
    expect(calls[0].table).toBe("v_pipeline_summary");
    expect(has(calls[0], "eq", "workspace_id", WS)).toBe(true);
  });
});
