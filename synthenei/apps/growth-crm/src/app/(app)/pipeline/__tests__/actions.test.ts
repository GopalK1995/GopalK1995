import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError } from "@/lib/authz";
import { DbError } from "@/lib/db/errors";

const state = vi.hoisted(() => ({
  demo: true, role: "sales_rep" as string, move: vi.fn(), assertCan: vi.fn(),
  deal: { id: "d1", name: "Acme", stage: "discovery", ownerId: "me" } as Record<string, unknown>,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/db/repo/deals", () => ({ dealsRepo: { move: state.move } }));
vi.mock("@/lib/authz/load", () => ({ assertCan: (...a: unknown[]) => state.assertCan(...a) }));
vi.mock("@/lib/auth/roles", () => ({ can: () => true, ROLE_LABEL: {} }));
vi.mock("@/lib/format", () => ({ inr: (n: number) => `Rs ${n}` }));
vi.mock("@/lib/data/metrics", () => ({ DEAL_STAGES: ["discovery", "proposal", "won", "lost"] }));
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
    ds: { deals: async () => [state.deal] },
  }),
}));

import { moveDeal } from "../actions";

beforeEach(() => {
  state.demo = true; state.role = "sales_rep"; state.deal = { id: "d1", name: "Acme", stage: "discovery", ownerId: "me" };
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
    expect(await moveDeal("d1", "won", { won: { plan: "Nope", seats: 1, value: 1, start: "2026-01-01" } }, 1)).toMatchObject({ ok: false, code: "invalid" });
    expect(state.move).not.toHaveBeenCalled();
  });
});
