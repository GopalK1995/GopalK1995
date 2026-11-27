// Suppression list access through the 0030 RPCs (AUD-034): the address is hashed inside the database with a per-tenant Vault key
// (HMAC-SHA256) and only that hash is stored; the clear address never lands in email_suppressions and the key never leaves Postgres.
// While migration 0030 is not applied the RPCs do not exist (PostgREST PGRST202 / Postgres 42883): the caller's legacy path runs, which is
// exactly the previous behaviour, so the app keeps working before and after the owner applies the migration. Any OTHER error is thrown
// (fail closed): a hashing failure must never fall back to storing or comparing the clear address.
import type { Db } from "@/lib/db/client";
import { normaliseEmail } from "./suppression";

type RpcRes = { data: unknown; error: { code?: string } | null };
const rpcOf = (db: Db) => (db as unknown as { rpc(fn: string, a: Record<string, unknown>): PromiseLike<RpcRes> }).rpc.bind(db);

/** Function absent (migration not applied) as opposed to a real failure. */
export const rpcMissing = (e: { code?: string } | null): boolean => !!e && ["PGRST202", "42883"].includes(String(e.code ?? ""));

export async function suppressionCheck(db: Db, workspaceId: string, email: string, legacy: () => Promise<boolean>): Promise<boolean> {
  const r = await rpcOf(db)("suppression_check", { p_workspace: workspaceId, p_email: normaliseEmail(email) });
  if (!r.error) return r.data === true;
  if (rpcMissing(r.error)) return legacy();
  throw new Error("email store: suppression check failed");   // fail closed: PostgREST text can quote values, so it is not echoed
}

export interface AddSuppression { workspaceId: string; email: string; reason: string; source: string; leadId?: string | null }
export async function suppressionAdd(db: Db, s: AddSuppression, legacy: () => Promise<boolean>): Promise<boolean> {
  const r = await rpcOf(db)("suppression_add", { p_workspace: s.workspaceId, p_email: normaliseEmail(s.email), p_reason: s.reason, p_source: s.source, p_lead: s.leadId ?? null });
  if (!r.error) return r.data === true;
  if (rpcMissing(r.error)) return legacy();
  throw new Error("email store: suppression insert failed");
}

/** What the settings list shows for a row: the address when it is still stored (legacy), otherwise a short fingerprint of the hash. */
export function suppressionDisplay(email: string | null, hash: string | null, mask: (e: string) => string, mayPii: boolean): string {
  if (email) return mayPii ? email : mask(email);
  return `address not kept (${(hash ?? "").slice(3, 11) || "hash"})`;
}
