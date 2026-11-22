// realSnapshot itself needs "server-only" + a request-scoped Supabase client, so only the pure helper is unit-tested
// here; the read path is exercised through loadWorkspaceHealth in evaluate.test.ts, which realSnapshot wraps.
// The "server-only" guard throws outside a Server Component (including under Vitest's default conditions), so it is
// neutralised just for this import -- the same marker package other server-only modules in this codebase use.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { parseDrillDetail } = await import("../adapter");

describe("parseDrillDetail", () => {
  it("parses the JSON a drill was logged with", () => {
    expect(parseDrillDetail(JSON.stringify({ durationMin: 22, notes: "counts matched" }))).toEqual({ durationMin: 22, notes: "counts matched" });
  });
  it("defaults a missing or non-numeric duration to 0 and a missing notes field to empty", () => {
    expect(parseDrillDetail(JSON.stringify({}))).toEqual({ durationMin: 0, notes: "" });
    expect(parseDrillDetail(JSON.stringify({ durationMin: "soon" }))).toEqual({ durationMin: 0, notes: "" });
  });
  it("null input (no detail recorded) is empty, not an error", () => {
    expect(parseDrillDetail(null)).toEqual({ durationMin: 0, notes: "" });
  });
  it("non-JSON detail (an older or hand-written row) falls back to showing it as a note, truncated", () => {
    const r = parseDrillDetail("restored fine, 20 min");
    expect(r).toEqual({ durationMin: 0, notes: "restored fine, 20 min" });
  });
});
