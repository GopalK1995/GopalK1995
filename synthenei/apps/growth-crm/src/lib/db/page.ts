// Keyset paging on (order column desc, id desc). Cursor = base64url(JSON).
export interface Page<T> { rows: T[]; nextCursor: string | null }

export interface CursorValue { v: string | number; id: string | number }

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export function clampLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

export function encodeCursor(c: CursorValue): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeCursor(s: string): CursorValue | null {
  try {
    const o = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as Partial<CursorValue>;
    if ((typeof o.v === "string" || typeof o.v === "number") && (typeof o.id === "string" || typeof o.id === "number")) return { v: o.v, id: o.id };
    return null;
  } catch {
    return null;
  }
}
