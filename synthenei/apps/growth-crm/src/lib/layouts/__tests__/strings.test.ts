import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "../../../../messages/en/objects.json";
import ta from "../../../../messages/ta/objects.json";
import { ICON_KEYS } from "../icons";
import { fill, ot, otAll } from "../strings";

const ROOTS = ["src/app/(app)/o", "src/app/(app)/settings/objects", "src/app/(app)/settings/layouts", "src/lib/layouts"];
const files: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "__tests__") walk(p); } else if (/\.tsx?$/.test(f)) files.push(p); } };
ROOTS.forEach(walk);
const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
const keys = new Set<string>();
for (const m of src.matchAll(/\b(?:t|tn|ot|tr)\(\s*"([A-Za-z_0-9]+)"/g)) keys.add(m[1]);
for (const m of src.matchAll(/"(viewNameInvalid|viewShareDenied|objectEnabled|objectDisabled|colObject|colKey|colRecords|colEnabled|colActions)"/g)) keys.add(m[1]);

describe("objects namespace", () => {
  it("every key the code asks for exists in English", () => {
    const missing = [...keys].filter((k) => typeof (en as Record<string, unknown>)[k] !== "string");
    expect(missing).toEqual([]);
  });
  it("dynamic key families are complete", () => {
    for (const k of ["private", "team", "workspace"]) { expect(en).toHaveProperty(`vis_${k}`); expect(en).toHaveProperty(`visDesc_${k}`); }
    for (const k of ["detail", "list"]) expect(en).toHaveProperty(`kind_${k}`);
    for (const k of ["org", "workspace"]) expect(en).toHaveProperty(`scope_${k}`);
    for (const k of ["workspace_role", "org_role", "workspace", "org"]) expect(en).toHaveProperty(`resolved_${k}`);
    for (const k of ICON_KEYS) expect(en, `icon_${k}`).toHaveProperty(`icon_${k}`);
  });
  it("Tamil is a draft subset: every key exists in English with the same placeholders", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const [k, v] of Object.entries(ta)) {
      if (k.startsWith("_")) continue;
      expect(typeof (en as Record<string, unknown>)[k], k).toBe("string");
      expect(ph(v as string), k).toBe(ph((en as Record<string, string>)[k]));
    }
  });
  it("falls back to English for missing Tamil keys, and to the key for unknown ones", () => {
    expect(ot("viewAll", {}, "ta")).toBe((ta as unknown as Record<string, string>).viewAll);
    expect(ot("keyTaken", { key: "x" }, "ta")).toBe('An object with the key "x" already exists.');
    expect(ot("nope")).toBe("nope");
    expect(otAll("ta").viewAll).toBe((ta as unknown as Record<string, string>).viewAll);
    expect(otAll("ta").keyTaken).toBe(otAll("en").keyTaken);
  });
  it("fills placeholders and leaves unknown ones", () => {
    expect(fill("a {x} {y}", { x: 1 })).toBe("a 1 {y}");
  });
  it("English strings contain no em or en dash", () => {
    for (const v of Object.values(en)) expect(String(v)).not.toMatch(/[–—]/);
  });
});
