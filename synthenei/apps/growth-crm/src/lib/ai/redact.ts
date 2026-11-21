// PII redaction applied to every prompt inside the gateway, before any provider is called. Pure, no imports beyond the secret scrubber.
// Core level is ALWAYS on (identifiers that can reach a person or an account); extended level follows ai_policies.pii_redaction.
import { scrubSecretsText } from "@/lib/audit/redact";

export interface Redacted { text: string; count: number }
export interface RedactOpts { extended: boolean }

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const AADHAAR = /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const PHONE = /\+?\d[\d\s().-]{8,}\d/g;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const URL_QUERY = /(https?:\/\/[^\s?#]+)[?#][^\s]*/g;
const PIN = /\b[1-9]\d{5}\b/g;
const DOB = /\b(?:dob|date of birth|born on)\b[:\s-]*[\w\s,/-]{4,20}/gi;

const luhn = (digits: string) => { let s = 0, alt = false; for (let i = digits.length - 1; i >= 0; i--) { let n = digits.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; };

export function redactPrompt(input: string, opts: RedactOpts): Redacted {
  let count = 0;
  const sub = (re: RegExp, repl: string | ((m: string, ...g: string[]) => string)) => { input = input.replace(re, (...a: unknown[]) => { const m = a[0] as string; const out = typeof repl === "string" ? repl : repl(m, ...(a.slice(1) as string[])); if (out !== m) count++; return out; }); };
  sub(URL_QUERY, (_m, base) => base);                         // tracking/session parameters, magic links
  const before = input; input = scrubSecretsText(input); if (input !== before) count++;
  sub(EMAIL, "[email]");
  sub(CARD, (m) => { const d = m.replace(/\D/g, ""); return d.length >= 13 && d.length <= 19 && luhn(d) ? "[card]" : m; });
  sub(AADHAAR, "[id-number]");
  sub(PAN, "[id-number]");
  sub(PHONE, (m) => { const d = m.replace(/\D/g, ""); return d.length >= 10 && d.length <= 15 && !/^\d{4}-\d{2}-\d{2}/.test(m) ? "[phone]" : m; });
  sub(IPV4, (m) => (m.split(".").every((x) => Number(x) <= 255) ? "[ip]" : m));
  if (opts.extended) { sub(PIN, "[pin]"); sub(DOB, "[dob]"); }
  return { text: input, count };
}

/** Redacts a whole conversation payload and sums the replacements. */
export function redactAll(parts: string[], opts: RedactOpts): { parts: string[]; count: number } {
  let count = 0;
  const out = parts.map((p) => { const r = redactPrompt(p, opts); count += r.count; return r.text; });
  return { parts: out, count };
}
