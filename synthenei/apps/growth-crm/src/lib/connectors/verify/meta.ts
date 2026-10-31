// Meta (WhatsApp Cloud, Marketing API): X-Hub-Signature-256 = "sha256=" + hex HMAC-SHA256(app secret, raw body).
import { hmac, safeEqual, stripPrefix, type Verifier } from "./util";

export const verify: Verifier = (raw, headers, secret) => {
  const sig = stripPrefix(headers.get("x-hub-signature-256"), "sha256=");
  return !!sig && !!secret && safeEqual(sig.toLowerCase(), hmac(secret, raw, "hex"));
};
