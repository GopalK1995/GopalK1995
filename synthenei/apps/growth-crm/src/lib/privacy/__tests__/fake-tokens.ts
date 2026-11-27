// In-memory TokenPort with the same rules as privacy_token_use / privacy_token_peek (migration 0032).
import type { TokenPeek, TokenPort, TokenPurpose, TokenUse } from "../tokens";

interface Row { purpose: TokenPurpose; wsUuid: string; requestId: string | null; maxUses: number; uses: number; expiresAt: number; revoked: boolean }

export function fakeTokens(now: () => number, opts: { unsupported?: boolean } = {}): TokenPort & { rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const state = (r: Row): "ok" | "used" | "expired" | "revoked" => (r.revoked ? "revoked" : r.expiresAt <= now() ? "expired" : r.uses >= r.maxUses ? "used" : "ok");
  return {
    rows,
    async issue(i) {
      if (opts.unsupported) return "unsupported";
      rows.set(i.hash, { purpose: i.purpose, wsUuid: i.wsUuid, requestId: i.requestId, maxUses: i.maxUses, uses: 0, expiresAt: Date.parse(i.expiresAt), revoked: false });
      return "ok";
    },
    async use(i): Promise<TokenUse> {
      if (opts.unsupported) return { ok: false, reason: "unsupported" };
      if (i.register && !rows.has(i.hash)) rows.set(i.hash, { purpose: i.purpose, wsUuid: i.wsUuid, requestId: null, maxUses: 1, uses: 0, expiresAt: i.expiresAt ? Date.parse(i.expiresAt) : now() + 86_400_000, revoked: false });
      const r = rows.get(i.hash);
      if (!r) return { ok: false, reason: "unknown" };
      if (r.purpose !== i.purpose || r.wsUuid !== i.wsUuid) return { ok: false, reason: "scope" };
      const s = state(r);
      if (s !== "ok") return { ok: false, reason: s };
      r.uses++;
      return { ok: true, requestId: r.requestId };
    },
    async peek(i): Promise<TokenPeek> {
      if (opts.unsupported) return { state: "unsupported" };
      const r = rows.get(i.hash);
      if (!r) return { state: "fresh" };
      if (r.purpose !== i.purpose || r.wsUuid !== i.wsUuid) return { state: "scope" };
      return { state: state(r), requestId: r.requestId };
    },
    async revoke(i) { for (const r of rows.values()) if (r.requestId === i.requestId && r.purpose === i.purpose) r.revoked = true; },
  };
}
