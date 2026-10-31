// Zoho CRM notifications: base64 HMAC-SHA256(secret, raw body) in X-ZOHO-SIGNATURE, or the shared-token form (header x-zoho-token
// equal to the secret). Zoho publishes no test vectors: confirm against a real delivery (docs/tasks/T023.md, known gaps).
import { hmac, safeEqual, type Verifier } from "./util";

export const verify: Verifier = (raw, headers, secret) => {
  if (!secret) return false;
  const sig = headers.get("x-zoho-signature");
  if (sig) return safeEqual(sig, hmac(secret, raw, "base64"));
  const tok = headers.get("x-zoho-token");
  return !!tok && safeEqual(tok, secret);
};
