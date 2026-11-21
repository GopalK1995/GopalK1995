// Cal.com v2 REST calls: key check, webhook subscribe / unsubscribe. Auth is the tenant's API key (Bearer). No paid plan is needed.
import { CredentialError, type ConnectionSecrets } from "../core/types";
import { guarded, obj, stateOf, strOf, vendorFetch, type SubscriptionState, type VendorFetch } from "../calendly/subscribe";
import { CALCOM_API_VERSION, CALCOM_CRED, CALCOM_DEFAULT_BASE, CALCOM_ENV, CALCOM_TRIGGERS } from "./constants";

type Env = Record<string, string | undefined>;
export const calcomBase = (env: Env): string => (env[CALCOM_ENV.apiBase] ?? "").trim().replace(/\/+$/, "") || CALCOM_DEFAULT_BASE;
const auth = (s: ConnectionSecrets): Record<string, string> => ({ authorization: `Bearer ${s[CALCOM_CRED.apiKey] ?? ""}`, "cal-api-version": CALCOM_API_VERSION });

export async function whoAmI(call: VendorFetch, base: string, secrets: ConnectionSecrets): Promise<{ id: string; label: string }> {
  if (!secrets[CALCOM_CRED.apiKey]) throw new CredentialError("Cal.com key is missing");
  const r = await call("GET", `${base}/v2/me`, auth(secrets));
  if (r.status === 401 || r.status === 403) throw new CredentialError("Cal.com rejected the key");
  const d = obj(obj(r.body)?.data);
  if (r.status !== 200 || !d) throw new Error(`Cal.com request failed (HTTP ${r.status})`);
  return { id: String(d.id ?? ""), label: strOf(d.email) ?? strOf(d.username) ?? "Cal.com" };
}

export interface CalcomSubscribeInput { fetchImpl?: typeof fetch; call?: VendorFetch; apiBase: string; secrets: ConnectionSecrets; webhookUrl: string }

export function subscribeCalcom(i: CalcomSubscribeInput): Promise<SubscriptionState> {
  return guarded(async () => {
    const call = i.call ?? vendorFetch(i.fetchImpl);
    const secret = i.secrets[CALCOM_CRED.webhookSecret];
    if (!secret) return stateOf("needs_attention");
    await whoAmI(call, i.apiBase, i.secrets);
    // Cal.com happily keeps duplicates: drop our earlier subscription to this URL first so deliveries are not doubled and the secret is OURS.
    const list = await call("GET", `${i.apiBase}/v2/webhooks`, auth(i.secrets));
    const items = Array.isArray(obj(list.body)?.data) ? (obj(list.body)!.data as unknown[]) : [];
    for (const it of items) { const o = obj(it); if (o && o.subscriberUrl === i.webhookUrl && o.id !== undefined) await call("DELETE", `${i.apiBase}/v2/webhooks/${encodeURIComponent(String(o.id))}`, auth(i.secrets)); }
    const r = await call("POST", `${i.apiBase}/v2/webhooks`, auth(i.secrets), { subscriberUrl: i.webhookUrl, triggers: [...CALCOM_TRIGGERS], active: true, secret });
    if (r.status === 401 || r.status === 403) return stateOf("needs_attention");
    if (r.status !== 200 && r.status !== 201) return stateOf("error");
    const id = obj(obj(r.body)?.data)?.id;
    return stateOf("subscribed", { id: id === undefined ? undefined : String(id) });
  });
}

export async function unsubscribeCalcom(i: Pick<CalcomSubscribeInput, "fetchImpl" | "call" | "apiBase" | "secrets"> & { id: string }): Promise<boolean> {
  try {
    const call = i.call ?? vendorFetch(i.fetchImpl);
    const r = await call("DELETE", `${i.apiBase}/v2/webhooks/${encodeURIComponent(i.id)}`, auth(i.secrets));
    return r.status === 204 || r.status === 200 || r.status === 404;
  } catch { return false; }
}
