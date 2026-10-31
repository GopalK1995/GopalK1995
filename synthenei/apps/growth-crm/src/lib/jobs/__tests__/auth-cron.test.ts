import { describe, expect, it } from "vitest";
import { bearerToken, tickAuthorized } from "../auth";
import { nextCronRun, parseCron } from "../cron";
import { queueForKind } from "../scheduler";

describe("tick secret check", () => {
  const secrets = ["tick-secret-aaaaaaaaaaaaaaaa", "cron-secret-bbbbbbbbbbbbbbbb"];
  it("accepts either secret as a bearer token", () => {
    expect(tickAuthorized("Bearer tick-secret-aaaaaaaaaaaaaaaa", secrets)).toBe(true);
    expect(tickAuthorized("bearer cron-secret-bbbbbbbbbbbbbbbb", secrets)).toBe(true);
  });
  it("rejects missing, malformed, wrong and near-miss tokens", () => {
    expect(tickAuthorized(null, secrets)).toBe(false);
    expect(tickAuthorized("", secrets)).toBe(false);
    expect(tickAuthorized("tick-secret-aaaaaaaaaaaaaaaa", secrets)).toBe(false);
    expect(tickAuthorized("Bearer wrong", secrets)).toBe(false);
    expect(tickAuthorized("Bearer tick-secret-aaaaaaaaaaaaaaa", secrets)).toBe(false);
    expect(tickAuthorized("Bearer tick-secret-aaaaaaaaaaaaaaaaa", secrets)).toBe(false);
  });
  it("never matches when a secret is unset, even with an empty token", () => {
    expect(tickAuthorized("Bearer ", [undefined, ""])).toBe(false);
    expect(tickAuthorized("Bearer undefined", [undefined])).toBe(false);
  });
  it("parses the header", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
  });
});

const IST = "Asia/Kolkata";
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

describe("cron", () => {
  it("05:30 IST daily (GA4) is 00:00 UTC", () => {
    expect(iso(nextCronRun("30 5 * * *", IST, Date.parse("2026-10-29T23:59:00Z")))).toBe("2026-10-30T00:00:00.000Z");
    expect(iso(nextCronRun("30 5 * * *", IST, Date.parse("2026-10-30T00:00:00Z") + 1))).toBe("2026-10-31T00:00:00.000Z");
  });
  it("06:00 IST daily", () => {
    expect(iso(nextCronRun("0 6 * * *", IST, Date.parse("2026-10-30T10:00:00Z")))).toBe("2026-10-31T00:30:00.000Z");
  });
  it("steps, lists and ranges", () => {
    expect(iso(nextCronRun("*/15 * * * *", "UTC", Date.parse("2026-10-30T10:07:00Z")))).toBe("2026-10-30T10:15:00.000Z");
    expect(iso(nextCronRun("0 9-11 * * *", "UTC", Date.parse("2026-10-30T11:00:00Z")))).toBe("2026-10-31T09:00:00.000Z");
    expect(iso(nextCronRun("0 8 1,15 * *", "UTC", Date.parse("2026-10-30T00:00:00Z")))).toBe("2026-11-01T08:00:00.000Z");
  });
  it("day of week (Monday 09:00 UTC); 7 is Sunday", () => {
    expect(iso(nextCronRun("0 9 * * 1", "UTC", Date.parse("2026-10-30T00:00:00Z")))).toBe("2026-11-02T09:00:00.000Z"); // 30 Oct 2026 is a Friday
    expect(iso(nextCronRun("0 9 * * 7", "UTC", Date.parse("2026-10-30T00:00:00Z")))).toBe("2026-11-01T09:00:00.000Z");
  });
  it("rejects malformed expressions", () => {
    expect(() => parseCron("* * * *")).toThrow();
    expect(() => parseCron("61 * * * *")).toThrow();
    expect(() => parseCron("*/0 * * * *")).toThrow();
  });
  it("maps scheduled kinds to queues", () => {
    expect(queueForKind("connector.sync")).toBe("connector_sync");
    expect(queueForKind("import.resume")).toBe("import");
    expect(queueForKind("retention.sweep")).toBe("maintenance");
  });
});
