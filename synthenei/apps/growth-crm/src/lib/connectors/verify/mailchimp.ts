// Mailchimp does not sign webhooks: the shared secret travels as the `k` query value of the webhook URL. The route copies it into
// the x-hook-key pseudo header (always overwriting a client-sent one); compare in constant time.
import { HOOK_KEY, safeEqual, type Verifier } from "./util";

export const verify: Verifier = (_raw, headers, secret) => {
  const k = headers.get(HOOK_KEY);
  return !!k && !!secret && safeEqual(k, secret);
};
