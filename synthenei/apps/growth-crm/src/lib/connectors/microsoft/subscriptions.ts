// Graph change-notification subscriptions: create, renew before they lapse, recreate when Graph dropped one. Mail and event subscriptions
// live at most about 70 hours, so the hourly `subscriptions` stream renews anything with under 12 hours left. State (ids and expiry, not
// secrets) lives in that stream's cursor. The `clientState` secret is created once per connection and stored in the Vault as the
// connection's webhook secret; the receiver checks it on every delivery (validation.ts). Polling keeps working whatever happens here.
import type { RuntimeDeps } from "../core/ports";
import { randomToken } from "../core/oauth";
import { saveSecrets } from "../core/secrets";
import type { ConnectionRow } from "../core/types";
import { MS_ENV, SUB_KEYS, SUB_MINUTES, SUB_RENEW_BEFORE_MS, SUB_RESOURCES, type SubKey } from "./constants";
import { GraphApiError } from "./errors";
import type { GraphGateway } from "./gateway";
import type { MsDeps } from "./store";

type Env = Record<string, string | undefined>;
export interface SubEntry { id: string; expiresAt: string }
export type SubStatus = "active" | "no_public_url" | "error";
export interface SubCursor { subs: Partial<Record<SubKey, SubEntry>>; status: SubStatus; error?: string }

export function asSubCursor(c: unknown): SubCursor {
  const o = c && typeof c === "object" ? (c as { subs?: unknown; status?: unknown }) : {};
  const subs: SubCursor["subs"] = {};
  if (o.subs && typeof o.subs === "object") for (const k of SUB_KEYS) {
    const e = (o.subs as Record<string, unknown>)[k] as Partial<SubEntry> | undefined;
    if (e && typeof e.id === "string" && typeof e.expiresAt === "string") subs[k] = { id: e.id, expiresAt: e.expiresAt };
  }
  return { subs, status: o.status === "active" || o.status === "error" ? o.status : "no_public_url" };
}

/** The public notification URL of a connection, or null when the deployment has no public https base (Graph cannot reach localhost). */
export function notificationUrl(env: Env, connectionId: string): string | null {
  const base = (env[MS_ENV.appBaseUrl] ?? "").trim().replace(/\/+$/, "");
  try {
    const u = new URL(base);
    if (u.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || u.search || u.hash) return null;
    return `${base}/api/hooks/outlook/${encodeURIComponent(connectionId)}`;
  } catch { return null; }
}

/** The per-connection clientState: read from the Vault, or created and stored once. */
async function clientStateOf(rd: RuntimeDeps, conn: ConnectionRow): Promise<string> {
  const fresh = (await rd.store.getConnection(conn.id)) ?? conn;
  if (fresh.webhookSecretId) {
    const raw = await rd.vault.getSecret(fresh.webhookSecretId);
    try { const v = (JSON.parse(raw ?? "") as { webhook_secret?: unknown }).webhook_secret; if (typeof v === "string" && v.length >= 16) return v; } catch { /* regenerate below */ }
  }
  const state = randomToken(32);
  const id = await saveSecrets(rd.vault, conn.id, { webhook_secret: state }, fresh.webhookSecretId, "webhook");
  await rd.store.updateConnection(conn.id, { webhookSecretId: id });
  return state;
}

export interface EnsureInput { rd: RuntimeDeps; deps: MsDeps; gateway: GraphGateway; conn: ConnectionRow; env: Env; cursor: unknown }
export interface EnsureResult { cursor: SubCursor; created: number; renewed: number }

export async function ensureSubscriptions(i: EnsureInput): Promise<EnsureResult> {
  const cur = asSubCursor(i.cursor);
  const url = notificationUrl(i.env, i.conn.id) ?? (i.gateway.kind === "mock" ? `https://example.invalid/api/hooks/${i.conn.id}` : null);
  if (!url) return { cursor: { subs: cur.subs, status: "no_public_url" }, created: 0, renewed: 0 };
  const clientState = await clientStateOf(i.rd, i.conn);
  const now = i.deps.now().getTime(), subs = { ...cur.subs };
  let created = 0, renewed = 0, error: string | undefined;
  for (const key of SUB_KEYS) {
    const have = subs[key];
    if (have && Date.parse(have.expiresAt) - now > SUB_RENEW_BEFORE_MS) continue;
    const expiresAt = new Date(now + SUB_MINUTES * 60_000).toISOString();
    try {
      if (have) {
        try { subs[key] = await i.gateway.renewSubscription(have.id, expiresAt); renewed++; continue; }
        catch (e) { if (!(e instanceof GraphApiError && e.failure === "not_found")) throw e; delete subs[key]; }   // dropped by Graph: recreate
      }
      subs[key] = await i.gateway.createSubscription({ resource: SUB_RESOURCES[key], notificationUrl: url, expiresAt, clientState });
      created++;
    } catch (e) {
      // Credentials and transient failures are the framework's business; a refused subscription (for example Graph could not reach the
      // URL for its handshake) is recorded and polling carries on.
      if (e instanceof GraphApiError) { error = `${key}:http_${e.httpStatus}`; i.deps.log.warn("outlook subscription refused", { key, status: e.httpStatus }); continue; }
      throw e;
    }
  }
  return { cursor: { subs, status: error ? "error" : "active", ...(error ? { error } : {}) }, created, renewed };
}

/** Best effort on disconnect: removes our subscriptions at Graph (they would otherwise keep posting until they lapse). */
export async function dropSubscriptions(gateway: GraphGateway, cursor: unknown): Promise<number> {
  let n = 0;
  for (const e of Object.values(asSubCursor(cursor).subs)) { try { await gateway.deleteSubscription(e.id); n++; } catch { /* lapses by itself within 70 h */ } }
  return n;
}
