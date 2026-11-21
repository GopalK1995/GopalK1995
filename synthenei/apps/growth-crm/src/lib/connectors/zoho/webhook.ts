// Zoho CRM notifications: parsing, the per-connection channel id, and the watch registration (channels expire within a week, so the
// daily health stream renews them). The edge receiver (verify/receive.ts) checks the signature or shared token first; this file adds
// a second line: the token in the body must equal this connection's secret, and the channel id must be this connection's own.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ConnectionRow, ConnectionSecrets, VendorHttp } from "../core/types";
import { isCrmObject, type CrmObject } from "./engine/types";
import { MODULE, WATCH_TTL_DAYS } from "./constants";

export interface ZohoEvent { object: CrmObject; operation: string; ids: string[]; channelId: string }

const OBJECT_OF = new Map<string, CrmObject>(Object.entries(MODULE).map(([o, m]) => [m, o as CrmObject]));
const ID_RE = /^\d{1,25}$/;

/** Zoho wants a numeric channel id; derive a stable one from the connection id so a delivery can be tied back to its connection. */
export function channelIdFor(connectionId: string): string {
  return BigInt(`0x${createHash("sha256").update(`zoho-channel:${connectionId}`).digest("hex").slice(0, 12)}`).toString();
}

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Parses a notification body. When a secret is known and the body carries a token, a mismatch drops the delivery. */
export function parseZohoWebhook(raw: string, secret?: string | null): ZohoEvent[] {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return []; }
  const items = Array.isArray(j) ? j : [j];
  const out: ZohoEvent[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const e = it as Record<string, unknown>;
    if (secret && typeof e.token === "string" && !safeEq(e.token, secret)) continue;
    const object = typeof e.module === "string" ? OBJECT_OF.get(e.module) : undefined;
    const ids = Array.isArray(e.ids) ? e.ids.map(String).filter((x) => ID_RE.test(x)) : [];
    if (!object || !isCrmObject(object) || !ids.length || typeof e.operation !== "string") continue;
    out.push({ object, operation: e.operation, ids: ids.slice(0, 100), channelId: String(e.channel_id ?? "") });
  }
  return out;
}

export const newWebhookSecret = (): string => randomBytes(24).toString("base64url");

export interface WatchInput { http: VendorHttp; apiBase: string; token: string; conn: Pick<ConnectionRow, "id">; notifyUrl: string; secret: string; objects: CrmObject[]; now: Date }
/** POST /actions/watch. Returns the expiry that was requested. A rejected registration throws; polling keeps working without it. */
export async function registerWatch(i: WatchInput): Promise<{ expiresAt: string }> {
  const expiresAt = new Date(i.now.getTime() + WATCH_TTL_DAYS * 86_400_000).toISOString();
  await i.http.json({
    method: "POST", url: `${i.apiBase.replace(/\/+$/, "")}/crm/v6/actions/watch`, headers: { authorization: `Zoho-oauthtoken ${i.token}` },
    body: { watch: [{ channel_id: channelIdFor(i.conn.id), events: i.objects.map((o) => `${MODULE[o]}.all`), channel_expiry: expiresAt.replace(/\.\d{3}Z$/, "+00:00"), token: i.secret, notify_url: i.notifyUrl }] },
  });
  return { expiresAt };
}

export const secretsHaveToken = (s: ConnectionSecrets): boolean => typeof s.access_token === "string" && s.access_token.length > 0;
