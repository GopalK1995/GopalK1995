// Server-side audit of authentication events (AUD-056, SEC-016): sign-in success and failure, MFA failure. Written through
// audit_record_server() with the service client, so a browser can neither forge nor suppress these rows. Best effort: a missing
// function (migration 0025 not applied yet), a missing service key or any other error is logged and never blocks sign-in.
// The e-mail address is never stored: only a short sha256 prefix, enough to correlate attempts against one account.
import { createHash } from "node:crypto";

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };
export type AuthEvent = "auth.login.success" | "auth.login.failure" | "auth.mfa.failure" | "auth.mfa.success";
export interface AuthEventInput { action: AuthEvent; uid?: string | null; email?: string | null; ip?: string | null; userAgent?: string | null; via?: string }

export const emailTag = (email: string): string => createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 16);

const SUMMARY: Record<AuthEvent, string> = {
  "auth.login.success": "Sign-in succeeded", "auth.login.failure": "Sign-in failed",
  "auth.mfa.failure": "Second-factor code rejected", "auth.mfa.success": "Second-factor code accepted",
};

export function buildAuthEventArgs(i: AuthEventInput): Record<string, unknown> {
  return {
    p_actor: i.uid ?? null, p_workspace: null, p_action: i.action, p_summary: SUMMARY[i.action], p_object_table: "auth",
    p_object_id: i.uid ?? null, p_detail: { ...(i.email ? { email_tag: emailTag(i.email) } : {}), via: i.via ?? "password" },
    p_source: "ui", p_actor_kind: i.uid ? "user" : "system", p_request_id: null,
    p_ip: i.ip && i.ip !== "unknown" ? i.ip : null, p_user_agent: i.userAgent ? i.userAgent.slice(0, 300) : null,
  };
}

export async function recordAuthEvent(i: AuthEventInput, deps: { service?: () => Rpc; log?: (m: string) => void } = {}): Promise<void> {
  const log = deps.log ?? ((m: string) => console.warn(`[auth-audit] ${m}`));
  try {
    const svc = deps.service ? deps.service() : ((await import("../db/service")).serviceDb() as unknown as Rpc);
    const { error } = await svc.rpc("audit_record_server", buildAuthEventArgs(i));
    if (error) log(`${i.action} not recorded (${error.code ?? "error"})`);
  } catch (e) { log(`${i.action} not recorded (${e instanceof Error ? e.message : "error"})`); }
}
