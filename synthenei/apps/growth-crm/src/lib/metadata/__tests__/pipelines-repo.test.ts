import { describe, expect, it } from "vitest";
import { err, has, mockDb, ok } from "@/lib/db/__tests__/mock";
import { DbError } from "@/lib/db/errors";
import { countInStage, insertPipeline, listPipelines, setStagePositions, stageFromRow, updatePipeline, updateStageGuarded, type StageWrite } from "../pipelines-repo";

const stageRow = (over: Record<string, unknown> = {}) => ({ id: "s1", pipeline_id: "p1", key: "discovery", label: "Discovery", name: { en: "Discovery" }, position: 1, probability: 10, color: null, outcome: "open", sla_hours: null, required_fields: [], archived_at: null, version: 3, ...over });

describe("pipelines repo", () => {
  it("lists pipelines with their stages, default first, archived flagged", async () => {
    const { db, calls } = mockDb([
      ok([{ id: "p2", key: "renewals", name: { en: "Renewals", ta: "புதுப்பிப்பு" }, is_default: false, position: 1, archived_at: null }, { id: "p1", key: "sales", name: { en: "Sales" }, is_default: true, position: 0, archived_at: null }]),
      ok([stageRow(), stageRow({ id: "s2", pipeline_id: "p2", key: "open", position: 1, color: "info", sla_hours: 48, required_fields: ["next_step"], archived_at: "2026-01-01T00:00:00Z" })]),
    ]);
    const out = await listPipelines("w", "deal", async () => db);
    expect(out.map((p) => p.key)).toEqual(["sales", "renewals"]);
    expect(out[1].name).toEqual({ en: "Renewals", ta: "புதுப்பிப்பு" });
    expect(out[0].stages[0]).toMatchObject({ key: "discovery", color: "neutral", version: 3, archived: false, slaHours: null });
    expect(out[1].stages[0]).toMatchObject({ color: "info", slaHours: 48, requiredFields: ["next_step"], archived: true });
    expect(has(calls[0], "eq", "workspace_id", "w")).toBe(true);
    expect(has(calls[1], "in", "pipeline_id", ["p2", "p1"])).toBe(true);
  });
  it("a stage row with an unknown colour falls back to the outcome's colour", () => {
    expect(stageFromRow(stageRow({ color: "magenta", outcome: "won" })).color).toBe("success");
    expect(stageFromRow(stageRow({ color: null, outcome: "lost" })).color).toBe("danger");
  });
  it("updateStageGuarded writes only when the version still matches and maps a stale write to conflict", async () => {
    const w: StageWrite = { name: { en: "X" }, position: 2, probability: 20, color: "info", outcome: "open", slaHours: 24, requiredFields: ["owner"], archived: false };
    const good = mockDb([ok([stageRow({ version: 4 })])]);
    const saved = await updateStageGuarded("w", "s1", 3, w, false, async () => good.db);
    expect(saved.version).toBe(4);
    expect(has(good.calls[0], "eq", "version", 3)).toBe(true);
    const body = good.calls[0].ops.find(([o]) => o === "update")?.[1][0] as Record<string, unknown>;
    expect(body).toMatchObject({ sla_hours: 24, required_fields: ["owner"], label: "X" });
    expect("archived_at" in body).toBe(false); // unchanged archive state keeps the original timestamp
    const stale = mockDb([ok([]), ok({ id: "s1", version: 9 })]);
    await expect(updateStageGuarded("w", "s1", 3, w, false, async () => stale.db)).rejects.toMatchObject({ code: "conflict" });
    const gone = mockDb([ok([]), ok(null)]);
    await expect(updateStageGuarded("w", "s1", 3, w, false, async () => gone.db)).rejects.toMatchObject({ code: "not_found" });
    const arch = mockDb([ok([stageRow()])]);
    await updateStageGuarded("w", "s1", 3, { ...w, archived: true }, false, async () => arch.db);
    expect((arch.calls[0].ops.find(([o]) => o === "update")?.[1][0] as Record<string, unknown>).archived_at).toEqual(expect.any(String));
  });
  it("setStagePositions parks rows above the range first so the unique (pipeline, position) never clashes", async () => {
    const { db, calls } = mockDb([]);
    await setStagePositions("w", [{ id: "a", position: 2 }, { id: "b", position: 1 }], async () => db);
    const pos = calls.map((c) => (c.ops.find(([o]) => o === "update")?.[1][0] as { position: number }).position);
    expect(pos).toEqual([1002, 1001, 2, 1]);
  });
  it("countInStage ignores deleted rows; pipeline writes are workspace-scoped; errors surface", async () => {
    const c = mockDb([ok([{ id: "1" }, { id: "2" }])]);
    expect(await countInStage("deal", "s1", 50, async () => c.db)).toBe(2);
    expect(c.calls[0].table).toBe("deals"); expect(has(c.calls[0], "is", "deleted_at", null)).toBe(true);
    const l = mockDb([ok([])]);
    await countInStage("lead", "s1", 50, async () => l.db); expect(l.calls[0].table).toBe("leads");
    const i = mockDb([ok({ id: "new" })]);
    expect(await insertPipeline({ ws: "w", tenantId: "t", objectType: "deal", key: "k", name: { en: "K" }, position: 1 }, async () => i.db)).toBe("new");
    const u = mockDb([ok([])]);
    await expect(updatePipeline("w", "p", { archivedAt: null }, async () => u.db)).rejects.toBeInstanceOf(DbError);
    const dup = mockDb([err("23505")]);
    await expect(insertPipeline({ ws: "w", tenantId: "t", objectType: "deal", key: "k", name: { en: "K" }, position: 1 }, async () => dup.db)).rejects.toMatchObject({ code: "unique" });
  });
});
