// HubSpot v3: X-HubSpot-Signature-v3 = base64 HMAC-SHA256(client secret, METHOD + URL + raw body + X-HubSpot-Request-Timestamp(ms)); 5 minute window.
import { HOOK_METHOD, HOOK_URL, hmac, safeEqual, withinWindow, type Verifier } from "./util";

export const verify: Verifier = (raw, headers, secret, opts) => {
  const sig = headers.get("x-hubspot-signature-v3"), ts = headers.get("x-hubspot-request-timestamp");
  const method = headers.get(HOOK_METHOD), url = headers.get(HOOK_URL);
  if (!sig || !ts || !secret || !method || !url || !/^\d{10,14}$/.test(ts) || !withinWindow(Number(ts), 300, opts?.now, "ms")) return false;
  return safeEqual(sig, hmac(secret, `${method.toUpperCase()}${url}${raw}${ts}`, "base64"));
};
