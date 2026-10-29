// Shared server-action result shape (CONTRACTS C7).
import { AuthzError, denyMessageKey } from "@/lib/authz";
import { DbError } from "@/lib/db/errors";

export type ActionFailCode = "denied" | "not_found" | "conflict" | "invalid" | "error";
export type ActionResult<T = undefined> =
  | { ok: true; message: string; sub?: string; data?: T }
  | { ok: false; message: string; code: ActionFailCode; sub?: string;
      issues?: { path: string; message: string }[]; current?: unknown };

export const okResult = <T = undefined>(message: string, extra?: { sub?: string; data?: T }): ActionResult<T> => ({ ok: true, message, ...extra });
export const failResult = <T = undefined>(code: ActionFailCode, message: string, extra?: { sub?: string; issues?: { path: string; message: string }[]; current?: unknown }): ActionResult<T> =>
  ({ ok: false, code, message, ...extra });

// Fallback English text; callers with translations should build their own failResult.
const DB_MESSAGES: Record<string, string> = {
  denied: "You do not have permission to do that.",
  not_found: "That record no longer exists.",
  conflict: "Someone else changed this record. Reload and try again.",
  invalid: "Some values are not valid.",
  unique: "That value is already in use.",
  error: "Something went wrong. Try again.",
};

interface ZodLike { issues: { path: (string | number | symbol)[]; message: string }[] }
const isZodLike = (e: unknown): e is ZodLike => typeof e === "object" && e !== null && Array.isArray((e as ZodLike).issues);

/** Runs a mutation body; AuthzError -> denied (message = deny message key), DbError -> its code, zod issues -> invalid, anything else -> logged "error". */
export async function runAction<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthzError) return failResult<T>("denied", denyMessageKey(e.decision));
    if (e instanceof DbError) {
      const code: ActionFailCode = e.code === "unique" ? "invalid" : e.code;
      return failResult<T>(code, DB_MESSAGES[e.code] ?? DB_MESSAGES.error, { current: e.current });
    }
    if (isZodLike(e)) return failResult<T>("invalid", DB_MESSAGES.invalid, { issues: e.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });
    console.error("[runAction]", e);
    return failResult<T>("error", DB_MESSAGES.error);
  }
}
