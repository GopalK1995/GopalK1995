/** Server log line for a failed request, so the digest a user quotes (Error id ...) maps to a real error class and message.
 * Next replaces the message sent to the browser in production; the server still has it. Message is truncated, never the stack. */
export function formatRequestError(
  err: { name?: string; message?: string; digest?: string },
  req: { path?: string; method?: string },
  ctx: { routePath?: string; routeType?: string },
): string {
  const msg = String(err.message ?? "").replace(/\s+/g, " ").slice(0, 300);
  return `[request-error] digest=${err.digest ?? "none"} class=${err.name ?? "Error"} route=${ctx.routePath ?? req.path ?? "?"} type=${ctx.routeType ?? "?"} method=${req.method ?? "?"} message=${JSON.stringify(msg)}`;
}
