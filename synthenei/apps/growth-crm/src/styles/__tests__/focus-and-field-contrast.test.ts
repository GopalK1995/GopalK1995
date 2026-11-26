// AUD-017: visible keyboard focus everywhere (WCAG 2.4.7 / 2.4.11) and 3:1 form-control borders (WCAG 1.4.11).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, readTokens, tokenRgb } from "@/components/ui/contrast";

const root = process.cwd();
const tokens = readTokens(readFileSync(join(root, "src/styles/tokens.css"), "utf8"));
const globals = readFileSync(join(root, "src/app/globals.css"), "utf8");
const rgb = (n: string) => tokenRgb(tokens[n]);

describe("focus ring and field border tokens", () => {
  it("defines ONE focus ring: 2 px width, 2 px offset, shared utilities", () => {
    expect(tokens["--focus-ring-width"]).toBe("2px");
    expect(tokens["--focus-ring-offset"]).toBe("2px");
    expect(globals).toMatch(/@utility focus-ring \{/);
    expect(globals).toMatch(/@utility focus-ring-inset \{/);
    expect(globals).toMatch(/:focus-visible \{ outline: var\(--focus-ring-width\) solid var\(--ring\); outline-offset: var\(--focus-ring-offset\); \}/);
    expect(globals).toContain("--color-field-line: var(--field-line)");
  });
  for (const bg of ["--surface", "--paper", "--paper-2"]) {
    it(`--field-line on ${bg} is at least 3:1 (1.4.11)`, () => expect(contrastRatio(rgb("--field-line"), rgb(bg))).toBeGreaterThanOrEqual(3));
  }
  for (const bg of ["--surface", "--paper", "--navy-900"]) {
    it(`--ring on ${bg} is at least 3:1 (focus indicator)`, () => expect(contrastRatio(rgb("--ring"), rgb(bg))).toBeGreaterThanOrEqual(3));
  }
  it("records why --line-strong could not be reused for inputs", () => {
    expect(contrastRatio(rgb("--line-strong"), rgb("--surface"))).toBeLessThan(2);
  });
  it("tokens only: no raw colour in the new token definitions", () => {
    expect(tokens["--field-line"]).toMatch(/^oklch\(/);
    expect(globals).not.toMatch(/@utility focus-ring[^}]*#[0-9a-f]{3,8}/i);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") walk(p, out); }
    else if (/\.(tsx?|css)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(join(root, "src")).map((p) => ({ rel: relative(root, p).split(sep).join("/"), text: readFileSync(p, "utf8") }));

/** A pairing that still shows a visible indicator when the browser outline is suppressed. */
const PAIRED = /focus-ring|focus-visible:ring|focus-visible:outline|focus:ring|focus-within:ring|focus-within:outline/;

/**
 * Allowlist: outline-none that is NOT a keyboard-focus loss. Every entry needs a reason.
 * `needle` must appear on the same line. Container elements receive programmatic focus only (Radix focus management),
 * and menu / listbox items show focus through `data-[highlighted]` (roving highlight), not the browser outline.
 */
const ALLOW: { file: string; needle: string; reason: string }[] = [
  { file: "src/app/globals.css", needle: "Never use bare outline-none", reason: "comment in the utility docs" },
  { file: "src/components/ui/dialog.tsx", needle: "D.Content", reason: "dialog container, programmatic focus only" },
  { file: "src/components/ui/sheet.tsx", needle: "D.Content", reason: "sheet container, programmatic focus only" },
  { file: "src/components/ui/command.tsx", needle: "D.Content", reason: "command dialog container, programmatic focus only" },
  { file: "src/components/command/command-palette.tsx", needle: "D.Content", reason: "command dialog container, programmatic focus only" },
  { file: "src/components/ui/controls.tsx", needle: "P.Content", reason: "popover container, programmatic focus only" },
  { file: "src/components/ui/controls.tsx", needle: "S.Item", reason: "select option, focus shown by data-[highlighted]" },
  { file: "src/components/ui/dropdown.tsx", needle: "M.Item", reason: "menu item, focus shown by data-[highlighted]" },
  { file: "src/components/shell/switcher.tsx", needle: "data-[highlighted]", reason: "workspace menu items, focus shown by data-[highlighted]" },
  { file: "src/components/shell/shell.tsx", needle: "D.Content", reason: "mobile nav drawer container, programmatic focus only" },
  { file: "src/components/shell/shell.tsx", needle: "id=\"main-content\"", reason: "skip-link target, tabIndex -1, not in the tab order" },
];

describe("no keyboard focus is suppressed without a visible replacement", () => {
  const offenders: string[] = [];
  const used = new Set<number>();
  for (const f of files) {
    f.text.split(/\r?\n/).forEach((line, i) => {
      if (!/(^|[\s"'`:])outline-none\b/.test(line) && !/\boutline-none\b/.test(line)) return;
      if (PAIRED.test(line)) return;
      const a = ALLOW.findIndex((x) => x.file === f.rel && line.includes(x.needle));
      if (a >= 0) { used.add(a); return; }
      offenders.push(`${f.rel}:${i + 1}`);
    });
  }
  it("every bare outline-none is paired with .focus-ring / focus-visible:ring or allowlisted", () => {
    expect(offenders).toEqual([]);
  });
  it("the allowlist has no stale entries", () => {
    expect(ALLOW.map((_, i) => i).filter((i) => !used.has(i))).toEqual([]);
  });
  it("form controls never use the 1.6:1 --line-strong as their resting border", () => {
    const bad: string[] = [];
    for (const f of files) f.text.split(/\r?\n/).forEach((line, i) => {
      if (/<(input|select|textarea)\b[^>]*(^|[\s"'`])border-line-strong/.test(line) && !/type="file"/.test(line)) bad.push(`${f.rel}:${i + 1}`);
    });
    expect(bad).toEqual([]);
  });
});
