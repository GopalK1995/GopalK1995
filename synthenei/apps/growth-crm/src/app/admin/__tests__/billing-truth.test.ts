import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { describe, expect, it } from "vitest";
import { seatView } from "../_lib/billing-truth";
import { maskEmail, tenantSummary } from "../_components/data";
import { TENANTS } from "@/lib/tenancy";
import { loadAdminBilling } from "../(console)/billing/view";

const base = { tenant: { ...TENANTS[0], plan: "Pilot" as const, seats: 0, status: "active" as const }, seatsUsed: 4 };

describe("platform console seat truth (AUD-039)", () => {
  it("prefers the billing subscription and never yields NaN", () => {
    const v = seatView({ ...base, billing: { planName: "Growth", statusLabel: "Active", seatsUsed: 9, seatLimit: 12 } });
    expect(v).toMatchObject({ used: 9, limit: 12, plan: "Growth", status: "Active", free: 3, label: "9 of 12 seats" });
    expect(v.ratio).toBeCloseTo(0.75);
  });
  it("treats a missing cap as no cap, not a zero divisor", () => {
    const v = seatView(base);
    expect(v.limit).toBeNull();
    expect(v.ratio).toBeNull();
    expect(v.label).toBe("4 seats, no cap");
    expect(seatView({ ...base, seatsUsed: Number.NaN }).used).toBe(0);
  });
  it("masks emails so different people stay distinguishable", () => {
    expect(maskEmail("arun@lawsome.example")).not.toBe(maskEmail("anoop@lawsome.example"));
    expect(maskEmail("arun@lawsome.example")).toBe("a•••un@lawsome.example");
  });
  it("demo Billing and Overview agree per tenant", async () => {
    const r = await loadAdminBilling({ uid: "u", demo: true, canEdit: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const t of TENANTS) {
      const sum = tenantSummary(t), sv = seatView(sum), row = r.view.subs.find((x) => x.tenantId === t.id)!;
      expect(row.planName).toBe(sv.plan);
      expect(row.seats.used).toBe(sv.used);
      expect(row.seats.limit).toBe(sv.limit);
    }
  });
});
