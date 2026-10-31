// Inbound webhook receiver logic (CONTRACTS C10), framework free so it is unit tested with fakes.
// Order: rate limit -> resolve connection -> size -> verify signature on the RAW body -> persist webhook_inbox -> enqueue -> 200.
// Nothing is processed inline. Bodies and secrets are never logged. Unknown/disabled connection = 404, bad signature = 401, both with
// the same empty-detail body.
import { LIMITS, type RateLimitResult } from "@/lib/security/rate-limit";
import { HOOK_KEY, HOOK_METHOD, HOOK_URL, safeEqual } from "./util";
import { VERIFIERS, allowListedHeaders, pickSecret, pickVerifyToken, providerEventId, schemeFor, type Scheme } from "./index";

export const MAX_BODY_BYTES = 1_048_576;
export const BAD_SIG_PER_MIN = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "cache-control": "no-store" };

export interface InboundConnection { id: string; tenantId: string; workspaceId: string; connectorId: string; status: string; webhookSecretId: string | null; credentialSecretId: string | null }
export interface NewInbox { connectorId: string; connectionId: string; tenantId: string; workspaceId: string; providerEventId: string; signatureOk: boolean; headers: Record<string, string>; body: string | null }
export interface InboxStore {
  getConnection(id: string): Promise<InboundConnection | null>;
  /** Inserts with ON CONFLICT (connector_id, provider_event_id) DO NOTHING. duplicate = the key already existed. */
  insertInbox(n: NewInbox): Promise<{ id: number | null; duplicate: boolean }>;
  deleteInbox(id: number): Promise<void>;
}
export interface Logger { warn(msg: string, fields?: Record<string, unknown>): void; error(msg: string, fields?: Record<string, unknown>): void }
export interface ReceiveDeps {
  store: InboxStore;
  getSecret(id: string): Promise<string | null>;
  rate(scope: string, id: string, cfg: { limit: number; windowMs: number }): Promise<RateLimitResult>;
  enqueue(connectorId: string, inboxId: number, tenantId: string): Promise<void>;
  log: Logger;
  now(): number;
  /** False in demo, or when Supabase / service credentials are missing: every request is a 404. */
  enabled: boolean;
  /** False for connectors that must not run in this environment (mock in production). */
  usable(connectorId: string): boolean;
  /** Platform fallback verify token for the Meta handshake (META_WEBHOOK_VERIFY_TOKEN). */
  metaVerifyToken?: string;
}
export interface ReceiveReq { method: "GET" | "POST"; connector: string; connection: string; headers: Headers; url: string; query: URLSearchParams; contentLength: number | null; ip: string; readBody(): Promise<string> }
export interface ReceiveRes { status: number; json?: unknown; text?: string; headers?: Record<string, string> }

const notFound = (): ReceiveRes => ({ status: 404, json: { ok: false }, headers: NO_STORE });
const unauthorized = (): ReceiveRes => ({ status: 401, json: { ok: false }, headers: NO_STORE });
const ok = (extra: Record<string, unknown> = {}): ReceiveRes => ({ status: 200, json: { ok: true, ...extra }, headers: NO_STORE });

async function resolve(d: ReceiveDeps, req: ReceiveReq): Promise<{ conn: InboundConnection; scheme: Scheme } | null> {
  if (!d.enabled || !UUID.test(req.connection)) return null;
  const scheme = schemeFor(req.connector);
  if (!scheme || !d.usable(req.connector)) return null;
  const conn = await d.store.getConnection(req.connection.toLowerCase());
  if (!conn || conn.connectorId !== req.connector) return null;
  if (["disconnected", "not_configured", "showcase"].includes(conn.status)) return null;
  return { conn, scheme };
}

async function throttled(d: ReceiveDeps, req: ReceiveReq): Promise<ReceiveRes | null> {
  const ip = await d.rate("hook-ip", req.ip.slice(0, 64), { limit: LIMITS.webhookInbound.limit * 4, windowMs: LIMITS.webhookInbound.windowMs });
  const tok = await d.rate("hook", req.connection.slice(0, 64).toLowerCase(), LIMITS.webhookInbound);
  const bad = !ip.ok ? ip : !tok.ok ? tok : null;
  return bad ? { status: 429, json: { ok: false }, headers: { ...NO_STORE, "Retry-After": String(bad.retryAfterSec) } } : null;
}

/** GET: Meta's subscription handshake (hub.mode=subscribe&hub.verify_token&hub.challenge). */
export async function receiveGet(d: ReceiveDeps, req: ReceiveReq): Promise<ReceiveRes> {
  const limited = await throttled(d, req);
  if (limited) return limited;
  const r = await resolve(d, req);
  if (!r || r.scheme !== "meta") return notFound();
  const mode = req.query.get("hub.mode"), token = req.query.get("hub.verify_token"), challenge = req.query.get("hub.challenge");
  if (mode !== "subscribe" || !token || !challenge || challenge.length > 200) return { status: 403, headers: NO_STORE };
  const own = pickVerifyToken(r.conn.webhookSecretId ? await d.getSecret(r.conn.webhookSecretId) : null);
  const expected = [own, d.metaVerifyToken].filter((x): x is string => !!x);
  let match = false;
  for (const e of expected) if (safeEqual(token, e)) match = true;
  if (!match) { d.log.warn("webhook_challenge_failed", { connector: req.connector, connection: r.conn.id }); return { status: 403, headers: NO_STORE }; }
  return { status: 200, text: challenge, headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8" } };
}

export async function receivePost(d: ReceiveDeps, req: ReceiveReq): Promise<ReceiveRes> {
  const limited = await throttled(d, req);
  if (limited) return limited;
  const r = await resolve(d, req);
  if (!r) return notFound();
  const { conn, scheme } = r;
  if (req.contentLength !== null && req.contentLength > MAX_BODY_BYTES) return { status: 413, json: { ok: false }, headers: NO_STORE };
  const raw = await req.readBody();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return { status: 413, json: { ok: false }, headers: NO_STORE };

  // Pseudo headers are ours: overwrite whatever the client sent.
  const h = new Headers(req.headers);
  h.set(HOOK_METHOD, "POST"); h.set(HOOK_URL, req.url); h.delete(HOOK_KEY);
  const k = req.query.get("k"); if (k) h.set(HOOK_KEY, k);

  let secret: string | null = null;
  try {
    const sid = conn.webhookSecretId ?? conn.credentialSecretId;
    secret = pickSecret(sid ? await d.getSecret(sid) : null);
  } catch { d.log.error("webhook_vault_unavailable", { connector: req.connector, connection: conn.id }); return { status: 503, json: { ok: false }, headers: NO_STORE }; }

  let valid = false;
  if (secret) { try { valid = await VERIFIERS[scheme](raw, h, secret, { now: d.now() }); } catch { valid = false; } }
  if (!valid) {
    d.log.warn("webhook_signature_failed", { connector: req.connector, connection: conn.id });   // never the body, headers or secret
    const bad = await d.rate("hook-bad", conn.id, { limit: BAD_SIG_PER_MIN, windowMs: 60_000 });
    if (bad.ok) {
      await d.store.insertInbox({ connectorId: conn.connectorId, connectionId: conn.id, tenantId: conn.tenantId, workspaceId: conn.workspaceId, providerEventId: `bad:${conn.id}:${d.now()}:${Math.random().toString(36).slice(2, 10)}`, signatureOk: false, headers: {}, body: null }).catch(() => undefined);
    }
    return unauthorized();
  }

  // Slack's one-off URL verification arrives signed; answer it without storing anything.
  if (scheme === "slack") {
    try { const j = JSON.parse(raw) as { type?: string; challenge?: unknown }; if (j.type === "url_verification" && typeof j.challenge === "string") return { status: 200, json: { challenge: j.challenge }, headers: NO_STORE }; } catch { /* fall through */ }
  }

  const eventId = `${conn.id}:${providerEventId(scheme, req.headers, raw)}`;
  const ins = await d.store.insertInbox({ connectorId: conn.connectorId, connectionId: conn.id, tenantId: conn.tenantId, workspaceId: conn.workspaceId, providerEventId: eventId, signatureOk: true, headers: allowListedHeaders(req.headers), body: raw });
  if (ins.duplicate || ins.id === null) return ok({ duplicate: true });   // replay or vendor retry: already stored, do not enqueue twice
  try { await d.enqueue(conn.connectorId, ins.id, conn.tenantId); }
  catch {
    d.log.error("webhook_enqueue_failed", { connector: req.connector, connection: conn.id });
    await d.store.deleteInbox(ins.id).catch(() => undefined);   // so the vendor's retry is not treated as a duplicate
    return { status: 503, json: { ok: false }, headers: NO_STORE };
  }
  return ok();
}
