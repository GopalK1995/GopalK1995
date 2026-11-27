import { describe, expect, it } from "vitest";
import { digestAnchorMs } from "../digest-week";

describe("digestAnchorMs", () => {
  it("uses noon IST on the last campaign day", () => {
    expect(new Date(digestAnchorMs("2026-11-20", "2026-11-27T00:00:00Z")).toISOString()).toBe("2026-11-20T06:30:00.000Z");
  });
  it("empty workspace (no campaign days) falls back to now instead of NaN", () => {
    const ms = digestAnchorMs("", "2026-11-27T04:00:00.000Z");
    expect(Number.isFinite(ms)).toBe(true);
    expect(() => new Date(ms - 6 * 864e5).toISOString()).not.toThrow();
  });
  it("garbage inputs still give a finite anchor", () => {
    expect(Number.isFinite(digestAnchorMs("nope", "also nope"))).toBe(true);
  });
});
