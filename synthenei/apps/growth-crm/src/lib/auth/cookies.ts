import { demoModeOn as envDemoModeOn } from "@/lib/env";
// One cookie-options helper for middleware (edge) and server actions.
export const cookieOpts = (maxAgeSecs: number) => ({
  httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: maxAgeSecs,
  secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
});
export const WS_MAX_AGE = 60 * 60 * 24 * 90;
/** Same-origin relative path only. Rejects protocol-relative, backslash and control-char tricks. */
export function safeNext(n: unknown): string | null {
  const s = String(n ?? "");
  if (!s.startsWith("/") || s.startsWith("//") || /[\\\u0000-\u001f]/.test(s)) return null;
  try { const u = new URL(s, "http://x.invalid"); return u.origin === "http://x.invalid" ? u.pathname + u.search : null; } catch { return null; }
}
/** Demo personas are a security switch: server-only env, never NEXT_PUBLIC. */
export const demoModeOn = envDemoModeOn;
