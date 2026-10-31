import { describe, expect, it, vi } from "vitest";
import type { EventRow } from "@/lib/events/types";
import { processNotify, type NotificationInsert, type NotifyPayload, type NotifyPorts } from "../process";
import { quietKind } from "../prefs";
import type { PrefRow, RuleRow } from "../types";

const WS = "00000000-0000-4000-8000-0000000000a1";
const OTHER_WS = "00000000-0000-4000-8000-0000000000b2";
const [ACTOR, OWNER, MGR, FOLLOWER, NOACCESS, OUTSIDER] = ["a", "b", "c", "d", "e", "f"].map((c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`);
const ROLE = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-10-31T06:00:00Z"); // 11:30 IST

const ev = (over: Partial<EventRow> = {}): EventRow => ({
  id: 7, tenant_id: "t", workspace_id: WS, type: "lead.assigned", object_type: "lead", object_id: "lead-1",
  actor_kind: "user", actor_id: ACTOR, data: { after: { stage: "won" } }, occurred_at: "2026-10-31T05:59:00Z", ...over,
});
const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  id: "r1", workspaceId: WS, eventType: "lead.*", conditions: {}, recipients: ["owner"], channels: ["in_app"], template: {}, enabled: true, ...over,
});
const payload: NotifyPayload = { event_id: "7", occurred_at: "2026-10-31T05:59:00Z", rule_id: "r1", workspace_id: WS, type: "lead.assigned", dedupe: "nt:7:r1" };

function fake(o: { event?: EventRow | null; rule?: RuleRow | null; readers?: string[]; members?: string[]; prefs?: PrefRow[]; stored?: NotificationInsert[] } = {}) {
  const stored = o.stored ?? [];
  const members = new Set(o.members ?? [OWNER, MGR, FOLLOWER, NOACCESS, ACTOR]);
  const readers = new Set(o.readers ?? [OWNER, MGR, FOLLOWER, ACTOR]);
  const ports: NotifyPorts = {
    event: async () => (o.event === undefined ? ev() : o.event),
    rule: async () => (o.rule === undefined ? rule() : o.rule),
    objectOwners: async () => ({ ownerId: OWNER, assigneeId: null }),
    teamManagers: async () => [MGR],
    roleMembers: async (r) => (r === ROLE ? [FOLLOWER, NOACCESS, OUTSIDER] : []),
    followers: async () => [FOLLOWER, ACTOR],
    activeMembers: async (ids) => ids.filter((i) => members.has(i)),
    canRead: vi.fn(async (u: string, ws: string) => ws === WS && readers.has(u)),
    displayName: async () => "Priya",
    prefs: async () => o.prefs ?? [],
    existing: async (_u, _ws, keys) => new Set(stored.map((s) => s.body.dedupe).filter((k) => keys.includes(k))),
    insert: async (rows) => { stored.push(...rows); },
    emailOf: async (u) => `${u.slice(0, 4)}@example.test`,
  };
  return { ports, stored };
}
const run = (f: ReturnType<typeof fake>, sender = { send: vi.fn(async () => ({ status: "queued" as const })) }) =>
  processNotify(payload, f.ports, { now: NOW, sender }).then((r) => ({ r, sender }));

describe("processNotify", () => {
  it("creates an in-app notification for the owner, never for the actor", async () => {
    const f = fake({ rule: rule({ recipients: ["owner", `user:${ACTOR}`] }) });
    const { r } = await run(f);
    expect(r).toBe("done");
    expect(f.stored.map((s) => s.userId)).toEqual([OWNER]);
    expect(f.stored[0]).toMatchObject({ kind: "lead.assigned", url: "/leads/lead-1", objectType: "lead", workspaceId: WS, actorId: ACTOR });
    expect(f.stored[0].title.en).toBe("Lead assigned");
    expect(f.stored[0].body.en).toBe("By Priya");
  });

  it("is idempotent: a redelivered message creates nothing new", async () => {
    const f = fake();
    await run(f);
    await run(f);
    await run(f);
    expect(f.stored).toHaveLength(1);
    expect(f.stored[0].body.dedupe).toBe(`nt:7:r1:${OWNER}`);
  });

  it("resolves team managers, followers and roles, and drops users without read access", async () => {
    const f = fake({ rule: rule({ recipients: ["owner", "team_manager", "followers", `role:${ROLE}`] }) });
    await run(f);
    const ids = f.stored.map((s) => s.userId).sort();
    expect(ids).toEqual([OWNER, MGR, FOLLOWER].sort());
    expect(ids).not.toContain(NOACCESS); // member but cannot read the record
    expect(ids).not.toContain(OUTSIDER); // not an active member of the workspace
  });

  it("never notifies someone through a record they cannot read (no leak of the change)", async () => {
    const f = fake({ readers: [] });
    await run(f);
    expect(f.stored).toHaveLength(0);
  });

  it("cross-workspace isolation: foreign event, foreign rule, or disabled rule do nothing", async () => {
    for (const f of [fake({ event: ev({ workspace_id: OTHER_WS }) }), fake({ rule: rule({ workspaceId: OTHER_WS }) }), fake({ rule: rule({ enabled: false }) }), fake({ rule: null }), fake({ event: null })]) {
      expect((await run(f)).r).toBe("done");
      expect(f.stored).toHaveLength(0);
    }
  });

  it("conditions gate the rule; invalid conditions fail closed", async () => {
    const hit = fake({ rule: rule({ conditions: { field: "record.stage", op: "eq", value: "won" } }) });
    await run(hit);
    expect(hit.stored).toHaveLength(1);
    const miss = fake({ rule: rule({ conditions: { field: "record.stage", op: "eq", value: "lost" } }) });
    await run(miss);
    expect(miss.stored).toHaveLength(0);
    const bad = fake({ rule: rule({ conditions: { nonsense: true } }) });
    await run(bad);
    expect(bad.stored).toHaveLength(0);
  });

  it("respects user preferences: a muted kind creates nothing, other users unaffected", async () => {
    const f = fake({
      rule: rule({ recipients: ["owner", "team_manager"] }),
      prefs: [{ userId: OWNER, workspaceId: WS, kind: "lead.assigned", channels: [], digest: "off" }],
    });
    await run(f);
    expect(f.stored.map((s) => s.userId)).toEqual([MGR]);
  });

  it("email is queued through the stub sender, flagged queued and never claimed delivered", async () => {
    const f = fake({ rule: rule({ channels: ["in_app", "email"] }) });
    const { sender } = await run(f);
    expect(f.stored[0].body.email).toBe("queued");
    expect(JSON.stringify(f.stored[0].body)).not.toMatch(/sent|delivered/i);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({ dedupe: `nt:7:r1:${OWNER}` }));
  });

  it("quiet hours (IST) set deliverAfter on the email, in-app still arrives", async () => {
    const f = fake({
      rule: rule({ channels: ["in_app", "email"] }),
      prefs: [{ userId: OWNER, workspaceId: WS, kind: quietKind("11:00-12:00"), channels: ["in_app"], digest: "instant" }],
    });
    await run(f);
    expect(f.stored[0].body).toMatchObject({ email: "queued", deliverAfter: "2026-10-31T06:30:00.000Z" }); // 12:00 IST
  });

  it("comment events: the DB trigger owns in-app rows, so rules add no duplicate row", async () => {
    const f = fake({ event: ev({ type: "comment.created", object_type: "lead" }), rule: rule({ eventType: "comment.created", channels: ["in_app", "email"] }) });
    const { sender } = await run(f);
    expect(f.stored).toHaveLength(0);
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it("notification text carries no PII beyond the actor display name, and is short", async () => {
    const f = fake({ event: ev({ data: { after: { stage: "won", email: "x@y.z", phone: "+919999999999" } } }) });
    await run(f);
    const text = JSON.stringify([f.stored[0].title, f.stored[0].body]);
    expect(text).not.toMatch(/@|\+91|x@y/);
    expect(Object.values(f.stored[0].body).every((v) => v.length <= 140)).toBe(true);
  });

  it("template placeholders are filled and truncated", async () => {
    const f = fake({ rule: rule({ template: { title: { en: "{actor} assigned a lead", ta: "{actor}" }, body: { en: "x".repeat(300) } } }) });
    await run(f);
    expect(f.stored[0].title).toEqual({ en: "Priya assigned a lead", ta: "Priya" });
    expect(f.stored[0].body.en).toHaveLength(140);
  });
});
