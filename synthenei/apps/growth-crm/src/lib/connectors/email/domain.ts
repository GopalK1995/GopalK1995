// Per-tenant sending-domain verification state. Resend answers from its API (DKIM/SPF records and their status); SMTP is checked by
// DNS lookup. The result is stored in the connection's `health.domain` and shown on /settings/email exactly as returned: a sandbox
// connection says "showcase", an unreachable provider says "unknown". Nothing here ever reports "verified" without evidence.
import { resolveTxt } from "node:dns/promises";
import { CredentialError } from "../core/types";
import type { ConnectionRow } from "../core/types";
import { checkDomainDns } from "./dns-check";
import { domainOf, senderOf } from "./config";
import type { DomainState, EmailTransport } from "./transport";

export type DomainCheck = { ok: true; state: DomainState } | { ok: false; reason: "no_sender" | "provider_error" | "unreachable" | "credentials" };

export async function checkSendingDomain(conn: ConnectionRow, transport: EmailTransport, now: Date, resolver: (h: string) => Promise<string[][]> = resolveTxt): Promise<DomainCheck> {
  const sender = senderOf(conn.settings);
  const domain = domainOf(sender.fromEmail);
  if (!domain) return { ok: false, reason: "no_sender" };
  try {
    if (transport.domain) {
      const state = sender.domainId ? await transport.domain.refresh(sender.domainId, domain) : await transport.domain.ensure(domain);
      return { ok: true, state };
    }
    return { ok: true, state: await checkDomainDns(resolver, domain, sender.dkimSelector, now) };
  } catch (e) {
    if (e instanceof CredentialError) return { ok: false, reason: "credentials" };
    return { ok: false, reason: e instanceof Error && e.name === "EmailApiError" ? "provider_error" : "unreachable" };
  }
}

/** The domain state a page shows, from connection.health. Missing or malformed = null ("not checked yet"). */
export function domainStateOf(health: unknown): DomainState | null {
  const d = health && typeof health === "object" ? (health as { domain?: unknown }).domain : null;
  if (!d || typeof d !== "object") return null;
  const s = d as DomainState;
  return typeof s.domain === "string" && typeof s.status === "string" && Array.isArray(s.records) ? s : null;
}
