// Shared server-side helpers for account and contact actions (not a "use server" file: plain functions).
import { runAction, type ActionResult } from "@/lib/actions/result";
import type { Vocab } from "@/lib/vertical";
import { at } from "./strings";

/** Runs a real-mode body and maps failures to vocabulary-correct copy. A conflict carries only the current version (never the row). */
export async function realRun<T>(v: Vocab, support: unknown, fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const t = at(v);
  const r = await runAction(fn);
  if (r.ok) return r;
  if (r.code === "denied") return { ...r, message: t("deniedTitle"), sub: support ? t("deniedSupport") : undefined };
  if (r.code === "conflict") {
    const ver = (r.current as { version?: number } | undefined)?.version;
    return { ...r, message: t("conflictTitle"), sub: t("conflictBody"), current: ver === undefined ? undefined : { version: ver } };
  }
  if (r.code === "not_found") return { ...r, message: t("notFound") };
  if (r.code === "error") return { ...r, message: t("errorTitle"), sub: t("errorBody") };
  // invalid from the database (unique index race): keep the generic text but never leak the row
  if (r.code === "invalid" && !r.issues) return { ...r, message: t("errorTitle"), sub: t("errorBody"), current: undefined };
  return r;
}
