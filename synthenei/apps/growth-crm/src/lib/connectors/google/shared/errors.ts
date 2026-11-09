// Classifies Google API failures. Google reports the reason in the JSON body (`error.status`, `error.errors[].reason`,
// `error.details[].errors[]` for Ads), so a 403 can mean "quota, wait" or "no access, reconnect": they are told apart here.
// Messages never carry the vendor text (it can quote ids or query text).
import { CredentialError, TransientError } from "../../core/types";

export type GoogleFailure = "quota" | "auth" | "permission" | "developer_token" | "not_found" | "bad_request" | "server" | "other";

export class GoogleApiError extends Error {
  constructor(public httpStatus: number, public failure: GoogleFailure, message: string) { super(message); this.name = "GoogleApiError"; }
}

const QUOTA_REASONS = new Set(["ratelimitexceeded", "userratelimitexceeded", "quotaexceeded", "dailylimitexceeded", "resource_exhausted"]);

/** Lower-cased reason strings found anywhere in the standard Google error body shapes (REST, Admin/Data API, Ads). */
function reasons(body: unknown): string[] {
  const out: string[] = [];
  const e = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (!e || typeof e !== "object") return out;
  const o = e as { status?: unknown; errors?: unknown; details?: unknown };
  if (typeof o.status === "string") out.push(o.status.toLowerCase());
  if (Array.isArray(o.errors)) for (const x of o.errors) if (x && typeof (x as { reason?: unknown }).reason === "string") out.push((x as { reason: string }).reason.toLowerCase());
  if (Array.isArray(o.details)) for (const d of o.details) {
    if (d && typeof (d as { reason?: unknown }).reason === "string") out.push((d as { reason: string }).reason.toLowerCase());
    const errs = d && typeof d === "object" ? (d as { errors?: unknown }).errors : undefined;
    if (Array.isArray(errs)) for (const x of errs) {
      const code = x && typeof x === "object" ? (x as { errorCode?: Record<string, unknown> }).errorCode : undefined;
      if (code) for (const [k, v] of Object.entries(code)) out.push(`${k}:${String(v)}`.toLowerCase());
    }
  }
  return out;
}

export function classify(status: number, body: unknown): GoogleFailure {
  const f = reasons(body);
  if (f.some((x) => x.includes("developer_token"))) return "developer_token";
  if (status === 429 || f.some((x) => QUOTA_REASONS.has(x) || x.includes("quota_error") || x.includes("rate_exceeded") || x.includes("resource_exhausted"))) return "quota";
  if (status === 401 || f.includes("unauthenticated")) return "auth";
  if (status === 403 || f.includes("permission_denied")) return "permission";
  if (status === 404) return "not_found";
  if (status >= 500) return "server";
  if (status === 400) return "bad_request";
  return "other";
}

/**
 * Throwable for a failed Google response. A rejected token, a removed grant, a missing permission or an unapproved developer token needs
 * the owner (CredentialError -> needs_attention, never silent). Quota and server errors are transient: callers back off and retry.
 */
export function errorFromResponse(status: number, body: unknown, retryAfterMs?: number): Error {
  const kind = classify(status, body);
  if (kind === "auth") return new CredentialError("Google rejected the access token (expired or revoked). Reconnect to continue.");
  if (kind === "permission") return new CredentialError("Google refused access to this account. Reconnect and grant the requested access.");
  if (kind === "developer_token") return new CredentialError("The Google Ads developer token is not approved for this account yet (needs basic access).");
  if (kind === "quota" || kind === "server") return new TransientError(kind === "quota" ? "Google quota reached; retrying later" : `Google service error (HTTP ${status})`, retryAfterMs);
  return new GoogleApiError(status, kind, `Google API error (HTTP ${status})`);
}
