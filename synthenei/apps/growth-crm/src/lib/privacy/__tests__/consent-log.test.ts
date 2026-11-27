import { describe, expect, it } from "vitest";
import { CONSENT_PAGE_SIZE, decodeConsentCursor, maskSubject, pageConsentMemory } from "../consent-log";
import type { ConsentEntry } from "@/lib/data/types";

const mk = (n: number): ConsentEntry[] => Array.from({ length: n }, (_, i) => ({
  id: String(i + 1), leadId: `l${i % 7}`, purpose: "whatsapp", action: i % 5 === 0 ? "withdrawn" : "granted", noticeVersion: "v1", via: "landing_form",
  at: new Date(Date.UTC(2026, 9, 1) + Math.floor(i / 3) * 3600e3).toISOString(),  // three entries share each timestamp: ties must page cleanly
}));
const names = new Map(Array.from({ length: 7 }, (_, i) => [`l${i}`, i === 2 ? "Anoop Mathew" : `Person${i} Surname`]));
const now = Date.UTC(2026, 9, 20);

describe("consent log paging (AUD-048)", () => {
  it("walks every row exactly once with no cap, including past 5,000 and across timestamp ties", () => {
    const all = mk(5300);
    const seen = new Set<string>();
    let cursor: string | undefined, pages = 0;
    for (;;) {
      const p = pageConsentMemory(all, names, "Erased lead", now, { cursor, limit: 100 });
      for (const r of p.rows) { expect(seen.has(r.id)).toBe(false); seen.add(r.id); }
      pages++;
      if (!p.nextCursor) break;
      cursor = p.nextCursor;
    }
    expect(seen.size).toBe(5300);
    expect(pages).toBe(53);
  });
  it("reports the true total and defaults to one page", () => {
    const p = pageConsentMemory(mk(60), names, "Erased lead", now);
    expect(p.total).toBe(60);
    expect(p.rows).toHaveLength(CONSENT_PAGE_SIZE);
    expect(p.nextCursor).not.toBeNull();
  });
  it("searches by name on the server and never returns full names or contact values", () => {
    const p = pageConsentMemory(mk(60), names, "Erased lead", now, { q: "anoop" });
    expect(p.total).toBeGreaterThan(0);
    for (const r of p.rows) { expect(r.subject).toBe("Anoop M."); expect(JSON.stringify(r)).not.toMatch(/Mathew|@|\+91/); }
    expect(pageConsentMemory(mk(60), names, "Erased lead", now, { q: "nobody" })).toMatchObject({ rows: [], total: 0, nextCursor: null });
  });
  it("ignores a cursor made for another search", () => {
    const p1 = pageConsentMemory(mk(60), names, "Erased lead", now, { q: "person", limit: 5 });
    expect(decodeConsentCursor(p1.nextCursor!, "person")).not.toBeNull();
    expect(decodeConsentCursor(p1.nextCursor!, "other")).toBeNull();
    expect(decodeConsentCursor("garbage", "")).toBeNull();
  });
  it("shows honest empties", () => {
    expect(pageConsentMemory([], names, "Erased lead", now)).toMatchObject({ rows: [], total: 0, withdrawn30: 0, nextCursor: null });
    expect(maskSubject(null, "Erased lead")).toBe("Erased lead");
    expect(maskSubject("Erased lead", "Erased lead")).toBe("Erased lead");
    expect(maskSubject("Madonna", "x")).toBe("M.");
  });
});
