// Security headers, shared by next.config.mjs (plain ESM so Node can import it without a build step).
// CSP ships in REPORT-ONLY mode until the integrator has verified it in a browser (CSP_ENFORCE=1 flips it).
// Nonces need per-request generation in middleware (not owned by T009); buildCsp(nonce) supports both forms.

function origin(url) {
  try { return new URL(url).origin; } catch { return null; }
}

/** @param {{ nonce?: string, env?: Record<string, string | undefined> }} [opts] */
export function buildCsp({ nonce, env = {} } = {}) {
  const supa = origin(env.NEXT_PUBLIC_SUPABASE_URL || "");
  const supaWs = supa ? supa.replace(/^http/, "ws") : null;
  const sentry = origin(env.SENTRY_DSN || env.NEXT_PUBLIC_SENTRY_DSN || "");
  const dev = env.NODE_ENV !== "production";
  const script = ["'self'", nonce ? `'nonce-${nonce}' 'strict-dynamic'` : "'unsafe-inline'", dev ? "'unsafe-eval'" : ""].filter(Boolean);
  const connect = ["'self'", supa, supaWs, sentry, dev ? "ws:" : ""].filter(Boolean);
  const d = {
    "default-src": ["'self'"],
    "script-src": script,
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", supa].filter(Boolean),
    "font-src": ["'self'", "data:"],
    "connect-src": connect,
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };
  return Object.entries(d).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

export function buildSecurityHeaders(env = {}) {
  const cspKey = env.CSP_ENFORCE === "1" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
  return [
    { key: cspKey, value: buildCsp({ env }) },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
}
