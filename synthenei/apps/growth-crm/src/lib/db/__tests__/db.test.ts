import { describe, expect, it } from "vitest";
import { updateVersioned } from "../concurrency";
import { DbError, mapPgError } from "../errors";
import { toCamel, toSnake } from "../map";
import { decodeCursor, encodeCursor } from "../page";
import { createLeadsRepo } from "../repo/leads";
import { createDealsRepo } from "../repo/deals";
import { createTasksRepo } from "../repo/tasks";
import { createConversationsRepo } from "../repo/conversations";
import * as repos from "../repo";
import { runAction, okResult } from "@/lib/actions/result";
import { err, has, mockDb, ok } from "./mock";

describe("map", () => {
  it("maps keys both ways and keeps jsonb values", () => {
    expect(toCamel({ full_name: "a", utm: { a_b: 1 }, owner_id: null })).toEqual({ fullName: "a", utm: { a_b: 1 }, ownerId: null });
    expect(toSnake({ fullName: "a", ownerId: undefined, nextStepAt: 1 })).toEqual({ full_name: "a", next_step_at: 1 });
  });
});

describe("mapPgError", () => {
  it.each([["42501", "denied"], ["PGRST116", "not_found"], ["23505", "unique"], ["P0409", "conflict"], ["23514", "invalid"], ["22P02", "invalid"], ["XX000", "error"]])("%s -> %s", (pg, code) => {
    expect(mapPgError({ code: pg, message: "m" })?.code).toBe(code);
  });
  it("null stays null", () => expect(mapPgError(null)).toBeNull());
});

describe("cursor", () => {
  it("round trips and rejects junk", () => {
    expect(decodeCursor(encodeCursor({ v: "2026-01-01T00:00:00Z", id: "x" }))).toEqual({ v: "2026-01-01T00:00:00Z", id: "x" });
    expect(decodeCursor("%%%")).toBeNull();
  });
});

describe("updateVersioned", () => {
  it("returns the camelCased row when the version matches", async () => {
    const { db, calls } = mockDb([ok([{ id: "1", version: 3, full_name: "n" }])]);
    const r = await updateVersioned<{ fullName: string; version: number }>("leads", "1", 2, { fullName: "n" }, { db, ws: "w" });
    expect(r).toMatchObject({ fullName: "n", version: 3 });
    expect(has(calls[0], "eq", "version", 2)).toBe(true);
    expect(has(calls[0], "eq", "workspace_id", "w")).toBe(true);
  });
  it("surfaces conflict with the current row", async () => {
    const { db } = mockDb([ok([]), ok({ id: "1", version: 5 })]);
    await expect(updateVersioned("leads", "1", 2, {}, { db })).rejects.toMatchObject({ code: "conflict", current: { id: "1", version: 5 } });
  });
  it("surfaces not_found when the row is gone", async () => {
    const { db } = mockDb([ok([]), ok(null)]);
    await expect(updateVersioned("leads", "1", 2, {}, { db })).rejects.toMatchObject({ code: "not_found" });
  });
  it("never patches protected columns", async () => {
    const { db, calls } = mockDb([ok([{ id: "1" }])]);
    await updateVersioned("leads", "1", 1, { id: "z", workspaceId: "z", fullName: "a" } as never, { db });
    expect(calls[0].ops.find(([o]) => o === "update")?.[1][0]).toEqual({ full_name: "a" });
  });
});

describe("list / paging", () => {
  it("scopes by ws, hides soft-deleted, returns nextCursor when more rows exist", async () => {
    const rows = [1, 2, 3].map((n) => ({ id: `id${n}`, created_at: `2026-01-0${n}T00:00:00Z` }));
    const { db, calls } = mockDb([ok(rows)]);
    const page = await createLeadsRepo(async () => db).list("ws1", { limit: 2 });
    expect(page.rows).toHaveLength(2);
    expect(decodeCursor(page.nextCursor as string)).toEqual({ v: "2026-01-02T00:00:00Z", id: "id2" });
    expect(has(calls[0], "eq", "workspace_id", "ws1")).toBe(true);
    expect(has(calls[0], "is", "deleted_at", null)).toBe(true);
    expect(has(calls[0], "limit", 3)).toBe(true);
  });
  it("last page has no cursor and a cursor adds the keyset filter", async () => {
    const { db, calls } = mockDb([ok([{ id: "a", created_at: "t" }])]);
    const page = await createLeadsRepo(async () => db).list("w", { cursor: encodeCursor({ v: "t2", id: "b" }), limit: 5 });
    expect(page.nextCursor).toBeNull();
    expect(calls[0].ops.find(([o]) => o === "or")?.[1][0]).toContain('created_at.lt."t2"');
  });
  it("rejects a malformed cursor and unsafe filter fields", async () => {
    const { db } = mockDb([]);
    const repo = createLeadsRepo(async () => db);
    await expect(repo.list("w", { cursor: "junk" })).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.list("w", { filters: [{ field: "a;b", op: "eq", value: 1 }] })).rejects.toMatchObject({ code: "invalid" });
  });
  it("maps RLS denial to a typed DbError", async () => {
    const { db } = mockDb([err("42501")]);
    const p = createLeadsRepo(async () => db).list("w");
    await expect(p).rejects.toBeInstanceOf(DbError);
  });
});

describe("writes", () => {
  it("create sends snake_case plus workspace_id", async () => {
    const { db, calls } = mockDb([ok({ id: "1", full_name: "n" })]);
    const r = await createLeadsRepo(async () => db).create("w", { fullName: "n" } as never);
    expect(r).toMatchObject({ fullName: "n" });
    expect(calls[0].ops.find(([o]) => o === "insert")?.[1][0]).toEqual({ full_name: "n", workspace_id: "w" });
  });
  it("softDelete is version guarded", async () => {
    const { db, calls } = mockDb([ok([{ id: "1" }])]);
    await createLeadsRepo(async () => db).softDelete("w", "1", 4);
    expect(has(calls[0], "eq", "version", 4)).toBe(true);
  });
  it("deals.move resolves the stage key then updates with the version", async () => {
    const { db, calls } = mockDb([ok({ id: "d", tenant_id: "t", version: 1 }), ok({ id: "s9" }), ok([{ id: "d", stage_id: "s9", version: 2 }])]);
    const d = await createDealsRepo(async () => db).move("w", "d", "won", 1, {});
    expect(d).toMatchObject({ stageId: "s9", version: 2 });
    expect(calls[1].table).toBe("pipeline_stages");
    expect(has(calls[2], "eq", "version", 1)).toBe(true);
  });
  it("tasks.complete only touches open tasks in the workspace", async () => {
    const { db, calls } = mockDb([ok(null)]);
    await createTasksRepo(async () => db).complete("w", ["a", "b"]);
    expect(has(calls[0], "in", "id", ["a", "b"])).toBe(true);
    expect(has(calls[0], "is", "completed_at", null)).toBe(true);
  });
  it("conversation messages filter by conversation", async () => {
    const { db, calls } = mockDb([ok([])]);
    await createConversationsRepo(async () => db).messages("w", "c1");
    expect(calls[0].table).toBe("messages");
    expect(has(calls[0], "eq", "conversation_id", "c1")).toBe(true);
  });
});

describe("repo contract: every method", () => {
  const expected: Record<string, string[]> = {
    leadsRepo: ["list", "get", "create", "update", "softDelete", "assign"],
    accountsRepo: ["list", "get", "create", "update", "softDelete"],
    contactsRepo: ["list", "get", "create", "update", "softDelete"],
    dealsRepo: ["list", "get", "create", "update", "softDelete", "move"],
    tasksRepo: ["list", "get", "create", "update", "complete"],
    activitiesRepo: ["list", "get", "create", "update"],
    campaignsRepo: ["list", "get", "create", "update"],
    conversationsRepo: ["list", "get", "create", "update", "messages", "addMessage"],
    messagesRepo: ["listForConversation", "get", "create"],
    integrationsRepo: ["list", "get", "create", "update"],
    auditRepo: ["list"],
  };
  it.each(Object.entries(expected))("%s", (name, methods) => {
    expect(Object.keys((repos as unknown as Record<string, object>)[name]).sort()).toEqual([...methods].sort());
  });
});

describe("runAction", () => {
  it("maps DbError, zod issues and passes ok through", async () => {
    expect(await runAction(async () => okResult("fine"))).toMatchObject({ ok: true });
    expect(await runAction(async () => { throw new DbError("conflict", "conflict", { current: { v: 1 } }); })).toMatchObject({ ok: false, code: "conflict", current: { v: 1 } });
    expect(await runAction(async () => { throw new DbError("unique"); })).toMatchObject({ code: "invalid" });
    expect(await runAction(async () => { throw { issues: [{ path: ["a", 0], message: "bad" }] }; })).toMatchObject({ code: "invalid", issues: [{ path: "a.0", message: "bad" }] });
  });
});
