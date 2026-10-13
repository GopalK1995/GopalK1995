// Shared by the branding form (live readout) and the saveBranding server action (authoritative recheck).
// ---- OKLCH -> sRGB -> WCAG contrast (same formulas as tokens.css values) ----
function oklchToLinear(L: number, C: number, h: number) {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
const lum = (L: number, C: number, h: number) => { const [r, g, b] = oklchToLinear(L, C, h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export function contrastChecks(h: number) {
  const accent = lum(0.52, 0.15, h), accentInk = lum(0.99, 0.005, h), surface = lum(0.995, 0.002, 90), navy = lum(0.22, 0.045, h), navyInk = lum(0.96, 0.01, h);
  return [
    { key: "button", label: "Button text on accent", value: ratio(accentInk, accent), min: 4.5 },
    { key: "link", label: "Accent text on page", value: ratio(accent, surface), min: 4.5 },
    { key: "nav", label: "Sidebar text on navy", value: ratio(navyInk, navy), min: 4.5 },
  ];
}
