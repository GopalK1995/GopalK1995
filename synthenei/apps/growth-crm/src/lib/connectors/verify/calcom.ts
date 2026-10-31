// Cal.com: X-Cal-Signature-256 = hex HMAC-SHA256(secret, raw body). No timestamp is sent, so replay protection is the dedupe key.
import { hmac, safeEqual, type Verifier } from "./util";

export const verify: Verifier = (raw, headers, secret) => {
  const sig = headers.get("x-cal-signature-256");
  return !!sig && !!secret && safeEqual(sig.toLowerCase(), hmac(secret, raw, "hex"));
};
