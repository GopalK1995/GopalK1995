// Idempotency-Key support for POST and PATCH (stored in idempotency_keys, service-role only, CONTRACTS C11).
// Same key + same request replays the stored response; same key + different request is a conflict.
// A row with no status is an in-progress LEASE that lives LEASE_MS from created_at: a retry inside the lease gets a
// 409 with Retry-After, a retry after it (the first request crashed or was killed) takes the key over. Completed rows
// replay until IDEMPOTENCY_TTL_MS. No schema change needed: created_at is the lease start.
import { createHash } from "node:crypto";
import { serviceDb } from "../db/service";
import { from } from "../db/query";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** An in-progress request older than this is treated as abandoned (acceptance: reusable after 60 s). */
export const IDEMPOTENCY_LEASE_MS = 60 * 1000;
const KEY_RE = /^[\x21-\x7e]{8,200}$/;

export type IdemBegin =
  | { state: "new" }
  | { state: "replay"; status: number; body: unknown }
  | { state: "mismatch" }
  | { state: "inflight"; retryAfterSec?: number };

/** Thrown when the store cannot be used (table missing, database down). The caller answers 503, never runs the write. */
export class IdempotencyUnavailableError extends Error {
  constructor() { super("idempotency store unavailable"); this.name = "IdempotencyUnavailableError"; }
}

export interface IdempotencyStore {
  begin(keyId: string, tenantId: string, idemKey: string, requestHash: string, now?: number): Promise<IdemBegin>;
  finish(keyId: string, idemKey: string, status: number, body: unknown): Promise<void>;
  abort(keyId: string, idemKey: string): Promise<void>;
}

export const validIdempotencyKey = (k: string): boolean => KEY_RE.test(k);
export const requestHash = (method: string, path: string, rawBody: string): string =>
  createHash("sha256").update(`${method.toUpperCase()}\n${path}\n${rawBody}`).digest("hex");

interface IdemRow { request_hash: string; response: unknown; status: number | null; created_at: string }

export function serviceIdempotencyStore(getDb = serviceDb): IdempotencyStore {
  /** Deletes the row only if it is still the stale one we looked at: a fresh row from a concurrent retry survives. */
  const deleteIf = async (keyId: string, idemKey: string, olderThanIso: string, inFlightOnly: boolean) => {
    let q = from(getDb(), "idempotency_keys").delete().eq("key_id", keyId).eq("idem_key", idemKey).lt("created_at", olderThanIso);
    if (inFlightOnly) q = q.is("status", null);
    await q;
  };
  return {
    async begin(keyId, tenantId, idemKey, hash, now = Date.now()) {
      const db = getDb();
      for (let attempt = 0; attempt < 3; attempt++) {
        let ins;
        try { ins = await from(db, "idempotency_keys").insert({ key_id: keyId, tenant_id: tenantId, idem_key: idemKey, request_hash: hash }); } catch { throw new IdempotencyUnavailableError(); }
        if (!ins.error) return { state: "new" };
        if (ins.error.code !== "23505") throw new IdempotencyUnavailableError();
        const sel = await from(db, "idempotency_keys").select("request_hash,response,status,created_at").eq("key_id", keyId).eq("idem_key", idemKey).maybeSingle();
        if (sel.error) throw new IdempotencyUnavailableError();
        const row = sel.data as IdemRow | null;
        if (!row) continue;
        const age = now - Date.parse(row.created_at);
        if (age > IDEMPOTENCY_TTL_MS) { await deleteIf(keyId, idemKey, new Date(now - IDEMPOTENCY_TTL_MS).toISOString(), false); continue; }
        if (row.request_hash !== hash) return { state: "mismatch" };
        if (row.status == null) {
          if (age > IDEMPOTENCY_LEASE_MS) { await deleteIf(keyId, idemKey, new Date(now - IDEMPOTENCY_LEASE_MS).toISOString(), true); continue; }
          return { state: "inflight", retryAfterSec: Math.max(1, Math.ceil((IDEMPOTENCY_LEASE_MS - age) / 1000)) };
        }
        return { state: "replay", status: row.status, body: row.response };
      }
      return { state: "inflight", retryAfterSec: 1 };
    },
    async finish(keyId, idemKey, status, body) {
      const write = () => from(getDb(), "idempotency_keys").update({ status, response: body ?? null }).eq("key_id", keyId).eq("idem_key", idemKey);
      const r = await write();
      if (r.error) await write(); // one retry; if it still fails the lease expires and the key frees itself
    },
    async abort(keyId, idemKey) {
      await from(getDb(), "idempotency_keys").delete().eq("key_id", keyId).eq("idem_key", idemKey);
    },
  };
}
