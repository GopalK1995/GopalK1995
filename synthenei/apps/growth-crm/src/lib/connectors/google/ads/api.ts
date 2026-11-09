// Real Google Ads gateway: customers:listAccessibleCustomers + GAQL over googleAds:search with page tokens. Every call carries the
// platform's developer token (env name GOOGLE_ADS_DEVELOPER_TOKEN) and, for accounts reached through a manager, login-customer-id.
// Quota answers back off inside googleJson; an unapproved developer token or removed grant is a CredentialError.
import { CredentialError, TransientError } from "../../core/types";
import { googleJson, joinUrl, type GoogleHttpDeps } from "../shared/api";
import { CUSTOMER_ID, cleanCustomerId, MAX_NAME_LEN } from "./constants";
import type { AdsCustomer, AdsGateway } from "./gateway";
import { campaignQuery, type AdsPage } from "./report";

export interface AdsApiOptions extends GoogleHttpDeps { base: string; version: string; token: string; developerToken: string; /** optional platform-level manager */ loginCustomerId?: string }
const MAX_ACCESSIBLE = 100, MAX_CLIENTS = 300;

interface CustomerRow { id?: string | number; descriptiveName?: string; currencyCode?: string; manager?: boolean; status?: string }

export function makeAdsApi(o: AdsApiOptions): AdsGateway {
  if (!o.developerToken) throw new CredentialError("The Google Ads developer token is not configured on this deployment");
  const root = joinUrl(o.base, o.version);
  const headers = (login?: string): Record<string, string> => {
    const l = cleanCustomerId(login ?? o.loginCustomerId);
    return { "developer-token": o.developerToken, ...(CUSTOMER_ID.test(l) ? { "login-customer-id": l } : {}) };
  };
  const search = <T>(customerId: string, login: string | undefined, body: Record<string, unknown>) =>
    googleJson<{ results?: T[]; nextPageToken?: string }>({ method: "POST", url: joinUrl(root, `customers/${customerId}/googleAds:search`), token: o.token, headers: headers(login), body }, o);
  const toCustomer = (c: CustomerRow, login?: string): AdsCustomer | null => {
    const id = cleanCustomerId(c.id === undefined ? "" : String(c.id));
    return CUSTOMER_ID.test(id) ? { id, name: (c.descriptiveName ?? "").slice(0, MAX_NAME_LEN) || id, currency: /^[A-Z]{3}$/.test(c.currencyCode ?? "") ? (c.currencyCode as string) : "", manager: c.manager === true, ...(login ? { loginCustomerId: login } : {}) } : null;
  };

  return {
    kind: "api",
    async listCustomers() {
      const list = await googleJson<{ resourceNames?: string[] }>({ method: "GET", url: joinUrl(root, "customers:listAccessibleCustomers"), token: o.token, headers: headers() }, o);
      const ids = (list.resourceNames ?? []).map((n) => cleanCustomerId(n)).filter((i) => CUSTOMER_ID.test(i)).slice(0, MAX_ACCESSIBLE);
      const out = new Map<string, AdsCustomer>();
      let lastCredentialError: CredentialError | null = null;
      for (const id of ids) {
        try {
          const r = await search<{ customer?: CustomerRow }>(id, undefined, { query: "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager, customer.status FROM customer LIMIT 1" });
          const c = r.results?.[0]?.customer ? toCustomer(r.results[0].customer) : null;
          if (!c) continue;
          if (!c.manager) { out.set(c.id, c); continue; }
          // A manager cannot report metrics itself: offer its enabled client accounts, reached with the manager as login-customer-id.
          const kids = await search<{ customerClient?: CustomerRow }>(id, id, { query: "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.level = 1" });
          for (const k of (kids.results ?? []).slice(0, MAX_CLIENTS)) {
            if (!k.customerClient || k.customerClient.status !== "ENABLED") continue;
            const kc = toCustomer(k.customerClient, id);
            if (kc && !kc.manager && !out.has(kc.id)) out.set(kc.id, kc);
          }
        } catch (e) {
          if (e instanceof CredentialError) { lastCredentialError = e; continue; }   // one account the token cannot open must not hide the others
          if (e instanceof TransientError) throw e;
          continue;
        }
      }
      if (!out.size && lastCredentialError) throw lastCredentialError;
      return [...out.values()];
    },
    async campaignMetrics(i) {
      const id = cleanCustomerId(i.customerId);
      if (!CUSTOMER_ID.test(id)) throw new Error("ads: bad customer id");
      const r = await search<AdsPage["results"][number]>(id, i.loginCustomerId, { query: campaignQuery(i.since, i.until), ...(i.pageToken ? { pageToken: i.pageToken } : {}) });
      return { results: r.results ?? [], nextPageToken: r.nextPageToken || undefined };
    },
  };
}
