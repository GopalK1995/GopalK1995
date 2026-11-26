import { describe, expect, it } from "vitest";
import { addHoursIso, fmtIstDate, fmtIstDateTime, fmtIstDateTimeZ, fmtIstMonth, istDayKey, istInputToIso, toIstInputValue } from "../datetime";
import { boardReportDueAt } from "../privacy/breach";

describe("IST formatting is independent of the runtime zone", () => {
  it("renders fixed instants around midnight IST and UTC", () => {
    expect(fmtIstDate("2026-11-25T18:29:59Z")).toBe("25 Nov 2026"); // 23:59:59 IST
    expect(fmtIstDate("2026-11-25T18:30:00Z")).toBe("26 Nov 2026"); // 00:00 IST next day
    expect(fmtIstDate("2026-11-26T00:00:00Z")).toBe("26 Nov 2026"); // UTC midnight = 05:30 IST
    expect(fmtIstDate("2026-12-31T18:30:00Z")).toBe("1 Jan 2027"); // year rollover
    expect(fmtIstMonth("2026-11-30T20:00:00Z")).toBe("Dec 2026");
  });
  it("prints a 12-hour clock and an explicit IST label when asked", () => {
    expect(fmtIstDateTime("2026-11-25T18:30:00Z")).toBe("26 Nov 2026, 12:00 am");
    expect(fmtIstDateTime("2026-11-26T06:30:00Z")).toBe("26 Nov 2026, 12:00 pm");
    expect(fmtIstDateTimeZ("2026-11-26T18:00:00Z")).toBe("26 Nov 2026, 11:30 pm IST");
  });
  it("returns an empty string, never Invalid Date, for bad input", () => {
    expect(fmtIstDate("nope")).toBe("");
    expect(fmtIstDateTimeZ("nope")).toBe("");
    expect(toIstInputValue("nope")).toBe("");
  });
  it("is DST-free: the offset is +05:30 in every month", () => {
    for (const m of ["01", "03", "06", "10", "11"]) expect(toIstInputValue(`2026-${m}-15T00:00:00Z`)).toBe(`2026-${m}-15T05:30`);
  });
});

describe("datetime-local input is read as IST", () => {
  it("converts the typed wall clock to the right UTC instant", () => {
    expect(istInputToIso("2026-11-26T23:30")).toBe("2026-11-26T18:00:00.000Z");
    expect(istInputToIso("2026-11-26T00:00")).toBe("2026-11-25T18:30:00.000Z"); // IST midnight is the previous UTC day
    expect(istInputToIso("2027-01-01T05:29")).toBe("2026-12-31T23:59:00.000Z");
  });
  it("round-trips with toIstInputValue", () => {
    for (const iso of ["2026-11-25T18:30:00.000Z", "2026-11-26T00:00:00.000Z", "2026-02-28T23:59:00.000Z"]) expect(istInputToIso(toIstInputValue(iso))).toBe(iso);
  });
  it("rejects values that are not real calendar times", () => {
    for (const bad of ["", "2026-02-31T10:00", "2026-11-26T25:00", "2026-11-26", "yesterday"]) expect(istInputToIso(bad)).toBeNull();
  });
  it("the old default (UTC slice) was 5h30m behind IST; the new default is the IST wall clock", () => {
    const now = new Date("2026-11-26T10:00:00Z"); // 15:30 IST
    expect(now.toISOString().slice(0, 16)).toBe("2026-11-26T10:00");
    expect(toIstInputValue(now)).toBe("2026-11-26T15:30");
    expect(istInputToIso(toIstInputValue(now))).toBe(now.toISOString());
  });
});

describe("72-hour Board report deadline", () => {
  it("is exactly 72 hours after the true detection instant", () => {
    const detected = istInputToIso("2026-11-26T23:30")!; // 18:00Z
    expect(boardReportDueAt(detected)).toBe("2026-11-29T18:00:00.000Z");
    expect(fmtIstDateTimeZ(boardReportDueAt(detected))).toBe("29 Nov 2026, 11:30 pm IST");
  });
  it("crosses midnight correctly in both zones", () => {
    expect(addHoursIso("2026-11-25T18:29:00.000Z", 72)).toBe("2026-11-28T18:29:00.000Z");
    expect(istDayKey("2026-11-28T18:29:00.000Z")).toBe("2026-11-28");
    expect(istDayKey("2026-11-28T18:30:00.000Z")).toBe("2026-11-29");
  });
});
