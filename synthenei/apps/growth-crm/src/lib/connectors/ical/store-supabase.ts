// Supabase implementation of IcalStore on the SERVICE-ROLE client (jobs and the public feed route are sanctioned users of serviceDb,
// CONTRACTS C6). RLS does not protect this path, so every query is explicitly scoped by tenant_id and workspace_id. Tables ical_feeds and
// ical_export_tokens come from the SQL under "T046 needs" in docs/migrations-backlog.md; feed URLs live in the Vault, never in a column.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import type { VaultPort } from "../core/ports";
import type { FeedSource } from "./constants";
import type { FeedRow, FeedScope, IcalStore, TokenRow } from "./store";

type R = Record<string, unknown>;
const failed = (what: string) => new Error(`ical store: ${what} failed`);   // PostgREST text can quote values: not echoed
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function supabaseIcalStore(db: Db, vault: VaultPort): IcalStore {
  const q = (t: string) => from(db, t);
  const del = (t: string): Qb => (from(db, t) as unknown as { delete(): Qb }).delete();   // the shared Qb view has no delete
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };
  const toFeed = (r: R): FeedRow => ({
    id: String(r.id), tenantId: String(r.tenant_id), workspaceId: String(r.workspace_id), connectionId: String(r.integration_id), propertyKey: String(r.property_key),
    source: String(r.source) as FeedSource, label: str(r.label) ?? "", timezone: str(r.timezone), lastHash: str(r.last_hash), failures: typeof r.failures === "number" ? r.failures : 0,
    lastError: str(r.last_error), lastOkAt: str(r.last_ok_at),
  });
  const toToken = (r: R): TokenRow => ({
    id: String(r.id), tenantId: String(r.tenant_id), workspaceId: String(r.workspace_id), propertyKey: String(r.property_key), excludeSource: str(r.exclude_source) as FeedSource | null,
    revokedAt: str(r.revoked_at), lastFetchedAt: str(r.last_fetched_at), createdAt: String(r.created_at),
  });
  const feedsOf = (s: FeedScope) => q("ical_feeds").select().eq("tenant_id", s.tenantId).eq("workspace_id", s.workspaceId).eq("integration_id", s.connectionId);

  return {
    async listFeeds(s) { return (await rows(feedsOf(s).order("created_at", { ascending: true }).limit(100), "feed list")).map(toFeed); },
    async countFeeds(s) { return (await rows(q("ical_feeds").select("id").eq("tenant_id", s.tenantId).eq("workspace_id", s.workspaceId).limit(200), "feed count")).length; },
    async feedUrl(f) {
      const r = (await rows(q("ical_feeds").select("url_secret_id").eq("id", f.id).eq("tenant_id", f.tenantId).eq("workspace_id", f.workspaceId).limit(1), "feed secret"))[0];
      const id = str(r?.url_secret_id);
      return id ? vault.getSecret(id) : null;
    },
    async createFeed(f) {
      // The connection must be this workspace's iCal connection: a forged connection id cannot attach a feed to someone else's.
      const c = await rows(q("integrations").select("id").eq("id", f.connectionId).eq("tenant_id", f.tenantId).eq("workspace_id", f.workspaceId).eq("connector_id", "ical").limit(1), "connection check");
      if (!c.length) throw failed("connection check");
      const secretId = await vault.putSecret(`ical:feed:${f.connectionId}:${Date.now().toString(36)}`, f.url);
      const ins = await rows(q("ical_feeds").insert({
        tenant_id: f.tenantId, workspace_id: f.workspaceId, integration_id: f.connectionId, property_key: f.propertyKey, source: f.source, label: f.label,
        timezone: f.timezone, url_secret_id: secretId, url_host: new URL(f.url).hostname,
      }).select(), "feed insert").catch(async (e) => { await vault.deleteSecret(secretId).catch(() => undefined); throw e; });
      if (!ins[0]) throw failed("feed insert");
      return toFeed(ins[0]);
    },
    async deleteFeed(s, id) {
      const cur = (await rows(feedsOf(s).eq("id", id).limit(1), "feed read"))[0];
      if (!cur) return false;
      await rows(del("ical_feeds").eq("id", id).eq("tenant_id", s.tenantId).eq("workspace_id", s.workspaceId).select("id"), "feed delete");
      const sec = str(cur.url_secret_id);
      if (sec) await vault.deleteSecret(sec).catch(() => undefined);
      return true;
    },
    async recordFeedOk(f, r) {
      await rows(q("ical_feeds").update({ last_hash: r.hash, failures: 0, last_error: null, last_ok_at: r.at }).eq("id", f.id).eq("tenant_id", f.tenantId).eq("workspace_id", f.workspaceId).select("id"), "feed ok");
    },
    async recordFeedFailure(f, r) {
      const cur = (await rows(q("ical_feeds").select("failures").eq("id", f.id).eq("tenant_id", f.tenantId).eq("workspace_id", f.workspaceId).limit(1), "feed read"))[0];
      const n = (typeof cur?.failures === "number" ? cur.failures : f.failures) + 1;
      await rows(q("ical_feeds").update({ failures: n, last_error: r.code.slice(0, 60) }).eq("id", f.id).eq("tenant_id", f.tenantId).eq("workspace_id", f.workspaceId).select("id"), "feed failure");
      return n;
    },
    async resetFailures(s) {
      await rows(q("ical_feeds").update({ failures: 0, last_error: null }).eq("tenant_id", s.tenantId).eq("workspace_id", s.workspaceId).eq("integration_id", s.connectionId).select("id"), "feed reset");
    },
    async flagNeedsAttention(s, message, n) {
      await rows(q("integrations").update({ status: "needs_attention", last_error: message.slice(0, 300) }).eq("id", s.connectionId).eq("tenant_id", s.tenantId).eq("workspace_id", s.workspaceId).select("id"), "flag connection");
      const owners = (await rows(q("memberships").select("user_id").eq("workspace_id", s.workspaceId).eq("role", "owner").eq("is_active", true).limit(20), "owners")).map((r) => String(r.user_id));
      if (!owners.length) return;
      const have = await rows(q("notifications").select("user_id").eq("workspace_id", s.workspaceId).in("user_id", owners).in("body->>dedupe", [n.dedupe]), "notice lookup");
      const done = new Set(have.map((r) => String(r.user_id)));
      const todo = owners.filter((u) => !done.has(u));
      if (!todo.length) return;
      await rows(q("notifications").insert(todo.map((u) => ({
        tenant_id: s.tenantId, workspace_id: s.workspaceId, user_id: u, kind: "connector.needs_attention", object_type: null, object_id: null,
        title: n.title, body: { ...n.body, dedupe: n.dedupe }, url: n.url,
      }))).select("id"), "notice insert");
    },

    async findTokenByHash(hash) { const r = (await rows(q("ical_export_tokens").select().eq("token_hash", hash).limit(1), "token read"))[0]; return r ? toToken(r) : null; },
    async createToken(t) {
      const r = (await rows(q("ical_export_tokens").insert({ tenant_id: t.tenantId, workspace_id: t.workspaceId, property_key: t.propertyKey, exclude_source: t.excludeSource, token_hash: t.tokenHash, created_by: t.createdBy }).select(), "token insert"))[0];
      if (!r) throw failed("token insert");
      return toToken(r);
    },
    async listTokens(s) { return (await rows(q("ical_export_tokens").select().eq("tenant_id", s.tenantId).eq("workspace_id", s.workspaceId).order("created_at", { ascending: false }).limit(200), "token list")).map(toToken); },
    async revokeToken(s, id, at) {
      const r = await rows(q("ical_export_tokens").update({ revoked_at: at }).eq("id", id).eq("tenant_id", s.tenantId).eq("workspace_id", s.workspaceId).is("revoked_at", null).select("id"), "token revoke");
      return r.length > 0;
    },
    async touchToken(id, at) { await rows(q("ical_export_tokens").update({ last_fetched_at: at }).eq("id", id).select("id"), "token touch"); },
  };
}
