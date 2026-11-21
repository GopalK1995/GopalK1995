// Input sanitising for the global search. The query reaches PostgREST `or(...)` filter strings and `ilike` patterns, so every
// character that can change the structure of a filter (comma, parentheses, quotes, wildcards, backslash) is removed, not escaped.
export const MIN_QUERY = 2;
export const MAX_QUERY = 64;

// Control, format (zero width, bidi) and line separator characters, by code point (no raw invisible characters in this file).
const INVISIBLE_RANGES: [number, number][] = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]];
const isInvisible = (cp: number) => INVISIBLE_RANGES.some(([a, b]) => cp >= a && cp <= b);
const blankInvisible = (s: string) => Array.from(s, (c) => (isInvisible(c.codePointAt(0)!) ? " " : c)).join("");
// Characters that carry meaning in PostgREST filter syntax or in LIKE patterns.
const STRUCTURAL = /[%_*\\,()"'`;:<>{}[\]|=&?#]/g;

export interface SanitizedQuery { q: string; tooShort: boolean }

export function sanitizeQuery(raw: unknown): SanitizedQuery {
  if (typeof raw !== "string") return { q: "", tooShort: false };
  const q = blankInvisible(raw.slice(0, 256).normalize("NFC")).replace(STRUCTURAL, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY).trim();
  return { q, tooShort: q.length > 0 && [...q].length < MIN_QUERY };
}

/** A sanitised query as an ilike pattern for a PostgREST or() clause. Only call with the output of sanitizeQuery. */
export const likePattern = (q: string) => `*${q}*`;
