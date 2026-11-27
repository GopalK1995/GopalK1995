import { describe, expect, it } from "vitest";
import { mockDb, ok, has } from "@/lib/db/__tests__/mock";
import { cleanFilters, filtersFromParams, queryAudit, withDefaultActorScope } from "../query";
import { HUMAN_ACTOR_KINDS, SYSTEM_ACTOR_KINDS } from "../types";

const WS = "11111111-1111-4111-8111-111111111111";

describe("audit log actor scope (AUD-047)", () => {
  it("defaults to people only", () => {
    expect(withDefaultActorScope({})).toEqual({ kind: "human" });
    expect(withDefaultActorScope({ action: "lead.updated" })).toEqual({ action: "lead.updated", kind: "human" });
  });
  it("Show system activity lifts the restriction; an explicit kind wins", () => {
    expect(withDefaultActorScope({ system: "1" })).toEqual({ system: "1" });
    expect(withDefaultActorScope({ kind: "connector" })).toEqual({ kind: "connector" });
  });
  it("human and system kind lists do not overlap and cover every kind", () => {
    expect(HUMAN_ACTOR_KINDS.filter((k) => (SYSTEM_ACTOR_KINDS as readonly string[]).includes(k))).toEqual([]);
    expect([...HUMAN_ACTOR_KINDS, ...SYSTEM_ACTOR_KINDS].sort()).toEqual(["agent", "api_key", "connector", "platform_admin", "support", "system", "user"]);
  });
  it("URL params are parsed and junk is dropped", () => {
    expect(filtersFromParams({ kind: "connector", system: "1" })).toEqual({ kind: "connector", system: "1" });
    expect(filtersFromParams({ kind: "root'; drop", system: "yes" })).toEqual({});
    expect(cleanFilters({ kind: "human" })).toEqual({ kind: "human" });
  });
  it("queries people with an in() on actor_kind by default", async () => {
    const { db, calls } = mockDb([ok([])]);
    await queryAudit(db, { workspaceId: WS }, withDefaultActorScope({}));
    expect(has(calls[0], "in", "actor_kind", [...HUMAN_ACTOR_KINDS])).toBe(true);
  });
  it("system toggle adds no actor_kind condition; a kind filter is an eq", async () => {
    const a = mockDb([ok([])]);
    await queryAudit(a.db, { workspaceId: WS }, withDefaultActorScope({ system: "1" }));
    expect(a.calls[0].ops.some(([, x]) => x[0] === "actor_kind")).toBe(false);
    const b = mockDb([ok([])]);
    await queryAudit(b.db, { workspaceId: WS }, withDefaultActorScope({ kind: "system", system: "1" }));
    expect(has(b.calls[0], "eq", "actor_kind", "system")).toBe(true);
  });
  it("keeps keyset pagination with the default scope", async () => {
    const row = (id: number, at: string) => ({ id, occurred_at: at, table_name: "leads", action: "update", actor_label: "Meena", actor_kind: "user", source: "ui", support_session_id: null });
    const { db } = mockDb([ok([row(3, "2026-10-12T10:00:00+00:00"), row(2, "2026-10-12T09:00:00+00:00"), row(1, "2026-10-12T08:00:00+00:00")])]);
    const page = await queryAudit(db, { workspaceId: WS }, withDefaultActorScope({}), undefined, 2);
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeTruthy();
  });
});
