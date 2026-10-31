// Standard Webhooks (Zapier / Make style senders and our own outbound signer): webhook-id, webhook-timestamp (seconds),
// webhook-signature = space separated "v1,<base64 HMAC-SHA256(key, id.timestamp.body)>". Key = base64 part after "whsec_".
import { hmac, safeEqual, withinWindow, type Verifier } from "./util";

export const STANDARD_TOLERANCE_SEC = 300;
export const verify: Verifier = (raw, headers, secret, opts) => {
  const id = headers.get("webhook-id"), ts = headers.get("webhook-timestamp"), sigs = headers.get("webhook-signature");
  if (!id || !ts || !sigs || !secret || !/^\d{1,12}$/.test(ts) || !withinWindow(Number(ts), STANDARD_TOLERANCE_SEC, opts?.now)) return false;
  const key = secret.startsWith("whsec_") ? Buffer.from(secret.slice(6), "base64") : Buffer.from(secret, "utf8");
  const expected = hmac(key, `${id}.${ts}.${raw}`, "base64");
  let ok = false;
  for (const part of sigs.split(" ")) {
    const [ver, sig] = part.split(",");
    if (ver === "v1" && sig && safeEqual(sig, expected)) ok = true;   // every candidate is compared, no early exit
  }
  return ok;
};
