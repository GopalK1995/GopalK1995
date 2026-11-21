// Classifies Microsoft Graph failures. Graph reports `error.code` in the body; a 403 can mean "consent withdrawn / admin consent needed"
// or "no Exchange Online mailbox", both of which need the owner (CredentialError -> needs_attention). Messages never carry vendor text.
import { CredentialError, TransientError } from "../core/types";

export type GraphFailure = "quota" | "auth" | "permission" | "mailbox" | "not_found" | "gone" | "bad_request" | "server" | "other";

export class GraphApiError extends Error {
  constructor(public httpStatus: number, public failure: GraphFailure, message: string) { super(message); this.name = "GraphApiError"; }
}
/** The delta link or sync state is no longer valid (HTTP 410): the stream restarts its delta from scratch. Not a credential problem. */
export class GraphResyncError extends Error { constructor() { super("Graph delta state expired"); this.name = "GraphResyncError"; } }

const codeOf = (body: unknown): string => {
  const e = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  const c = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
  return typeof c === "string" ? c.toLowerCase() : "";
};

export function classify(status: number, body: unknown): GraphFailure {
  const code = codeOf(body);
  if (code.includes("mailboxnotenabled") || code.includes("mailboxnotsupported") || code === "mailboxnotfound") return "mailbox";
  if (status === 429 || code === "applicationthrottled" || code === "toomanyrequests" || code === "activitylimitreached") return "quota";
  if (status === 401 || code === "invalidauthenticationtoken" || code === "unauthenticated") return "auth";
  if (status === 403 || code === "erroraccessdenied" || code === "authorization_requestdenied") return "permission";
  if (status === 410 || code === "syncstatenotfound" || code === "resyncrequired") return "gone";
  if (status === 404 || code === "erroritemnotfound") return "not_found";
  if (status >= 500) return "server";
  if (status === 400) return "bad_request";
  return "other";
}

export function errorFromResponse(status: number, body: unknown, retryAfterMs?: number): Error {
  const kind = classify(status, body);
  if (kind === "auth") return new CredentialError("Microsoft rejected the access token (expired or revoked). Reconnect to continue.");
  if (kind === "permission") return new CredentialError("Microsoft refused access. The account owner or a tenant admin has to grant the requested access; reconnect or send the admin-consent link.");
  if (kind === "mailbox") return new CredentialError("This Microsoft account has no Exchange Online mailbox the CRM can read.");
  if (kind === "gone") return new GraphResyncError();
  if (kind === "quota" || kind === "server") return new TransientError(kind === "quota" ? "Microsoft Graph throttled the request; retrying later" : `Microsoft Graph service error (HTTP ${status})`, retryAfterMs);
  return new GraphApiError(status, kind, `Microsoft Graph error (HTTP ${status})`);
}
