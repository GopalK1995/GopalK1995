// Thrown when a real session's permission lookup cannot be completed. Callers must treat it as a deny (HTTP 503), never as a grant.
export type GrantsUnavailableCause = "no_client" | "rpc_error" | "empty_result";
export class GrantsUnavailableError extends Error {
  readonly status = 503;
  constructor(public cause: GrantsUnavailableCause) { super(`Permissions unavailable (${cause})`); this.name = "GrantsUnavailableError"; }
}
