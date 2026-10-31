import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "../../../../messages/en/fields.json";
import ta from "../../../../messages/ta/fields.json";
import review from "../../../../messages/ta/_review/fields.json";
import { FIELD_TYPES, FIELD_COLORS } from "../types";
import { ft, ftAll } from "../strings";

const ROOT = join(__dirname, "../../../..");
const DIRS = ["src/lib/metadata", "src/components/fields", "src/app/(app)/settings/fields"].map((d) => join(ROOT, d));
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "__tests__") walk(p, out); } else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

describe("fields namespace", () => {
  const files = DIRS.flatMap((d) => walk(d));
  const used = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\b(?:ft|t|tt)\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)) used.add(m[1]);
  }
  const en2 = en as Record<string, string>;

  it("every literal key used in code exists in messages/en/fields.json", () => {
    const missing = [...used].filter((k) => !(k in en2));
    expect(missing).toEqual([]);
  });
  it("dynamic key families exist: types, colours, operators, rule help", () => {
    for (const t of FIELD_TYPES) expect(en2[`type_${t}`], `type_${t}`).toBeTypeOf("string");
    for (const c of FIELD_COLORS) expect(en2[`color_${c}`]).toBeTypeOf("string");
    for (const o of ["eq", "neq", "in", "contains"]) expect(en2[`op_${o}`]).toBeTypeOf("string");
    for (const r of ["Required", "Unique", "Pii", "Filterable", "Searchable"]) { expect(en2[`rule${r}`]).toBeTypeOf("string"); expect(en2[`rule${r}Help`]).toBeTypeOf("string"); }
    for (const c of ["Order", "Field", "Type", "Rules", "Access", "Actions"]) expect(en2[`col${c}`]).toBeTypeOf("string");
  });
  it("copy has no em dashes, no exclamation marks, no 11 px talk", () => {
    for (const [k, v] of Object.entries(en2)) { expect(v, k).not.toMatch(/[—–]/); expect(v, k).not.toContain("!"); }
  });
  it("Tamil is a draft: flagged _review, every key has an English counterpart and is listed in _review/fields.json", () => {
    expect((ta as Record<string, unknown>)._review).toBe(true);
    const keys = Object.keys(ta).filter((k) => k !== "_review");
    for (const k of keys) { expect(en2[k], k).toBeTypeOf("string"); expect(review).toContain(k); }
  });
  it("lookup falls back to English for untranslated Tamil keys and fills placeholders", () => {
    expect(ft("created", { label: "Budget" }, "ta")).toBe("Field added: Budget");
    expect(ft("edit", {}, "ta")).toBe((ta as Record<string, string>).edit);
    expect(ftAll("ta").created).toBe(en2.created);
    expect(ft("no_such_key")).toBe("no_such_key");
  });
});
