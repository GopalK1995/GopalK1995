import { describe, expect, it } from "vitest";
import { DEFAULT_SLA_HOURS, addBusinessMinutes, businessMinutesBetween, describeSlaClock, hasBusinessWindow, leadResponseBusinessMins, nextBusinessInstant, parseHm, slaHoursFrom, type SlaHours } from "../business-hours";

// IST helper: local wall time in Asia/Kolkata (UTC+05:30) to an ISO instant. 2026-11-23 is a Monday.
const ist = (date: string, hm: string) => new Date(`${date}T${hm}:00+05:30`).getTime();
const iso = (ms: number | null) => (ms === null ? null : new Date(ms + 330 * 60_000).toISOString().slice(0, 16).replace("T", " "));
const H = DEFAULT_SLA_HOURS; // Mon-Sat 10:00-19:00 IST

describe("addBusinessMinutes (IST, Mon-Sat 10-19)", () => {
  it("counts straight through an open window", () => {
    expect(iso(addBusinessMinutes(ist("2026-11-23", "11:00"), 120, H))).toBe("2026-11-23 13:00");
  });
  it("lead at 22:00 starts at the next opening", () => {
    expect(iso(addBusinessMinutes(ist("2026-11-23", "22:00"), 120, H))).toBe("2026-11-24 12:00");
  });
  it("lead before opening starts at opening", () => {
    expect(iso(addBusinessMinutes(ist("2026-11-23", "06:30"), 120, H))).toBe("2026-11-23 12:00");
  });
  it("spills across closing into the next morning", () => {
    expect(iso(addBusinessMinutes(ist("2026-11-23", "18:00"), 120, H))).toBe("2026-11-24 11:00");
  });
  it("lead at closing time starts next day", () => {
    expect(iso(addBusinessMinutes(ist("2026-11-23", "19:00"), 60, H))).toBe("2026-11-24 11:00");
  });
  it("exactly filling a window ends at closing", () => {
    expect(iso(addBusinessMinutes(ist("2026-11-23", "17:00"), 120, H))).toBe("2026-11-23 19:00");
  });
  it("skips Sunday", () => {
    expect(iso(addBusinessMinutes(ist("2026-11-28", "18:00"), 120, H))).toBe("2026-11-30 11:00"); // Sat 18:00 -> Mon
    expect(iso(addBusinessMinutes(ist("2026-11-29", "12:00"), 60, H))).toBe("2026-11-30 11:00"); // Sunday noon
  });
  it("Friday night to Monday when Saturday is closed", () => {
    const wk: SlaHours = { ...H, days: [1, 2, 3, 4, 5] };
    expect(iso(addBusinessMinutes(ist("2026-11-27", "18:30"), 120, wk))).toBe("2026-11-30 11:30");
  });
  it("skips holidays", () => {
    const h: SlaHours = { ...H, holidays: ["2026-11-24"] };
    expect(iso(addBusinessMinutes(ist("2026-11-23", "22:00"), 120, h))).toBe("2026-11-25 12:00");
  });
  it("skips consecutive holidays over a weekend", () => {
    const h: SlaHours = { ...H, holidays: ["2026-11-27", "2026-11-28", "2026-11-30"] };
    expect(iso(addBusinessMinutes(ist("2026-11-27", "09:00"), 60, h))).toBe("2026-12-01 11:00");
  });
  it("zero minutes returns the opening instant (or now when open)", () => {
    expect(iso(addBusinessMinutes(ist("2026-11-23", "22:00"), 0, H))).toBe("2026-11-24 10:00");
    expect(iso(addBusinessMinutes(ist("2026-11-23", "12:00"), 0, H))).toBe("2026-11-23 12:00");
  });
  it("multi-day SLA", () => {
    expect(iso(addBusinessMinutes(ist("2026-11-23", "10:00"), 9 * 60 * 2, H))).toBe("2026-11-24 19:00");
  });
  it("accepts ISO strings and Dates", () => {
    expect(addBusinessMinutes("2026-11-23T11:00:00+05:30", 60, H)).toBe(ist("2026-11-23", "12:00"));
    expect(addBusinessMinutes(new Date("2026-11-23T05:30:00Z"), 60, H)).toBe(ist("2026-11-23", "12:00"));
  });
  it("works in a different IANA zone and honours its local date", () => {
    const utc: SlaHours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" };
    expect(new Date(addBusinessMinutes("2026-11-27T16:30:00Z", 60, utc)!).toISOString()).toBe("2026-11-30T09:30:00.000Z");
  });
  it("handles a daylight-saving zone (New York spring forward 8 Mar 2026)", () => {
    const ny: SlaHours = { days: [0, 1, 2, 3, 4, 5, 6], start: "09:00", end: "17:00", timezone: "America/New_York" };
    // Sat 7 Mar 17:30 EST -> Sun 8 Mar 09:00 EDT = 13:00Z, +60 min
    expect(new Date(addBusinessMinutes("2026-03-07T22:30:00Z", 60, ny)!).toISOString()).toBe("2026-03-08T14:00:00.000Z");
  });
});

describe("zero-length and invalid windows", () => {
  it("start equal to end has no window", () => {
    const z: SlaHours = { ...H, start: "10:00", end: "10:00" };
    expect(hasBusinessWindow(z)).toBe(false);
    expect(addBusinessMinutes(ist("2026-11-23", "11:00"), 60, z)).toBeNull();
    expect(nextBusinessInstant(ist("2026-11-23", "11:00"), z)).toBeNull();
    expect(businessMinutesBetween(ist("2026-11-23", "11:00"), ist("2026-11-24", "11:00"), z)).toBe(0);
  });
  it("start after end, no days, bad time and bad zone are all unusable", () => {
    expect(hasBusinessWindow({ ...H, start: "19:00", end: "10:00" })).toBe(false);
    expect(hasBusinessWindow({ ...H, days: [] })).toBe(false);
    expect(hasBusinessWindow({ ...H, start: "25:00" })).toBe(false);
    expect(hasBusinessWindow({ ...H, timezone: "Mars/Olympus" })).toBe(false);
  });
  it("every day a holiday for over a year gives null instead of looping forever", () => {
    const days: string[] = [];
    for (let i = 0; i < 420; i++) days.push(new Date(Date.UTC(2026, 10, 23 + i)).toISOString().slice(0, 10));
    expect(addBusinessMinutes(ist("2026-11-23", "11:00"), 60, { ...H, holidays: days })).toBeNull();
  });
  it("rejects NaN and negative input", () => {
    expect(addBusinessMinutes("not a date", 60, H)).toBeNull();
    expect(addBusinessMinutes(ist("2026-11-23", "11:00"), -5, H)).toBeNull();
    expect(addBusinessMinutes(ist("2026-11-23", "11:00"), Number.NaN, H)).toBeNull();
  });
  it("parseHm", () => {
    expect(parseHm("09:30")).toBe(570);
    expect(parseHm("9:30")).toBeNull();
    expect(parseHm("24:00")).toBeNull();
  });
});

describe("businessMinutesBetween", () => {
  it("same window", () => expect(businessMinutesBetween(ist("2026-11-23", "11:00"), ist("2026-11-23", "12:30"), H)).toBe(90));
  it("overnight counts only the open hours", () => {
    expect(businessMinutesBetween(ist("2026-11-23", "18:00"), ist("2026-11-24", "11:00"), H)).toBe(120);
  });
  it("whole closed stretch is zero (22:00 to 09:00)", () => {
    expect(businessMinutesBetween(ist("2026-11-23", "22:00"), ist("2026-11-24", "09:00"), H)).toBe(0);
  });
  it("weekend gap", () => {
    expect(businessMinutesBetween(ist("2026-11-28", "18:00"), ist("2026-11-30", "11:00"), H)).toBe(120);
  });
  it("holiday is excluded", () => {
    const h: SlaHours = { ...H, holidays: ["2026-11-24"] };
    expect(businessMinutesBetween(ist("2026-11-23", "18:00"), ist("2026-11-25", "11:00"), h)).toBe(120);
  });
  it("end before start is zero", () => expect(businessMinutesBetween(ist("2026-11-23", "12:00"), ist("2026-11-23", "11:00"), H)).toBe(0));
  it("is the inverse of addBusinessMinutes", () => {
    const start = ist("2026-11-23", "17:45");
    const due = addBusinessMinutes(start, 300, H)!;
    expect(businessMinutesBetween(start, due, H)).toBe(300);
  });
});

describe("leadResponseBusinessMins", () => {
  it("answered lead uses created to first response in business time", () => {
    // created Mon 18:00 IST, answered Tue 11:00 IST = 1020 wall minutes: 60 + 60 business minutes
    expect(leadResponseBusinessMins("2026-11-23T12:30:00.000Z", 1020, ist("2026-11-30", "10:00"), H)).toBe(120);
  });
  it("unanswered lead runs to now", () => {
    expect(leadResponseBusinessMins("2026-11-23T16:30:00.000Z", null, ist("2026-11-24", "11:00"), H)).toBe(60);
  });
});

describe("slaHoursFrom and describeSlaClock", () => {
  it("defaults timezone to IST and keeps holidays", () => {
    const h = slaHoursFrom({ days: [1, 2], start: "09:00", end: "18:00" }, { holidays: ["2026-12-25"] });
    expect(h.timezone).toBe("Asia/Kolkata");
    expect(h.holidays).toEqual(["2026-12-25"]);
    expect(slaHoursFrom(null).days).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("describes the clock honestly", () => {
    expect(describeSlaClock(120, H)).toBe("2 business hours (Mon to Sat, 10:00 to 19:00 IST)");
    expect(describeSlaClock(60, { ...H, days: [0, 1, 2, 3, 4, 5, 6] })).toBe("1 business hour (every day, 10:00 to 19:00 IST)");
    expect(describeSlaClock(45, { ...H, days: [1, 3, 5] })).toBe("45 business minutes (Mon, Wed, Fri, 10:00 to 19:00 IST)");
  });
});
