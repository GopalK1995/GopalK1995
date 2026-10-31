// Calendly: Calendly-Webhook-Signature = "t=<unix seconds>,v1=<hex HMAC-SHA256(signing key, t + "." + raw body)>"; 3 minute window.
import { hmac, safeEqual, withinWindow, type Verifier } from "./util";

export const CALENDLY_TOLERANCE_SEC = 180;
export const verify: Verifier = (raw, headers, secret, opts) => {
  const h = headers.get("calendly-webhook-signature");
  if (!h || !secret) return false;
  const parts: Record<string, string> = {};
  for (const p of h.split(",")) { const i = p.indexOf("="); if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1 || !/^\d{1,12}$/.test(t) || !withinWindow(Number(t), CALENDLY_TOLERANCE_SEC, opts?.now)) return false;
  return safeEqual(v1.toLowerCase(), hmac(secret, `${t}.${raw}`, "hex"));
};
