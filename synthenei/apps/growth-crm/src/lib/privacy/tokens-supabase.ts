// Service-role TokenPort over public.privacy_tokens and privacy_token_use / privacy_token_peek (migration 0032).
// Before 0032 every call answers "unsupported" and the callers degrade: verify links keep their old (replayable inside 24 h) behaviour,
// status and export links cannot be issued. Never throws for a missing function or table.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { notApplied } from "./consent-write";
import type { TokenPeek, TokenPort, TokenUse } from "./tokens";

type Rpc = { rpc(fn: string, a: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };
const REASONS = new Set(["unknown", "revoked", "expired", "used", "scope"]);

export function supabaseTokenPort(db: Db): TokenPort {
  const rpc = (fn: string, a: Record<string, unknown>) => (db as unknown as Rpc).rpc(fn, a);
  return {
    async issue(i) {
      const r = await from(db, "privacy_tokens").insert({
        tenant_id: i.tenantUuid, workspace_id: i.wsUuid, request_id: i.requestId, purpose: i.purpose, token_hash: i.hash,
        max_uses: i.maxUses, expires_at: i.expiresAt, created_by: i.createdBy,
      });
      if (r.error) { if (notApplied(r.error)) return "unsupported"; throw new Error("privacy tokens: issue failed"); }
      return "ok";
    },
    async use(i): Promise<TokenUse> {
      const r = await rpc("privacy_token_use", { p_hash: i.hash, p_purpose: i.purpose, p_workspace: i.wsUuid, p_expires: i.expiresAt ?? null, p_register: i.register === true });
      if (r.error) { if (notApplied(r.error)) return { ok: false, reason: "unsupported" }; throw new Error("privacy tokens: use failed"); }
      const v = (r.data ?? {}) as { ok?: boolean; reason?: string; request_id?: string | null };
      if (v.ok === true) return { ok: true, requestId: v.request_id ?? null };
      return { ok: false, reason: REASONS.has(String(v.reason)) ? (v.reason as "unknown") : "unknown" };
    },
    async peek(i): Promise<TokenPeek> {
      const r = await rpc("privacy_token_peek", { p_hash: i.hash, p_purpose: i.purpose, p_workspace: i.wsUuid });
      if (r.error) { if (notApplied(r.error)) return { state: "unsupported" }; throw new Error("privacy tokens: peek failed"); }
      const v = (r.data ?? {}) as { state?: string; request_id?: string | null };
      const s = String(v.state);
      return { state: (["fresh", "ok", "used", "expired", "revoked", "scope"].includes(s) ? s : "scope") as TokenPeek["state"], requestId: v.request_id ?? null };
    },
    async revoke(i) {
      const r = await from(db, "privacy_tokens").update({ revoked_at: new Date().toISOString() }).eq("request_id", i.requestId).eq("purpose", i.purpose).is("revoked_at", null);
      if (r.error && !notApplied(r.error)) throw new Error("privacy tokens: revoke failed");
    },
  };
}
