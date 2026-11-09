// Mailchimp Marketing API calls over the framework's VendorHttp (retries, backoff, 401 -> CredentialError). The API host depends on the
// account's data centre, which Mailchimp reports at the OAuth metadata endpoint; MAILCHIMP_API_BASE overrides it (tests, stubs).
import type { VendorHttp } from "../core/types";
import { CredentialError } from "../core/types";
import { DC_RE, DEFAULT_OAUTH_BASE } from "./constants";
import { subscriberHash, type McMemberPut } from "./mapping";

export interface McAudience { id: string; name: string; members: number }

/** The API base for a token. Throws CredentialError when the metadata call says the token is not valid. */
export async function resolveBase(http: VendorHttp, token: string, override: string): Promise<string> {
  if (override) return override.replace(/\/+$/, "");
  const m = await http.json<{ dc?: unknown }>({ method: "GET", url: `${DEFAULT_OAUTH_BASE}/oauth2/metadata`, headers: { authorization: `OAuth ${token}` } });
  if (typeof m.dc !== "string" || !DC_RE.test(m.dc)) throw new CredentialError("Mailchimp did not report a data centre for this token");
  return `https://${m.dc}.api.mailchimp.com`;
}

export function mailchimpApi(http: VendorHttp, base: string, token: string) {
  const call = <T,>(method: string, path: string, body?: unknown) => http.json<T>({ method, url: `${base}/3.0${path}`, headers: { authorization: `Bearer ${token}` }, body });
  return {
    async ping(): Promise<{ account?: string }> {
      const root = await call<{ account_name?: unknown }>("GET", "/?fields=account_name");
      return { account: typeof root.account_name === "string" ? root.account_name : undefined };
    },
    async audiences(): Promise<McAudience[]> {
      const r = await call<{ lists?: { id: string; name: string; stats?: { member_count?: number } }[] }>("GET", "/lists?count=100&fields=lists.id,lists.name,lists.stats.member_count");
      return (r.lists ?? []).map((l) => ({ id: l.id, name: l.name, members: l.stats?.member_count ?? 0 }));
    },
    putMember: (listId: string, m: McMemberPut) => call<{ id?: string }>("PUT", `/lists/${encodeURIComponent(listId)}/members/${subscriberHash(m.email_address)}`, m),
    members: (listId: string, status: "unsubscribed" | "cleaned", since: string | null, offset: number, count: number) =>
      call<unknown>("GET", `/lists/${encodeURIComponent(listId)}/members?status=${status}&count=${count}&offset=${offset}${since ? `&since_last_changed=${encodeURIComponent(since)}` : ""}&sort_field=last_changed&sort_dir=ASC&fields=total_items,members.email_address,members.last_changed`),
  };
}
