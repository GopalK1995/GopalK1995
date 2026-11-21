// Webhook subscription for the booking connectors. The connection's health.booking_webhook holds { state, id?, at } and is what the UI reads
// (subscriptionState): the framework's generic http client hides the vendor's 403 text, and "paid plan needed" is exactly that 403, so these calls use fetch directly.
// Nothing here logs a token, a signing key or a response body.
import { randomBytes } from "node:crypto";
import type { ConnectorStore } from "../core/ports";
import { CredentialError, type ConnectionRow } from "../core/types";

export type SubscriptionCode = "not_subscribed" | "subscribed" | "needs_paid_plan" | "user_scope" | "needs_attention" | "error";
export interface SubscriptionState { code: SubscriptionCode; /** Key in messages/<locale>/calendly.json. */ messageKey: string; id?: string; at?: string }
export const stateOf = (code: SubscriptionCode, extra: { id?: string; at?: string } = {}): SubscriptionState => ({ code, messageKey: `state_${code}`, ...extra });

const CODES = new Set<string>(["not_subscribed", "subscribed", "needs_paid_plan", "user_scope", "needs_attention", "error"]);
/** Reads the stored state for the connection card; a connection never subscribed reads as not_subscribed. */
export function subscriptionState(health: unknown): SubscriptionState {
  const w = (health && typeof health === "object" ? (health as Record<string, unknown>).booking_webhook : undefined) as Record<string, unknown> | undefined;
  const code = typeof w?.state === "string" && CODES.has(w.state) ? (w.state as SubscriptionCode) : "not_subscribed";
  return stateOf(code, { id: typeof w?.id === "string" ? w.id : undefined, at: typeof w?.at === "string" ? w.at : undefined });
}

/** A fresh random signing key for the connect form to prefill (the tenant may replace it). */
export const newSigningKey = (): string => randomBytes(32).toString("hex");

/** The URL the vendor posts to. `base` is APP_BASE_URL. */
export function webhookUrlFor(base: string | undefined, connectorId: string, connectionId: string): string {
  return `${(base ?? "").replace(/\/+$/, "")}/api/hooks/${connectorId}/${connectionId}`;
}

export interface VendorReply { status: number; body: unknown }
export type VendorFetch = (method: string, url: string, headers: Record<string, string>, body?: unknown) => Promise<VendorReply>;
export function vendorFetch(fetchImpl: typeof fetch = fetch): VendorFetch {
  return async (method, url, headers, body) => {
    const res = await fetchImpl(url, {
      method, headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    let parsed: unknown = null;
    try { parsed = res.status === 204 ? null : await res.json(); } catch { /* no JSON body */ }
    return { status: res.status, body: parsed };
  };
}
export const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
export const strOf = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Persists the state on the connection (health.booking_webhook) and flags needs_attention when the vendor refused the token. */
export async function saveState(store: Pick<ConnectorStore, "updateConnection">, conn: ConnectionRow, s: SubscriptionState, now: Date): Promise<SubscriptionState> {
  const out = { ...s, at: now.toISOString() };
  await store.updateConnection(conn.id, { health: { booking_webhook: { state: out.code, ...(out.id ? { id: out.id } : {}), at: out.at } }, ...(out.code === "needs_attention" ? { status: "needs_attention" as const } : {}) });
  return out;
}

/** Runs a vendor-specific subscribe and turns thrown credential errors / network failures into a state; never throws a vendor message. */
export async function guarded(run: () => Promise<SubscriptionState>): Promise<SubscriptionState> {
  try { return await run(); }
  catch (e) { return stateOf(e instanceof CredentialError ? "needs_attention" : "error"); }
}
