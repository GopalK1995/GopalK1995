// @vitest-environment node
// Regression for AUD-008: utilities such as text-11, text-20, text-24 and rounded-card were used in the code but
// compiled to nothing because the @theme block never defined them. Every text-<n> / rounded-* name used under src
// must resolve to a theme value, and the 12 px type floor must hold.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(p, "utf8");
const theme = read(join(SRC, "app", "globals.css"));
const tokens = read(join(SRC, "styles", "tokens.css"));

const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules" && n !== "__tests__") walk(p, out); }
    else if (/\.(tsx?|css)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
};
const files = walk(SRC).filter((f) => !f.endsWith("globals.css") && !f.endsWith("tokens.css"));

const defined = (prefix: string) => new Set([...theme.matchAll(new RegExp(`--${prefix}-([a-z0-9-]+)\s*:`, "g"))].map((m) => m[1]));
const textSizes = defined("text");
const radii = defined("radius");
const BUILTIN_RADIUS = new Set(["full", "none"]);

function used(re: RegExp) {
  const hits = new Map<string, string>();
  for (const f of files) for (const m of read(f).matchAll(re)) if (!hits.has(m[1])) hits.set(m[1], relative(SRC, f));
  return hits;
}

describe("theme utilities resolve", { timeout: 30_000 }, () => {
  it("every text-<n> utility is a defined type size", () => {
    const bad = [...used(/(?<![\w-])text-(\d+)(?![\w-])/g)].filter(([n]) => !textSizes.has(n)).map(([n, f]) => `text-${n} (${f})`);
    expect(bad).toEqual([]);
  });
  it("every rounded-<name> utility is a defined radius", () => {
    const bad = [...used(/(?<![\w-])rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?-([a-z][a-z0-9]*)(?![\w[-])/g)]
      .filter(([n]) => !radii.has(n) && !BUILTIN_RADIUS.has(n)).map(([n, f]) => `rounded-${n} (${f})`);
    expect(bad).toEqual([]);
  });
  it("keeps the 12 px type floor and defines the new sizes", () => {
    const px = [...tokens.matchAll(/--text-(\d+):\s*(\d+)px/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(px.every(([n, v]) => n === v && v >= 12)).toBe(true);
    expect(textSizes.has("20") && textSizes.has("24") && radii.has("card")).toBe(true);
    expect(textSizes.has("11")).toBe(false);
  });
});
