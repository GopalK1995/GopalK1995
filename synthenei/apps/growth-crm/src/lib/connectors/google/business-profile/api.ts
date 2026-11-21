// Real Business Profile gateway over four Google APIs: Account Management (accounts), Business Information (locations),
// Performance (daily metrics) and the v4 reviews API (list + reply). Quota answers back off inside googleJson; a missing grant or an
// API that Google has not enabled for the project (the vendor-approval gate) is a CredentialError, never a silent empty list.
import { googleJson, joinUrl, type GoogleHttpDeps } from "../shared/api";
import { ALL_METRICS, cleanResourceId, MAX_NAME_LEN, MAX_REPLY_LEN, RESOURCE_ID, REVIEW_PAGE_SIZE } from "./constants";
import type { GbpGateway, GbpLocation } from "./gateway";
import { rangeParams, type RawReview, type RawSeries } from "./mappers";

export interface GbpApiOptions extends GoogleHttpDeps { token: string; accountsBase: string; infoBase: string; performanceBase: string; reviewsBase: string }
const MAX_ACCOUNTS = 50, MAX_LOCATION_PAGES = 20;

const qs = (pairs: [string, string][]): string => { const u = new URLSearchParams(); for (const [k, v] of pairs) u.append(k, v); return `?${u.toString()}`; };
const need = (id: string, what: string): string => { const c = cleanResourceId(id); if (!RESOURCE_ID.test(c)) throw new Error(`gbp: bad ${what} id`); return c; };

export function makeGbpApi(o: GbpApiOptions): GbpGateway {
  const get = <T>(url: string) => googleJson<T>({ method: "GET", url, token: o.token }, o);
  return {
    kind: "api",
    async listLocations() {
      const accounts = await get<{ accounts?: { name?: string }[] }>(joinUrl(o.accountsBase, "accounts") + qs([["pageSize", "20"]]));
      const out: GbpLocation[] = [];
      for (const a of (accounts.accounts ?? []).slice(0, MAX_ACCOUNTS)) {
        const account = cleanResourceId(a.name ?? "");
        if (!RESOURCE_ID.test(account)) continue;
        let pageToken: string | undefined;
        for (let p = 0; p < MAX_LOCATION_PAGES; p++) {
          const r = await get<{ locations?: { name?: string; title?: string; storefrontAddress?: { locality?: string; addressLines?: string[] } }[]; nextPageToken?: string }>(
            joinUrl(o.infoBase, `accounts/${account}/locations`) + qs([["readMask", "name,title,storefrontAddress"], ["pageSize", "100"], ...(pageToken ? [["pageToken", pageToken] as [string, string]] : [])]));
          for (const l of r.locations ?? []) {
            const location = cleanResourceId(l.name ?? "");
            if (!RESOURCE_ID.test(location)) continue;
            const addr = [l.storefrontAddress?.addressLines?.[0], l.storefrontAddress?.locality].filter(Boolean).join(", ");
            out.push({ account, location, title: (l.title ?? "").slice(0, MAX_NAME_LEN) || location, ...(addr ? { address: addr.slice(0, MAX_NAME_LEN) } : {}) });
          }
          pageToken = r.nextPageToken || undefined;
          if (!pageToken) break;
        }
      }
      return out;
    },
    async listReviews(i) {
      const a = need(i.account, "account"), l = need(i.location, "location");
      const r = await get<{ reviews?: RawReview[]; nextPageToken?: string }>(
        joinUrl(o.reviewsBase, `accounts/${a}/locations/${l}/reviews`) + qs([["pageSize", String(REVIEW_PAGE_SIZE)], ["orderBy", "updateTime desc"], ...(i.pageToken ? [["pageToken", i.pageToken] as [string, string]] : [])]));
      return { reviews: r.reviews ?? [], nextPageToken: r.nextPageToken || undefined };
    },
    async dailyMetrics(i) {
      const l = need(i.location, "location");
      const r = await get<{ multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: RawSeries[] }[] }>(
        joinUrl(o.performanceBase, `locations/${l}:fetchMultiDailyMetricsTimeSeries`) + qs([...ALL_METRICS.map((m) => ["dailyMetrics", m] as [string, string]), ...rangeParams(i.since, i.until)]));
      return (r.multiDailyMetricTimeSeries ?? []).flatMap((m) => m.dailyMetricTimeSeries ?? []);
    },
    async replyToReview(i) {
      const a = need(i.account, "account"), l = need(i.location, "location");
      const id = i.reviewId.trim();
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error("gbp: bad review id");
      const comment = i.comment.trim();
      if (!comment || comment.length > MAX_REPLY_LEN) throw new Error("gbp: bad reply text");
      await googleJson<unknown>({ method: "PUT", url: joinUrl(o.reviewsBase, `accounts/${a}/locations/${l}/reviews/${id}/reply`), token: o.token, body: { comment } }, o);
    },
  };
}
