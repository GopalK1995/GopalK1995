// Noun rewrite: page copy in the vocabulary templates is written with the preset's own nouns ("enquiries",
// "bookings", "guest"). When a tenant renames a noun, every string the templates produce (including the output
// of copy functions) is rewritten with the configured noun, so a rename shows up on every page, not just
// in the menu. Single pass over all nouns (no chained replacements), case preserved. Pure and edge-safe.
import type { Noun } from "./types";

export type Nouns = Record<string, Noun>;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Returns a string rewriter, or null when nothing differs. */
export function makeRewriter(from: Nouns, to: Nouns): ((s: string) => string) | null {
  const map = new Map<string, string>();
  for (const k of Object.keys(from)) {
    if (!to[k]) continue;
    for (const f of ["many", "one"] as const) if (from[k][f].toLowerCase() !== to[k][f].toLowerCase() && from[k][f]) map.set(from[k][f].toLowerCase(), to[k][f]);
  }
  if (!map.size) return null;
  const re = new RegExp(`\\b(${[...map.keys()].sort((a, b) => b.length - a.length).map(esc).join("|")})\\b`, "gi");
  return (s) => s.replace(re, (m) => {
    const t = map.get(m.toLowerCase())!;
    return m === m.toUpperCase() && m.length > 1 ? t.toUpperCase() : m[0] === m[0].toUpperCase() ? cap(t) : t;
  });
}

/** Deep rewrite of strings, arrays, plain objects and function results. */
export function rewriteDeep<T>(v: T, rw: (s: string) => string): T {
  if (typeof v === "string") return rw(v) as T;
  if (Array.isArray(v)) return v.map((x) => rewriteDeep(x, rw)) as T;
  if (typeof v === "function") return ((...a: unknown[]) => rewriteDeep((v as (...x: unknown[]) => unknown)(...a), rw)) as T;
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewriteDeep(x, rw)])) as T;
  return v;
}
