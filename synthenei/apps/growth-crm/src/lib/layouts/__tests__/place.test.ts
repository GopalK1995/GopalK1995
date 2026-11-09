import { describe, expect, it } from "vitest";
import { placeFields } from "../place";
import type { ClientField } from "@/lib/metadata/runtime";

const f = (key: string): ClientField => ({ key, label: { en: key }, type: "text", section: "Old", required: false, isPii: false, isFilterable: true, edit: true, default: null });

describe("placeFields", () => {
  it("orders and groups by the layout and drops fields it does not place", () => {
    const out = placeFields([f("a"), f("b"), f("c")], { sections: [{ id: "s1", title: "First", fields: ["c", "a"] }, { id: "s2", title: "", fields: ["zzz"] }], showRelated: true, showComments: true }, "Details");
    expect(out.map((x) => [x.key, x.section])).toEqual([["c", "First"], ["a", "First"]]);
  });
  it("names an untitled section with the fallback", () => {
    const out = placeFields([f("a")], { sections: [{ id: "s1", title: "", fields: ["a"] }], showRelated: true, showComments: true }, "Details");
    expect(out[0].section).toBe("Details");
  });
  it("a field the viewer cannot see (not in the prepared list) is never revived by the layout", () => {
    expect(placeFields([f("a")], { sections: [{ id: "s1", title: "S", fields: ["secret", "a"] }], showRelated: true, showComments: true }, "D").map((x) => x.key)).toEqual(["a"]);
  });
});
