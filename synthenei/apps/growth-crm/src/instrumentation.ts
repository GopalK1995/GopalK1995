// Loads Sentry only when a DSN is configured; otherwise a complete no-op.
export async function register(): Promise<void> {
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config");
  else if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}
