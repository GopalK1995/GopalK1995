// Idempotency-Key support for POST and PATCH (stored 24 h in idempotency_keys, service-role only, CONTRACTS C11).
// Same key + same request replays the stored response; same key + different request is a conflict; a request still in flight is a conflict.
import { createHash } from "node:crypto";
import { serviceDb } from "../db/service";
import { from } from "../db/query";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_RE = /^[\x21-\x7e]{8,200}$/;

export type IdemBegin =
  | { state: "new" }
  | { state: "replay"; status: number; body: unknown }
  | { state: "mismatch" }
  | { state: "inflight" };

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
  return {
    async begin(keyId, tenantId, idemKey, hash, now = Date.now()) {
      const db = getDb();
      for (let attempt = 0; attempt < 2; attempt++) {
        const ins = await from(db, "idempotency_keys").insert({ key_id: keyId, tenant_id: tenantId, idem_key: idemKey, request_hash: hash });
        if (!ins.error) return { state: "new" };
        if (ins.error.code !== "23505") throw new Error("idempotency store unavailable");
        const sel = await from(db, "idempotency_keys").select("request_hash,response,status,created_at").eq("key_id", keyId).eq("idem_key", idemKey).maybeSingle();
        const row = sel.data as IdemRow | null;
        if (!row) continue;
        if (now - Date.parse(row.created_at) > IDEMPOTENCY_TTL_MS) { await this.abort(keyId, idemKey); continue; }
        if (row.request_hash !== hash) return { state: "mismatch" };
        if (row.status == null) return { state: "inflight" };
        return { state: "replay", status: row.status, body: row.response };
      }
      return { state: "inflight" };
    },
    async finish(keyId, idemKey, status, body) {
      await from(getDb(), "idempotency_keys").update({ status, response: body ?? null }).eq("key_id", keyId).eq("idem_key", idemKey);
    },
    async abort(keyId, idemKey) {
      const q = (getDb() as unknown as { from(t: string): { delete(): { eq(c: string, v: string): { eq(c: string, v: string): PromiseLike<unknown> } } } }).from("idempotency_keys");
      await q.delete().eq("key_id", keyId).eq("idem_key", idemKey);
    },
  };
}
