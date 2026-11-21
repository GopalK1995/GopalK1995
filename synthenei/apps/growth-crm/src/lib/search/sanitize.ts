// Input sanitising for the global search. The query reaches PostgREST `or(...)` filter strings and `ilike` patterns, so every
// character that can change the structure of a filter (comma, parentheses, quotes, wildcards, backslash) is removed, not escaped.
export const MIN_QUERY = 2;
export const MAX_QUERY = 64;

// Control, format (zero width, bidi) and line separator characters.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏ -‮⁠-⁯﻿]/g;
// Characters that carry meaning in PostgREST filter syntax or in LIKE patterns.
const STRUCTURAL = /[%_*\,()"'`;:<>{}[\]|=&?#]/g;

export interface SanitizedQuery { q: string; tooShort: boolean }

export function sanitizeQuery(raw: unknown): SanitizedQuery {
  if (typeof raw !== "string") return { q: "", tooShort: false };
  const q = raw.slice(0, 256).normalize("NFC").replace(INVISIBLE, " ").replace(STRUCTURAL, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY).trim();
  return { q, tooShort: q.length > 0 && [...q].length < MIN_QUERY };
}

/** A sanitised query as an ilike pattern for a PostgREST or() clause. Only call with the output of sanitizeQuery. */
export const likePattern = (q: string) => `*${q}*`;
