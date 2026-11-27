/** Why the billing page could not load, in terms a customer can act on. `unconfigured` is permanent until someone sets billing up; `database` and `unknown` may be transient. */
export type ErrorCause = "unconfigured" | "database" | "unknown";
export function classifyError(e: unknown): ErrorCause {
  const m = e instanceof Error ? e.message : String(e);
  if (e instanceof Error && e.name === "GrantsUnavailableError") return "database";
  if (/not configured|service credentials/i.test(m)) return "unconfigured";
  if (/permission denied|row-level security|JWT|does not exist|invalid input syntax|fetch failed|timeout|42501|PGRST|DbError/i.test(m)) return "database";
  return "unknown";
}
