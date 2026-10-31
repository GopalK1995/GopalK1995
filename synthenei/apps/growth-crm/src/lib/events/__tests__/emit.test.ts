import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/db/client";
import { emitEvent } from "../emit";

vi.mock("@/lib/db/client", () => ({ dbForRequest: vi.fn(async () => { throw new Error("no request client in tests"); }) }));

const dbWith = (result: { data: unknown; error: { code?: string; message?: string } | null }) => {
  const rpc = vi.fn(async () => result);
  return { db: { rpc } as unknown as Db, rpc };
};

describe("emitEvent", () => {
  it("calls the emit_event RPC and returns the id as a string", async () => {
    const { db, rpc } = dbWith({ data: 123, error: null });
    const id = await emitEvent({ type: "lead.exported", objectType: "lead", workspaceId: "w1", data: { count: 3 } }, db);
    expect(id).toBe("123");
    expect(rpc).toHaveBeenCalledWith("emit_event", { p_type: "lead.exported", p_object_type: "lead", p_object_id: null, p_data: { count: 3, workspace_id: "w1" } });
  });
  it("refuses a type that is not in the catalogue, without calling the database", async () => {
    const { db, rpc } = dbWith({ data: 1, error: null });
    await expect(emitEvent({ type: "lead.exploded" as never }, db)).rejects.toThrow(/unknown event type/);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps database errors to DbError", async () => {
    const { db } = dbWith({ data: null, error: { code: "42501", message: "not a member of this workspace" } });
    await expect(emitEvent({ type: "ops.test", workspaceId: "w1" }, db)).rejects.toMatchObject({ name: "DbError", code: "denied" });
  });
  it("accepts record.<object>.<verb> events", async () => {
    const { db } = dbWith({ data: 9, error: null });
    await expect(emitEvent({ type: "record.vehicle.created", workspaceId: "w1" }, db)).resolves.toBe("9");
  });
});
