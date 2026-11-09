// Transport port: what the send pipeline needs from Resend, SMTP or the sandbox. Errors are classified here so the pipeline can
// tell "the connection is broken" (CredentialError), "try again later" (TransientError) and "this message will never go" (EmailApiError).
import type { Address } from "./mime";

export interface OutboundEmail {
  from: Address; to: Address; replyTo?: Address; subject: string; text: string; html?: string;
  headers: Record<string, string>;
  /** Provider-side tags (ASCII letters, digits, _ and - only): used to correlate webhooks. */
  tags: Record<string, string>;
  /** Stable per logical message; Resend de-duplicates repeats of it for 24 h. */
  idempotencyKey: string;
}
export interface SendReceipt { providerId: string }

export type DomainRecordKind = "spf" | "dkim" | "dmarc" | "return_path" | "other";
export type DomainRecordStatus = "verified" | "pending" | "failed" | "not_started" | "unknown";
export interface DomainRecord { kind: DomainRecordKind; type: string; host: string; value: string; status: DomainRecordStatus }
export interface DomainState {
  /** "showcase" = sandbox transport: nothing was checked. "unknown" = the provider could not be asked. */
  status: "verified" | "pending" | "failed" | "not_started" | "unknown" | "showcase";
  domain: string; domainId?: string; records: DomainRecord[]; checkedAt: string;
}

export interface EmailTransport {
  kind: "resend" | "smtp" | "mock";
  send(m: OutboundEmail): Promise<SendReceipt>;
  /** Cheap authenticated check used when connecting: resolves when the credentials work, throws CredentialError when they do not. */
  ping(): Promise<void>;
  /** Provider-managed sending domain (Resend). Absent for SMTP: its state comes from a DNS lookup instead. */
  domain?: {
    ensure(domain: string): Promise<DomainState>;
    refresh(domainId: string, domain: string): Promise<DomainState>;
  };
}

export type FailureKind = "invalid_recipient" | "rejected" | "invalid_request" | "message_too_large" | "unknown";
export class EmailApiError extends Error {
  constructor(message: string, readonly status: number, readonly failure: FailureKind, readonly transient = false) { super(message); this.name = "EmailApiError"; }
}
/** A recipient the provider refused permanently: the same as a hard bounce, and it suppresses the address. */
export const isRecipientRefusal = (e: unknown): boolean => e instanceof EmailApiError && e.failure === "invalid_recipient";
