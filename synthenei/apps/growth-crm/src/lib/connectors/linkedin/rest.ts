// Real LinkedIn REST gateway (versioned /rest endpoints, Rest.li 2.0 query syntax). Used only with real credentials (see config.ts).
// Retries 429/5xx with the framework's backoff (core/http), maps 401/403 to CredentialError, never logs or echoes bodies, tokens or answers.
// The response parsers are pure and exported: they are what the fixtures exercise. LinkedIn has no public sandbox.
import { makeVendorHttp } from "../core/http";
import type { RateLimitPolicy, VendorHttp } from "../core/types";
import { ACCOUNT_URN_PREFIX, INTROSPECT_URL, LEADS_PAGE_SIZE } from "./constants";
import type { AdAccountAsset, LeadAnswer, LeadResponse, LeadsPage, LinkedInGateway, RawAnalytics, TokenInfo } from "./gateway";

export interface RestOpts {
  apiBase: string; version: string; token: string; clientId?: string; clientSecret?: string;
  fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; random?: () => number; policy?: Partial<RateLimitPolicy>; http?: VendorHttp;
}
type R = Record<string, unknown>;
const isObj = (v: unknown): v is R => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 500): string | undefined => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : typeof v === "number" ? String(v) : undefined);
const enc = encodeURIComponent;
export const idOfUrn = (urn: string): string => urn.slice(urn.lastIndexOf(":") + 1).replace(/\)$/, "");

/** First readable answer text inside an answerDetails object (text answers, or the chosen options of a multiple-choice question). */
export function answerText(details: unknown, depth = 0): string {
  if (typeof details === "string") return details.trim();
  if (depth > 4) return "";
  if (Array.isArray(details)) return details.map((d) => answerText(d, depth + 1)).filter(Boolean).join(", ");
  if (isObj(details)) {
    for (const k of ["answer", "textAnswer", "value", "options", "selectedOptions"]) if (k in details) { const t = answerText(details[k], depth + 1); if (t) return t; }
    for (const v of Object.values(details)) { const t = answerText(v, depth + 1); if (t) return t; }
  }
  return "";
}

/** One element of GET /rest/leadFormResponses. Returns null for an element that has no id or submission time. Never throws. */
export function parseLeadResponse(raw: unknown): LeadResponse | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 128), submitted = typeof raw.submittedAt === "number" ? raw.submittedAt : Number(raw.submittedAt);
  if (!id || !Number.isFinite(submitted) || submitted <= 0) return null;
  const owner = isObj(raw.owner) ? str(raw.owner.sponsoredAccount, 100) ?? null : typeof raw.owner === "string" ? raw.owner : null;
  const fr = isObj(raw.formResponse) ? raw.formResponse : {};
  const answers: LeadAnswer[] = arr(fr.answers).filter(isObj).flatMap((a) => {
    const questionId = str(a.questionId, 64), value = answerText(a.answerDetails).slice(0, 1000);
    return questionId && value ? [{ questionId, value }] : [];
  });
  const consents = arr(fr.consentResponses).filter(isObj).flatMap((c) => { const cid = str(c.consentId, 100); return cid ? [{ id: cid, accepted: c.accepted === true }] : []; });
  const assoc = isObj(raw.associatedEntity) ? Object.values(raw.associatedEntity).find((v) => typeof v === "string" && v.includes(":sponsoredCampaign:")) : undefined;
  return {
    id, submittedAt: submitted, ownerAccountUrn: owner, formUrn: str(raw.versionedLeadGenFormUrn, 200) ?? null,
    campaignUrn: str(raw.campaign, 100) ?? (typeof assoc === "string" ? assoc : null), testLead: raw.testLead === true, answers, consents,
  };
}

/** Parses a lead form definition into questionId -> field key. */
export function parseFormQuestions(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const root = isObj(raw) ? raw : {};
  const content = isObj(root.content) ? root.content : root;
  for (const q of arr(content.questions).filter(isObj)) {
    const id = str(q.questionId, 64);
    if (!id) continue;
    const pre = str(q.predefinedField, 60) ?? (isObj(q.question) ? str(q.question.predefinedField, 60) : undefined);
    out.set(id, pre ? pre.toLowerCase() : `custom_${id}`);
  }
  return out;
}

export function parseAdAccounts(raw: unknown): AdAccountAsset[] {
  return arr(isObj(raw) ? raw.elements : []).filter(isObj).flatMap((a) => {
    const id = str(a.id, 40), status = str(a.status, 30);
    if (!id || !/^\d+$/.test(id) || status === "REMOVED" || status === "CANCELED") return [];
    return [{ id, name: str(a.name, 200) ?? `Ad account ${id}`, currency: (str(a.currency, 3) ?? "").toUpperCase() }];
  });
}

const dateArg = (day: string): string => { const [y, m, d] = day.split("-").map(Number); return `(year:${y},month:${m},day:${d})`; };

export function makeRestGateway(o: RestOpts): LinkedInGateway {
  const base = o.apiBase.replace(/\/+$/, "");
  const http = o.http ?? makeVendorHttp(o.policy ?? {}, { fetch: o.fetch, sleep: o.sleep, random: o.random });
  const headers = { authorization: `Bearer ${o.token}`, "linkedin-version": o.version, "x-restli-protocol-version": "2.0.0" };
  const get = <T>(path: string) => http.json<T>({ method: "GET", url: `${base}${path}`, headers });
  const forms = new Map<string, Map<string, string>>();

  return {
    kind: "rest",
    async listAdAccounts() { return parseAdAccounts(await get<unknown>("/rest/adAccounts?q=search&count=100")); },
    async listLeadResponses(i): Promise<LeadsPage> {
      const path = `/rest/leadFormResponses?q=owner&owner=(sponsoredAccount:${enc(i.accountUrn)})&leadType=(leadType:SPONSORED)&submittedAfterTimestamp=${Math.floor(i.sinceMs)}&start=${i.start}&count=${i.count}`;
      const body = await get<unknown>(path), root = isObj(body) ? body : {};
      const rows = arr(root.elements).map(parseLeadResponse).filter((x): x is LeadResponse => x !== null).sort((a, b) => a.submittedAt - b.submittedAt);
      const paging = isObj(root.paging) ? root.paging : {}, got = arr(root.elements).length;
      const total = typeof paging.total === "number" ? paging.total : undefined;
      const more = arr(paging.links).some((l) => isObj(l) && l.rel === "next") || (got >= i.count && (total === undefined || i.start + got < total));
      return { rows, nextStart: more && got > 0 ? i.start + got : undefined };
    },
    async formQuestions(formUrn) {
      const m = /leadGenForm:(\d+)/.exec(formUrn);
      if (!m) return new Map();
      const hit = forms.get(m[1]);
      if (hit) return hit;
      let q = new Map<string, string>();
      try { q = parseFormQuestions(await get<unknown>(`/rest/leadForms/${m[1]}`)); } catch (e) { if (e instanceof Error && e.name === "CredentialError") throw e; /* unreadable form: answers fall back to custom_<id> */ }
      forms.set(m[1], q);
      return q;
    },
    async analytics(i) {
      const path = `/rest/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY&dateRange=(start:${dateArg(i.since)},end:${dateArg(i.until)})&accounts=List(${enc(i.accountUrn)})&fields=dateRange,pivotValues,costInLocalCurrency,impressions,clicks,oneClickLeads`;
      const body = await get<unknown>(path);
      return arr(isObj(body) ? body.elements : []).filter(isObj) as RawAnalytics[];
    },
    async campaignNames(accountId) {
      const body = await get<unknown>(`/rest/adAccounts/${enc(accountId)}/adCampaigns?q=search&count=1000`);
      const out = new Map<string, string>();
      for (const c of arr(isObj(body) ? body.elements : []).filter(isObj)) { const id = str(c.id, 40), name = str(c.name, 200); if (id && name) out.set(id, name); }
      return out;
    },
    async accountCurrency(accountId) {
      const body = await get<unknown>(`/rest/adAccounts/${enc(accountId)}`);
      return (isObj(body) ? str(body.currency, 3) ?? "" : "").toUpperCase();
    },
    async introspect(): Promise<TokenInfo> {
      if (!o.clientId || !o.clientSecret) return { active: true, expiresAt: null, scopes: [] };   // cannot introspect without the app credentials: unknown, not alarming
      const body = await http.json<unknown>({
        method: "POST", url: INTROSPECT_URL, headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ client_id: o.clientId, client_secret: o.clientSecret, token: o.token }).toString(),
      });
      const r = isObj(body) ? body : {};
      const scope = typeof r.scope === "string" ? r.scope.split(/[,\s]+/).filter(Boolean) : [];
      return { active: r.active === true, expiresAt: typeof r.expires_at === "number" ? r.expires_at : null, scopes: scope };
    },
  };
}

export const accountUrn = (accountId: string): string => `${ACCOUNT_URN_PREFIX}${accountId}`;
export { LEADS_PAGE_SIZE };
