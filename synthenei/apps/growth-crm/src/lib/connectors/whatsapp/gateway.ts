// The seam between the connector logic and the vendor. Two implementations: graph.ts (real Cloud API) and mock.ts (sandbox, no network).
import { CredentialError, TransientError } from "../core/types";

export interface SendResult { wamid: string }
export interface ProviderTemplate { id: string; name: string; language: string; status: string; category: string; components: unknown[]; rejectedReason?: string }
export interface PhoneInfo { displayNumber: string; verifiedName?: string; quality: "green" | "yellow" | "red" | "unknown"; messagingLimitTier?: string }
export interface MediaInfo { url: string; mime?: string; sha256?: string; size?: number }
export interface MediaBytes { bytes: Uint8Array; mime?: string }

export interface WhatsAppGateway {
  /** "mock" never touches the network; the UI shows the Showcase label for it. */
  readonly kind: "graph" | "mock";
  sendText(i: { to: string; body: string; replyToWamid?: string }): Promise<SendResult>;
  sendTemplate(i: { to: string; name: string; language: string; bodyParams: string[] }): Promise<SendResult>;
  listTemplates(): Promise<ProviderTemplate[]>;
  getPhoneNumber(): Promise<PhoneInfo>;
  getMediaInfo(mediaId: string): Promise<MediaInfo>;
  downloadMedia(url: string, maxBytes: number): Promise<MediaBytes>;
}

export type ApiFailure =
  | "window_closed" | "rate_limited" | "recipient_not_allowed" | "invalid_recipient" | "user_limit" | "template" | "account" | "other";

/** A Graph API error with the vendor code kept, so a failed send can say why. The message never carries the request body. */
export class WhatsAppApiError extends Error {
  constructor(public code: number, message: string, public httpStatus: number, public failure: ApiFailure, public transient: boolean) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

const WINDOW = new Set([131047]);
const RATE = new Set([130429, 131056, 80007, 4, 17, 32, 613]);
const NOT_ALLOWED = new Set([131030]);
const INVALID_RECIPIENT = new Set([131026, 131021, 1013]);
const USER_LIMIT = new Set([131048, 131049]);
const TEMPLATE = new Set([132000, 132001, 132005, 132007, 132012, 132015, 132016, 131009]);
const ACCOUNT = new Set([131031, 131042, 131045, 133010]);
const TRANSIENT = new Set([1, 2, 131000, 131016, 133004]);

export function classifyError(code: number, httpStatus: number): { failure: ApiFailure; transient: boolean } {
  if (WINDOW.has(code)) return { failure: "window_closed", transient: false };
  if (RATE.has(code)) return { failure: "rate_limited", transient: true };
  if (NOT_ALLOWED.has(code)) return { failure: "recipient_not_allowed", transient: false };
  if (INVALID_RECIPIENT.has(code)) return { failure: "invalid_recipient", transient: false };
  if (USER_LIMIT.has(code)) return { failure: "user_limit", transient: false };
  if (TEMPLATE.has(code)) return { failure: "template", transient: false };
  if (ACCOUNT.has(code)) return { failure: "account", transient: false };
  return { failure: "other", transient: TRANSIENT.has(code) || httpStatus >= 500 || httpStatus === 429 };
}

/** Maps a Graph error body ({error:{code,message,...}}) to the right throwable. 401 / code 190 = dead token = CredentialError. */
export function errorFromResponse(status: number, body: unknown): Error {
  const e = body && typeof body === "object" ? (body as { error?: Record<string, unknown> }).error : undefined;
  const code = typeof e?.code === "number" ? e.code : 0;
  if (status === 401 || code === 190) return new CredentialError("WhatsApp rejected the access token");
  const c = classifyError(code, status);
  // The vendor message can quote the recipient; keep only the code and a fixed label.
  return new WhatsAppApiError(code, `WhatsApp API error ${code || status}`, status, c.failure, c.transient);
}

export const isTransientFailure = (e: unknown): boolean => e instanceof TransientError || (e instanceof WhatsAppApiError && e.transient);
