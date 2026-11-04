import { describe, expect, it, vi } from "vitest";
import { DbError } from "@/lib/db/errors";
import type { AuditActor } from "@/lib/audit/types";
import { presetConfig } from "@/lib/config/presets";
import { withVocabLabels } from "../pipelines-load";
import { keyFromName, missingRequired, pickPipeline, pipelinesFromConfig, reorderStages, validateStageInputs, viewOfDeal, viewOfDealRow, type Pipeline, type Stage, type StageInput } from "../pipelines";
import { createPipeline, renamePipeline, saveStages, setPipelineArchived, type PipeCtx, type PipeDeps } from "../pipelines-admin";
import { patchArchivePipeline, patchCreatePipeline, patchRenamePipeline, patchSaveStages } from "../pipelines-config";

const brand = { id: "t", name: "T", product: "P", hue: 200 };
const cfg = presetConfig("legal", brand);
const hosp = presetConfig("hospitality", brand);

const stage = (key: string, position: number, over: Partial<Stage> = {}): Stage => ({ id: `id-${key}`, key, name: { en: key }, position, probability: 10, color: "neutral", outcome: "open", slaHours: null, requiredFields: [], archived: false, version: 1, ...over });
const input = (s: Stage, over: Partial<StageInput> = {}): StageInput => ({ key: s.key, id: s.id, version: s.version, name: s.name.en, probability: s.probability, color: s.color, outcome: s.outcome, slaHours: s.slaHours, requiredFields: s.requiredFields, archived: s.archived, ...over });

describe("config-backed pipelines (demo)", () => {
  it("the default deal pipeline carries the preset stages in order; leads have one pipeline", () => {
    const [def, ...rest] = pipelinesFromConfig(cfg, "deal");
    expect(rest).toEqual([]);
    expect(def).toMatchObject({ key: "sales", isDefault: true });
    expect(def.stages.map((s) => s.key)).toEqual(["discovery", "demo_scheduled", "demo_done", "proposal", "negotiation", "won", "lost"]);
    expect(def.stages.map((s) => s.name.en)).toEqual(Object.values(cfg.stages.deal).map((s) => s.label));
    expect(pipelinesFromConfig(cfg, "lead")).toHaveLength(1);
  });
  it("vocabulary parity: hospitality labels come from its preset, not from the legal ones", () => {
    expect(pipelinesFromConfig(hosp, "deal")[0].stages.find((s) => s.key === "proposal")?.name.en).toBe(hosp.stages.deal.proposal.label);
    expect(hosp.stages.deal.proposal.label).not.toBe(cfg.stages.deal.proposal.label);
  });
  it("extra pipelines follow the default, ordered; pickPipeline falls back to the default for an unknown or archived key", () => {
    const x = structuredClone(cfg);
    x.pipelines.renewals = { name: "Renewals", order: 0, stages: { won: cfg.stages.deal.won, lost: cfg.stages.deal.lost } };
    x.pipelines.old = { name: "Old", order: 1, archived: true, stages: { won: cfg.stages.deal.won, lost: cfg.stages.deal.lost } };
    const ps = pipelinesFromConfig(x, "deal");
    expect(ps.map((p) => p.key)).toEqual(["sales", "renewals", "old"]);
    expect(pickPipeline(ps, "renewals")?.key).toBe("renewals");
    expect(pickPipeline(ps, "old")?.key).toBe("sales");
    expect(pickPipeline(ps, "nope")?.key).toBe("sales");
  });
});

describe("stage input validation", () => {
  const base: StageInput[] = [
    { key: "aa", name: "A", probability: 10, color: "neutral", outcome: "open", slaHours: null, requiredFields: [], archived: false },
    { key: "ww", name: "Won", probability: 100, color: "success", outcome: "won", slaHours: null, requiredFields: [], archived: false },
    { key: "ll", name: "Lost", probability: 0, color: "danger", outcome: "lost", slaHours: null, requiredFields: [], archived: false },
  ];
  it("accepts a good list", () => expect(validateStageInputs("deal", base)).toEqual([]));
  it("needs a won and a lost stage, names, unique names, 100/0 terminals", () => {
    expect(validateStageInputs("deal", base.slice(0, 2)).map((i) => i.message)).toContain("At least one stage must count as lost.");
    expect(validateStageInputs("deal", [{ ...base[0], name: " " }, base[1], base[2]]).map((i) => i.message)).toContain("Every stage needs a name.");
    expect(validateStageInputs("deal", [base[0], { ...base[1], name: "a" }, base[2]]).map((i) => i.message)).toContain("Stage names must be different from each other.");
    expect(validateStageInputs("deal", [base[0], { ...base[1], probability: 90 }, base[2]]).map((i) => i.message)).toContain("A won stage is 100%.");
  });
  it("required fields must be core fields of the record or a known custom field", () => {
    expect(validateStageInputs("deal", [{ ...base[0], requiredFields: ["next_step", "custom.po"] }, base[1], base[2]], { customKeys: ["po"] })).toEqual([]);
    expect(validateStageInputs("deal", [{ ...base[0], requiredFields: ["custom.po"] }, base[1], base[2]]).length).toBe(1);
    expect(validateStageInputs("deal", [{ ...base[0], requiredFields: ["email"] }, base[1], base[2]]).length).toBe(1); // lead field on a deal stage
  });
  it("archiving the only won stage is refused", () => {
    expect(validateStageInputs("deal", [base[0], { ...base[1], archived: true }, base[2]]).map((i) => i.message)).toContain("At least one stage must count as won.");
  });
  it("keyFromName builds valid, unique, stable keys", () => {
    expect(keyFromName("Site visit", [])).toBe("site_visit");
    expect(keyFromName("Site visit", ["site_visit"])).toBe("site_visit_2");
    expect(keyFromName("2nd call!", [])).toMatch(/^[a-z][a-z0-9_]{1,31}$/);
    expect(keyFromName("தமிழ்", [])).toMatch(/^[a-z][a-z0-9_]{1,31}$/);
  });
  it("reorderStages moves live stages only and keeps archived ones last", () => {
    const l = [{ key: "aa", archived: false }, { key: "bb", archived: false }, { key: "z", archived: true }];
    expect(reorderStages(l, 0, 1).map((x) => x.key)).toEqual(["bb", "aa", "z"]);
    expect(reorderStages(l, 1, 1)).toBe(l);
  });
});

describe("required fields on move", () => {
  it("lists what is missing, treats 0 value/seats as missing, lets the move supply values", () => {
    const view = viewOfDeal({ value: 0, seats: 2, expectedClose: "", ownerId: "u" }, null);
    expect(missingRequired(["value", "seats", "expected_close", "next_step", "owner"], view)).toEqual(["value", "expected_close", "next_step"]);
    expect(missingRequired(["value", "expected_close"], view, { value: 500, expected_close: "2026-12-01" })).toEqual([]);
  });
  it("reads custom values from the row", () => {
    const row = viewOfDealRow({ valueInr: 10, seats: 1, expectedCloseOn: "2026-01-01", nextStep: "x", ownerId: "u", custom: { po: "" } });
    expect(missingRequired(["custom.po", "custom.other"], row)).toEqual(["custom.po", "custom.other"]);
  });
});

describe("vocabulary labels over seeded names (real workspaces)", () => {
  it("an unedited seeded stage shows the vocabulary label; an edited one keeps its own name; extra pipelines are untouched", () => {
    const def: Pipeline = { id: "p", key: "sales", objectType: "deal", name: { en: "Sales" }, isDefault: true, position: 0, archived: false, stages: [stage("proposal", 1, { name: { en: "Proposal sent" } }), stage("negotiation", 2, { name: { en: "Final call" } })] };
    const extra: Pipeline = { ...def, id: "q", key: "x", isDefault: false, stages: [stage("proposal", 1, { name: { en: "Proposal sent" } })] };
    const out = withVocabLabels([def, extra], "deal", { proposal: "Advance pending", negotiation: "Final confirmation" });
    expect(out[0].stages.map((s) => s.name.en)).toEqual(["Advance pending", "Final call"]);
    expect(out[1].stages[0].name.en).toBe("Proposal sent");
  });
});

// ---------------------------------------------------------------------------------------------------- admin (real workspaces)
const actor = { uid: "u", workspaceId: "ws", kind: "user", source: "ui", impersonation: false } as unknown as AuditActor;
function setup(stages: Stage[], opts: { inStage?: Record<string, number> } = {}) {
  let pipe: Pipeline = { id: "p1", key: "sales", objectType: "deal", name: { en: "Sales" }, isDefault: true, position: 0, archived: false, stages };
  const extra: Pipeline[] = [];
  const deps = {
    list: vi.fn(async () => [pipe, ...extra]),
    insertPipeline: vi.fn(async (a: { key: string; name: { en: string }; position: number }) => { extra.push({ id: `pid-${a.key}`, key: a.key, objectType: "deal", name: a.name, isDefault: false, position: a.position, archived: false, stages: [] }); return `pid-${a.key}`; }),
    updatePipeline: vi.fn(async () => {}),
    insertStage: vi.fn(async (a: { key: string }) => stage(a.key, 99, { id: `new-${a.key}` })),
    updateStageGuarded: vi.fn(async (_ws: string, id: string) => stage(id, 1, { version: 2 })),
    setStagePositions: vi.fn(async (_ws: string, _items: { id: string; position: number }[]) => {}),
    countInStage: vi.fn(async (_t: string, id: string) => opts.inStage?.[id] ?? 0),
    audit: vi.fn(async () => ({})),
    emit: vi.fn(async () => ({})),
  };
  const ctx: PipeCtx = { ws: "ws", tenantId: "t", objectType: "deal", actor, deps: deps as unknown as PipeDeps, customKeys: ["po"] };
  return { ctx, deps, setPipe: (p: Pipeline) => { pipe = p; } };
}
const base = () => [stage("aa", 1), stage("bb", 2), stage("ww", 3, { outcome: "won", probability: 100 }), stage("ll", 4, { outcome: "lost", probability: 0 })];

describe("saveStages", () => {
  it("adds a stage with a derived key, writes final positions, audits and emits", async () => {
    const { ctx, deps } = setup(base());
    const inputs = base().map((s) => input(s));
    inputs.splice(2, 0, { name: "Site visit", probability: 70, color: "accent", outcome: "open", slaHours: 48, requiredFields: ["next_step"], archived: false });
    const r = await saveStages(ctx, "sales", inputs);
    expect(r).toMatchObject({ ok: true, data: { added: ["site_visit"], changed: [], archived: [] } });
    expect(deps.insertStage).toHaveBeenCalledWith(expect.objectContaining({ key: "site_visit", pipelineId: "p1", write: expect.objectContaining({ slaHours: 48, requiredFields: ["next_step"], position: 2000 }) }));
    const positions = deps.setStagePositions.mock.calls[0][1];
    expect(positions).toEqual(expect.arrayContaining([{ id: "new-site_visit", position: 3 }, { id: "id-ww", position: 4 }, { id: "id-ll", position: 5 }]));
    expect(deps.audit).toHaveBeenCalledWith(actor, expect.objectContaining({ action: "pipelines.stages_saved" }));
    expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "metadata.changed", objectType: "pipeline", workspaceId: "ws" }));
  });
  it("renames with the version the editor loaded and reports a changed stage", async () => {
    const { ctx, deps } = setup(base());
    const inputs = base().map((s) => input(s, s.key === "aa" ? { name: "Alpha", version: 7 } : {}));
    const r = await saveStages(ctx, "sales", inputs);
    expect(r).toMatchObject({ ok: true, data: { changed: ["aa"] } });
    expect(deps.updateStageGuarded).toHaveBeenCalledWith("ws", "id-aa", 7, expect.objectContaining({ name: { en: "Alpha" } }), false);
    expect(deps.setStagePositions).not.toHaveBeenCalled();
  });
  it("a stale version becomes a conflict result and nothing is audited", async () => {
    const { ctx, deps } = setup(base());
    deps.updateStageGuarded.mockRejectedValue(new DbError("conflict", "conflict"));
    const r = await saveStages(ctx, "sales", base().map((s) => input(s, s.key === "aa" ? { name: "Alpha" } : {})));
    expect(r).toMatchObject({ ok: false, code: "conflict" });
    expect(deps.audit).not.toHaveBeenCalled();
  });
  it("refuses to archive a stage that still has records, and to drop an existing stage from the list", async () => {
    const { ctx, deps } = setup(base(), { inStage: { "id-bb": 3 } });
    const r = await saveStages(ctx, "sales", base().map((s) => input(s, s.key === "bb" ? { archived: true } : {})));
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect(!r.ok && r.message).toContain("still has records");
    expect(deps.updateStageGuarded).not.toHaveBeenCalled();
    const r2 = await saveStages(ctx, "sales", base().slice(1).map((s) => input(s)));
    expect(r2).toMatchObject({ ok: false, code: "conflict" });
  });
  it("archives an empty stage, parks it last, and never deletes", async () => {
    const { ctx, deps } = setup(base());
    const inputs = base().map((s) => input(s, s.key === "aa" ? { archived: true } : {}));
    const r = await saveStages(ctx, "sales", inputs);
    expect(r).toMatchObject({ ok: true, data: { archived: ["aa"] } });
    expect(deps.updateStageGuarded).toHaveBeenCalledWith("ws", "id-aa", 1, expect.objectContaining({ archived: true }), false);
    expect(deps.setStagePositions.mock.calls[0][1].find((p) => p.id === "id-aa")?.position).toBe(4);
  });
  it("validation failures come back as issues; unknown pipeline is not_found; a stage key never changes", async () => {
    const { ctx } = setup(base());
    expect(await saveStages(ctx, "sales", base().map((s) => input(s, s.key === "aa" ? { requiredFields: ["custom.nope"] } : {})))).toMatchObject({ ok: false, code: "invalid" });
    expect(await saveStages(ctx, "nope", [])).toMatchObject({ ok: false, code: "not_found" });
    expect(await saveStages(ctx, "sales", base().map((s) => input(s, s.key === "aa" ? { key: "other" } : {})))).toMatchObject({ ok: false, code: "invalid" });
  });
  it("an audit failure is reported but the saved change stands", async () => {
    const { ctx, deps } = setup(base());
    deps.audit.mockRejectedValue(new Error("down"));
    const r = await saveStages(ctx, "sales", base().map((s) => input(s, s.key === "aa" ? { name: "Alpha" } : {})));
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.sub).toContain("audit");
  });
});

describe("pipelines", () => {
  it("creates a second pipeline with New, Won and Lost stages", async () => {
    const { ctx, deps } = setup(base());
    const r = await createPipeline(ctx, "Renewals");
    expect(r).toMatchObject({ ok: true, data: { key: "renewals" } });
    expect(deps.insertStage).toHaveBeenCalledTimes(3);
    expect(deps.audit).toHaveBeenCalledWith(actor, expect.objectContaining({ action: "pipelines.created" }));
  });
  it("rejects empty and duplicate names, and a lead pipeline", async () => {
    const { ctx } = setup(base());
    expect(await createPipeline(ctx, " ")).toMatchObject({ ok: false });
    expect(await createPipeline(ctx, "sales")).toMatchObject({ ok: false }); // the default is already called Sales
  });
  it("renames and archives non-default pipelines only; archiving needs empty open stages", async () => {
    const { ctx, deps } = setup(base());
    await createPipeline(ctx, "Renewals");
    expect(await renamePipeline(ctx, "renewals", "Renewals 2")).toMatchObject({ ok: true });
    expect(await setPipelineArchived(ctx, "sales", true)).toMatchObject({ ok: false, code: "invalid" });
    expect(await setPipelineArchived(ctx, "renewals", true)).toMatchObject({ ok: true });
    expect(deps.updatePipeline).toHaveBeenLastCalledWith("ws", "pid-renewals", { archivedAt: expect.any(String) });
    expect(await setPipelineArchived(ctx, "nope", true)).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("config patches (demo)", () => {
  const edit = (c: typeof cfg) => pipelinesFromConfig(c, "deal")[0].stages.map((s) => input(s));
  it("saves stage edits for the default pipeline as a stages.deal patch with full stage objects", () => {
    const inputs = edit(cfg).map((s) => (s.key === "discovery" ? { ...s, name: "First call", requiredFields: ["owner"] } : s));
    inputs.splice(1, 0, { name: "Site visit", probability: 20, color: "accent", outcome: "open", slaHours: 24, requiredFields: [], archived: false });
    const r = patchSaveStages(cfg, "deal", "sales", inputs, () => 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const st = (r.patch.stages as { deal: Record<string, { label: string; order: number; requiredFields: string[] }> }).deal;
      expect(st.discovery).toMatchObject({ label: "First call", requiredFields: ["owner"], order: 0 });
      expect(st.site_visit).toMatchObject({ label: "Site visit", order: 1 });
      expect(st.demo_scheduled.order).toBe(2);
      expect(r.added).toEqual(["site_visit"]);
    }
  });
  it("refuses to archive a stage with deals", () => {
    const r = patchSaveStages(cfg, "deal", "sales", edit(cfg).map((s) => (s.key === "negotiation" ? { ...s, archived: true } : s)), (k) => (k === "negotiation" ? 2 : 0));
    expect(r.ok).toBe(false);
  });
  it("creates, renames and archives an extra pipeline", () => {
    const c = patchCreatePipeline(cfg, "deal", "Renewals");
    expect(c.ok && Object.keys(c.patch.pipelines as object)).toEqual(["renewals"]);
    const x = structuredClone(cfg);
    x.pipelines.renewals = { name: "Renewals", order: 0, stages: { won: cfg.stages.deal.won, lost: cfg.stages.deal.lost } };
    expect(patchCreatePipeline(x, "deal", "renewals").ok).toBe(false); // duplicate name
    expect(patchRenamePipeline(x, "renewals", "Renewals 2").ok).toBe(true);
    expect(patchRenamePipeline(x, "sales", "X").ok).toBe(false);
    expect(patchArchivePipeline(x, "renewals", true, () => 1).ok).toBe(false);
    expect(patchArchivePipeline(x, "renewals", true, () => 0).ok).toBe(true);
    expect(patchCreatePipeline(cfg, "lead", "Another").ok).toBe(false);
  });
});
