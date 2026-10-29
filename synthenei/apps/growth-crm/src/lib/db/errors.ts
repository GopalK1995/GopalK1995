// Typed database errors. Repositories throw DbError; server actions map it with runAction (src/lib/actions/result.ts).
export type DbErrorCode = "denied" | "not_found" | "conflict" | "invalid" | "unique" | "error";

export interface PgErrorLike { code?: string; message?: string; details?: string | null; hint?: string | null }

export class DbError extends Error {
  code: DbErrorCode;
  detail?: string;
  current?: unknown;
  constructor(code: DbErrorCode, message?: string, opts?: { detail?: string; current?: unknown }) {
    super(message ?? code);
    this.name = "DbError";
    this.code = code;
    this.detail = opts?.detail;
    this.current = opts?.current;
  }
}

const CODE_MAP: Record<string, DbErrorCode> = {
  "42501": "denied",
  PGRST116: "not_found",
  "23505": "unique",
  P0409: "conflict",
  "23514": "invalid",
  "22P02": "invalid",
  "23502": "invalid",
  "23503": "invalid",
};

/** null in, null out; otherwise a DbError. `message` is just the code; the original text goes to `detail`. */
export function mapPgError(e: PgErrorLike | null | undefined): DbError | null {
  if (!e) return null;
  const code = (e.code && CODE_MAP[e.code]) || "error";
  return new DbError(code, code, { detail: [e.message, e.details].filter(Boolean).join(": ") || undefined });
}

export function throwIfError(e: PgErrorLike | null | undefined): void {
  const m = mapPgError(e);
  if (m) throw m;
}
