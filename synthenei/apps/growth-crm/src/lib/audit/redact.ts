// Redaction for audit detail and text. Secrets (passwords, tokens, keys, cookies) never reach the log; personal fields are
// replaced with the same placeholder the DB trigger uses. Pure, no imports, safe on client and server.
export const REDACTED = "[redacted]";
export const PII_MARK = "[pii]";

/** Keys matched after lower-casing and removing separators (api_key, apiKey and API-KEY are the same). */
const SECRET_PARTS = ["password", "passwd", "passphrase", "secret", "token", "apikey", "authorization", "cookie", "credential", "privatekey", "accesskey", "signingkey", "bearer", "signature", "jwt", "sessionid", "vault", "cardnumber"];
const SECRET_EXACT = new Set(["otp", "pin", "pwd", "cvv", "cvc", "pan", "aadhaar", "auth", "key", "authkey", "sid"]);
export const PII_KEYS = new Set(["fullname", "name", "email", "phone", "mobile", "body", "note", "notes", "addressline", "address", "firmname", "displayname", "ip", "useragent"]);

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
export const isSecretKey = (k: string): boolean => { const n = norm(k); return SECRET_EXACT.has(n) || SECRET_PARTS.some((p) => n.includes(p)); };
export const isPiiKey = (k: string): boolean => PII_KEYS.has(norm(k));

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /\+?\d[\d\s-]{8,}\d/g;
const JWT_RE = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/g;
const BEARER_RE = /\b(?:Bearer|Basic)\s+[\w.~+/=-]{8,}/gi;
const PREFIXED_KEY_RE = /\b(?:sk|pk|rk|ghp|gho|ghs|xox[abp]|AKIA|AIza|sb_secret|sb_publishable)[-_]?[A-Za-z0-9_-]{12,}/g;
const KV_SECRET_RE = /\b(password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/gi;

/** Scrubs secrets inside free text. Personal data is separate (maskPiiText) because some viewers may see it. */
export function scrubSecretsText(s: string): string {
  return s.replace(JWT_RE, REDACTED).replace(BEARER_RE, REDACTED).replace(PREFIXED_KEY_RE, REDACTED).replace(KV_SECRET_RE, (_m, k: string) => `${k}=${REDACTED}`);
}
/** Masks emails and phone numbers inside free text. */
export function maskPiiText(s: string): string {
  return s.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]");
}

const MAX_DEPTH = 6, MAX_STR = 500, MAX_ITEMS = 50, MAX_KEYS = 60;

/** Deep copy that removes secrets and masks personal fields. Used on everything written by audit(). */
export function redactDetail(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") { const s = maskPiiText(scrubSecretsText(v)); return s.length > MAX_STR ? `${s.slice(0, MAX_STR)}...` : s; }
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(v)) return v.slice(0, MAX_ITEMS).map((x) => redactDetail(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, MAX_KEYS)) {
      out[k] = isSecretKey(k) ? REDACTED : isPiiKey(k) ? PII_MARK : redactDetail(val, depth + 1);
    }
    return out;
  }
  return String(v);
}

/** One line of text that is safe to store: secrets scrubbed, personal data masked, capped. */
export function redactLine(s: string, max: number): string {
  const t = maskPiiText(scrubSecretsText(s)).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) : t;
}
