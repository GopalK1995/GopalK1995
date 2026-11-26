import { describe, expect, it } from "vitest";
import * as m from "../mappers";

// Row shapes copied from the live Supabase tables (camelCased by src/lib/db/map.ts). Before the mappers existed the DataSource returned
// these raw, so `account.courts.join()` and friends threw during the server render of /accounts, /ai and /leads/<id>.
describe("live row shapes map to domain types", () => {
  const acct = m.account({
    id: "a1", name: "Firm", city: "Madurai", district: "Madurai", addressLine: "Anna Nagar", courtFocus: ["Madurai Bench"], practiceAreas: ["Civil"],
    sizeBand: "2-5", lawyersCount: 4, sites: [{ city: "Madurai", label: "HQ" }], customerStatus: "prospect", ownerId: "u1", updatedAt: "2026-11-01T00:00:00Z",
  });
  it("account has every field pages dereference", () => {
    expect(acct.courts.join(",")).toBe("Madurai Bench");
    expect(acct).toMatchObject({ size: "2–5", lawyers: 4, status: "prospect", locality: "Anna Nagar", lastActivityAt: "2026-11-01T00:00:00.000Z" });
    expect(() => acct.lastActivityAt.localeCompare("x")).not.toThrow();
  });
  it("account tolerates a bare row", () => {
    const a = m.account({ id: "x" });
    expect(a.courts).toEqual([]); expect(a.practiceAreas).toEqual([]); expect(a.size).toBe("Solo"); expect(typeof a.lastActivityAt).toBe("string");
  });
  it("task maps enum values and priority", () => {
    expect(m.task({ id: "t", kind: "demo_prep", priority: 1, status: "open", assigneeId: "u1", dueAt: "2026-11-02T00:00:00Z" })).toMatchObject({ kind: "demo", priority: "high", status: "open", ownerId: "u1", dueAt: "2026-11-02T00:00:00.000Z" });
    expect(m.task({ id: "t", priority: 3, status: "done" })).toMatchObject({ priority: "low", status: "done" });
  });
  it("campaign and daily metrics map", () => {
    expect(m.campaign({ id: "c", channel: "google_ads", status: "active", startsOn: "2026-10-01", endsOn: null, budgetInr: "5000.00", utmCampaign: "x" })).toMatchObject({ status: "live", startDate: "2026-10-01", endDate: null, budget: 5000, channel: "google_ads" });
    expect(m.campaignDay({ campaignId: "c", day: "2026-10-02", spendInr: "10.5", reactions: 1, comments: 2, shares: 3 })).toMatchObject({ date: "2026-10-02", spend: 10.5, engagements: 6 });
  });
});
