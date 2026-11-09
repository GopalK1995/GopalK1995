// The seam between the connector logic and Razorpay. Two implementations: api.ts (real REST API) and mock.ts (showcase, no network).
import { CredentialError, TransientError } from "../core/types";

export interface CreateLinkInput {
  amount: number; currency: string; referenceId: string; description: string; notes: Record<string, string>;
  customer?: { name?: string; email?: string; contact?: string }; expireBy?: number; callbackUrl?: string;
}
export interface LinkResult { id: string; shortUrl: string; status: string }
export interface CreateOrderInput { amount: number; currency: string; receipt: string; notes: Record<string, string> }
export interface OrderResult { id: string; status: string }
export interface RefundInfo { id: string; paymentId: string; amount: number; currency: string; status: string; createdAt?: string }
export interface AccountProbe { ok: true; mode: "test" | "live" }

export interface RazorpayGateway {
  /** "mock" never touches the network; the UI shows the Showcase label for it. */
  readonly kind: "api" | "mock";
  probe(): Promise<AccountProbe>;
  createPaymentLink(i: CreateLinkInput): Promise<LinkResult>;
  cancelPaymentLink(id: string): Promise<void>;
  createOrder(i: CreateOrderInput): Promise<OrderResult>;
  /** Read-only. */
  listRefunds(paymentId: string): Promise<RefundInfo[]>;
}

export type ApiFailure = "bad_request" | "auth" | "not_found" | "rate_limited" | "server" | "other";

/** A vendor error with the vendor code kept. The message never carries the request body, keys or customer details. */
export class RazorpayApiError extends Error {
  constructor(public code: string, message: string, public httpStatus: number, public failure: ApiFailure, public transient: boolean) { super(message); this.name = "RazorpayApiError"; }
}

/** Maps an error body ({error:{code,description,field}}) to the right throwable. 401 = dead keys = CredentialError. */
export function errorFromResponse(status: number, body: unknown): Error {
  const e = body && typeof body === "object" ? (body as { error?: Record<string, unknown> }).error : undefined;
  const code = typeof e?.code === "string" ? e.code : "";
  if (status === 401) return new CredentialError("Razorpay rejected the API keys");
  // The vendor description can echo customer fields; keep only the code and a fixed label.
  if (status === 429) return new RazorpayApiError(code || "RATE_LIMIT", "Razorpay API rate limited", status, "rate_limited", true);
  if (status >= 500) return new RazorpayApiError(code || "SERVER_ERROR", `Razorpay API error ${status}`, status, "server", true);
  if (status === 404) return new RazorpayApiError(code || "NOT_FOUND", "Razorpay API: not found", status, "not_found", false);
  if (status === 403) return new RazorpayApiError(code || "FORBIDDEN", "Razorpay API: forbidden", status, "auth", false);
  return new RazorpayApiError(code || "BAD_REQUEST_ERROR", `Razorpay API error ${code || status}`, status, "bad_request", false);
}
export const isTransientFailure = (e: unknown): boolean => e instanceof TransientError || (e instanceof RazorpayApiError && e.transient);
