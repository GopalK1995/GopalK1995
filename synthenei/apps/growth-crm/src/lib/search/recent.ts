// Recent items for the palette: per browser, per user and workspace, newest first. Storage is injected so it can be tested
// and so a blocked or full storage never breaks the palette (every call is try/catch).
import type { SearchHit } from "./types";

export const RECENT_MAX = 8;
export interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void }
const keyOf = (uid: string, ws: string) => `gcrm-recent:${ws}:${uid}`;
const valid = (x: unknown): x is SearchHit =>
  !!x && typeof x === "object" && typeof (x as SearchHit).key === "string" && typeof (x as SearchHit).title === "string" && typeof (x as SearchHit).href === "string" && (x as SearchHit).href.startsWith("/") && !(x as SearchHit).href.startsWith("//");

export function readRecent(store: KeyValueStore | null, uid: string, ws: string): SearchHit[] {
  try {
    const raw = store?.getItem(keyOf(uid, ws));
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(valid).slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

export function pushRecent(store: KeyValueStore | null, uid: string, ws: string, hit: SearchHit): SearchHit[] {
  const next = [hit, ...readRecent(store, uid, ws).filter((h) => h.key !== hit.key)].slice(0, RECENT_MAX);
  try { store?.setItem(keyOf(uid, ws), JSON.stringify(next)); } catch { /* storage blocked or full: recent items are a convenience */ }
  return next;
}
