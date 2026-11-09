// Real GA4 gateway: Analytics Admin API (accountSummaries) to list properties, Analytics Data API (runReport) for the daily report.
// Quota errors (429 RESOURCE_EXHAUSTED) back off inside googleJson; a removed property or grant is a CredentialError.
import { googleJson, joinUrl, type GoogleHttpDeps } from "../shared/api";
import type { Ga4Gateway, Ga4Property } from "./gateway";
import { reportRequest, type RunReportResponse } from "./report";

export interface Ga4ApiOptions extends GoogleHttpDeps { dataBase: string; adminBase: string; token: string }
const PROPERTY_ID = /^\d{1,20}$/;

interface AccountSummaries { accountSummaries?: { account?: string; displayName?: string; propertySummaries?: { property?: string; displayName?: string }[] }[]; nextPageToken?: string }

export function makeGa4Api(o: Ga4ApiOptions): Ga4Gateway {
  return {
    kind: "api",
    async listProperties() {
      const out: Ga4Property[] = [];
      let token: string | undefined;
      for (let page = 0; page < 20; page++) {
        const qs = new URLSearchParams({ pageSize: "200", ...(token ? { pageToken: token } : {}) });
        const r = await googleJson<AccountSummaries>({ method: "GET", url: `${joinUrl(o.adminBase, "accountSummaries")}?${qs}`, token: o.token }, o);
        for (const a of r.accountSummaries ?? []) for (const p of a.propertySummaries ?? []) {
          const id = (p.property ?? "").replace(/^properties\//, "");
          if (PROPERTY_ID.test(id)) out.push({ id, name: p.displayName ?? id, account: a.displayName });
        }
        token = r.nextPageToken;
        if (!token) break;
      }
      return out;
    },
    async runReport(i) {
      if (!PROPERTY_ID.test(i.propertyId)) throw new Error("ga4: bad property id");
      return googleJson<RunReportResponse>({ method: "POST", url: joinUrl(o.dataBase, `properties/${i.propertyId}:runReport`), token: o.token, body: reportRequest(i.since, i.until, i.offset, i.limit) }, o);
    },
  };
}
