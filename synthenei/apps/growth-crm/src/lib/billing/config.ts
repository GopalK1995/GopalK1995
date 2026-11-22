// Platform billing configuration. Everything that is price-, GSTIN-, SAC-, brand- or mode-specific comes from the environment
// (names in docs/tasks/T053.md) or from the plans table: nothing is hard coded. Pure: takes the env object.
export const BILLING_ENV = {
  gstin: "BILLING_GSTIN", sac: "BILLING_SAC_CODE", gstRatePercent: "BILLING_GST_RATE_PERCENT", legalName: "BILLING_LEGAL_NAME",
  address: "BILLING_ADDRESS", graceDays: "BILLING_PAST_DUE_GRACE_DAYS",
  keyId: "RAZORPAY_KEY_ID", keySecret: "RAZORPAY_KEY_SECRET", webhookSecret: "RAZORPAY_WEBHOOK_SECRET", apiBase: "RAZORPAY_API_BASE", live: "BILLING_RAZORPAY_LIVE",
} as const;
type Env = Record<string, string | undefined>;
const v = (env: Env, k: string) => { const x = env[k]?.trim(); return x ? x : undefined; };

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const SAC_RE = /^[0-9]{4,8}$/;

export interface IssuerConfig { gstin: string; sac: string; gstRatePercent: number; legalName: string; address: string[] }
/** Invoices are refused until the issuer config is complete; `missing` names the env vars. */
export function issuerConfig(env: Env): { ok: true; cfg: IssuerConfig } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const gstin = v(env, BILLING_ENV.gstin), sac = v(env, BILLING_ENV.sac), rate = v(env, BILLING_ENV.gstRatePercent), name = v(env, BILLING_ENV.legalName);
  if (!gstin || !GSTIN_RE.test(gstin)) missing.push(BILLING_ENV.gstin);
  if (!sac || !SAC_RE.test(sac)) missing.push(BILLING_ENV.sac);
  const r = rate == null ? NaN : Number(rate);
  if (!(r >= 0 && r <= 100)) missing.push(BILLING_ENV.gstRatePercent);
  if (!name) missing.push(BILLING_ENV.legalName);
  if (missing.length) return { ok: false, missing };
  return { ok: true, cfg: { gstin: gstin!, sac: sac!, gstRatePercent: r, legalName: name!, address: (v(env, BILLING_ENV.address) ?? "").split("|").map((s) => s.trim()).filter(Boolean) } };
}

/** Days after current_period_end before a past_due tenant turns read-only. Unset = never enforced (warning only). */
export function graceDays(env: Env): number | null {
  const x = v(env, BILLING_ENV.graceDays);
  if (x == null) return null;
  const n = Number(x);
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : null;
}

export interface RazorpayConfig { keyId: string; keySecret: string; webhookSecret?: string; apiBase: string; mode: "test" | "live" }
export type RazorpayRefusal = "not_configured" | "live_refused" | "bad_key" | "mode_mismatch";
/** Test keys only, unless BILLING_RAZORPAY_LIVE=1 says live. A live key without the flag, a test key with the flag, or a malformed key id is refused. */
export function razorpayConfig(env: Env): { ok: true; cfg: RazorpayConfig } | { ok: false; reason: RazorpayRefusal } {
  const keyId = v(env, BILLING_ENV.keyId), keySecret = v(env, BILLING_ENV.keySecret);
  if (!keyId || !keySecret) return { ok: false, reason: "not_configured" };
  const m = /^rzp_(test|live)_[A-Za-z0-9]+$/.exec(keyId);
  if (!m) return { ok: false, reason: "bad_key" };
  const wantLive = v(env, BILLING_ENV.live) === "1";
  if (m[1] === "live" && !wantLive) return { ok: false, reason: "live_refused" };
  if (m[1] === "test" && wantLive) return { ok: false, reason: "mode_mismatch" };
  return { ok: true, cfg: { keyId, keySecret, webhookSecret: v(env, BILLING_ENV.webhookSecret), apiBase: (v(env, BILLING_ENV.apiBase) ?? "https://api.razorpay.com").replace(/\/+$/, ""), mode: m[1] as "test" | "live" } };
}
