// Real Graph API gateway over fetch. Used only with real credentials (see config.ts). Retries 429/5xx and Meta's rate-limit codes
// with the framework's backoff, honours Retry-After, keeps the vendor error code, never logs or echoes bodies, tokens or recipients.
// Every call carries appsecret_proof when the app secret is known (Meta's "require app secret proof" setting).
import { createHmac } from "node:crypto";
import { backoffMs, parseRetryAfter } from "../core/http";
import { CredentialError, DEFAULT_RATE_POLICY, TransientError, type RateLimitPolicy } from "../core/types";
import { INSIGHTS_PAGE_SIZE } from "./constants";
import { errorFromResponse, MetaApiError, type AdAccountAsset, type GraphLead, type InsightsPage, type MetaGateway, type PageWithToken, type RawInsight, type TokenDebug } from "./gateway";

export interface GraphOpts {
  apiBase: string; version: string; userToken?: string; pageToken?: string; pageId?: string; igUserId?: string; appId?: string; appSecret?: string;
  fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; random?: () => number; policy?: Partial<RateLimitPolicy>;
}
type R = Record<string, unknown>;
const isObj = (v: unknown): v is R => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 500): string | undefined => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const appSecretProof = (token: string, appSecret: string): string => createHmac("sha256", appSecret).update(token, "utf8").digest("hex");
export const actId = (id: string): string => (id.startsWith("act_") ? id : `act_${id}`);

/** Lead object per the Marketing API (field_data is [{name, values[]}]). Never throws. */
export function parseGraphLead(raw: unknown): GraphLead | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 64);
  if (!id) return null;
  const fields: Record<string, string> = {};
  for (const f of arr(raw.field_data)) {
    if (!isObj(f)) continue;
    const name = str(f.name, 100), vals = arr(f.values).filter((x): x is string => typeof x === "string" && x.trim() !== "");
    if (name && vals.length) fields[name] = vals.join(", ").slice(0, 1000);
  }
  const disclaimers = arr(raw.custom_disclaimer_responses).filter(isObj).flatMap((d) => {
    const key = str(d.checkbox_key, 100);
    return key ? [{ key, checked: d.is_checked === true || d.is_checked === "true" || d.is_checked === 1 || d.is_checked === "1" }] : [];
  });
  return {
    id, createdAt: str(raw.created_time, 40), formId: str(raw.form_id, 64), adId: str(raw.ad_id, 64), adName: str(raw.ad_name, 200), adsetId: str(raw.adset_id, 64),
    adsetName: str(raw.adset_name, 200), campaignId: str(raw.campaign_id, 64), campaignName: str(raw.campaign_name, 200),
    isOrganic: typeof raw.is_organic === "boolean" ? raw.is_organic : undefined, platform: str(raw.platform, 20), fields, disclaimers,
  };
}

const LEAD_FIELDS = "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,is_organic,platform,custom_disclaimer_responses";
const INSIGHT_FIELDS = "campaign_id,campaign_name,spend,impressions,reach,clicks,actions,account_currency,date_start,date_stop";

export function makeGraphGateway(o: GraphOpts): MetaGateway {
  const p = { ...DEFAULT_RATE_POLICY, ...o.policy };
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = `${o.apiBase.replace(/\/+$/, "")}/${o.version}`;

  async function call<T>(method: "GET" | "POST", path: string, a: { token?: string; query?: Record<string, string | undefined>; body?: unknown } = {}): Promise<T> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(a.query ?? {})) if (v !== undefined) q.set(k, v);
    if (a.token && o.appSecret) q.set("appsecret_proof", appSecretProof(a.token, o.appSecret));
    const url = `${base}/${path.replace(/^\/+/, "")}${q.size ? `?${q.toString()}` : ""}`;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, {
          method, headers: { accept: "application/json", ...(a.token ? { authorization: `Bearer ${a.token}` } : {}), ...(a.body !== undefined ? { "content-type": "application/json" } : {}) },
          body: a.body === undefined ? undefined : JSON.stringify(a.body),
        });
      } catch {
        if (attempt >= p.maxRetries) throw new TransientError("Meta API unreachable");
        await sleep(backoffMs(attempt, p, o.random));
        continue;
      }
      if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
      let errBody: unknown = null;
      try { errBody = await res.json(); } catch { /* no body */ }
      const err = errorFromResponse(res.status, errBody);
      // Meta reports throttling as HTTP 400 with a rate-limit code, not only as 429: both are retried with backoff.
      if (err instanceof MetaApiError && err.transient) {
        const ra = parseRetryAfter(res.headers.get("retry-after"));
        if (attempt >= p.maxRetries) throw new TransientError(`Meta API kept failing (code ${err.code || res.status})`, ra);
        await sleep(Math.min(p.maxDelayMs, ra ?? backoffMs(attempt, p, o.random)));
        continue;
      }
      throw err;
    }
  }
  const need = (t: string | undefined, what: string): string => { if (!t) throw new CredentialError(`Meta ${what} is missing`); return t; };

  return {
    kind: "graph",
    async getLead(leadgenId) {
      try { return parseGraphLead(await call("GET", leadgenId, { token: need(o.pageToken, "page token"), query: { fields: LEAD_FIELDS } })); }
      catch (e) { if (e instanceof MetaApiError && e.failure === "not_found") return null; throw e; }
    },
    async listPages() {
      const out: PageWithToken[] = [];
      let after: string | undefined;
      for (let i = 0; i < 5; i++) {
        const j = await call<R>("GET", "me/accounts", { token: need(o.userToken, "user token"), query: { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "100", after } });
        for (const x of arr(j.data)) {
          if (!isObj(x)) continue;
          const id = str(x.id, 64), token = str(x.access_token, 1000);
          if (!id || !token) continue;
          const ig = isObj(x.instagram_business_account) ? x.instagram_business_account : undefined;
          out.push({ id, name: str(x.name, 200) ?? id, pageToken: token, igUserId: str(ig?.id, 64), igUsername: str(ig?.username, 100) });
        }
        after = isObj(j.paging) && isObj(j.paging.cursors) && typeof j.paging.next === "string" ? str(j.paging.cursors.after, 500) : undefined;
        if (!after) break;
      }
      return out;
    },
    async listAdAccounts() {
      const out: AdAccountAsset[] = [];
      let after: string | undefined;
      for (let i = 0; i < 5; i++) {
        const j = await call<R>("GET", "me/adaccounts", { token: need(o.userToken, "user token"), query: { fields: "account_id,name,currency", limit: "100", after } });
        for (const x of arr(j.data)) {
          if (!isObj(x)) continue;
          const id = str(x.account_id, 64) ?? str(x.id, 64)?.replace(/^act_/, "");
          if (id) out.push({ id, name: str(x.name, 200) ?? id, currency: str(x.currency, 3) ?? "" });
        }
        after = isObj(j.paging) && isObj(j.paging.cursors) && typeof j.paging.next === "string" ? str(j.paging.cursors.after, 500) : undefined;
        if (!after) break;
      }
      return out;
    },
    async subscribePage(pageId, pageToken, fields) {
      const r = await call<R>("POST", `${pageId}/subscribed_apps`, { token: pageToken, body: { subscribed_fields: fields.join(",") } });
      if (r && r.success === false) throw new TransientError("Meta did not accept the page subscription");
    },
    async insights(i): Promise<InsightsPage> {
      const j = await call<R>("GET", `${actId(i.adAccountId)}/insights`, {
        token: need(o.userToken, "user token"),
        query: { level: "campaign", time_increment: "1", fields: INSIGHT_FIELDS, time_range: JSON.stringify({ since: i.since, until: i.until }), limit: String(INSIGHTS_PAGE_SIZE), after: i.after },
      });
      const rows = arr(j.data).filter(isObj) as RawInsight[];
      const next = isObj(j.paging) && typeof j.paging.next === "string" && isObj(j.paging.cursors) ? str(j.paging.cursors.after, 500) : undefined;
      return { rows, after: next };
    },
    async igProfile(senderId) {
      const j = await call<R>("GET", senderId, { token: need(o.pageToken, "page token"), query: { fields: "name,username" } });
      return { name: str(j.name, 200), username: str(j.username, 100) };
    },
    async sendIgMessage(i) {
      const j = await call<R>("POST", `${need(o.pageId, "page id")}/messages`, { token: need(o.pageToken, "page token"), body: { recipient: { id: i.recipientId }, message: { text: i.text }, messaging_type: "RESPONSE" } });
      const mid = str(j.message_id, 300);
      if (!mid) throw new TransientError("Meta answered without a message id");
      return { mid };
    },
    async debugToken(): Promise<TokenDebug> {
      if (!o.appId || !o.appSecret) throw new Error("Meta app credentials are not configured");
      const j = await call<R>("GET", "debug_token", { query: { input_token: need(o.userToken, "user token"), access_token: `${o.appId}|${o.appSecret}` } });
      const d = isObj(j.data) ? j.data : {};
      return { valid: d.is_valid === true, expiresAt: typeof d.expires_at === "number" ? d.expires_at : null, scopes: arr(d.scopes).filter((s): s is string => typeof s === "string") };
    },
    async exchangeLongLived() {
      if (!o.appId || !o.appSecret) throw new Error("Meta app credentials are not configured");
      const j = await call<R>("GET", "oauth/access_token", { query: { grant_type: "fb_exchange_token", client_id: o.appId, client_secret: o.appSecret, fb_exchange_token: need(o.userToken, "user token") } });
      const t = str(j.access_token, 2000);
      if (!t) throw new CredentialError("Meta did not return a long-lived token");
      return { accessToken: t, expiresInSec: typeof j.expires_in === "number" ? j.expires_in : undefined };
    },
  };
}
