import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, over, readTokens, tokenRgb } from "../contrast";

const css = readFileSync(join(process.cwd(), "src/styles/tokens.css"), "utf8");
const t = readTokens(css);
const rgb = (name: string) => tokenRgb(t[name]);

describe("contrast calculator", () => {
  it("matches known WCAG ratios", () => {
    expect(contrastRatio([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 1);
    expect(contrastRatio([1, 1, 1], [1, 1, 1])).toBeCloseTo(1, 5);
    // #767676 on white is the canonical 4.54:1
    const g = 0x76 / 255;
    expect(contrastRatio([g, g, g], [1, 1, 1])).toBeCloseTo(4.54, 1);
  });
});

describe("text tokens at 12px (4.5:1)", () => {
  const dark = ["--ink", "--ink-2", "--ink-3", "--accent", "--accent-strong", "--success", "--warn-ink", "--danger", "--info"];
  const light = ["--navy-ink", "--navy-ink-2", "--navy-ink-3", "--accent-on-navy"];
  for (const bg of ["--paper", "--surface"]) for (const fg of dark)
    it(`${fg} on ${bg}`, () => expect(contrastRatio(rgb(fg), rgb(bg))).toBeGreaterThanOrEqual(4.5));
  for (const fg of light)
    it(`${fg} on --navy-900`, () => expect(contrastRatio(rgb(fg), rgb("--navy-900"))).toBeGreaterThanOrEqual(4.5));
  for (const s of ["--success", "--warn-ink", "--danger", "--info"])
    it(`${s} on its 12% fill over --surface`, () => {
      expect(contrastRatio(rgb(s), over(rgb(s), rgb("--surface"), 0.12))).toBeGreaterThanOrEqual(4.5);
    });
});
