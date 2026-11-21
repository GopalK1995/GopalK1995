// Calendly REST calls: token check, webhook subscribe / unsubscribe. Auth is the tenant's personal access token (Bearer).
// Webhook subscriptions need a paid Calendly plan: on a free plan the create call is refused with a 403 whose text asks to upgrade, which we
// surface as the `needs_paid_plan` state instead of a generic credential error.
import { CredentialError, type ConnectionSecrets } from "../core/types";
import { CALENDLY_CRED, CALENDLY_DEFAULT_BASE, CALENDLY_ENV, CALENDLY_EVENTS } from "./constants";
import { guarded, obj, stateOf, strOf, vendorFetch, type SubscriptionState, type VendorFetch } from "./subscribe";

type Env = Record<string, string | undefined>;
export const calendlyBase = (env: Env): string => (env[CALENDLY_ENV.apiBase] ?? "").trim().replace(/\/+$/, "") || CALENDLY_DEFAULT_BASE;
const auth = (secrets: ConnectionSecrets): Record<string, string> => ({ authorization: `Bearer ${secrets[CALENDLY_CRED.token] ?? ""}` });
const UPGRADE = /upgrad|paid plan|standard|premium|subscription/i;
const msgOf = (body: unknown): string => `${strOf(obj(body)?.title) ?? ""} ${strOf(obj(body)?.message) ?? ""}`;
const lastSegment = (uri: string | undefined): string | undefined => uri?.split("/").filter(Boolean).pop();

export interface CalendlyMe { uri: string; organization: string; name: string; email: string }
/** One authenticated read. 401/403 = the token is refused. */
export async function whoAmI(call: VendorFetch, base: string, secrets: ConnectionSecrets): Promise<CalendlyMe> {
  if (!secrets[CALENDLY_CRED.token]) throw new CredentialError("Calendly token is missing");
  const r = await call("GET", `${base}/users/me`, auth(secrets));
  if (r.status === 401 || r.status === 403) throw new CredentialError("Calendly rejected the token");
  const res = obj(obj(r.body)?.resource);
  const uri = strOf(res?.uri), org = strOf(res?.current_organization);
  if (r.status !== 200 || !uri || !org) throw new Error(`Calendly request failed (HTTP ${r.status})`);
  return { uri, organization: org, name: strOf(res?.name) ?? "", email: strOf(res?.email) ?? "" };
}

export interface SubscribeInput { fetchImpl?: typeof fetch; call?: VendorFetch; apiBase: string; secrets: ConnectionSecrets; webhookUrl: string }

export function subscribeCalendly(i: SubscribeInput): Promise<SubscriptionState> {
  return guarded(async () => {
    const call = i.call ?? vendorFetch(i.fetchImpl);
    const key = i.secrets[CALENDLY_CRED.signingKey];
    if (!key) return stateOf("needs_attention");
    const me = await whoAmI(call, i.apiBase, i.secrets);
    for (const scope of ["organization", "user"] as const) {
      const body = { url: i.webhookUrl, events: [...CALENDLY_EVENTS], organization: me.organization, ...(scope === "user" ? { user: me.uri } : {}), scope, signing_key: key };
      let r = await call("POST", `${i.apiBase}/webhook_subscriptions`, auth(i.secrets), body);
      if (r.status === 409) {   // already subscribed to this URL (an earlier attempt): drop it and re-create so the signing key is OURS
        await removeExisting(call, i.apiBase, i.secrets, i.webhookUrl, me, scope);
        r = await call("POST", `${i.apiBase}/webhook_subscriptions`, auth(i.secrets), body);
      }
      if (r.status === 201 || r.status === 200) return stateOf(scope === "user" ? "user_scope" : "subscribed", { id: lastSegment(strOf(obj(obj(r.body)?.resource)?.uri)) });
      if (r.status === 401) return stateOf("needs_attention");
      if (r.status === 403) {
        if (UPGRADE.test(msgOf(r.body))) return stateOf("needs_paid_plan");
        if (scope === "organization") continue;   // not an organisation admin: try a user-scoped subscription
        return stateOf("needs_attention");
      }
      return stateOf("error");
    }
    return stateOf("error");
  });
}

async function removeExisting(call: VendorFetch, base: string, secrets: ConnectionSecrets, url: string, me: CalendlyMe, scope: "organization" | "user"): Promise<void> {
  const qs = new URLSearchParams({ organization: me.organization, scope, ...(scope === "user" ? { user: me.uri } : {}) });
  const list = await call("GET", `${base}/webhook_subscriptions?${qs}`, auth(secrets));
  const items = Array.isArray(obj(list.body)?.collection) ? (obj(list.body)!.collection as unknown[]) : [];
  for (const it of items) {
    const o = obj(it);
    if (o && o.callback_url === url) { const id = lastSegment(strOf(o.uri)); if (id) await call("DELETE", `${base}/webhook_subscriptions/${encodeURIComponent(id)}`, auth(secrets)); }
  }
}

/** Best-effort removal on disconnect. Returns false when Calendly refused or was unreachable (the owner can delete it in Calendly). */
export async function unsubscribeCalendly(i: Pick<SubscribeInput, "fetchImpl" | "call" | "apiBase" | "secrets"> & { id: string }): Promise<boolean> {
  try {
    const call = i.call ?? vendorFetch(i.fetchImpl);
    const r = await call("DELETE", `${i.apiBase}/webhook_subscriptions/${encodeURIComponent(i.id)}`, auth(i.secrets));
    return r.status === 204 || r.status === 200 || r.status === 404;
  } catch { return false; }
}
