// Slack: X-Slack-Signature = "v0=" + hex HMAC-SHA256(signing secret, "v0:" + X-Slack-Request-Timestamp + ":" + raw body); 5 minute window.
import { hmac, safeEqual, stripPrefix, withinWindow, type Verifier } from "./util";

export const SLACK_TOLERANCE_SEC = 300;
export const verify: Verifier = (raw, headers, secret, opts) => {
  const ts = headers.get("x-slack-request-timestamp");
  const sig = stripPrefix(headers.get("x-slack-signature"), "v0=");
  if (!ts || !sig || !secret || !/^\d{1,12}$/.test(ts) || !withinWindow(Number(ts), SLACK_TOLERANCE_SEC, opts?.now)) return false;
  return safeEqual(sig.toLowerCase(), hmac(secret, `v0:${ts}:${raw}`, "hex"));
};
