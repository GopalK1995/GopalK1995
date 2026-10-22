// Font allow-list: key -> CSS font stack. No arbitrary URLs: only keys from this table reach the page.
// Self-hosted/system only (no runtime or build-time font fetch). "geist" is the font the app already ships.
import type { FontKey } from "./types";

export const FONT_STACKS: Record<FontKey, string> = {
  default: "",
  geist: "var(--font-geist-sans), system-ui, sans-serif",
  system: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "ui-serif, 'Iowan Old Style', 'Palatino Linotype', Georgia, 'Times New Roman', serif",
  humanist: "Seravek, 'Gill Sans Nova', 'Trebuchet MS', Calibri, 'Segoe UI', sans-serif",
  mono: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};
export const FONT_LABEL: Record<FontKey, string> = {
  default: "Product default (Geist)", geist: "Geist", system: "System sans", serif: "Serif (Georgia family)", humanist: "Humanist sans", mono: "Monospace",
};
export const isFontKey = (k: unknown): k is FontKey => typeof k === "string" && k in FONT_STACKS;
/** Inline style value for a key (empty string = leave the product default). */
export const fontStack = (k: string | undefined) => (isFontKey(k) ? FONT_STACKS[k] : "");
