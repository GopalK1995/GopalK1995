import { describe, expect, it } from "vitest";
import { RECENT_MAX, pushRecent, readRecent, type KeyValueStore } from "../recent";
import type { SearchHit } from "../types";

const mem = (): KeyValueStore => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }; };
const hit = (i: number, over: Partial<SearchHit> = {}): SearchHit => ({ key: `lead:${i}`, type: "lead", title: `Lead ${i}`, href: `/leads/${i}`, ...over });

describe("recent items", () => {
  it("is newest first, de-duplicated and capped", () => {
    const s = mem();
    for (let i = 0; i < RECENT_MAX + 3; i++) pushRecent(s, "u", "w", hit(i));
    pushRecent(s, "u", "w", hit(5));
    const r = readRecent(s, "u", "w");
    expect(r).toHaveLength(RECENT_MAX);
    expect(r[0].key).toBe("lead:5");
    expect(r.filter((h) => h.key === "lead:5")).toHaveLength(1);
  });
  it("keeps users and workspaces apart", () => {
    const s = mem();
    pushRecent(s, "u1", "w", hit(1));
    expect(readRecent(s, "u2", "w")).toEqual([]);
    expect(readRecent(s, "u1", "w2")).toEqual([]);
  });
  it("survives corrupt, hostile or missing storage", () => {
    const s = mem();
    s.setItem("gcrm-recent:w:u", "{not json");
    expect(readRecent(s, "u", "w")).toEqual([]);
    s.setItem("gcrm-recent:w:u", JSON.stringify([{ key: "x", type: "lead", title: "t", href: "//evil.example" }, { key: "y", type: "lead", title: "t", href: "https://evil.example" }, hit(1)]));
    expect(readRecent(s, "u", "w").map((h) => h.key)).toEqual(["lead:1"]);
    expect(readRecent(null, "u", "w")).toEqual([]);
    const blocked: KeyValueStore = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => pushRecent(blocked, "u", "w", hit(1))).not.toThrow();
  });
});
