// WCAG contrast calculator for OKLCH tokens (used by the unit test and docs/contrast.md generation).
export type Rgb = [number, number, number];

/** Parse "oklch(L C H)" or "oklch(L C H / a)" into numbers. `brandH` replaces var(--brand-h). */
export function parseOklch(value: string, brandH = 245): { l: number; c: number; h: number; a: number } {
  const v = value.replace(/var\(--brand-h\)/g, String(brandH)).replace(/calc\(([^)]*)\)/g, (_, e: string) => String(Function(`"use strict";return (${e})`)()));
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.-]+)(?:\s*\/\s*([\d.]+))?\s*\)/.exec(v);
  if (!m) throw new Error(`Not an oklch colour: ${value}`);
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
}

const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const clamp = (x: number) => Math.min(1, Math.max(0, x));

/** OKLCH to gamma-encoded sRGB in 0..1 (clipped to gamut). */
export function oklchToRgb(l: number, c: number, h: number): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3, M = m_ ** 3, S = s_ ** 3;
  const r = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const bl = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;
  return [clamp(gamma(clamp(r))), clamp(gamma(clamp(g))), clamp(gamma(clamp(bl)))];
}

const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
/** Mix fg over bg at alpha (sRGB space, as browsers do for color-mix in srgb; close enough for AA checks). */
export function over(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)) as Rgb;
}
export function tokenRgb(value: string, brandH = 245): Rgb {
  const { l, c, h } = parseOklch(value, brandH);
  return oklchToRgb(l, c, h);
}
/** Read `--name: value;` custom properties from a CSS string (first definition wins). */
export function readTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) if (!(m[1] in out)) out[m[1]] = m[2].replace(/\/\*.*?\*\//g, "").trim();
  return out;
}
