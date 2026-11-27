// Loads Sentry only when a DSN is configured; otherwise a complete no-op.
export async function register(): Promise<void> {
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config");
  else if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}

/** Next calls this for every uncaught server error (render, route handler, action). Without it a production failure shows only an opaque digest. */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routePath?: string; routeType?: string },
): Promise<void> {
  const { formatRequestError } = await import("./lib/request-error");
  console.error(formatRequestError((err ?? {}) as { name?: string; message?: string; digest?: string }, request, context));
}
