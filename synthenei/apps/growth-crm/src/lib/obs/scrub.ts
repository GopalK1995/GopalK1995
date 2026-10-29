// PII scrubber for Sentry beforeSend and logs: strips emails and phone numbers from strings, recursively.
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])/g;

export function scrubString(s: string): string {
  return s.replace(EMAIL, "[email]").replace(PHONE, "[phone]");
}

export function scrub<T>(v: T, depth = 0): T {
  if (depth > 8) return v;
  if (typeof v === "string") return scrubString(v) as T;
  if (Array.isArray(v)) return v.map((x) => scrub(x, depth + 1)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = /^(email|phone|mobile|password|token|authorization|cookie)$/i.test(k) ? "[redacted]" : scrub(x, depth + 1);
    }
    return out as T;
  }
  return v;
}

/** Sentry beforeSend: scrub the event, drop user identity and request cookies/headers/body. */
export function sentryBeforeSend<E extends object>(event: E): E {
  const e = scrub(event) as Record<string, unknown>;
  delete e.user;
  const req = e.request as Record<string, unknown> | undefined;
  if (req) { delete req.cookies; delete req.headers; delete req.data; }
  return e as E;
}
