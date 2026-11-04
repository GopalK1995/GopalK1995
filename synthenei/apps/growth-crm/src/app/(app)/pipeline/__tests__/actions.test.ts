import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError } from "@/lib/authz";
import { DbError } from "@/lib/db/errors";

const state = vi.hoisted(() => {
  const st = (key: string, outcome: string, requiredFields: string[] = []) => ({ id: `s-${key}`, key, name: { en: key }, position: 1, probability: 10, color: "neutral", outcome, slaHours: null, requiredFields, archived: false, version: 1 });
  return {
    demo: true, role: "sales_rep" as string, move: vi.fn(), get: vi.fn(), assertCan: vi.fn(),
    deal: { id: "d1", name: "Acme", stage: "discovery", ownerId: "me", leadId: "l1", value: 100, seats: 2, expectedClose: "2026-12-01" } as Record<string, unknown>,
    lead: { id: "l1", nextActionAt: null as string | null },
    stages: [st("discovery", "open"), st("proposal", "open"), st("negotiation", "open", ["next_step", "custom.po_number"]), st("signed", "won"), st("lost", "lost")] as ReturnType<typeof st>[],
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/db/repo/deals", () => ({ dealsRepo: { move: state.move, get: state.get } }));
vi.mock("@/lib/metadata/pipelines-load", () => ({ loadPipelines: async () => [{ id: "p1", key: "sales", objectType: "deal", name: { en: "Sales" }, isDefault: true, position: 0, archived: false, stages: state.stages }] }));
vi.mock("@/lib/authz/load", () => ({ assertCan: (...a: unknown[]) => state.assertCan(...a) }));
vi.mock("@/lib/auth/roles", () => ({ can: () => true, ROLE_LABEL: {} }));
vi.mock("@/lib/format", () => ({ inr: (n: number) => `Rs ${n}` }));
vi.mock("@/lib/vertical", () => ({
  vocabFor: () => ({
    n: { deal: { one: "deal", many: "deals" } }, role: {}, dealStage: { discovery: "Discovery", proposal: "Proposal", won: "Won", lost: "Lost" },
    lost: [["price", "Price"]],
    pl: { plans: ["Practice"], a: { roleCant: () => "no", notFound: "not found", ownOnly: "own only", wonNeedsPlan: "plan", seatsMax: "seats", needValue: "value", wonMsg: (...x: unknown[]) => `won ${x[0]}` } },
  }),
}));
vi.mock("@/lib/data/context", () => ({
  pageCtx: async () => ({
    session: { demo: state.demo, uid: "me" }, role: state.role, support: null,
    active: { tenant: { id: "t" }, ws: { id: "ws-slug", uuid: "ws-uuid" } },
    ds: { deals: async () => [state.deal], leads: async () => [state.lead] },
  }),
}));

import { moveDeal } from "../actions";

beforeEach(() => {
  state.demo = true; state.role = "sales_rep"; state.deal = { id: "d1", name: "Acme", stage: "discovery", ownerId: "me", leadId: "l1", value: 100, seats: 2, expectedClose: "2026-12-01" };
  state.lead = { id: "l1", nextActionAt: null }; state.get.mockReset();
  state.move.mockReset(); state.assertCan.mockReset().mockResolvedValue({});
});

describe("moveDeal", () => {
  it("demo: returns the 'nothing was saved' result and never touches the repository", async () => {
    const r = await moveDeal("d1", "proposal");
    expect(r.ok).toBe(true);
    expect(r.ok && r.sub).toContain("nothing was saved");
    expect(state.move).not.toHaveBeenCalled();
    expect(state.assertCan).not.toHaveBeenCalled();
  });
  it("demo: a rep cannot move someone else's deal", async () => {
    state.deal = { ...state.deal, ownerId: "other" };
    const r = await moveDeal("d1", "proposal");
    expect(r).toMatchObject({ ok: false, code: "denied" });
  });
  it("real: persists with the expected version and returns the new version", async () => {
    state.demo = false; state.move.mockResolvedValue({ version: 8 });
    const r = await moveDeal("d1", "proposal", undefined, 7);
    expect(state.move).toHaveBeenCalledWith("ws-uuid", "d1", "proposal", 7, {});
    expect(r).toMatchObject({ ok: true, data: { version: 8, stage: "proposal" } });
    expect(state.assertCan).toHaveBeenCalledWith("deals.move", expect.objectContaining({ type: "deal", ownerId: "me" }));
  });
  it("real: a stale version returns a conflict result with the current row", async () => {
    state.demo = false; state.move.mockRejectedValue(new DbError("conflict", "conflict", { current: { version: 9 } }));
    const r = await moveDeal("d1", "proposal", undefined, 7);
    expect(r).toMatchObject({ ok: false, code: "conflict", current: { version: 9 } });
  });
  it("real: record-level denial maps to denied and nothing is written", async () => {
    state.demo = false;
    state.assertCan.mockResolvedValueOnce({}).mockRejectedValueOnce(new AuthzError({ allow: false, reason: "out_of_scope", step: 6, permission: "deals.move", maskedFields: [] }));
    const r = await moveDeal("d1", "proposal", undefined, 1);
    expect(r).toMatchObject({ ok: false, code: "denied" });
    expect(state.move).not.toHaveBeenCalled();
  });
  it("real: missing version is refused before any write; validation still applies to Won", async () => {
    state.demo = false;
    expect(await moveDeal("d1", "proposal")).toMatchObject({ ok: false, code: "conflict" });
    expect(await moveDeal("d1", "signed", { won: { plan: "Nope", seats: 1, value: 1, start: "2026-01-01" } }, 1)).toMatchObject({ ok: false, code: "invalid" });
    expect(state.move).not.toHaveBeenCalled();
  });
  it("stages are data: a stage that is not in the deal's pipeline is refused, a won-outcome stage with another key asks for the Won form", async () => {
    expect(await moveDeal("d1", "nope")).toMatchObject({ ok: false, code: "invalid", message: "Unknown stage." });
    expect(await moveDeal("d1", "signed")).toMatchObject({ ok: false, code: "invalid" }); // no Won form supplied
    const r = await moveDeal("d1", "signed", { won: { plan: "Practice", seats: 3, value: 500, start: "2026-12-01" } });
    expect(r).toMatchObject({ ok: true, data: { stage: "signed" } });
  });
  it("required fields: demo refuses a move into a stage whose required field is empty, naming the field", async () => {
    const r = await moveDeal("d1", "negotiation");
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect(!r.ok && r.message).toContain("Next step");
    state.lead = { id: "l1", nextActionAt: "2026-11-20T00:00:00Z" };
    expect(await moveDeal("d1", "negotiation")).toMatchObject({ ok: false }); // the custom field is still empty
    state.stages[2].requiredFields = ["next_step"];
    expect(await moveDeal("d1", "negotiation")).toMatchObject({ ok: true });
    state.stages[2].requiredFields = ["next_step", "custom.po_number"];
  });
  it("required fields: real session reads the row, refuses before any write, and passes the stage outcome to the writer", async () => {
    state.demo = false;
    state.get.mockResolvedValue({ id: "d1", valueInr: 100, seats: 2, expectedCloseOn: "2026-12-01", nextStep: "call", ownerId: "me", custom: {} });
    const r = await moveDeal("d1", "negotiation", undefined, 4);
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect(!r.ok && r.message).toContain("po number");
    expect(state.move).not.toHaveBeenCalled();
    state.get.mockResolvedValue({ id: "d1", valueInr: 100, seats: 2, expectedCloseOn: "2026-12-01", nextStep: "call", ownerId: "me", custom: { po_number: "PO-1" } });
    state.move.mockResolvedValue({ version: 5 });
    expect(await moveDeal("d1", "negotiation", undefined, 4)).toMatchObject({ ok: true, data: { version: 5 } });
    state.move.mockResolvedValue({ version: 6 });
    await moveDeal("d1", "signed", { won: { plan: "Practice", seats: 3, value: 500, start: "2026-12-01" } }, 5);
    expect(state.move).toHaveBeenLastCalledWith("ws-uuid", "d1", "signed", 5, expect.objectContaining({ valueInr: 500, seats: 3 }));
  });
});
