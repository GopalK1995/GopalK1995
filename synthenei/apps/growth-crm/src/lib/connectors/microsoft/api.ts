// Minimal Microsoft Graph client: bearer auth, JSON in/out, retries 429 and 5xx with exponential backoff + jitter (honours Retry-After),
// maps every failure through errors.ts. Delta / next links come from Graph but are only followed when they live under the configured Graph
// base (a stored or tampered link can never send the bearer token to another host). Pure with injected fetch/sleep/random.
import { backoffMs, parseRetryAfter } from "../core/http";
import { CredentialError, TransientError } from "../core/types";
import { BASE_DELAY_MS, MAX_DELAY_MS, MAX_RETRIES, PAGE_SIZE } from "./constants";
import { classify, errorFromResponse, GraphApiError, GraphResyncError } from "./errors";
import type { DeltaPage, GraphGateway, GraphProfile, SubscriptionInfo } from "./gateway";
import type { RawEvent, RawMessage } from "./mappers";
import { validGraphId } from "./mappers";

export interface GraphHttpDeps { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; random?: () => number; maxRetries?: number }
export interface GraphRequest { method: "GET" | "POST" | "PATCH" | "DELETE"; url: string; token: string; headers?: Record<string, string>; body?: unknown }

export async function graphJson<T>(req: GraphRequest, deps: GraphHttpDeps = {}): Promise<T> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const max = deps.maxRetries ?? MAX_RETRIES;
  const policy = { requestsPerMinute: 0, maxRetries: max, baseDelayMs: BASE_DELAY_MS, maxDelayMs: MAX_DELAY_MS };
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(req.url, {
        method: req.method,
        headers: { accept: "application/json", authorization: `Bearer ${req.token}`, ...(req.body !== undefined ? { "content-type": "application/json" } : {}), ...req.headers },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      });
    } catch {
      if (attempt >= max) throw new TransientError("Microsoft Graph unreachable");
      await sleep(backoffMs(attempt, policy, deps.random));
      continue;
    }
    if (res.ok) {
      if (res.status === 202 || res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
    let body: unknown;
    try { body = await res.json(); } catch { body = undefined; }
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    const kind = classify(res.status, body);
    if ((kind === "quota" || kind === "server") && attempt < max) { await sleep(Math.min(MAX_DELAY_MS, retryAfter ?? backoffMs(attempt, policy, deps.random))); continue; }
    throw errorFromResponse(res.status, body, retryAfter);
  }
}

export const joinUrl = (base: string, path: string): string => `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
const MSG_FIELDS = "id,subject,bodyPreview,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,conversationId,isDraft";
const EVENT_FIELDS = "id,subject,start,end,isCancelled,isAllDay,showAs,responseStatus,attendees";
const PREFER = `outlook.timezone="UTC", odata.maxpagesize=${PAGE_SIZE}`;
const enc = encodeURIComponent;

interface Page<T> { value?: T[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string }
interface SubBody { id?: string; expirationDateTime?: string }

export interface GraphApiInput { token: string; base: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; random?: () => number }

export function makeGraphApi(i: GraphApiInput): GraphGateway {
  const deps: GraphHttpDeps = { fetch: i.fetch, sleep: i.sleep, random: i.random };
  const base = i.base.replace(/\/+$/, "");
  const call = <T>(method: GraphRequest["method"], url: string, body?: unknown) => graphJson<T>({ method, url, token: i.token, headers: { prefer: PREFER }, body }, deps);
  const followable = (link: string): string => { if (!link.startsWith(`${base}/`)) throw new GraphResyncError(); return link; };
  const page = async <T>(url: string): Promise<DeltaPage<T>> => {
    const r = await call<Page<T>>("GET", url);
    return { items: Array.isArray(r?.value) ? r.value : [], next: r?.["@odata.nextLink"], delta: r?.["@odata.deltaLink"] };
  };
  const sub = (r: SubBody): SubscriptionInfo => {
    if (!r?.id || !r.expirationDateTime) throw new GraphApiError(502, "other", "Microsoft Graph returned an unreadable subscription");
    return { id: r.id, expiresAt: new Date(r.expirationDateTime).toISOString() };
  };
  const getOrNull = async <T>(url: string): Promise<T | null> => {
    try { return await call<T>("GET", url); } catch (e) { if (e instanceof GraphApiError && e.failure === "not_found") return null; throw e; }
  };
  return {
    kind: "api",
    async profile(): Promise<GraphProfile> {
      const r = await call<{ id?: string; mail?: string | null; userPrincipalName?: string | null; displayName?: string | null }>("GET", `${joinUrl(base, "me")}?$select=id,displayName,mail,userPrincipalName`);
      if (!r?.id) throw new CredentialError("Microsoft did not return the signed-in user");
      return { id: r.id, mail: r.mail ?? r.userPrincipalName ?? null, name: r.displayName ?? null };
    },
    async deltaMessages(folder, link, sinceIso) {
      const f = folder === "inbox" ? "inbox" : "sentitems";
      return page<RawMessage>(link ? followable(link) : `${joinUrl(base, `me/mailFolders/${f}/messages/delta`)}?$select=${MSG_FIELDS}&$filter=${enc(`receivedDateTime ge ${sinceIso}`)}`);
    },
    async deltaEvents(link, w) {
      return page<RawEvent>(link ? followable(link) : `${joinUrl(base, "me/calendarView/delta")}?startDateTime=${enc(w.startIso)}&endDateTime=${enc(w.endIso)}&$select=${EVENT_FIELDS}`);
    },
    getMessage(id) { return validGraphId(id) ? getOrNull<RawMessage>(`${joinUrl(base, `me/messages/${enc(id)}`)}?$select=${MSG_FIELDS}`) : Promise.resolve(null); },
    getEvent(id) { return validGraphId(id) ? getOrNull<RawEvent>(`${joinUrl(base, `me/events/${enc(id)}`)}?$select=${EVENT_FIELDS}`) : Promise.resolve(null); },
    async sendMail(m) {
      await call<void>("POST", joinUrl(base, "me/sendMail"), {
        message: { subject: m.subject, body: { contentType: "Text", content: m.body }, toRecipients: m.to.map((address) => ({ emailAddress: { address } })) },
        saveToSentItems: true,
      });
    },
    async createSubscription(s) {
      return sub(await call<SubBody>("POST", joinUrl(base, "subscriptions"), {
        changeType: "created,updated,deleted", notificationUrl: s.notificationUrl, lifecycleNotificationUrl: s.notificationUrl,
        resource: s.resource, expirationDateTime: s.expiresAt, clientState: s.clientState,
      }));
    },
    async renewSubscription(id, expiresAt) {
      if (!validGraphId(id)) throw new GraphApiError(404, "not_found", "Microsoft Graph error (HTTP 404)");
      return sub(await call<SubBody>("PATCH", joinUrl(base, `subscriptions/${enc(id)}`), { expirationDateTime: expiresAt }));
    },
    async deleteSubscription(id) {
      if (!validGraphId(id)) return;
      try { await call<void>("DELETE", joinUrl(base, `subscriptions/${enc(id)}`)); } catch (e) { if (!(e instanceof GraphApiError && e.failure === "not_found")) throw e; }
    },
  };
}
