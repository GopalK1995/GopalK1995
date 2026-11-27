import { describe, expect, it } from "vitest";
import { slaStats } from "../metrics";
import type { Lead } from "../types";

const lead = (createdAt: string, firstResponseMins: number | null) => ({ createdAt, firstResponseMins }) as unknown as Lead;

describe("slaStats runs inside business hours (AUD-025)", () => {
  // 2026-11-23 is a Monday. 16:30Z = 22:00 IST.
  it("a lead created at 22:00 and answered at 11:00 next day is within 2 business hours (wall clock 13h)", () => {
    const s = slaStats([lead("2026-11-23T16:30:00Z", 13 * 60)], "2026-11-25T06:30:00Z");
    expect(s.breached).toBe(0);
    expect(s.median).toBe(60);
  });
  it("answered 3 business hours after opening is a breach", () => {
    const s = slaStats([lead("2026-11-24T04:30:00Z", 180)], "2026-11-25T06:30:00Z"); // created 10:00 IST, answered 13:00
    expect(s.breached).toBe(1);
  });
  it("unanswered lead from a closed night is not breached until business time passes", () => {
    expect(slaStats([lead("2026-11-23T16:30:00Z", null)], "2026-11-24T03:30:00Z").breached).toBe(0); // now 09:00 IST
    expect(slaStats([lead("2026-11-23T16:30:00Z", null)], "2026-11-24T07:30:00Z").breached).toBe(1); // now 13:00 IST, 180 business min
  });
});
