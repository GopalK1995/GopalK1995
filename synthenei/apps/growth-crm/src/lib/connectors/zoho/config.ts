// Region resolution for a Zoho connection. A connection's data centre lives in its credential bundle (`region`); the deployment
// default applies when it has none. The env overrides exist for stubs (Cypress, local) and win over any region.
import type { ConnectionSecrets } from "../core/types";
import { CRED, DEFAULT_REGION, REGIONS, ZOHO_ENV, isRegion, type ZohoRegion } from "./constants";

type Env = Record<string, string | undefined>;
const trimUrl = (s: string) => s.trim().replace(/\/+$/, "");

export function regionOf(secrets: ConnectionSecrets, env: Env): ZohoRegion {
  const own = secrets[CRED.region], dflt = (env[ZOHO_ENV.defaultRegion] ?? "").trim().toLowerCase();
  return isRegion(own) ? own : isRegion(dflt) ? dflt : DEFAULT_REGION;
}
export function apiBaseOf(secrets: ConnectionSecrets, env: Env): string {
  const o = (env[ZOHO_ENV.apiBase] ?? "").trim();
  return o ? trimUrl(o) : REGIONS[regionOf(secrets, env)].api;
}
export function accountsUrlOf(secrets: ConnectionSecrets, env: Env): string {
  const o = (env[ZOHO_ENV.accountsUrl] ?? "").trim();
  return o ? trimUrl(o) : REGIONS[regionOf(secrets, env)].accounts;
}
