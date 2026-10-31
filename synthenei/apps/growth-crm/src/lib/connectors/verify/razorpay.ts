// Razorpay: X-Razorpay-Signature = hex HMAC-SHA256(webhook secret, raw body). Dedupe id: X-Razorpay-Event-Id.
import { hmac, safeEqual, type Verifier } from "./util";

export const verify: Verifier = (raw, headers, secret) => {
  const sig = headers.get("x-razorpay-signature");
  return !!sig && !!secret && safeEqual(sig.toLowerCase(), hmac(secret, raw, "hex"));
};
