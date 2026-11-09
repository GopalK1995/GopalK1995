// Svix webhooks (Resend): svix-id, svix-timestamp (seconds), svix-signature = space separated "v1,<base64 HMAC-SHA256(key, id.ts.body)>",
// key = base64 part after "whsec_". Identical to Standard Webhooks with svix-* header names, so it reuses that verifier.
import { verify as standard } from "./standard";
import type { Verifier } from "./util";

export const verify: Verifier = (raw, headers, secret, opts) => {
  const id = headers.get("svix-id"), ts = headers.get("svix-timestamp"), sig = headers.get("svix-signature");
  if (!id || !ts || !sig) return false;
  return standard(raw, new Headers({ "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": sig }), secret, opts);
};
